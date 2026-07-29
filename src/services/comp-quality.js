import { clamp, daysAgo, normalizeText, percentile, roundMoney } from './utils.js';

export const COMP_QUALITY_METHODOLOGY_VERSION = 'comp-quality-v1.0';

export const ALLOWED_AUTHORIZATION_BASES = new Set([
  'official_api',
  'ebay_api',
  'written_license',
  'commercial_partner',
  'user_authorized_export',
  'user_csv',
]);

const HARD_EXCLUSIONS = new Set([
  'excluded_active_listing',
  'excluded_demo_in_production',
  'excluded_missing_price',
  'excluded_missing_sale_date',
  'excluded_future_sale',
  'excluded_data_rights',
  'excluded_admin_rejected',
]);

function asDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function priceOf(sale) {
  const price = Number(sale.allInPrice ?? sale.price);
  return Number.isFinite(price) ? roundMoney(price) : null;
}

function lower(value) {
  return normalizeText(value || '');
}

function textValue(value) {
  return String(value ?? '').trim();
}

function gradeLabel(grade = {}) {
  if (!grade) return '';
  if (typeof grade === 'string') return lower(grade);
  return lower([grade.company, grade.grade].filter(Boolean).join(' '));
}

function saleSourceMode(sale) {
  if (sale.sourceMode) return sale.sourceMode;
  if (sale.sourceType === 'demo' || sale.provider === 'ManeFlow Demo' || sale.provider === 'ManeFlow Demo Dataset') return 'demo';
  return 'production';
}

function saleAuthorizationBasis(sale) {
  return sale.authorizationBasis || (saleSourceMode(sale) === 'demo' ? 'demo' : sale.verified ? 'user_authorized_export' : 'unknown');
}

function dataRightsStatusOf(sale, sourceMode, authorizationBasis) {
  if (sale.dataRightsStatus) return sale.dataRightsStatus;
  if (sourceMode === 'demo') return 'demo_only';
  if (ALLOWED_AUTHORIZATION_BASES.has(authorizationBasis)) return 'authorized';
  return 'unverified';
}

export function duplicateKey(sale) {
  if (sale.rawProviderId) return `${sale.provider || 'unknown'}|raw:${sale.rawProviderId}`;
  return [
    sale.provider || 'unknown',
    sale.soldAt ? String(sale.soldAt).slice(0, 10) : 'nodate',
    priceOf(sale) ?? 'noprice',
    lower(sale.title).slice(0, 120),
    sale.cardId || sale.cardKey || 'nocard',
  ].join('|');
}

export function publicCompSummary(sale) {
  return {
    id: sale.id,
    provider: sale.provider || 'Unknown',
    saleType: sale.saleType || 'unknown',
    listingType: sale.listingType || null,
    soldAt: sale.soldAt || null,
    allInPrice: priceOf(sale),
    currency: sale.currency || 'USD',
    verified: Boolean(sale.verified),
    qualityScore: sale.qualityScore ?? null,
    matchScore: sale.matchScore ?? null,
    sourceTrustScore: sale.sourceTrustScore ?? null,
    freshnessScore: sale.freshnessScore ?? null,
    priceReliabilityScore: sale.priceReliabilityScore ?? null,
    dataCompletenessScore: sale.dataCompletenessScore ?? null,
    confidenceScore: sale.confidenceScore ?? null,
    inclusionStatus: sale.inclusionStatus || null,
    reviewStatus: sale.reviewStatus || null,
    valuationUse: Boolean(sale.valuationUse),
    reasons: sale.reasons || [],
    warnings: sale.warnings || [],
    publicExplanation: sale.publicExplanation || null,
    sourceMode: sale.sourceMode || saleSourceMode(sale),
    authorizationBasis: sale.authorizationBasis || saleAuthorizationBasis(sale),
    dataRightsStatus: sale.dataRightsStatus || null,
    url: sale.rawUrl || sale.url || null,
  };
}

