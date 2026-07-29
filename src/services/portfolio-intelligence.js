import { calculateValuation } from './valuation.js';
import { buildPortfolioDecisionSupport, buildShopInventoryDecisionSupport } from './portfolio-decisions.js';
import { clamp, daysAgo, roundMoney, safeDate } from './utils.js';

export const PORTFOLIO_INTELLIGENCE_VERSION = 'portfolio-intelligence-v1.0';

function asCollection(input, options = {}) {
  if (Array.isArray(input)) return input;
  if (Array.isArray(input?.collection)) return input.collection;
  if (Array.isArray(options.collection)) return options.collection;
  return [];
}

function money(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? roundMoney(n) : fallback;
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeKey(value) {
  return String(value ?? 'Unknown').trim() || 'Unknown';
}

function gradeTier(card = {}) {
  const company = String(card.grade?.company || '').toUpperCase();
  const grade = String(card.grade?.grade || '').toUpperCase();
  if (!company || company === 'RAW' || grade === 'RAW') return 'Raw';
  const numeric = Number(grade.replace(/[^0-9.]/g, ''));
  if (Number.isFinite(numeric)) {
    if (numeric >= 10) return `${company} Gem Mint 10`;
    if (numeric >= 9) return `${company} Mint 9`;
    if (numeric >= 8) return `${company} NM-MT 8`;
    return `${company} Graded <8`;
  }
  return `${company} ${grade}`;
}

function statusOf(item = {}) {
  return String(item.status || 'owned').toLowerCase();
}

function itemDate(item = {}) {
  return safeDate(item.purchaseDate || item.acquiredAt || item.createdAt);
}

function dateKey(date, period = '90d') {
  const d = safeDate(date) || new Date();
  if (period === '365d' || period === 'year') return `${d.getUTCFullYear()}`;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function salesForCard(card, sales = []) {
  if (!card?.id) return [];
  return sales.filter((sale) => sale.cardId === card.id);
}

function cardLookup(options = {}) {
  if (typeof options.resolveCard === 'function') return options.resolveCard;
  const byId = new Map((options.cards || []).map((card) => [card.id, card]));
  return (id) => byId.get(id) || null;
}

function valuationFor(card, options = {}) {
  if (!card) return null;
  return calculateValuation(salesForCard(card, options.sales || []), {
    card,
    demoMode: options.demoMode !== false,
    overrides: options.overrides || {},
    includeCompDetails: false,
  });
}

function enrichHoldings(input, options = {}) {
  const resolveCard = cardLookup(options);
  return asCollection(input, options).map((item) => {
    const card = item.card || resolveCard(item.cardId);
    const market = item.market || valuationFor(card, options);
    const quantity = Math.max(1, Math.floor(num(item.quantity, 1)));
    const unitValue = money(item.currentUnitValue ?? item.unitValue ?? market?.value, 0);
    const currentValue = money(item.currentValue ?? unitValue * quantity, 0);
    const unitCost = money(item.purchasePrice ?? item.unitCost ?? item.costBasis, 0);
    const costBasis = money(item.costBasis ?? unitCost * quantity, 0);
    const gain = money(currentValue - costBasis, 0);
    const gainPct = costBasis > 0 ? roundMoney((gain / costBasis) * 100) : null;
    const soldPrice = item.soldPrice !== undefined ? money(item.soldPrice, 0) : null;
    const realizedGain = statusOf(item) === 'sold' && soldPrice !== null ? money((soldPrice * quantity) - costBasis, 0) : 0;
    const unrealizedGain = statusOf(item) === 'sold' ? 0 : gain;
    const liquidityScore = num(market?.liquidityScore, market?.volume90 >= 20 ? 85 : market?.volume90 >= 8 ? 70 : market?.volume90 >= 3 ? 52 : 28);
    const liquidValue = money(currentValue * clamp(liquidityScore / 100, 0.15, 0.98), 0);
    const ageDays = itemDate(item) ? Math.floor(daysAgo(itemDate(item), options.now || new Date())) : null;
    return {
      ...item,
      card,
      market,
      quantity,
      unitValue,
      currentValue,
      unitCost,
      costBasis,
      gain,
      gainPct,
      realizedGain,
      unrealizedGain,
      liquidityScore,
      liquidValue,
      ageDays,
      valueConfidence: num(market?.confidence, 0),
      compQuality: market?.compQuality || null,
    };
  });
}

function aggregateBy(holdings, keyFn, label = 'Unknown') {
  const groups = new Map();
  let totalValue = 0;
  for (const item of holdings) totalValue += item.currentValue;
  for (const item of holdings) {
    const key = normalizeKey(keyFn(item) || label);
    if (!groups.has(key)) groups.set(key, { label: key, itemCount: 0, quantity: 0, value: 0, costBasis: 0, gain: 0, liquidValue: 0, confidenceSum: 0 });
    const row = groups.get(key);
    row.itemCount += 1;
    row.quantity += item.quantity;
    row.value += item.currentValue;
    row.costBasis += item.costBasis;
    row.gain += item.gain;
    row.liquidValue += item.liquidValue;
    row.confidenceSum += item.valueConfidence;
  }
  return [...groups.values()].map((row) => ({
    label: row.label,
    itemCount: row.itemCount,
    quantity: row.quantity,
    value: roundMoney(row.value),
    costBasis: roundMoney(row.costBasis),
    gain: roundMoney(row.gain),
    gainPct: row.costBasis > 0 ? roundMoney((row.gain / row.costBasis) * 100) : null,
    pctOfValue: totalValue > 0 ? roundMoney((row.value / totalValue) * 100) : 0,
    liquidValue: roundMoney(row.liquidValue),
    averageConfidence: row.itemCount ? Math.round(row.confidenceSum / row.itemCount) : 0,
  })).sort((a, b) => b.value - a.value);
}

export function generateAllocationBreakdown(input, options = {}) {
  const holdings = enrichHoldings(input, options).filter((item) => statusOf(item) !== 'sold');
  const bySport = aggregateBy(holdings, (item) => item.card?.sport || 'Uncategorized');
  const byPlayer = aggregateBy(holdings, (item) => item.card?.player || item.name || 'Unknown Player');
  const bySet = aggregateBy(holdings, (item) => [item.card?.year, item.card?.brand, item.card?.set].filter(Boolean).join(' ') || 'Unknown Set');
  const byYear = aggregateBy(holdings, (item) => item.card?.year || 'Unknown Year');
  const byGradeTier = aggregateBy(holdings, (item) => gradeTier(item.card));
  const concentrationRisk = byPlayer[0]?.pctOfValue >= 35 ? 'high' : byPlayer[0]?.pctOfValue >= 20 ? 'medium' : 'balanced';
  return {
    generatedAt: (options.now || new Date()).toISOString(),
    bySport,
    byPlayer,
    bySet,
    byYear,
    byGradeTier,
    concentrationRisk,
    topConcentration: byPlayer[0] || null,
  };
}

export function calculateROI(input, options = {}) {
  const holdings = enrichHoldings(input, options);
  const active = holdings.filter((item) => statusOf(item) !== 'sold');
  const realized = holdings.filter((item) => statusOf(item) === 'sold');
  const totalCost = holdings.reduce((sum, item) => sum + item.costBasis, 0);
  const activeCost = active.reduce((sum, item) => sum + item.costBasis, 0);
  const currentValue = active.reduce((sum, item) => sum + item.currentValue, 0);
  const realizedGains = realized.reduce((sum, item) => sum + item.realizedGain, 0);
  const unrealizedGains = active.reduce((sum, item) => sum + item.unrealizedGain, 0);
  const totalGain = realizedGains + unrealizedGains;
  const groups = {
    byPlayer: aggregateBy(holdings, (item) => item.card?.player || item.name || 'Unknown Player').slice(0, 20),
    bySet: aggregateBy(holdings, (item) => [item.card?.year, item.card?.brand, item.card?.set].filter(Boolean).join(' ') || 'Unknown Set').slice(0, 20),
    byYear: aggregateBy(holdings, (item) => item.card?.year || 'Unknown Year').slice(0, 20),
    bySport: aggregateBy(holdings, (item) => item.card?.sport || 'Uncategorized').slice(0, 20),
    byGradeTier: aggregateBy(holdings, (item) => gradeTier(item.card)).slice(0, 20),
  };
  return {
    totalCost: roundMoney(totalCost),
    activeCostBasis: roundMoney(activeCost),
    currentValue: roundMoney(currentValue),
    realizedGains: roundMoney(realizedGains),
    unrealizedGains: roundMoney(unrealizedGains),
    totalGain: roundMoney(totalGain),
    totalRoiPct: totalCost > 0 ? roundMoney((totalGain / totalCost) * 100) : null,
    activeRoiPct: activeCost > 0 ? roundMoney((unrealizedGains / activeCost) * 100) : null,
    groups,
  };
}

export function calculatePortfolioMetrics(input, options = {}) {
  const holdings = enrichHoldings(input, options);
  const active = holdings.filter((item) => statusOf(item) !== 'sold');
  const currentValue = active.reduce((sum, item) => sum + item.currentValue, 0);
  const costBasis = active.reduce((sum, item) => sum + item.costBasis, 0);
  const liquidValue = active.reduce((sum, item) => sum + item.liquidValue, 0);
  const compQualityScores = active.map((item) => item.compQuality?.averageQualityScore).filter((value) => Number.isFinite(Number(value)));
  const confidenceScores = active.map((item) => item.valueConfidence).filter((value) => Number.isFinite(Number(value)));
  const roi = calculateROI(holdings, { ...options, collection: holdings });
  const allocation = generateAllocationBreakdown(holdings, { ...options, collection: holdings });
  return {
    methodologyVersion: PORTFOLIO_INTELLIGENCE_VERSION,
    generatedAt: (options.now || new Date()).toISOString(),
    itemCount: active.length,
    totalQuantity: active.reduce((sum, item) => sum + item.quantity, 0),
    currentValue: roundMoney(currentValue),
    costBasis: roundMoney(costBasis),
    unrealizedGain: roundMoney(currentValue - costBasis),
    unrealizedGainPct: costBasis > 0 ? roundMoney(((currentValue - costBasis) / costBasis) * 100) : null,
    realizedGains: roi.realizedGains,
    estimatedLiquidValue: roundMoney(liquidValue),
    liquidityDiscount: currentValue > 0 ? roundMoney(((currentValue - liquidValue) / currentValue) * 100) : 0,
    averageConfidence: confidenceScores.length ? Math.round(confidenceScores.reduce((sum, value) => sum + value, 0) / confidenceScores.length) : 0,
    averageValuationConfidence: confidenceScores.length ? Math.round(confidenceScores.reduce((sum, value) => sum + value, 0) / confidenceScores.length) : 0,
    averageLiquidityScore: active.length ? Math.round(active.reduce((sum, item) => sum + item.liquidityScore, 0) / active.length) : 0,
    averageCompQuality: compQualityScores.length ? Math.round(compQualityScores.reduce((sum, value) => sum + value, 0) / compQualityScores.length) : 0,
    lowConfidenceCount: active.filter((item) => item.valueConfidence < 55 || (item.compQuality?.includedCount || 0) < 2).length,
    staleValueCount: active.filter((item) => (item.market?.freshnessHours ?? Infinity) > 24 * 30).length,
    concentrationRisk: allocation.concentrationRisk,
    topConcentration: allocation.topConcentration,
    topGainers: [...active].sort((a, b) => b.gain - a.gain).slice(0, 5),
    topDecliners: [...active].sort((a, b) => a.gain - b.gain).slice(0, 5),
    mostLiquid: [...active].sort((a, b) => b.liquidityScore - a.liquidityScore || b.currentValue - a.currentValue).slice(0, 5),
    roi,
    allocation,
    disclaimer: 'Portfolio Intelligence uses ManeFlow valuations calculated from included, valuationUse=true comps only. Values are estimates, not tax, legal, financial, grading, authentication, or appraisal advice.',
  };
}

export function generateTaxEstimate(input, options = {}) {
  const now = options.now || new Date();
  const shortTermRate = num(options.shortTermRate, 0.24);
  const longTermRate = num(options.longTermRate, 0.15);
  const holdings = enrichHoldings(input, options);
  let shortTermGain = 0;
  let longTermGain = 0;
  let unrealizedShortTermGain = 0;
  let unrealizedLongTermGain = 0;
  for (const item of holdings) {
    const age = itemDate(item) ? daysAgo(itemDate(item), now) : null;
    const longTerm = age !== null && age >= 365;
    if (statusOf(item) === 'sold') {
      if (longTerm) longTermGain += item.realizedGain;
      else shortTermGain += item.realizedGain;
    } else if (longTerm) unrealizedLongTermGain += item.unrealizedGain;
    else unrealizedShortTermGain += item.unrealizedGain;
  }
  const realizedTaxEstimate = Math.max(0, shortTermGain) * shortTermRate + Math.max(0, longTermGain) * longTermRate;
  const ifLiquidatedTaxEstimate = realizedTaxEstimate + Math.max(0, unrealizedShortTermGain) * shortTermRate + Math.max(0, unrealizedLongTermGain) * longTermRate;
  return {
    generatedAt: now.toISOString(),
    taxYear: options.taxYear || now.getUTCFullYear(),
    costBasis: roundMoney(holdings.reduce((sum, item) => sum + item.costBasis, 0)),
    realizedShortTermGain: roundMoney(shortTermGain),
    realizedLongTermGain: roundMoney(longTermGain),
    unrealizedShortTermGain: roundMoney(unrealizedShortTermGain),
    unrealizedLongTermGain: roundMoney(unrealizedLongTermGain),
    realizedTaxEstimate: roundMoney(realizedTaxEstimate),
    ifLiquidatedTaxEstimate: roundMoney(ifLiquidatedTaxEstimate),
    assumptions: { shortTermRate, longTermRate, holdingPeriodDaysForLongTerm: 365 },
    disclaimer: 'Tax summary is an estimate for organization only. It is not tax advice and does not account for state taxes, fees, wash-sale-like record issues, ordinary income treatment, deductions, or business inventory accounting.',
  };
}

export function runScenarioAnalysis(input, scenario = {}, options = {}) {
  const holdings = enrichHoldings(input, options).filter((item) => statusOf(item) !== 'sold');
  const selectedIds = new Set(Array.isArray(scenario.collectionItemIds) ? scenario.collectionItemIds : []);
  const selectedCardIds = new Set(Array.isArray(scenario.cardIds) ? scenario.cardIds : []);
  const selected = selectedIds.size || selectedCardIds.size
    ? holdings.filter((item) => selectedIds.has(item.id) || selectedCardIds.has(item.cardId))
    : holdings;
  const currentValue = holdings.reduce((sum, item) => sum + item.currentValue, 0);
  const selectedValue = selected.reduce((sum, item) => sum + item.currentValue, 0);
  const dropPct = num(scenario.marketDropPct, 0);
  const gainPct = num(scenario.marketGainPct, 0);
  const netMovePct = gainPct - dropPct;
  const sellFeePct = num(scenario.sellFeePct, 0.13);
  const soldProceeds = selectedValue * (1 - sellFeePct);
  const selectedCost = selected.reduce((sum, item) => sum + item.costBasis, 0);
  const postMoveValue = currentValue * (1 + netMovePct / 100);
  return {
    generatedAt: (options.now || new Date()).toISOString(),
    scenario: { ...scenario, sellFeePct },
    currentValue: roundMoney(currentValue),
    selectedValue: roundMoney(selectedValue),
    selectedCount: selected.length,
    estimatedSellProceeds: roundMoney(soldProceeds),
    estimatedRealizedGainIfSold: roundMoney(soldProceeds - selectedCost),
    valueAfterMarketMove: roundMoney(postMoveValue),
    projectedChange: roundMoney(postMoveValue - currentValue),
    remainingValueAfterSelectedSale: roundMoney(currentValue - selectedValue),
    disclaimer: 'Scenario outputs are projections based on current included comps and user-supplied assumptions. They are not guarantees.',
  };
}

export function getInventoryHealth(input, options = {}) {
  const now = options.now || new Date();
  const holdings = enrichHoldings(input, options).filter((item) => statusOf(item) !== 'sold');
  const sales = options.sales || [];
  const decisionSupport = buildShopInventoryDecisionSupport(holdings, { now });
  const byCard = aggregateBy(holdings, (item) => item.cardId || item.card?.id || item.name || 'Unmatched');
  const cardRows = byCard.map((row) => {
    const cardId = holdings.find((item) => (item.cardId || item.card?.id || item.name || 'Unmatched') === row.label)?.cardId;
    const cardSales = sales.filter((sale) => sale.cardId === cardId);
    const sales90 = cardSales.filter((sale) => daysAgo(sale.soldAt, now) <= 90).length;
    const monthlyVelocity = roundMoney(sales90 / 3);
    const quantity = row.quantity;
    const daysOfSupply = monthlyVelocity > 0 ? Math.round((quantity / monthlyVelocity) * 30) : null;
    return { ...row, cardId, sales90, monthlyVelocity, daysOfSupply };
  });
  const agingStock = holdings.filter((item) => (item.ageDays ?? 0) >= 120 && item.liquidityScore < 55).sort((a, b) => (b.ageDays || 0) - (a.ageDays || 0)).slice(0, 25);
  const lowStockAlerts = cardRows.filter((row) => row.monthlyVelocity >= 1 && row.quantity <= Math.max(1, Math.ceil(row.monthlyVelocity))).slice(0, 25);
  const reorderPoints = cardRows.filter((row) => row.monthlyVelocity > 0).map((row) => ({
    cardId: row.cardId,
    label: row.label,
    currentQuantity: row.quantity,
    monthlyVelocity: row.monthlyVelocity,
    suggestedReorderPoint: Math.max(1, Math.ceil(row.monthlyVelocity * 1.5)),
  })).sort((a, b) => b.monthlyVelocity - a.monthlyVelocity).slice(0, 25);
  const stalePricing = holdings.filter((item) => (item.market?.freshnessHours ?? Infinity) > 24 * 30 || item.valueConfidence < 55).slice(0, 25);
  return {
    generatedAt: now.toISOString(),
    inventoryValue: roundMoney(holdings.reduce((sum, item) => sum + item.currentValue, 0)),
    itemCount: holdings.length,
    totalQuantity: holdings.reduce((sum, item) => sum + item.quantity, 0),
    activeListings: holdings.filter((item) => statusOf(item) === 'listed').length,
    gradingItems: holdings.filter((item) => statusOf(item) === 'grading').length,
    consignedItems: holdings.filter((item) => statusOf(item) === 'consigned').length,
    averageAgeDays: holdings.length ? Math.round(holdings.reduce((sum, item) => sum + (item.ageDays || 0), 0) / holdings.length) : 0,
    agingStock,
    lowStockAlerts,
    reorderPoints,
    stalePricing,
    velocityLeaders: cardRows.sort((a, b) => b.monthlyVelocity - a.monthlyVelocity).slice(0, 10),
    decisionSupport,
    listCandidates: decisionSupport.listCandidates,
    holdCandidates: decisionSupport.holdCandidates,
    repriceCandidates: decisionSupport.repriceCandidates,
    reviewCandidates: decisionSupport.reviewCandidates,
    disclaimer: 'Inventory health is decision support only. Reorder and sale recommendations depend on connected sales coverage, comp quality, and local shop strategy.',
  };
}

export function getSmartRecommendations(input, options = {}) {
  const metrics = calculatePortfolioMetrics(input, options);
  const holdings = enrichHoldings(input, options).filter((item) => statusOf(item) !== 'sold');
  const decisionSupport = buildPortfolioDecisionSupport(holdings, { now: options.now || new Date() });
  const recommendations = [];
  for (const item of holdings) {
    if (item.valueConfidence < 55 || (item.compQuality?.includedCount || 0) < 2) {
      recommendations.push({ type: 'review_value', priority: 'high', collectionItemId: item.id, cardId: item.cardId, title: 'Review valuation confidence', message: `${item.card?.player || item.name || 'This card'} has low confidence or limited included comps.` });
    }
    if (item.gainPct !== null && item.gainPct >= 40 && item.liquidityScore >= 65) {
      recommendations.push({ type: 'consider_sale', priority: 'medium', collectionItemId: item.id, cardId: item.cardId, title: 'Consider taking profit', message: `${item.card?.player || item.name || 'This card'} is up ${item.gainPct}% with solid liquidity.` });
    }
    if ((item.ageDays || 0) > 180 && item.liquidityScore < 45) {
      recommendations.push({ type: 'aging_stock', priority: 'medium', collectionItemId: item.id, cardId: item.cardId, title: 'Aging low-liquidity holding', message: 'Consider repricing, bundling, grading review, or moving to a long-term hold box.' });
    }
  }
  for (const signal of decisionSupport.actionBuckets.sellNow.slice(0, 8)) {
    recommendations.push({
      type: 'sell_now',
      priority: signal.recommendation.conviction >= 75 ? 'high' : 'medium',
      collectionItemId: signal.collectionItemId,
      cardId: signal.cardId,
      title: 'Sell-now candidate',
      message: `${signal.name} has ${signal.recommendation.label.toLowerCase()} pressure: ${signal.recommendation.reasons[0] || 'completed-sale signals favor action.'}`,
    });
  }
  for (const signal of decisionSupport.actionBuckets.buyMore.slice(0, 5)) {
    recommendations.push({
      type: 'buy_more',
      priority: 'medium',
      collectionItemId: signal.collectionItemId,
      cardId: signal.cardId,
      title: 'Momentum candidate',
      message: `${signal.name} is showing stronger completed-sale momentum and liquidity than most holdings.`,
    });
  }
  if (metrics.concentrationRisk === 'high') {
    recommendations.unshift({ type: 'concentration_risk', priority: 'high', title: 'Portfolio concentration risk', message: `${metrics.topConcentration?.label} represents ${metrics.topConcentration?.pctOfValue}% of value. Diversification may reduce portfolio volatility.` });
  }
  return {
    generatedAt: (options.now || new Date()).toISOString(),
    recommendations: recommendations.slice(0, 50),
    counts: recommendations.reduce((acc, item) => { acc[item.priority] = (acc[item.priority] || 0) + 1; return acc; }, {}),
  };
}

export function getPortfolioTrends(input, period = '365d', options = {}) {
  const holdings = enrichHoldings(input, options).filter((item) => statusOf(item) !== 'sold');
  const buckets = new Map();
  for (const item of holdings) {
    const key = dateKey(item.purchaseDate || item.createdAt || options.now, period);
    if (!buckets.has(key)) buckets.set(key, { period: key, costBasisAdded: 0, currentValueAdded: 0, quantityAdded: 0 });
    const row = buckets.get(key);
    row.costBasisAdded += item.costBasis;
    row.currentValueAdded += item.currentValue;
    row.quantityAdded += item.quantity;
  }
  let cumulativeCost = 0;
  let cumulativeValue = 0;
  return [...buckets.values()].sort((a, b) => a.period.localeCompare(b.period)).map((row) => {
    cumulativeCost += row.costBasisAdded;
    cumulativeValue += row.currentValueAdded;
    return {
      period: row.period,
      quantityAdded: row.quantityAdded,
      costBasisAdded: roundMoney(row.costBasisAdded),
      currentValueAdded: roundMoney(row.currentValueAdded),
      cumulativeCostBasis: roundMoney(cumulativeCost),
      cumulativeCurrentValue: roundMoney(cumulativeValue),
      cumulativeGain: roundMoney(cumulativeValue - cumulativeCost),
    };
  });
}

export function buildPortfolioIntelligence(input, options = {}) {
  const holdings = enrichHoldings(input, options);
  const metrics = calculatePortfolioMetrics(holdings, { ...options, collection: holdings });
  const decisionSupport = buildPortfolioDecisionSupport(holdings, { now: options.now || new Date() });
  return {
    metrics,
    roi: metrics.roi,
    allocation: metrics.allocation,
    taxEstimate: generateTaxEstimate(holdings, { ...options, collection: holdings }),
    inventoryHealth: getInventoryHealth(holdings, { ...options, collection: holdings }),
    recommendations: getSmartRecommendations(holdings, { ...options, collection: holdings }),
    trends: getPortfolioTrends(holdings, options.period || '365d', { ...options, collection: holdings }),
    decisionSupport,
    marketMovement: decisionSupport.summary,
  };
}
