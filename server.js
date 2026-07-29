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
import { createScanJobRouter } from './src/scan-job-router.js';
import { ScanJobQueue } from './src/services/scan-job-queue.js';

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
    if (error.code === 'ENOENT') return [];
    throw error;
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

const ocrService = new LightOcrService({
  enabled: config.localOcrEnabled,
  provider: config.localOcrProvider,
  queueCapacity: config.localOcrQueueCapacity,
  timeoutMs: config.localOcrTimeoutMs,
});

async function processQueuedScan({ dataUrl, fileName, signal }) {
  if (!config.serviceToken) {
    const error = new Error('MANEFLOW_SERVICE_TOKEN is required for the internal scan-job worker.');
    error.code = 'SCAN_JOB_WORKER_NOT_CONFIGURED';
    error.status = 503;
    error.retryable = false;
    throw error;
  }
  const timeoutSignal = AbortSignal.timeout(config.httpRequestTimeoutMs);
  const combinedSignal = AbortSignal.any([signal, timeoutSignal]);
  let response;
  try {
    response = await fetch(`http://127.0.0.1:${config.port}/api/scan`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.serviceToken}`,
        'content-type': 'application/json',
        'x-maneflow-internal-job': 'durable-scan-intake',
      },
      body: JSON.stringify({
        frontDataUrl: dataUrl,
        imageName: fileName,
        sourceType: 'durable_scan_job',
      }),
      signal: combinedSignal,
    });
  } catch (cause) {
    const error = new Error(
      cause?.name === 'TimeoutError'
        ? 'Queued scan exceeded the bounded server processing timeout.'
        : 'Queued scan could not reach the internal ManeFlow scan endpoint.',
      { cause },
    );
    error.code = cause?.name === 'TimeoutError' ? 'SCAN_JOB_PROCESSING_TIMEOUT' : 'SCAN_JOB_PROCESSING_NETWORK_FAILURE';
    error.status = cause?.name === 'TimeoutError' ? 408 : 503;
    error.retryable = cause?.name !== 'AbortError';
    throw error;
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message || `Internal scan endpoint returned ${response.status}.`);
    error.code = payload.error || 'SCAN_JOB_PROCESSING_REJECTED';
    error.status = response.status;
    error.retryable = response.status === 408
      || response.status === 409
      || response.status === 425
      || response.status === 429
      || response.status >= 500;
    throw error;
  }
  return payload;
}

const scanJobQueue = await new ScanJobQueue({
  store,
  uploadDirectory: config.scanJobUploadDirectory,
  maximumItems: config.scanJobMaximumItems,
  maximumImageBytes: config.scanJobMaximumImageBytes,
  concurrentJobs: config.scanJobConcurrentJobs,
  concurrentItems: config.scanJobConcurrentItems,
  maximumRetries: config.scanJobMaximumRetries,
  retryBaseDelayMs: config.scanJobRetryBaseDelayMs,
  retainUploads: config.scanJobRetainUploads,
  processor: processQueuedScan,
}).init();

if (typeof store.deleteUser === 'function') {
  const deleteUser = store.deleteUser.bind(store);
  store.deleteUser = async (userId) => {
    const ownedJobs = (store.state.scanJobs || []).filter((job) => job.userId === userId);
    for (const job of ownedJobs) {
      await scanJobQueue.cancelJob(userId, job.id).catch(() => {});
    }
    store.state.scanJobs = (store.state.scanJobs || []).filter((job) => job.userId !== userId);
    await Promise.allSettled(ownedJobs.map((job) => fs.rm(
      path.join(config.scanJobUploadDirectory, job.id),
      { recursive: true, force: true },
    )));
    return deleteUser(userId);
  };
}

const coreRouter = createRouter({ config, cards, sales, providers, store, cache, runtimeValidation, storage, ocrService, databaseRuntime });
const metaOwnerRouter = createMetaOwnerRouter({ config, store, databaseRuntime });
const scanJobRouter = createScanJobRouter({ config, store, queue: scanJobQueue });
const router = async (req, res) => {
  try {
    const ownerHandled = await metaOwnerRouter(req, res);
    if (ownerHandled || res.writableEnded) return;
    const scanJobHandled = await scanJobRouter(req, res);
    if (scanJobHandled || res.writableEnded) return;
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

server.requestTimeout = config.httpRequestTimeoutMs;
server.headersTimeout = 35_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 100;

server.listen(config.port, config.host, () => {
  scanJobQueue.start();
  console.log(`ManeFlow ${config.version} (${config.releaseChannel})`);
  console.log(`Open ${config.publicBaseUrl}`);
  console.log(`Market mode: ${config.demoMode ? 'DEMO/MIXED — connect approved data before public value claims' : 'PRODUCTION'}`);
  console.log(`Durable scan intake: ${config.serviceToken ? 'ready' : 'blocked — MANEFLOW_SERVICE_TOKEN required'}`);
});

function shutdown(signal) {
  console.log(`\n${signal} received; closing server.`);
  server.close(async () => {
    await Promise.allSettled([
      scanJobQueue.close(),
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
