import { clamp, daysAgo, median, percentile, roundMoney } from './utils.js';
import { includedComps, publicCompSummary, scoreComps, summarizeCompQuality } from './comp-quality.js';
import { summarizeAskingPriceContext } from './asking-price-context.js';

function weightedAverage(sales, now) {
  let numerator = 0;
  let denominator = 0;
  for (const sale of sales) {
    const age = daysAgo(sale.soldAt, now);
    const recency = Math.exp(-age / 45);
    const source = sale.verified ? 1.18 : 0.9;
    const confidence = clamp(sale.confidence || (sale.matchScore ? sale.matchScore / 100 : 0.5), 0.1, 1);
    const auctionFactor = sale.saleType === 'auction' ? 1.04 : 1;
    const qualityFactor = sale.qualityScore ? clamp(sale.qualityScore / 80, 0.45, 1.2) : 1;
    const weight = recency * source * confidence * auctionFactor * qualityFactor;
    numerator += Number(sale.allInPrice) * weight;
    denominator += weight;
  }
  return denominator ? numerator / denominator : null;
}

function windowStats(sales, days, now) {
  const included = sales.filter((sale) => daysAgo(sale.soldAt, now) <= days);
  const prices = included.map((sale) => Number(sale.allInPrice));
  return {
    days,
    count: included.length,
    low: prices.length ? roundMoney(Math.min(...prices)) : null,
    p25: prices.length ? roundMoney(percentile(prices, 0.25)) : null,
    median: prices.length ? roundMoney(median(prices)) : null,
    average: prices.length ? roundMoney(prices.reduce((sum, value) => sum + value, 0) / prices.length) : null,
    p75: prices.length ? roundMoney(percentile(prices, 0.75)) : null,
    high: prices.length ? roundMoney(Math.max(...prices)) : null,
    weighted: prices.length ? roundMoney(weightedAverage(included, now)) : null,
  };
}

function periodStats(sales, minDays, maxDays, now) {
  const included = sales.filter((sale) => {
    const age = daysAgo(sale.soldAt, now);
    return age > minDays && age <= maxDays;
  });
  const prices = included.map((sale) => Number(sale.allInPrice));
  return {
    count: prices.length,
    weighted: prices.length ? roundMoney(weightedAverage(included.map((sale) => ({ ...sale, soldAt: now.toISOString() })), now)) : null,
  };
}

function trend(current, previous) {
  if (!current?.weighted || !previous?.weighted) return null;
  return roundMoney(((current.weighted - previous.weighted) / previous.weighted) * 100);
}

function confidenceScore(sales, providerCount, outlierCount, duplicateCount, compQuality) {
  const volume = clamp(Math.log10(sales.length + 1) / 1.7, 0, 1);
  const diversity = clamp(providerCount / 4, 0, 1);
  const verified = sales.length ? sales.filter((sale) => sale.verified).length / sales.length : 0;
  const quality = clamp((compQuality?.averageQualityScore || 0) / 100, 0, 1);
  const trust = clamp((compQuality?.averageSourceTrust || 0) / 100, 0, 1);
  const outlierPenalty = sales.length ? outlierCount / (sales.length + outlierCount) : outlierCount ? 0.5 : 0;
  const duplicatePenalty = sales.length ? duplicateCount / (sales.length + duplicateCount) : duplicateCount ? 0.5 : 0;
  return Math.round(clamp((0.27 * volume + 0.2 * diversity + 0.18 * verified + 0.2 * quality + 0.15 * trust - 0.22 * outlierPenalty - 0.12 * duplicatePenalty) * 100, 4, 99));
}

function normalizeScoredInput(inputSales, options) {
  if (options.scored) return inputSales.map((sale) => ({ ...sale, valuationUse: sale.valuationUse !== false }));
  return scoreComps(inputSales, {
    now: options.now,
    demoMode: options.demoMode,
    card: options.card,
    overrides: options.overrides || {},
  });
}