function trustScoreFor(authorizationBasis, sourceMode, sale) {
  if (sourceMode === 'demo') return 64;
  if (authorizationBasis === 'official_api' || authorizationBasis === 'ebay_api') return 96;
  if (authorizationBasis === 'written_license') return 92;
  if (authorizationBasis === 'commercial_partner') return 88;
  if (authorizationBasis === 'user_authorized_export') return 80;
  if (authorizationBasis === 'user_csv') return sale.verified ? 76 : 68;
  return sale.verified ? 60 : 28;
}

function priceReliabilityFor(sale) {
  const price = priceOf(sale);
  if (price === null || price < 0) return 0;
  let score = 72;
  if (Number.isFinite(Number(sale.shipping))) score += 8;
  if (Number.isFinite(Number(sale.buyerPremium))) score += 6;
  if (sale.taxKnown) score += 4;
  if (sale.bestOfferAccepted && !sale.actualBestOfferPrice) score -= 14;
  if (sale.saleType === 'auction') score += 6;
  if (sale.saleType === 'private') score -= 8;
  return Math.round(clamp(score, 0, 100));
}

function dataCompletenessFor(sale) {
  const fields = [
    sale.provider, sale.soldAt, sale.allInPrice ?? sale.price, sale.title, sale.cardId || sale.cardKey,
    sale.player, sale.year, sale.set, sale.cardNumber, sale.grade?.company || sale.grade, sale.grade?.grade || sale.grade,
    sale.rawProviderId || sale.rawUrl || sale.url, sale.authorizationBasis, sale.sourceMode,
  ];
  const filled = fields.filter((value) => value !== null && value !== undefined && String(value).trim() !== '').length;
  let score = Math.round((filled / fields.length) * 100);
  if (sale.parallel && String(sale.parallel).trim()) score += 4;
  if (sale.serialNumber && String(sale.serialNumber).trim()) score += 3;
  if (sale.condition && String(sale.condition).trim()) score += 2;
  if (Number.isFinite(Number(sale.shipping))) score += 2;
  if (Number.isFinite(Number(sale.buyerPremium))) score += 2;
  return Math.round(clamp(score, 0, 100));
}

function freshnessFor(soldAt, now) {
  const age = daysAgo(soldAt, now);
  if (!Number.isFinite(age)) return 0;
  return Math.round(clamp(100 * Math.exp(-age / 180), 8, 100));
}

function matchScoreFor(sale, context = {}) {
  const card = context.card || null;
  if (!card) return Math.round(clamp(Number(sale.confidence || 0.7) * 100, 1, 100));
  let possible = 0;
  let earned = 0;
  const check = (a, b, weight) => {
    if (!a || !b) return;
    possible += weight;
    if (lower(a) === lower(b)) earned += weight;
  };
  if (sale.cardId || card.id) {
    possible += 35;
    if (sale.cardId && sale.cardId === card.id) earned += 35;
  }
  check(sale.player, card.player, 16);
  check(sale.set, card.set, 12);
  check(sale.cardNumber, card.cardNumber, 16);
  check(sale.parallel, card.parallel, 14);
  if (sale.year && card.year) {
    possible += 12;
    if (Number(sale.year) === Number(card.year)) earned += 12;
  }
  if (sale.grade && card.grade) {
    possible += 10;
    if (gradeLabel(sale.grade) === gradeLabel(card.grade)) earned += 10;
  }
  const base = possible ? (earned / possible) * 100 : Number(sale.confidence || 0.7) * 100;
  const confidence = Number.isFinite(Number(sale.confidence)) ? Number(sale.confidence) * 10 : 0;
  return Math.round(clamp(base + confidence, 1, 100));
}

function isCompletedSale(sale) {
  if (sale.isCompletedSale === true) return true;
  if (sale.isCompletedSale === false) return false;
  const sourceType = lower(sale.sourceType);
  const listingType = lower(sale.listingType);
  const saleType = lower(sale.saleType);
  if (['active', 'asking', 'current', 'live_listing', 'for_sale'].includes(sourceType)) return false;
  if (['active', 'asking', 'current', 'buy_it_now_asking'].includes(listingType)) return false;
  return sourceType === 'sold' || sourceType === 'completed_sale' || Boolean(sale.soldAt) || ['auction', 'fixed price', 'fixed_price', 'best_offer', 'private'].includes(saleType);
}

