import { clamp, daysAgo, roundMoney } from './utils.js';

export const PORTFOLIO_DECISION_VERSION = 'portfolio-decision-v1.0';

const ACTION_LABELS = {
  sell_now: 'Sell now',
  hold: 'Hold',
  buy_more: 'Buy more',
  wait: 'Wait',
};

const SHOP_ACTION_LABELS = {
  list: 'List candidate',
  hold: 'Hold',
  reprice: 'Reprice',
  review: 'Review first',
};

const PRIORITY_WEIGHT = { high: 3, medium: 2, low: 1 };

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function maybeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pctLabel(value) {
  return value === null || value === undefined ? 'no trend' : `${value >= 0 ? '+' : ''}${roundMoney(value)}%`;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function cardName(item = {}) {
  const card = item.card || {};
  return [card.year, card.brand, card.set, card.player || item.name, card.cardNumber ? `#${card.cardNumber}` : '', card.parallel]
    .filter(Boolean)
    .join(' ')
    .trim() || item.name || 'Unmatched card';
}

function includedCompCount(market = {}) {
  return num(market.compQuality?.includedCount, num(market.windows?.d90?.count, 0));
}

function completedSalesOnlyNote(market = {}) {
  const asks = market.askingPriceContext || {};
  if (!asks.count) return null;
  return {
    label: 'BIN context only',
    count: asks.count,
    medianAsk: asks.medianAsk ?? null,
    rating: asks.rating || 'asking_context',
    note: 'Current asking prices are secondary listing context only and are not included in completed-sale market value, movement, confidence, or ROI.',
  };
}

function historicalAnchorFromTrend(currentValue, trendPct) {
  if (!currentValue || trendPct === null || trendPct === undefined || trendPct <= -99) return null;
  return roundMoney(currentValue / (1 + Number(trendPct) / 100));
}

export function buildMarketMovement(market = {}, quantity = 1) {
  const currentUnitValue = maybeNumber(market.value);
  const currentValue = currentUnitValue === null ? null : roundMoney(currentUnitValue * Math.max(1, num(quantity, 1)));
  const trend30Pct = maybeNumber(market.trend30Pct);
  const trend90Pct = maybeNumber(market.trend90Pct);
  const prior30UnitValue = historicalAnchorFromTrend(currentUnitValue, trend30Pct);
  const prior90UnitValue = historicalAnchorFromTrend(currentUnitValue, trend90Pct);
  const shortMomentumPct = market.windows?.d7?.weighted && market.windows?.d30?.weighted
    ? roundMoney(((market.windows.d7.weighted - market.windows.d30.weighted) / market.windows.d30.weighted) * 100)
    : null;
  return {
    currentUnitValue,
    currentValue,
    prior30UnitValue,
    prior90UnitValue,
    change30Unit: currentUnitValue !== null && prior30UnitValue !== null ? roundMoney(currentUnitValue - prior30UnitValue) : null,
    change90Unit: currentUnitValue !== null && prior90UnitValue !== null ? roundMoney(currentUnitValue - prior90UnitValue) : null,
    change30Value: currentValue !== null && prior30UnitValue !== null ? roundMoney(currentValue - prior30UnitValue * Math.max(1, num(quantity, 1))) : null,
    change90Value: currentValue !== null && prior90UnitValue !== null ? roundMoney(currentValue - prior90UnitValue * Math.max(1, num(quantity, 1))) : null,
    trend30Pct,
    trend90Pct,
    shortMomentumPct,
    direction: market.direction || (trend30Pct === null ? 'insufficient_data' : trend30Pct > 3 ? 'rising' : trend30Pct < -3 ? 'falling' : 'steady'),
    completedSaleWindows: {
      d7: market.windows?.d7 || null,
      d30: market.windows?.d30 || null,
      d90: market.windows?.d90 || null,
      d180: market.windows?.d180 || null,
      d365: market.windows?.d365 || null,
    },
    methodology: 'Movement is calculated from included completed-sale comps only. Active BIN/ask prices are not used.',
  };
}

export function buildValuationConfidence(market = {}) {
  const included = includedCompCount(market);
  const base = num(market.completedSaleConfidence ?? market.confidence, 0);
  const compQuality = market.compQuality || {};
  const quality = num(compQuality.averageQualityScore, base);
  const trust = num(compQuality.averageSourceTrust, base);
  const match = num(compQuality.averageMatchScore, base);
  const providerScore = clamp(num(market.providerCount, safeArray(market.providers).length) / 4, 0, 1) * 100;
  const volumeScore = clamp(Math.log10(included + 1) / 1.45, 0, 1) * 100;
  const freshnessHours = market.freshnessHours === null || market.freshnessHours === undefined ? Infinity : num(market.freshnessHours, Infinity);
  const freshnessScore = freshnessHours === Infinity ? 0 : clamp(100 - freshnessHours / 24, 0, 100);
  const reviewPenalty = clamp(num(compQuality.needsReviewCount, 0) * 5 + num(market.outlierCount, 0) * 2 + num(market.duplicateCount, 0), 0, 24);
  const score = Math.round(clamp(
    0.34 * base + 0.18 * quality + 0.16 * trust + 0.12 * match + 0.1 * providerScore + 0.07 * volumeScore + 0.03 * freshnessScore - reviewPenalty,
    0,
    99,
  ));
  const label = included < 2 ? 'thin_data' : score >= 78 ? 'high' : score >= 58 ? 'medium' : 'low';
  const warnings = [];
  if (!market.value) warnings.push('No completed-sale anchor is available.');
  if (included < 2) warnings.push('Fewer than two included completed-sale comps.');
  if (safeArray(market.providers).length < 2) warnings.push('Limited source diversity.');
  if (freshnessHours > 24 * 30) warnings.push('Most recent included comp is stale.');
  if (num(compQuality.needsReviewCount, 0) > 0) warnings.push(`${compQuality.needsReviewCount} comp(s) need review.`);
  return {
    score,
    label,
    includedCompCount: included,
    sourceDiversity: safeArray(market.providers).length,
    averageCompQuality: compQuality.averageQualityScore ?? null,
    averageSourceTrust: compQuality.averageSourceTrust ?? null,
    averageMatchScore: compQuality.averageMatchScore ?? null,
    freshnessHours: market.freshnessHours ?? null,
    warnings,
    methodology: 'Valuation confidence is separate from scan confidence and is based on completed-sale volume, comp quality, source trust, match quality, source diversity, and freshness.',
  };
}

export function buildLiquiditySignal(market = {}, now = new Date()) {
  const score = Math.round(clamp(num(market.liquidityScore, 0), 0, 100));
  const volume90 = num(market.volume90, market.windows?.d90?.count || 0);
  const monthlyVelocity = num(market.monthlyVelocity, roundMoney(volume90 / 3));
  const lastSaleAgeDays = market.lastSaleAt ? Math.round(daysAgo(market.lastSaleAt, now)) : null;
  const label = score >= 75 ? 'high' : score >= 55 ? 'tradable' : score >= 35 ? 'slow' : 'thin';
  const warnings = [];
  if (volume90 < 3) warnings.push('Thin recent completed-sale volume.');
  if (lastSaleAgeDays === null) warnings.push('No included completed-sale date.');
  else if (lastSaleAgeDays > 45) warnings.push('No recent included sale in the last 45 days.');
  return {
    score,
    label,
    volume90,
    monthlyVelocity: roundMoney(monthlyVelocity),
    lastSaleAt: market.lastSaleAt || null,
    lastSaleAgeDays,
    warnings,
  };
}

export function buildMomentumSignal(market = {}, portfolioAverageTrend30Pct = null) {
  const trend30 = maybeNumber(market.trend30Pct);
  const trend90 = maybeNumber(market.trend90Pct);
  const shortMomentum = market.windows?.d7?.weighted && market.windows?.d30?.weighted
    ? roundMoney(((market.windows.d7.weighted - market.windows.d30.weighted) / market.windows.d30.weighted) * 100)
    : null;
  const relativeStrengthPct = trend30 !== null && portfolioAverageTrend30Pct !== null ? roundMoney(trend30 - portfolioAverageTrend30Pct) : null;
  const trend30Score = trend30 === null ? 0 : clamp((trend30 + 24) / 48, 0, 1) * 100;
  const trend90Score = trend90 === null ? 0 : clamp((trend90 + 30) / 60, 0, 1) * 100;
  const relativeScore = relativeStrengthPct === null ? 50 : clamp((relativeStrengthPct + 20) / 40, 0, 1) * 100;
  const shortScore = shortMomentum === null ? 50 : clamp((shortMomentum + 18) / 36, 0, 1) * 100;
  const score = Math.round(clamp(0.42 * trend30Score + 0.28 * trend90Score + 0.2 * relativeScore + 0.1 * shortScore, 0, 100));
  const label = trend30 === null && trend90 === null ? 'insufficient_data' : score >= 70 ? 'outperforming' : score >= 48 ? 'steady' : 'weakening';
  return {
    score,
    label,
    trend30Pct: trend30,
    trend90Pct: trend90,
    shortMomentumPct: shortMomentum,
    relativeStrengthPct,
    summary: `30d ${pctLabel(trend30)} / 90d ${pctLabel(trend90)}${relativeStrengthPct === null ? '' : ` / relative ${pctLabel(relativeStrengthPct)}`}`,
  };
}

export function recommendPortfolioAction({ holding = {}, market = {}, valuationConfidence, liquidity, momentum } = {}) {
  const reasons = [];
  const risks = [];
  const value = maybeNumber(market.value);
  const gainPct = maybeNumber(holding.gainPct);
  const trend30 = maybeNumber(market.trend30Pct);
  const trend90 = maybeNumber(market.trend90Pct);
  const included = valuationConfidence.includedCompCount;
  const confidence = valuationConfidence.score;

  if (!value || included < 2 || confidence < 45) {
    reasons.push('Completed-sale data is too thin for a confident action.');
    risks.push(...valuationConfidence.warnings);
    return {
      action: 'wait',
      label: ACTION_LABELS.wait,
      conviction: Math.max(20, Math.round(confidence / 2)),
      reasons,
      risks: [...new Set(risks)],
    };
  }

  if (confidence < 58) {
    reasons.push('Valuation confidence is still low enough to require review.');
    risks.push(...valuationConfidence.warnings);
    return { action: 'wait', label: ACTION_LABELS.wait, conviction: confidence, reasons, risks: [...new Set(risks)] };
  }

  const relative = maybeNumber(momentum.relativeStrengthPct);
  const falling = trend30 !== null && trend30 <= -8;
  const extendedProfit = gainPct !== null && gainPct >= 35 && liquidity.score >= 55;
  const weakRelative = relative !== null && relative <= -12 && (trend90 ?? 0) <= 0;

  if (liquidity.score >= 55 && confidence >= 64 && (falling || extendedProfit || weakRelative)) {
    if (falling) reasons.push(`Recent completed sales are weakening (${pctLabel(trend30)} over 30 days).`);
    if (extendedProfit) reasons.push(`Position is up ${roundMoney(gainPct)}% with tradable liquidity.`);
    if (weakRelative) reasons.push('This card is underperforming the rest of the portfolio.');
    return {
      action: 'sell_now',
      label: ACTION_LABELS.sell_now,
      conviction: Math.round(clamp((confidence + liquidity.score + (falling ? 75 : 55)) / 3, 0, 100)),
      reasons,
      risks: valuationConfidence.warnings.slice(0, 3),
    };
  }

  const strongUptrend = trend30 !== null && trend30 >= 8 && (trend90 === null || trend90 >= 3);
  const outperforming = relative !== null && relative >= 6;
  if (confidence >= 70 && liquidity.score >= 55 && (strongUptrend || outperforming) && included >= 3) {
    if (strongUptrend) reasons.push(`Completed-sale momentum is positive (${pctLabel(trend30)} over 30 days).`);
    if (outperforming) reasons.push('Relative strength is better than the portfolio average.');
    reasons.push('Liquidity and valuation confidence are strong enough to support a watchlist/add decision.');
    return {
      action: 'buy_more',
      label: ACTION_LABELS.buy_more,
      conviction: Math.round(clamp((confidence + liquidity.score + momentum.score) / 3, 0, 100)),
      reasons,
      risks: valuationConfidence.warnings.slice(0, 2),
    };
  }

  if (liquidity.score < 35) {
    reasons.push('Liquidity is thin, so forcing action may create bad execution.');
    risks.push(...liquidity.warnings);
    return { action: 'wait', label: ACTION_LABELS.wait, conviction: Math.max(35, Math.round(confidence * 0.7)), reasons, risks: [...new Set(risks)] };
  }

  reasons.push(momentum.label === 'weakening' ? 'Momentum is soft but not decisive enough to force a sale.' : 'Completed-sale trend and liquidity support holding.');
  return {
    action: 'hold',
    label: ACTION_LABELS.hold,
    conviction: Math.round(clamp((confidence + liquidity.score + momentum.score) / 3, 0, 100)),
    reasons,
    risks: [...new Set([...valuationConfidence.warnings.slice(0, 2), ...liquidity.warnings.slice(0, 1)])],
  };
}

export function buildCardDecisionSignal(holding = {}, { now = new Date(), portfolioAverageTrend30Pct = null } = {}) {
  const market = holding.market || {};
  const quantity = Math.max(1, num(holding.quantity, 1));
  const movement = buildMarketMovement(market, quantity);
  const valuationConfidence = buildValuationConfidence(market);
  const liquidity = buildLiquiditySignal(market, now);
  const momentum = buildMomentumSignal(market, portfolioAverageTrend30Pct);
  const recommendation = recommendPortfolioAction({ holding, market, valuationConfidence, liquidity, momentum });
  const askingPriceContext = completedSalesOnlyNote(market);
  return {
    collectionItemId: holding.id || null,
    cardId: holding.cardId || holding.card?.id || null,
    name: cardName(holding),
    quantity,
    costBasis: roundMoney(num(holding.costBasis, 0)),
    currentValue: movement.currentValue ?? roundMoney(num(holding.currentValue, 0)),
    gain: roundMoney(num(holding.gain, 0)),
    gainPct: holding.gainPct ?? null,
    movement,
    valuationConfidence,
    liquidity,
    momentum,
    recommendation,
    askingPriceContext,
    dataHealth: {
      thinData: valuationConfidence.includedCompCount < 2,
      stale: valuationConfidence.freshnessHours !== null && valuationConfidence.freshnessHours > 24 * 30,
      completedSalesOnly: true,
    },
    disclaimer: 'Decision support is based on included completed-sale comps only. Asking prices are secondary context and values are estimates, not appraisals or guarantees.',
  };
}

function activeHoldings(input = []) {
  return safeArray(input).filter((item) => String(item.status || 'owned').toLowerCase() !== 'sold');
}

function averageTrend30(holdings = []) {
  const trends = holdings.map((item) => maybeNumber(item.market?.trend30Pct)).filter((value) => value !== null);
  if (!trends.length) return null;
  return roundMoney(trends.reduce((sum, value) => sum + value, 0) / trends.length);
}

function summarizeSignals(signals = []) {
  const totalValue = signals.reduce((sum, item) => sum + num(item.currentValue, 0), 0);
  const value30Change = signals.reduce((sum, item) => sum + num(item.movement.change30Value, 0), 0);
  const confidenceScores = signals.map((item) => item.valuationConfidence.score).filter(Number.isFinite);
  const liquidityScores = signals.map((item) => item.liquidity.score).filter(Number.isFinite);
  const momentumScores = signals.map((item) => item.momentum.score).filter(Number.isFinite);
  const actionCounts = signals.reduce((acc, item) => {
    acc[item.recommendation.action] = (acc[item.recommendation.action] || 0) + 1;
    return acc;
  }, { sell_now: 0, hold: 0, buy_more: 0, wait: 0 });
  return {
    totalValue: roundMoney(totalValue),
    estimated30DayChange: roundMoney(value30Change),
    estimated30DayChangePct: totalValue > 0 ? roundMoney((value30Change / Math.max(0.01, totalValue - value30Change)) * 100) : null,
    averageValuationConfidence: confidenceScores.length ? Math.round(confidenceScores.reduce((sum, value) => sum + value, 0) / confidenceScores.length) : 0,
    averageLiquidityScore: liquidityScores.length ? Math.round(liquidityScores.reduce((sum, value) => sum + value, 0) / liquidityScores.length) : 0,
    averageMomentumScore: momentumScores.length ? Math.round(momentumScores.reduce((sum, value) => sum + value, 0) / momentumScores.length) : 0,
    thinDataCount: signals.filter((item) => item.dataHealth.thinData).length,
    staleValueCount: signals.filter((item) => item.dataHealth.stale).length,
    actionCounts,
  };
}

export function buildPortfolioDecisionSupport(input = [], options = {}) {
  const now = options.now || new Date();
  const holdings = activeHoldings(input);
  const portfolioTrend30Pct = averageTrend30(holdings);
  const signals = holdings.map((item) => buildCardDecisionSignal(item, { now, portfolioAverageTrend30Pct: portfolioTrend30Pct }))
    .sort((a, b) => b.currentValue - a.currentValue);
  const byAction = {
    sellNow: signals.filter((item) => item.recommendation.action === 'sell_now').sort((a, b) => b.recommendation.conviction - a.recommendation.conviction),
    hold: signals.filter((item) => item.recommendation.action === 'hold').sort((a, b) => b.currentValue - a.currentValue),
    buyMore: signals.filter((item) => item.recommendation.action === 'buy_more').sort((a, b) => b.recommendation.conviction - a.recommendation.conviction),
    wait: signals.filter((item) => item.recommendation.action === 'wait').sort((a, b) => a.valuationConfidence.score - b.valuationConfidence.score),
  };
  return {
    methodologyVersion: PORTFOLIO_DECISION_VERSION,
    generatedAt: now.toISOString(),
    portfolioAverageTrend30Pct: portfolioTrend30Pct,
    summary: summarizeSignals(signals),
    actionBuckets: byAction,
    cards: signals,
    relativeStrengthLeaders: [...signals].filter((item) => item.momentum.relativeStrengthPct !== null).sort((a, b) => b.momentum.relativeStrengthPct - a.momentum.relativeStrengthPct).slice(0, 10),
    weakeningCards: [...signals].filter((item) => item.momentum.label === 'weakening').sort((a, b) => a.momentum.score - b.momentum.score).slice(0, 10),
    disclaimer: 'Portfolio decision intelligence uses completed-sale valuation signals only. BIN/ask prices are displayed as secondary context and never mixed into market value averages.',
  };
}

export function recommendShopInventoryAction(item = {}, signal = null) {
  const decision = signal || buildCardDecisionSignal(item);
  const market = item.market || {};
  const listPrice = maybeNumber(item.listPrice);
  const value = maybeNumber(market.value);
  const status = String(item.status || 'available').toLowerCase();
  const reasons = [];
  if (!value || decision.valuationConfidence.score < 50 || decision.valuationConfidence.includedCompCount < 2) {
    reasons.push('Review before listing because completed-sale data is thin or low confidence.');
    return { action: 'review', label: SHOP_ACTION_LABELS.review, priority: 'high', reasons, suggestedListPrice: null };
  }
  if (status === 'listed' && listPrice !== null) {
    const high = maybeNumber(market.range?.high);
    const low = maybeNumber(market.range?.low);
    if (high !== null && listPrice > high * 1.12) {
      reasons.push(`Current list price is above the completed-sale high range (${roundMoney((listPrice / high - 1) * 100)}% over).`);
      return { action: 'reprice', label: SHOP_ACTION_LABELS.reprice, priority: 'high', reasons, suggestedListPrice: roundMoney(value * 1.05) };
    }
    if (low !== null && listPrice < low * 0.9 && decision.liquidity.score >= 55) {
      reasons.push('Listed below completed-sale range with tradable liquidity.');
      return { action: 'reprice', label: SHOP_ACTION_LABELS.reprice, priority: 'medium', reasons, suggestedListPrice: roundMoney(value * 1.03) };
    }
  }
  if (['available', 'hold'].includes(status) && ['sell_now', 'hold'].includes(decision.recommendation.action) && decision.liquidity.score >= 55) {
    reasons.push(decision.recommendation.action === 'sell_now' ? 'Completed-sale signals favor turning this into cash.' : 'Tradable liquidity and adequate confidence make this listable.');
    return { action: 'list', label: SHOP_ACTION_LABELS.list, priority: decision.recommendation.action === 'sell_now' ? 'high' : 'medium', reasons, suggestedListPrice: roundMoney(value * 1.05) };
  }
  if (decision.recommendation.action === 'buy_more') {
    reasons.push('Momentum is strong; hold inventory unless local demand supports a premium listing.');
    return { action: 'hold', label: SHOP_ACTION_LABELS.hold, priority: 'medium', reasons, suggestedListPrice: listPrice ?? roundMoney(value * 1.12) };
  }
  reasons.push('No urgent completed-sale signal. Keep monitored and re-evaluate after more comps.');
  return { action: 'hold', label: SHOP_ACTION_LABELS.hold, priority: 'low', reasons, suggestedListPrice: listPrice ?? roundMoney(value * 1.05) };
}

export function buildShopInventoryDecisionSupport(input = [], options = {}) {
  const now = options.now || new Date();
  const holdings = activeHoldings(input);
  const portfolioTrend30Pct = averageTrend30(holdings);
  const items = holdings.map((item) => {
    const signal = buildCardDecisionSignal(item, { now, portfolioAverageTrend30Pct: portfolioTrend30Pct });
    const shopAction = recommendShopInventoryAction(item, signal);
    return { ...signal, shopItemId: item.id || null, status: item.status || 'available', listPrice: item.listPrice ?? null, shopAction };
  });
  return {
    methodologyVersion: PORTFOLIO_DECISION_VERSION,
    generatedAt: now.toISOString(),
    summary: summarizeSignals(items),
    listCandidates: items.filter((item) => item.shopAction.action === 'list').sort((a, b) => (PRIORITY_WEIGHT[b.shopAction.priority] || 0) - (PRIORITY_WEIGHT[a.shopAction.priority] || 0) || b.currentValue - a.currentValue),
    holdCandidates: items.filter((item) => item.shopAction.action === 'hold').sort((a, b) => b.currentValue - a.currentValue),
    repriceCandidates: items.filter((item) => item.shopAction.action === 'reprice').sort((a, b) => b.currentValue - a.currentValue),
    reviewCandidates: items.filter((item) => item.shopAction.action === 'review').sort((a, b) => a.valuationConfidence.score - b.valuationConfidence.score),
    items,
    disclaimer: 'Shop inventory actions are decision support based on completed sales only. Asking prices remain secondary listing context and are not market value.',
  };
}
