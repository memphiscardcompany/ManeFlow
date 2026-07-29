import { normalizeCatalogCard, smartMatchCard } from './catalog.js';
import { normalizeSale } from './normalizer.js';
import { scoreComps, summarizeCompQuality, publicCompSummary } from './comp-quality.js';
import { summarizeDataHealth } from './data-health.js';
import { makeId, normalizeText, roundMoney } from './utils.js';

export const PRICING_DATA_VERSION = 'pricing-data-v1.0';

export const APPROVED_AUTHORIZATION_BASES = new Set([
  'official_api',
  'ebay_api',
  'written_license',
  'commercial_partner',
  'user_authorized_export',
  'user_csv',
]);

export const PRICING_IMPORT_HEADERS = [
  'provider',
  'authorizationBasis',
  'sourceMode',
  'rawProviderId',
  'rawUrl',
  'imageUrl',
  'title',
  'soldAt',
  'price',
  'shipping',
  'buyerPremium',
  'currency',
  'saleType',
  'listingType',
  'isCompletedSale',
  'player',
  'year',
  'brand',
  'set',
  'cardNumber',
  'parallel',
  'serialNumber',
  'grader',
  'grade',
  'condition',
  'verified',
  'confidence',
  'rightsNotes',
];

function clean(value, fallback = '') {
  const output = String(value ?? fallback).trim();
  return output;
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'y', 'completed', 'sold'].includes(normalizeText(value));
}

function isApprovedAuthorizationBasis(value) {
  return APPROVED_AUTHORIZATION_BASES.has(clean(value));
}

function sourceModeOf(source = {}, row = {}) {
  return clean(row.sourceMode || source.sourceMode || source.mode || 'production');
}

function authorizationBasisOf(source = {}, row = {}) {
  return clean(row.authorizationBasis || source.authorizationBasis || (sourceModeOf(source, row) === 'demo' ? 'demo' : 'unknown'));
}

function saleFingerprint(sale) {
  return [
    normalizeText(sale.provider || 'unknown'),
    sale.rawProviderId ? `raw:${normalizeText(sale.rawProviderId)}` : '',
    normalizeText(sale.title || ''),
    String(sale.soldAt || '').slice(0, 10),
    String(sale.allInPrice ?? sale.price ?? ''),
    sale.cardId || sale.cardKey || '',
  ].filter(Boolean).join('|');
}

function validateSource(source = {}, { requireProductionAuthorization = true } = {}) {
  const sourceMode = clean(source.sourceMode || source.mode || 'production');
  const authorizationBasis = clean(source.authorizationBasis || (sourceMode === 'demo' ? 'demo' : 'unknown'));
  const errors = [];
  const warnings = [];
  if (!clean(source.provider)) errors.push('provider is required');
  if (sourceMode !== 'demo' && requireProductionAuthorization && !isApprovedAuthorizationBasis(authorizationBasis)) {
    errors.push('authorizationBasis must be official_api, ebay_api, written_license, commercial_partner, user_authorized_export, or user_csv for production pricing data');
  }
  if (sourceMode === 'demo' && authorizationBasis !== 'demo') warnings.push('Demo sources should use authorizationBasis=demo.');
  return {
    ok: errors.length === 0,
    provider: clean(source.provider),
    sourceMode,
    authorizationBasis,
    dataRightsStatus: clean(source.dataRightsStatus || (sourceMode === 'demo' ? 'demo_only' : 'authorized_input_required')),
    refreshPolicy: clean(source.refreshPolicy || 'manual_batch'),
    rightsNotes: clean(source.rightsNotes || source.notes || ''),
    errors,
    warnings,
  };
}

function coerceRow(row = {}, source = {}, importedBy = null) {
  const sourceMode = sourceModeOf(source, row);
  const authorizationBasis = authorizationBasisOf(source, row);
  const completed = bool(row.isCompletedSale, false) || ['sold', 'completed', 'completed_sale'].includes(normalizeText(row.sourceType || row.listingType || ''));
  return {
    ...row,
    provider: clean(row.provider || source.provider),
    sourceMode,
    authorizationBasis,
    sourceType: row.sourceType || (completed ? 'sold' : 'active_listing'),
    listingType: row.listingType || (completed ? 'completed' : 'active'),
    saleType: row.saleType || (completed ? 'fixed_price' : 'asking'),
    isCompletedSale: completed,
    soldAt: row.soldAt || row.date || row.endedAt || null,
    price: row.price ?? row.amount ?? row.salePrice,
    shipping: row.shipping ?? row.shippingPrice ?? 0,
    buyerPremium: row.buyerPremium ?? 0,
    verified: bool(row.verified, sourceMode !== 'demo' && ['official_api', 'ebay_api', 'written_license', 'commercial_partner'].includes(authorizationBasis)),
    confidence: Number.isFinite(Number(row.confidence)) ? Number(row.confidence) : (authorizationBasis === 'official_api' ? 0.95 : authorizationBasis === 'user_csv' ? 0.72 : 0.82),
    rawProviderId: clean(row.rawProviderId || row.itemId || row.orderLineItemId || row.saleId || ''),
    rawUrl: clean(row.rawUrl || row.url || ''),
    dataRightsStatus: clean(row.dataRightsStatus || source.dataRightsStatus || ''),
    refreshPolicy: clean(row.refreshPolicy || source.refreshPolicy || ''),
    importedBy,
    importedAt: row.importedAt || new Date().toISOString(),
    rightsNotes: clean(row.rightsNotes || source.rightsNotes || ''),
  };
}

