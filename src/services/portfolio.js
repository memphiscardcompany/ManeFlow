import { calculatePortfolioMetrics } from './portfolio-intelligence.js';

// Backward-compatible wrapper used by earlier ManeFlow screens.
// New callers should prefer portfolio-intelligence.js directly.
export function portfolioAnalytics(collection, options = {}) {
  const metrics = calculatePortfolioMetrics(collection, options);
  return {
    totalValue: metrics.currentValue,
    totalCost: metrics.costBasis,
    totalGain: metrics.unrealizedGain,
    totalGainPct: metrics.unrealizedGainPct,
    estimatedLiquidValue: metrics.estimatedLiquidValue,
    allocation: metrics.allocation.bySport,
    topGainers: metrics.topGainers,
    topDecliners: metrics.topDecliners,
    mostLiquid: metrics.mostLiquid,
    intelligence: metrics,
  };
}