function pushDecision(scored, status, reason, warning = null) {
  if (!scored.inclusionStatus || scored.inclusionStatus === 'included') scored.inclusionStatus = status;
  if (status.startsWith('excluded')) scored.valuationUse = false;
  if (status === 'needs_review' && scored.inclusionStatus !== 'excluded_active_listing') {
    scored.inclusionStatus = scored.inclusionStatus?.startsWith('excluded') ? scored.inclusionStatus : 'needs_review';
    scored.valuationUse = false;
  }
  if (reason && !scored.reasons.includes(reason)) scored.reasons.push(reason);
  if (warning && !scored.warnings.includes(warning)) scored.warnings.push(warning);
}

function applyReviewOverride(scored, override = null) {
  if (!override?.decision) return scored;
  scored.reviewStatus = override.decision;
  scored.auditTrail.push({ at: new Date().toISOString(), event: 'review_override_applied', decision: override.decision, notes: override.notes || '' });
  if (override.decision === 'rejected') {
    scored.inclusionStatus = override.inclusionStatus || 'excluded_wrong_card';
    scored.valuationUse = false;
    if (!scored.reasons.includes('Rejected by administrator review.')) scored.reasons.push('Rejected by administrator review.');
  }
  if (override.decision === 'approved' && !HARD_EXCLUSIONS.has(scored.inclusionStatus)) {
    scored.inclusionStatus = 'included';
    scored.valuationUse = true;
    if (!scored.reasons.includes('Approved by administrator review.')) scored.reasons.push('Approved by administrator review.');
  }
  return scored;
}