export function buildPricingImportTemplate() {
  return PRICING_IMPORT_HEADERS.join(',') + '\n'
    + 'eBay Seller Export,user_authorized_export,production,1234567890,https://example.com/sale,https://i.ebayimg.com/images/g/example/s-l500.jpg,"2018 Topps Update Shohei Ohtani US1 PSA 10",2026-07-01,125,6.5,0,USD,fixed_price,completed,true,Shohei Ohtani,2018,Topps,Update,US1,Base,,PSA,10,Graded,true,0.9,"Authorized seller export"\n';
}

export function validatePricingRows(rows = [], { source = {}, cards = [], now = new Date(), requireProductionAuthorization = true } = {}) {
  const sourceCheck = validateSource(source, { requireProductionAuthorization });
  const errors = sourceCheck.errors.map((error) => ({ row: null, error }));
  const warnings = sourceCheck.warnings.map((warning) => ({ row: null, warning }));
  const normalized = [];
  const review = [];
  const rejected = [];
  const seen = new Set();

  for (const [index, row] of rows.entries()) {
    const rowNumber = row.__row || index + 1;
    try {
      const coerced = coerceRow(row, sourceCheck, source.importedBy || source.actorId || null);
      if (coerced.sourceMode !== 'demo' && requireProductionAuthorization && !isApprovedAuthorizationBasis(coerced.authorizationBasis)) {
        throw new Error('Row lacks approved authorization basis.');
      }
      let cardId = clean(coerced.cardId || '');
      let match = null;
      if (!cardId && cards.length) {
        match = smartMatchCard(cards, coerced);
        if (match.accepted) cardId = match.best.id;
        else if (match.best) review.push({ row: rowNumber, reason: 'Card match needs review', query: match.query, matches: match.matches.map((item) => ({ id: item.id, player: item.player, year: item.year, set: item.set, confidence: item.confidence })) });
      }
      if (cardId && cards.length && !cards.some((card) => card.id === cardId)) throw new Error(`Unknown cardId: ${cardId}`);
      const sale = normalizeSale({ ...coerced, cardId }, sourceCheck.provider);
      const fingerprint = saleFingerprint(sale);
      if (seen.has(fingerprint)) {
        rejected.push({ row: rowNumber, error: 'Duplicate sale within import batch.', fingerprint });
        continue;
      }
      seen.add(fingerprint);
      normalized.push(sale);
    } catch (error) {
      errors.push({ row: rowNumber, error: error.message });
    }
  }

  const scored = scoreComps(normalized, { now, demoMode: sourceCheck.sourceMode === 'demo' || source.demoMode !== false });
  const compQuality = summarizeCompQuality(scored);
  return {
    version: PRICING_DATA_VERSION,
    source: sourceCheck,
    normalized,
    scored,
    errors,
    warnings,
    review,
    rejected,
    summary: {
      rows: rows.length,
      normalized: normalized.length,
      errors: errors.length,
      warnings: warnings.length,
      review: review.length,
      rejected: rejected.length,
      valuationEligible: scored.filter((sale) => sale.valuationUse).length,
      compQuality,
    },
  };
}