export function calculateValuation(inputSales = [], {
  now = new Date(),
  verifiedOnly = false,
  scored = false,
  includeCompDetails = false,
  demoMode = true,
  card = null,
  overrides = {},
  askingListings = [],
} = {}) {
  const scoredSales = normalizeScoredInput(inputSales, { now, scored, demoMode, card, overrides });
  const compQuality = summarizeCompQuality(scoredSales);
  const valid = includedComps(scoredSales).filter((sale) => {
    const soldAt = new Date(sale.soldAt);
    return sale.valuationUse === true
      && Number.isFinite(Number(sale.allInPrice))
      && Number(sale.allInPrice) >= 0
      && !Number.isNaN(soldAt.getTime())
      && soldAt <= now
      && (!verifiedOnly || sale.verified);
  }).sort((a, b) => new Date(b.soldAt) - new Date(a.soldAt));

  const providers = [...new Set(valid.map((sale) => sale.provider))];
  const stats7 = windowStats(valid, 7, now);
  const stats30 = windowStats(valid, 30, now);
  const stats90 = windowStats(valid, 90, now);
  const stats180 = windowStats(valid, 180, now);
  const stats365 = windowStats(valid, 365, now);
  const prior30 = periodStats(valid, 30, 60, now);
  const prior90 = periodStats(valid, 90, 180, now);
  const trend30 = trend(stats30, prior30);
  const trend90 = trend(stats90, prior90);
  const outlierCount = scoredSales.filter((sale) => sale.inclusionStatus === 'excluded_outlier' || sale.isOutlier).length;
  const duplicateCount = scoredSales.filter((sale) => sale.inclusionStatus === 'excluded_duplicate').length;
  const confidence = confidenceScore(valid, providers.length, outlierCount, duplicateCount, compQuality);
  const anchor = stats30.weighted ?? stats90.weighted ?? stats180.weighted ?? (valid.length ? roundMoney(median(valid.map((sale) => Number(sale.allInPrice)))) : null);
  const dispersion = valid.length >= 2 ? percentile(valid.map((sale) => Number(sale.allInPrice)), 0.75) - percentile(valid.map((sale) => Number(sale.allInPrice)), 0.25) : 0;
  const rangePadding = anchor ? Math.max(anchor * (confidence >= 80 ? 0.08 : confidence >= 60 ? 0.14 : 0.24), dispersion / 2) : 0;
  const volumePerMonth = stats90.count / 3;
  const liquidityScore = Math.round(clamp((Math.log10(volumePerMonth + 1) / 1.5) * 70 + (providers.length / 4) * 30, 0, 100));
  const lastSaleAt = valid[0]?.soldAt || null;

  const result = {
    value: anchor,
    range: anchor === null ? { low: null, high: null } : {
      low: roundMoney(Math.max(0, anchor - rangePadding)),
      high: roundMoney(anchor + rangePadding),
    },
    windows: { d7: stats7, d30: stats30, d90: stats90, d180: stats180, d365: stats365 },
    trend30Pct: trend30,
    trend90Pct: trend90,
    direction: trend30 === null ? 'insufficient_data' : trend30 > 3 ? 'rising' : trend30 < -3 ? 'falling' : 'steady',
    volume90: stats90.count,
    monthlyVelocity: roundMoney(volumePerMonth),
    liquidityScore,
    providerCount: providers.length,
    providers,
    confidence,
    completedSaleConfidence: confidence,
    outlierCount,
    duplicateCount,
    lastSaleAt,
    freshnessHours: lastSaleAt ? roundMoney(daysAgo(lastSaleAt, now) * 24) : null,
    verifiedOnly,
    compQuality,
    methodology: 'Recency-weighted, source-aware all-in completed-sale prices using comp-quality scoring, authorized-source checks, source diversity, deduplication, and IQR outlier filtering.',
    disclaimer: 'Estimated market intelligence, not an appraisal, authentication, grade, or guarantee. ManeFlow shows why each comp was included or excluded; confirm identity, condition, fees, and source details before transacting.',
  };
  const askingPriceContext = summarizeAskingPriceContext(askingListings, { valuation: result, now });
  result.askingPriceContext = askingPriceContext;
  result.pricingConfidence = askingPriceContext.count ? askingPriceContext.pricingConfidence : confidence;
  result.pricingRating = askingPriceContext.count ? askingPriceContext.rating : (valid.length ? 'completed_sales_only' : 'insufficient_data');
  result.contextualPricingMethodology = askingPriceContext.count
    ? `${result.methodology} Active Buy It Now listings are considered only as asking-price context for listing strategy, confidence, and new-release pricing; they never set market value.`
    : result.methodology;
  if (includeCompDetails) {
    result.compDetails = {
      included: valid.map(publicCompSummary),
      excluded: scoredSales.filter((sale) => String(sale.inclusionStatus || '').startsWith('excluded')).map(publicCompSummary),
      needsReview: scoredSales.filter((sale) => sale.inclusionStatus === 'needs_review').map(publicCompSummary),
    };
  }
  return result;
}