export function scoreComp(sale, context = {}) {
  const now = context.now || new Date();
  const sourceMode = saleSourceMode(sale);
  const authorizationBasis = saleAuthorizationBasis(sale);
  const dataRightsStatus = dataRightsStatusOf(sale, sourceMode, authorizationBasis);
  const soldAt = asDate(sale.soldAt);
  const allInPrice = priceOf(sale);
  const matchScore = matchScoreFor(sale, context);
  const sourceTrustScore = trustScoreFor(authorizationBasis, sourceMode, sale);
  const freshnessScore = soldAt ? freshnessFor(soldAt, now) : 0;
  const priceReliabilityScore = priceReliabilityFor(sale);
  const dataCompletenessScore = dataCompletenessFor({ ...sale, allInPrice });
  const scored = {
    ...sale,
    sourceMode,
    authorizationBasis,
    dataRightsStatus,
    allInPrice,
    qualityScore: 0,
    confidenceScore: 0,
    matchScore,
    sourceTrustScore,
    freshnessScore,
    priceReliabilityScore,
    dataCompletenessScore,
    inclusionStatus: 'included',
    reviewStatus: 'unreviewed',
    valuationUse: true,
    reasons: [],
    warnings: [],
    auditTrail: [{ at: now.toISOString(), event: 'comp_scored', methodologyVersion: COMP_QUALITY_METHODOLOGY_VERSION }],
    scoredAt: now.toISOString(),
  };

  if (allInPrice === null || allInPrice < 0) pushDecision(scored, 'excluded_missing_price', 'Missing or invalid all-in price.');
  if (!soldAt) pushDecision(scored, 'excluded_missing_sale_date', 'Missing or invalid completed-sale date.');
  if (soldAt && soldAt > now) pushDecision(scored, 'excluded_future_sale', 'Sale date is in the future.');
  if (!isCompletedSale(sale)) pushDecision(scored, 'excluded_active_listing', 'Active or asking listing; not a completed sale.');
  if (sourceMode === 'demo' && context.demoMode === false) pushDecision(scored, 'excluded_demo_in_production', 'Synthetic demo comp cannot be used in production valuation.');
  if (sourceMode !== 'demo' && !ALLOWED_AUTHORIZATION_BASES.has(authorizationBasis)) pushDecision(scored, 'excluded_unverified_source', 'Source does not document an approved authorization basis.');
  if (['unverified', 'not_for_public_value', 'active_listings_only_not_for_valuation'].includes(dataRightsStatus)) pushDecision(scored, 'excluded_data_rights', 'Data rights status does not allow production valuation use.');

  if (context.card) {
    if (sale.cardId && sale.cardId !== context.card.id) pushDecision(scored, 'excluded_wrong_card', 'Sale is mapped to a different catalog card.');
    const cardGrade = gradeLabel(context.card.grade);
    const saleGrade = gradeLabel(sale.grade);
    if (cardGrade && saleGrade && cardGrade !== saleGrade) pushDecision(scored, 'excluded_wrong_grade', 'Sale grade does not match the requested card.');
    const cardParallel = textValue(context.card.parallel);
    const saleParallel = textValue(sale.parallel);
    if (cardParallel && saleParallel && lower(cardParallel) !== lower(saleParallel)) pushDecision(scored, 'excluded_wrong_parallel', 'Sale parallel does not match the requested card.');
    if (cardParallel && !saleParallel && matchScore < 82) pushDecision(scored, 'needs_review', 'Parallel is not confirmed.', 'Parallel uncertain.');
  }

  if (!scored.inclusionStatus.startsWith('excluded') && sourceTrustScore < 45) pushDecision(scored, 'needs_review', 'Low source trust requires review.', 'Low source trust.');
  if (!scored.inclusionStatus.startsWith('excluded') && matchScore < 68) pushDecision(scored, 'needs_review', 'Low card-match confidence requires review.', 'Card identity uncertain.');
  if (!scored.inclusionStatus.startsWith('excluded') && dataCompletenessScore < 55 && !scored.warnings.includes('Data completeness is low.')) scored.warnings.push('Data completeness is low.');

  scored.qualityScore = Math.round(clamp((matchScore * 0.30) + (sourceTrustScore * 0.25) + (freshnessScore * 0.16) + (priceReliabilityScore * 0.18) + (dataCompletenessScore * 0.11), 0, 100));
  scored.confidenceScore = Math.round(clamp((matchScore * 0.42) + (sourceTrustScore * 0.26) + (priceReliabilityScore * 0.18) + (dataCompletenessScore * 0.14), 0, 100));
  if (!scored.inclusionStatus.startsWith('excluded') && scored.qualityScore < 50 && !scored.warnings.includes('Low comp quality.')) scored.warnings.push('Low comp quality.');
  scored.publicExplanation = scored.inclusionStatus === 'included'
    ? `Included because the sale is completed, authorized, matched to this card, and scored ${scored.qualityScore}/100 for comp quality.`
    : `${scored.inclusionStatus === 'needs_review' ? 'Needs review' : 'Excluded'}: ${(scored.reasons[0] || 'ManeFlow could not safely use this sale for valuation.').replace(/\.$/, '')}.`;
  scored.adminExplanation = [
    `status=${scored.inclusionStatus}`,
    `valuationUse=${scored.valuationUse}`,
    `match=${scored.matchScore}`,
    `sourceTrust=${scored.sourceTrustScore}`,
    `freshness=${scored.freshnessScore}`,
    `priceReliability=${scored.priceReliabilityScore}`,
    `dataCompleteness=${scored.dataCompletenessScore}`,
    `authorizationBasis=${authorizationBasis}`,
    `dataRightsStatus=${dataRightsStatus}`,
  ].join('; ');

  return applyReviewOverride(scored, context.overrides?.[sale.id] || null);
}

