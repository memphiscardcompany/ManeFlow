import { publicCompSummary } from './comp-quality.js';
import { redactSecrets } from './errors.js';

export function publicCard(card = {}) {
  if (!card) return null;
  return {
    id: card.id,
    player: card.player,
    year: card.year,
    brand: card.brand,
    set: card.set,
    cardNumber: card.cardNumber,
    parallel: card.parallel,
    sport: card.sport,
    category: card.category,
    grade: card.grade || null,
    image: card.image || null,
    rookie: Boolean(card.rookie),
    autograph: Boolean(card.autograph),
    relic: Boolean(card.relic),
  };
}

export function publicProviderStatus(provider = {}) {
  const safe = redactSecrets(provider);
  return {
    name: safe.name,
    mode: safe.mode,
    capabilities: safe.capabilities || [],
    authorizationBasis: safe.authorizationBasis || 'unknown',
    sourceMode: safe.sourceMode || 'production',
    supportsCompletedSales: Boolean(safe.supportsCompletedSales),
    supportsActiveListings: Boolean(safe.supportsActiveListings),
    supportsSellerOrders: Boolean(safe.supportsSellerOrders),
    supportsLiveAuctions: Boolean(safe.supportsLiveAuctions),
    refreshPolicy: safe.refreshPolicy || 'manual',
    requiresCredential: Boolean(safe.requiresCredential),
    dataRightsStatus: safe.dataRightsStatus || 'unknown',
    providerTrustScore: safe.providerTrustScore || 0,
    publicPricingReady: Boolean(safe.publicPricingReady),
    freshnessMinutes: safe.freshnessMinutes ?? null,
    lastSuccessAt: safe.lastSuccessAt || null,
    lastFailureAt: safe.lastFailureAt || null,
    lastImportAt: safe.lastImportAt || null,
    rateLimitUntil: safe.rateLimitUntil || null,
    notes: safe.notes || '',
  };
}

export function publicValuation(card, valuation = {}) {
  return {
    card: publicCard(card),
    value: valuation.value ?? null,
    range: valuation.range || { low: null, high: null },
    confidence: valuation.confidence || 0,
    liquidityScore: valuation.liquidityScore || 0,
    direction: valuation.direction || 'insufficient_data',
    volume90: valuation.volume90 || 0,
    providerCount: valuation.providerCount || 0,
    providers: valuation.providers || [],
    compQuality: valuation.compQuality || null,
    freshnessHours: valuation.freshnessHours ?? null,
    methodology: valuation.methodology,
    disclaimer: valuation.disclaimer,
  };
}

export function publicSale(sale) {
  return publicCompSummary(sale);
}
