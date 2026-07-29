import { calculateValuation } from './valuation.js';
import { scoreComps, summarizeCompQuality } from './comp-quality.js';

function countBy(items, keyFn) {
  const out = {};
  for (const item of items) {
    const key = keyFn(item) || 'Unknown';
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function validDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function summarizeDataHealth({ sales = [], cards = [], providers = [], config = {}, now = new Date(), overrides = {} } = {}) {
  const scored = scoreComps(sales, { now, demoMode: config.demoMode !== false, overrides });
  const demoComps = scored.filter((sale) => sale.sourceMode === 'demo').length;
  const productionComps = scored.length - demoComps;
  const authorizedComps = scored.filter((sale) => ['official_api', 'ebay_api', 'written_license', 'commercial_partner', 'user_authorized_export', 'user_csv'].includes(sale.authorizationBasis)).length;
  const unauthorizedComps = scored.filter((sale) => sale.sourceMode !== 'demo' && !['official_api', 'ebay_api', 'written_license', 'commercial_partner', 'user_authorized_export', 'user_csv'].includes(sale.authorizationBasis)).length;
  const activeListingsPresent = scored.filter((sale) => sale.inclusionStatus === 'excluded_active_listing').length;
  const missingSaleDates = scored.filter((sale) => sale.inclusionStatus === 'excluded_missing_sale_date' || !validDate(sale.soldAt)).length;
  const missingAllInPrice = scored.filter((sale) => sale.inclusionStatus === 'excluded_missing_price' || !Number.isFinite(Number(sale.allInPrice))).length;
  const compsNeedingReview = scored.filter((sale) => sale.inclusionStatus === 'needs_review').length;
  const byCard = new Map();
  for (const sale of scored) {
    if (!sale.cardId) continue;
    if (!byCard.has(sale.cardId)) byCard.set(sale.cardId, []);
    byCard.get(sale.cardId).push(sale);
  }
  const cardsWithNoComps = [];
  const cardsWithOnlyDemoComps = [];
  const cardsWithLowConfidenceValuations = [];
  const cardsWithHighOutlierRate = [];
  for (const card of cards) {
    const cardSales = byCard.get(card.id) || [];
    if (!cardSales.length) {
      cardsWithNoComps.push(card.id);
      continue;
    }
    if (cardSales.every((sale) => sale.sourceMode === 'demo')) cardsWithOnlyDemoComps.push(card.id);
    const valuation = calculateValuation(cardSales, { scored: true, now, includeCompDetails: false, demoMode: config.demoMode !== false, card });
    if (valuation.confidence < 50 || valuation.compQuality.averageQualityScore < 55) cardsWithLowConfidenceValuations.push({ cardId: card.id, confidence: valuation.confidence, averageQualityScore: valuation.compQuality.averageQualityScore });
    const outliers = cardSales.filter((sale) => sale.inclusionStatus === 'excluded_outlier').length;
    if (cardSales.length >= 5 && outliers / cardSales.length >= 0.25) cardsWithHighOutlierRate.push({ cardId: card.id, outlierRate: Math.round((outliers / cardSales.length) * 1000) / 10 });
  }
  const statusRows = Array.isArray(providers) ? providers : [];
  const providerCoverage = statusRows.map((provider) => ({
    name: provider.name,
    mode: provider.mode,
    dataRightsStatus: provider.dataRightsStatus,
    authorizationBasis: provider.authorizationBasis,
    supportsCompletedSales: Boolean(provider.supportsCompletedSales),
    supportsActiveListings: Boolean(provider.supportsActiveListings),
    supportsSellerOrders: Boolean(provider.supportsSellerOrders),
    supportsLiveAuctions: Boolean(provider.supportsLiveAuctions),
    refreshPolicy: provider.refreshPolicy,
    compCount: scored.filter((sale) => sale.provider === provider.name || sale.provider === provider.displayName).length,
  }));
  const staleProviders = providerCoverage.filter((provider) => provider.supportsCompletedSales && !provider.compCount && provider.dataRightsStatus !== 'demo_only');
  const dated = scored.filter((sale) => validDate(sale.soldAt)).sort((a, b) => new Date(b.soldAt) - new Date(a.soldAt));
  return {
    generatedAt: now.toISOString(),
    readyForPublicValueClaims: !config.demoMode && productionComps > 0 && unauthorizedComps === 0 && activeListingsPresent === 0 && missingSaleDates === 0 && missingAllInPrice === 0,
    totalComps: scored.length,
    demoComps,
    productionComps,
    authorizedComps,
    unauthorizedComps,
    activeListingsPresent,
    compsMissingSaleDates: missingSaleDates,
    compsMissingAllInPrice: missingAllInPrice,
    compsNeedingReview,
    providerCoverage,
    staleProviders,
    cardsWithLowConfidenceValuations,
    cardsWithNoComps,
    cardsWithOnlyDemoComps,
    cardsWithHighOutlierRate,
    newestSaleAt: dated[0]?.soldAt || null,
    byProvider: Object.entries(countBy(scored, (sale) => sale.provider)).sort((a, b) => b[1] - a[1]),
    byStatus: summarizeCompQuality(scored).byStatus,
    compQuality: summarizeCompQuality(scored),
    publicValueBlockers: [
      ...(config.demoMode ? ['Synthetic demonstration comps are enabled.'] : []),
      ...(productionComps === 0 ? ['No approved production completed-sale comps are connected.'] : []),
      ...(unauthorizedComps ? [`${unauthorizedComps} comps lack approved data authorization.`] : []),
      ...(activeListingsPresent ? [`${activeListingsPresent} active listings were detected and excluded.`] : []),
      ...(missingSaleDates ? [`${missingSaleDates} comps are missing sale dates.`] : []),
      ...(missingAllInPrice ? [`${missingAllInPrice} comps are missing all-in prices.`] : []),
    ],
  };
}