export async function ingestPricingData({ rows = [], cards = [], store, source = {}, actor = null, config = {}, now = new Date(), dryRun = false } = {}) {
  if (!store) throw new Error('store is required');
  const providerRunId = source.providerRunId || makeId('provider_run');
  const providerBatchId = source.providerBatchId || makeId('provider_batch');
  const validation = validatePricingRows(rows, {
    source: { ...source, actorId: actor?.userId || source.importedBy || null, providerRunId, providerBatchId },
    cards,
    now,
    requireProductionAuthorization: source.sourceMode !== 'demo',
  });
  const insertable = validation.scored.map((sale) => ({
    ...sale,
    providerRunId,
    providerBatchId,
    importedBy: actor?.userId || sale.importedBy || source.importedBy || null,
  })).filter((sale) => {
    if (sale.sourceMode === 'demo') return Boolean(config.demoMode);
    return isApprovedAuthorizationBasis(sale.authorizationBasis);
  });
  const result = dryRun ? { added: 0, updated: 0, skipped: insertable.length, dryRun: true }
    : typeof store.upsertCustomSales === 'function'
    ? await store.upsertCustomSales(insertable)
    : { added: await store.addCustomSales(insertable), updated: 0, skipped: 0 };
  const ingestSummary = {
    providerRunId,
    providerBatchId,
    provider: validation.source.provider,
    authorizationBasis: validation.source.authorizationBasis,
    sourceMode: validation.source.sourceMode,
    dataRightsStatus: validation.source.dataRightsStatus,
    dryRun,
    rows: rows.length,
    salesAdded: result.added ?? result,
    salesUpdated: result.updated || 0,
    salesSkipped: result.skipped || 0,
    saleErrors: validation.errors.length,
    review: validation.review.length,
    rejected: validation.rejected.length,
    valuationEligible: validation.summary.valuationEligible,
    compQuality: validation.summary.compQuality,
  };
  const ingest = dryRun ? { id: providerRunId, ...ingestSummary, createdAt: now.toISOString(), notPersisted: true }
    : await store.recordProviderIngest(ingestSummary);
  return { ...validation, result, ingest };
}

export async function rollbackPricingBatch(store, { providerRunId = null, providerBatchId = null, actor = null, reason = '' } = {}) {
  if (!store) throw new Error('store is required');
  if (!providerRunId && !providerBatchId) throw new Error('providerRunId or providerBatchId is required');
  const before = store.state.customSales.length;
  const removed = store.state.customSales.filter((sale) => (
    (providerRunId && sale.providerRunId === providerRunId) || (providerBatchId && sale.providerBatchId === providerBatchId)
  ));
  store.state.customSales = store.state.customSales.filter((sale) => !removed.includes(sale));
  await store.audit({
    type: 'pricing_batch_rollback',
    providerRunId,
    providerBatchId,
    removed: removed.length,
    actorUserId: actor?.userId || null,
    reason: String(reason || '').slice(0, 1000),
  });
  return { removed: removed.length, before, after: store.state.customSales.length };
}

export function summarizePricingData({ sales = [], cards = [], providers = [], config = {}, now = new Date(), overrides = {} } = {}) {
  const health = summarizeDataHealth({ sales, cards, providers, config, now, overrides });
  const scored = scoreComps(sales, { now, demoMode: config.demoMode !== false, overrides });
  const byProvider = new Map();
  for (const sale of scored) {
    const key = sale.provider || 'Unknown';
    if (!byProvider.has(key)) byProvider.set(key, { provider: key, total: 0, included: 0, review: 0, excluded: 0, value: 0, qualitySum: 0 });
    const row = byProvider.get(key);
    row.total += 1;
    if (sale.valuationUse) {
      row.included += 1;
      row.value += Number(sale.allInPrice || 0);
    } else if (sale.inclusionStatus === 'needs_review') row.review += 1;
    else row.excluded += 1;
    row.qualitySum += Number(sale.qualityScore || 0);
  }
  return {
    version: PRICING_DATA_VERSION,
    generatedAt: now.toISOString(),
    readyForPublicValueClaims: health.readyForPublicValueClaims,
    blockers: health.publicValueBlockers,
    totals: {
      totalComps: health.totalComps,
      authorizedComps: health.authorizedComps,
      unauthorizedComps: health.unauthorizedComps,
      demoComps: health.demoComps,
      productionComps: health.productionComps,
      valuationEligible: scored.filter((sale) => sale.valuationUse).length,
      needsReview: health.compsNeedingReview,
    },
    providerQuality: [...byProvider.values()].map((row) => ({
      ...row,
      totalValue: roundMoney(row.value),
      averageQualityScore: row.total ? Math.round(row.qualitySum / row.total) : 0,
      inclusionRate: row.total ? Math.round((row.included / row.total) * 1000) / 10 : 0,
    })).sort((a, b) => b.included - a.included || b.averageQualityScore - a.averageQualityScore),
    publicCompsSample: scored.slice(0, 25).map(publicCompSummary),
    dataHealth: health,
  };
}

export function normalizeCatalogRows(rows = [], { source = 'pricing_data_import' } = {}) {
  const cards = [];
  const errors = [];
  for (const [index, row] of rows.entries()) {
    try {
      cards.push(normalizeCatalogCard({ ...row, catalogSource: row.catalogSource || source }));
    } catch (error) {
      errors.push({ row: row.__row || index + 1, error: error.message });
    }
  }
  return { cards, errors, total: rows.length };
}
