import { attachCardImage, imageConfig, normalizeCardImageUrl } from './card-images.js';
import { makeId, normalizeText } from './utils.js';

export const IMAGE_ENRICHMENT_VERSION = 'image-enrichment-v1.0';

const APPROVED_AUTHORIZATION = new Set([
  'official_api',
  'ebay_api',
  'written_license',
  'commercial_partner',
  'user_authorized_export',
  'user_csv',
]);

function clean(value, max = 1000) {
  return String(value ?? '').trim().slice(0, max);
}

function sourceModeOf(source = {}, row = {}) {
  return clean(row.sourceMode || source.sourceMode || source.mode || 'production', 80);
}

function authOf(source = {}, row = {}) {
  return clean(row.authorizationBasis || source.authorizationBasis || (sourceModeOf(source, row) === 'demo' ? 'demo' : 'unknown'), 80);
}

function cardById(cards = []) {
  return new Map(cards.map((card) => [card.id, card]));
}

function coverageKey(card = {}, field) {
  return clean(card[field] || 'Unknown', 160) || 'Unknown';
}

function increment(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function asCounts(map) {
  return [...map.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || String(a.label).localeCompare(String(b.label)));
}

export function publicImageOverrideMap(overrides = {}) {
  return Object.fromEntries(Object.entries(overrides || {}).map(([cardId, record]) => [cardId, {
    cardId,
    imageUrl: record.imageUrl,
    source: record.source,
    sourceMode: record.sourceMode,
    authorizationBasis: record.authorizationBasis,
    dataRightsStatus: record.dataRightsStatus,
    rightsNotes: record.rightsNotes,
    providerBatchId: record.providerBatchId,
    importedBy: record.importedBy,
    disabledAt: record.disabledAt || null,
  }]));
}

export function imageCoverageReport({ cards = [], sales = [], config = {}, overrides = {} } = {}) {
  const bySport = new Map();
  const byGame = new Map();
  const bySet = new Map();
  const bySource = new Map();
  const resolvedCards = cards.map((card) => attachCardImage(card, imageConfig(config), {
    sales: sales.filter((sale) => sale.cardId === card.id),
    imageOverrides: overrides,
  }));
  const covered = resolvedCards.filter((card) => !card.imageMeta?.placeholder);
  for (const card of resolvedCards) {
    increment(bySport, coverageKey(card, 'sport'));
    increment(byGame, coverageKey(card, 'brand'));
    increment(bySet, [card.sport || 'Other', card.year || 'Unknown', card.brand || 'Unknown', card.set || 'Unknown'].join(' | '));
    increment(bySource, card.imageMeta?.sourceLabel || card.imageMeta?.source || 'Unknown');
  }
  return {
    version: IMAGE_ENRICHMENT_VERSION,
    totalCards: cards.length,
    cardsWithImages: covered.length,
    cardsWithPlaceholder: cards.length - covered.length,
    imageCoveragePct: cards.length ? Math.round((covered.length / cards.length) * 1000) / 10 : 0,
    directImageCount: resolvedCards.filter((card) => ['local_asset', 'remote_source'].includes(card.imageMeta?.status)).length,
    providerImageCount: resolvedCards.filter((card) => card.imageMeta?.status === 'provider_sale_image').length,
    overrideImageCount: resolvedCards.filter((card) => card.imageMeta?.status === 'image_enrichment_override').length,
    remoteTemplateCount: resolvedCards.filter((card) => card.imageMeta?.status === 'remote_template').length,
    placeholderCount: resolvedCards.filter((card) => card.imageMeta?.placeholder).length,
    bySport: asCounts(bySport),
    byGame: asCounts(byGame),
    bySet: asCounts(bySet).slice(0, 100),
    bySource: asCounts(bySource),
    missingExamples: resolvedCards.filter((card) => card.imageMeta?.placeholder).slice(0, 25).map((card) => ({
      id: card.id,
      title: [card.year, card.brand, card.set, card.player, card.cardNumber ? `#${card.cardNumber}` : ''].filter(Boolean).join(' '),
      sport: card.sport,
      catalogSource: card.catalogSource,
    })),
    policy: 'Coverage reports image availability only. It does not imply universal catalog coverage or completed-sale pricing coverage.',
  };
}

export function validateImageEnrichmentRows(rows = [], { cards = [], config = {}, source = {} } = {}) {
  const options = imageConfig(config);
  const cardsById = cardById(cards);
  const accepted = [];
  const rejected = [];
  const warnings = [];
  const providerBatchId = clean(source.providerBatchId || makeId('image_batch'), 160);

  for (const [index, row] of rows.entries()) {
    const rowNumber = row.__row || index + 1;
    const cardId = clean(row.cardId || row.id, 200);
    const imageUrl = clean(row.imageUrl || row.image || row.url, 1000);
    const sourceMode = sourceModeOf(source, row);
    const authorizationBasis = authOf(source, row);
    const normalized = normalizeCardImageUrl(imageUrl, options);
    if (!cardId || !cardsById.has(cardId)) {
      rejected.push({ row: rowNumber, cardId, error: 'Unknown or missing cardId.' });
      continue;
    }
    if (!normalized?.remote) {
      rejected.push({ row: rowNumber, cardId, error: 'Image URL must be HTTPS and hosted on an allowed image source.' });
      continue;
    }
    if (sourceMode !== 'demo' && !APPROVED_AUTHORIZATION.has(authorizationBasis)) {
      rejected.push({ row: rowNumber, cardId, error: 'Image source lacks approved authorization basis.' });
      continue;
    }
    const dataRightsStatus = clean(row.dataRightsStatus || source.dataRightsStatus || 'image_display_authorized', 160);
    accepted.push({
      cardId,
      imageUrl: normalized.url,
      source: clean(row.source || row.provider || source.provider || source.source || normalized.host, 160),
      sourceMode,
      authorizationBasis,
      dataRightsStatus,
      rightsNotes: clean(row.rightsNotes || source.rightsNotes || 'Approved card image enrichment URL.', 1000),
      providerBatchId,
      importedBy: clean(source.importedBy, 200),
    });
  }

  return {
    version: IMAGE_ENRICHMENT_VERSION,
    providerBatchId,
    accepted,
    rejected,
    warnings,
    summary: {
      rows: rows.length,
      accepted: accepted.length,
      rejected: rejected.length,
      allowedHosts: [...options.allowedHosts].sort(),
    },
  };
}

export async function ingestImageEnrichment({ rows = [], cards = [], sales = [], store, source = {}, actor = null, config = {}, dryRun = false } = {}) {
  if (!store) throw new Error('store is required');
  const validation = validateImageEnrichmentRows(rows, {
    cards,
    config,
    source: { ...source, importedBy: actor?.userId || source.importedBy || null },
  });
  const before = imageCoverageReport({ cards, sales, config, overrides: store.state.cardImageOverrides || {} });
  if (dryRun) {
    const nextOverrides = {
      ...(store.state.cardImageOverrides || {}),
      ...Object.fromEntries(validation.accepted.map((record) => [record.cardId, record])),
    };
    return {
      ...validation,
      dryRun: true,
      result: { added: 0, updated: 0, dryRun: true },
      coverageBefore: before,
      coverageAfter: imageCoverageReport({ cards, sales, config, overrides: nextOverrides }),
    };
  }
  const result = await store.upsertCardImageOverrides(validation.accepted, { actor });
  return {
    ...validation,
    dryRun: false,
    result,
    coverageBefore: before,
    coverageAfter: imageCoverageReport({ cards, sales, config, overrides: store.state.cardImageOverrides || {} }),
  };
}

export async function rollbackImageEnrichmentBatch(store, providerBatchId, { actor = null, reason = '' } = {}) {
  if (!store) throw new Error('store is required');
  return store.rollbackCardImageBatch(providerBatchId, { actor, reason });
}

export function sourceCoverageWarnings(report = {}) {
  const warnings = [];
  if ((report.imageCoveragePct || 0) < 50) warnings.push('Image coverage is below 50%; many cards will use placeholders until approved image sources are imported.');
  if ((report.placeholderCount || 0) > 0) warnings.push(`${report.placeholderCount} catalog cards still have no approved image source.`);
  if ((report.overrideImageCount || 0) > 0) warnings.push('Owner image overrides are active; keep rights metadata current.');
  return warnings;
}
