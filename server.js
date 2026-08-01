import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './src/config.js';
import { assertRuntimeConfig } from './src/services/config-runtime.js';
import { createRouter } from './src/router.js';
import { createStorageAdapter } from './src/services/storage/index.js';
import { TtlCache } from './src/services/cache.js';
import { createProviderRegistry } from './src/services/provider-registry.js';
import { LightOcrService } from './src/ocr-service/lightOcrService.js';
import { DatabaseRuntime } from './src/db/databaseRuntime.js';
import { createMetaOwnerRouter } from './src/manebrain/meta-owner-router.js';
import { createScanPipeline } from './src/services/scan-pipeline.js';
import { createDurableScanJobRouter } from './src/scan-job-router.js';
import { createAutomaticPricingEngine } from './src/services/automatic-pricing.js';
import { createAutomaticPricingRouter } from './src/automatic-pricing-router.js';
import { createReleaseProvenanceRouter } from './src/release-provenance-router.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile?.(path.join(__dirname, '.env'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const config = loadConfig();
const runtimeValidation = assertRuntimeConfig(config);
async function readJsonArrayIfPresent(filePath) {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return [];
  }
}
const baseCards = JSON.parse(await fs.readFile(path.join(__dirname, 'src/data/cards.json'), 'utf8'));
const ownedChecklistCards = await readJsonArrayIfPresent(path.join(__dirname, 'src/data/cards.memphis-owned.json'));
const tcgCatalogCards = await readJsonArrayIfPresent(path.join(__dirname, 'src/data/cards.tcg-imported.json'));
const cards = [...baseCards, ...ownedChecklistCards, ...tcgCatalogCards];
const sales = JSON.parse(await fs.readFile(path.join(__dirname, 'src/data/sales.json'), 'utf8'));
const storage = createStorageAdapter(config);
const store = await storage.init();
const cache = new TtlCache();
const providers = createProviderRegistry(config, sales);
const databaseRuntime = new DatabaseRuntime(config);
if (databaseRuntime.configured) await databaseRuntime.initialize();

function catalog() {
  return [...cards, ...(store.state.customCards || [])];
}

function allPricingSales() {
  const demoSales = config.demoMode
    ? sales.map((sale) => ({
      ...sale,
      sourceMode: 'demo',
      authorizationBasis: 'demo',
      rightsNotes: 'Synthetic demonstration comp. Not a public market value.',
    }))
    : [];
  const corrections = store.compCorrections?.() || {};
  return [...demoSales, ...(store.state.customSales || [])].map((sale) => (
    corrections[sale.id]?.correction
      ? { ...sale, ...corrections[sale.id].correction, corrected: true }
      : sale
  ));
}

function salesForCard(card) {
  return card?.id ? allPricingSales().filter((sale) => sale.cardId === card.id) : [];
}

function saleQueryFromCard(card = {}) {
  const grade = card.grade && typeof card.grade === 'object' ? card.grade.grade : card.grade;
  return [
    card.year,
    card.brand || card.manufacturer,
    card.set || card.product,
    card.player || card.subject,
    card.cardNumber,
    card.parallel || card.variation,
    card.grade?.company || card.grader,
    grade,
  ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

async function activeAskingListingsForCard(card, { limit = 12 } = {}) {
  const ebay = providers.byName.get('eBay');
  if (!card || !ebay?.supportsActiveListings || typeof ebay.searchActiveListings !== 'function') {
    return { listings: [], error: null };
  }
  try {
    const listings = await ebay.searchActiveListings({
      query: saleQueryFromCard(card),
      limit,
      binOnly: true,
    });
    return { listings, error: null };
  } catch (error) {
    return { listings: [], error: String(error?.message || error).slice(0, 800) };
  }
}

const ocrService = new LightOcrService({
  enabled: config.localOcrEnabled,
  provider: config.localOcrProvider,
  queueCapacity: config.localOcrQueueCapacity,
  timeoutMs: config.localOcrTimeoutMs,
});
const releaseProvenanceRouter = createReleaseProvenanceRouter({ config, env: process.env });
const coreRouter = createRouter({ config, cards, sales, providers, store, cache, runtimeValidation, storage, ocrService, databaseRuntime });
const metaOwnerRouter = createMetaOwnerRouter({ config, store, databaseRuntime });
const scanPipeline = createScanPipeline({ config, cards, sales, store, cache, ocrService, databaseRuntime });
const scanJobRuntime = await createDurableScanJobRouter({ config, store, processor: scanPipeline });
const automaticPricingEngine = createAutomaticPricingEngine({
  config,
  providers,
  store,
  cache,
  catalog,
  salesForCard,
  activeAskingListingsForCard,
});
const automaticPricingRouter = createAutomaticPricingRouter({
  config,
  store,
  cache,
  pricingEngine: automaticPricingEngine,
  catalog,
});

if (typeof store.deleteUser === 'function' && typeof scanJobRuntime.spool.deleteOwnerJobs === 'function') {
  const deleteUser = store.deleteUser.bind(store);
  store.deleteUser = async (userId) => {
    const deleted = await deleteUser(userId);
    if (deleted) await scanJobRuntime.spool.deleteOwnerJobs(userId);
    return deleted;
  };
}

const router = async (req, res) => {
  try {
    const releaseHandled = await releaseProvenanceRouter(req, res);
    if (releaseHandled || res.writableEnded) return;
    const metaHandled = await metaOwnerRouter(req, res);
    if (metaHandled || res.writableEnded) return;
    const scanJobHandled = await scanJobRuntime.handle(req, res);
    if (scanJobHandled || res.writableEnded) return;
    const automaticPricingHandled = await automaticPricingRouter(req, res);
    if (automaticPricingHandled || res.writableEnded) return;
    await coreRouter(req, res);
  } catch (error) {
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    }
    if (!res.writableEnded) res.end(JSON.stringify({ error: 'UNHANDLED_REQUEST_FAILURE' }));
    console.error('Unhandled ManeFlow request failure:', error instanceof Error ? error.message : String(error));
  }
};
const server = http.createServer(router);

server.requestTimeout = Math.max(
  30_000,
  Math.min(600_000, Number(process.env.MANEFLOW_HTTP_REQUEST_TIMEOUT_MS || 180_000)),
);
server.headersTimeout = 35_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 100;

server.listen(config.port, config.host, () => {
  console.log(`ManeFlow ${config.version} (${config.releaseChannel})`);
  console.log(`Open ${config.publicBaseUrl}`);
  console.log(`Market mode: ${config.demoMode ? 'DEMO/MIXED — connect approved data before public value claims' : 'PRODUCTION'}`);
  console.log(`Durable scan jobs: ${config.scanJobDir} · concurrency ${config.scanJobConcurrency}`);
  console.log(`Automatic pricing: ${providers.byName.get('eBay')?.marketplaceInsightsEnabled ? 'authorized completed-sale refresh enabled' : 'cached evidence only — Marketplace Insights not enabled'}`);
});

function shutdown(signal) {
  console.log(`\n${signal} received; closing server.`);
  server.close(async () => {
    await Promise.allSettled([
      scanJobRuntime.close(),
      ocrService.close(),
      databaseRuntime.close(),
      storage?.close?.(),
    ]);
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