export function scoreComps(sales = [], context = {}) {
  const now = context.now || new Date();
  const overrides = context.overrides || {};
  const seen = new Map();
  const scored = sales.map((sale) => scoreComp(sale, { ...context, now, overrides }));

  for (const sale of scored) {
    const key = duplicateKey(sale);
    if (seen.has(key)) {
      sale.duplicateOf = seen.get(key);
      pushDecision(sale, 'excluded_duplicate', 'Duplicate completed sale detected.');
      sale.auditTrail.push({ at: now.toISOString(), event: 'duplicate_detected', duplicateOf: sale.duplicateOf });
    } else {
      seen.set(key, sale.id || key);
    }
  }

  const eligible = scored.filter((sale) => sale.valuationUse && Number.isFinite(Number(sale.allInPrice)));
  if (eligible.length >= 5) {
    const prices = eligible.map((sale) => Number(sale.allInPrice)).sort((a, b) => a - b);
    const q1 = percentile(prices, 0.25);
    const q3 = percentile(prices, 0.75);
    const iqr = q3 - q1;
    const low = Math.max(0, q1 - 1.5 * iqr);
    const high = q3 + 1.5 * iqr;
    for (const sale of eligible) {
      if (Number(sale.allInPrice) < low || Number(sale.allInPrice) > high) {
        sale.isOutlier = true;
        pushDecision(sale, 'excluded_outlier', 'Price is outside the IQR outlier band.');
        sale.auditTrail.push({ at: now.toISOString(), event: 'outlier_detected', low: roundMoney(low), high: roundMoney(high) });
      } else {
        sale.isOutlier = false;
      }
    }
  } else {
    for (const sale of scored) sale.isOutlier = false;
  }

  for (const sale of scored) {
    applyReviewOverride(sale, overrides[sale.id] || null);
    sale.qualityScore = Math.round(clamp(sale.qualityScore, 0, 100));
  }

  return scored;
}

export function includedComps(scoredSales = []) {
  return scoredSales.filter((sale) => sale.valuationUse && sale.inclusionStatus === 'included');
}

export function excludedComps(scoredSales = []) {
  return scoredSales.filter((sale) => String(sale.inclusionStatus || '').startsWith('excluded'));
}

export function needsReviewComps(scoredSales = []) {
  return scoredSales.filter((sale) => sale.inclusionStatus === 'needs_review');
}

export function explainCompDecision(scoredSale) {
  const status = scoredSale.inclusionStatus || 'unknown';
  const label = status === 'included' ? 'Included' : status === 'needs_review' ? 'Needs review' : `Excluded: ${status.replace(/^excluded_/, '').replaceAll('_', ' ')}`;
  return {
    id: scoredSale.id,
    label,
    status,
    valuationUse: Boolean(scoredSale.valuationUse),
    reasons: scoredSale.reasons || [],
    warnings: scoredSale.warnings || [],
    scores: {
      quality: scoredSale.qualityScore,
      match: scoredSale.matchScore,
      sourceTrust: scoredSale.sourceTrustScore,
      freshness: scoredSale.freshnessScore,
      priceReliability: scoredSale.priceReliabilityScore,
      dataCompleteness: scoredSale.dataCompletenessScore,
      confidence: scoredSale.confidenceScore,
    },
    publicExplanation: scoredSale.publicExplanation || null,
  };
}

export function summarizeCompQuality(scoredSales = []) {
  const included = includedComps(scoredSales);
  const excluded = excludedComps(scoredSales);
  const review = needsReviewComps(scoredSales);
  const avg = (values) => values.length ? Math.round(values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length) : 0;
  const warnings = new Map();
  for (const sale of scoredSales) for (const warning of sale.warnings || []) warnings.set(warning, (warnings.get(warning) || 0) + 1);
  const byStatus = scoredSales.reduce((acc, sale) => {
    const key = sale.inclusionStatus || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  return {
    methodologyVersion: COMP_QUALITY_METHODOLOGY_VERSION,
    totalCount: scoredSales.length,
    includedCount: included.length,
    excludedCount: excluded.length,
    needsReviewCount: review.length,
    averageQualityScore: avg(scoredSales.map((sale) => sale.qualityScore)),
    averageSourceTrust: avg(scoredSales.map((sale) => sale.sourceTrustScore)),
    averageMatchScore: avg(scoredSales.map((sale) => sale.matchScore)),
    averageDataCompleteness: avg(scoredSales.map((sale) => sale.dataCompletenessScore)),
    topWarnings: [...warnings.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([warning, count]) => ({ warning, count })),
    byStatus,
  };
}
