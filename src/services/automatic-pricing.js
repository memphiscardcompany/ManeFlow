import { calculateValuation } from './valuation.js';
import { ingestPricingData } from './pricing-data.js';

const DEFAULT_REFRESH_INTERVAL_MS = 6 * 60 * 60_000;
const DEFAULT_CACHE_TTL_MS = 15 * 60_000;
const DEFAULT_LOOKBACK_DAYS = 730;
const DEFAULT_COMPLETED_LIMIT = 100;
const DEFAULT_ACTIVE_LIMIT = 12;

function iso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function ageMs(value, now) {
  const timestamp = iso(value);
  return timestamp ? Math.max(0, now.getTime() - new Date(timestamp).getTime()) : Infinity;
}

function cleanCardContext(card = {}) {
  const grade = card.grade && typeof card.grade === 'object'
    ? card.grade.grade ?? null
    : card.grade ?? null;
  return {
    cardId: card.id || null,
    player: card.player || card.subject || null,
    year: card.year || null,
    brand: card.brand || card.manufacturer || null,
    set: card.set || card.product || null,
    cardNumber: card.cardNumber || null,
    parallel: card.parallel || card.variation || null,
    grader: card.grade?.company || card.grader || null,
    grade,
  };
}

function cardQuery(card = {}) {
  const context = cleanCardContext(card);
  return [
    context.year,
    context.brand,
    context.set,
    context.player,
    context.cardNumber,
    context.parallel,
    context.grader,
    context.grade,
  ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function latestProviderEvidenceAt(sales = [], providerPattern = /ebay/i) {
  const timestamps = sales
    .filter((sale) => providerPattern.test(String(sale.provider || '')))
    .map((sale) => iso(sale.importedAt || sale.updatedAt || sale.createdAt || sale.soldAt))
    .filter(Boolean)
    .sort()
    .reverse();
  return timestamps[0] || null;
}

function providerReadiness(ebay) {
  if (!ebay) return { ready: false, reason: 'provider_not_registered', status: null };
  const status = typeof ebay.status === 'function' ? ebay.status() : {};
  if (typeof ebay.searchCompletedSales !== 'function') {
    return { ready: false, reason: 'completed_sale_search_unavailable', status };
  }
  if (status.marketplaceInsightsEnabled !== true && ebay.marketplaceInsightsEnabled !== true) {
    return { ready: false, reason: 'marketplace_insights_not_enabled', status };
  }
  return { ready: true, reason: null, status };
}

function publicFailure(error) {
  return {
    code: String(error?.code || 'AUTOMATIC_PRICING_REFRESH_FAILED').slice(0, 160),
    message: String(error?.message || error || 'Automatic pricing refresh failed.').slice(0, 800),
    status: Number(error?.status || 0) || null,
    retryable: error?.retryable === true,
  };
}

function marketMode(config, sales = []) {
  const productionCount = sales.filter((sale) => sale.sourceMode !== 'demo').length;
  const demoCount = sales.filter((sale) => sale.sourceMode === 'demo').length;
  if (productionCount && demoCount) return 'mixed';
  if (productionCount) return 'production';
  if (demoCount || config.demoMode) return 'demo';
  return 'unavailable';
}

function pricingStatus(valuation, sales = [], refresh = {}) {
  const productionEligible = sales.filter((sale) => sale.sourceMode !== 'demo' && sale.valuationUse !== false).length;
  if (valuation?.value !== null && valuation?.value !== undefined) {
    return productionEligible > 0 ? 'valued_from_authorized_completed_sales' : 'demo_or_nonproduction_value';
  }
  if (refresh.attempted && refresh.error) return 'refresh_failed_no_value';
  return 'valuation_unavailable';
}

export function createAutomaticPricingEngine({
  config,
  providers,
  store,
  cache,
  catalog,
  salesForCard,
  activeAskingListingsForCard = null,
  refreshIntervalMs = DEFAULT_REFRESH_INTERVAL_MS,
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
  completedLimit = DEFAULT_COMPLETED_LIMIT,
  activeLimit = DEFAULT_ACTIVE_LIMIT,
} = {}) {
  if (!config || !providers || !store || !cache || typeof catalog !== 'function' || typeof salesForCard !== 'function') {
    throw new TypeError('Automatic pricing requires config, providers, store, cache, catalog, and salesForCard.');
  }
  const inFlight = new Map();

  async function calculate(card, { actor = null, force = false, reason = 'automatic', now = new Date() } = {}) {
    if (!card?.id) {
      return {
        status: 'card_identity_required',
        cardId: null,
        valuation: null,
        refresh: { attempted: false, reason: 'card_identity_required' },
        askingPriceContext: { listings: [], error: null },
      };
    }
    const cacheKey = `automatic-pricing:${card.id}`;
    if (!force) {
      const cached = cache.get(cacheKey);
      if (cached) return { ...cached, cache: { hit: true } };
      if (inFlight.has(cacheKey)) return inFlight.get(cacheKey);
    }

    const task = (async () => {
      const existingBefore = salesForCard(card);
      const latestEvidenceAt = latestProviderEvidenceAt(existingBefore);
      const stale = ageMs(latestEvidenceAt, now) >= refreshIntervalMs;
      const ebay = providers.byName?.get?.('eBay') || null;
      const readiness = providerReadiness(ebay);
      const refresh = {
        attempted: false,
        performed: false,
        provider: 'eBay Marketplace Insights',
        reason: null,
        stale,
        latestEvidenceAt,
        imported: 0,
        updated: 0,
        rejected: 0,
        review: 0,
        rawCount: 0,
        error: null,
      };

      if (!force && !stale && existingBefore.length) {
        refresh.reason = 'fresh_completed_sale_evidence_available';
      } else if (!readiness.ready) {
        refresh.reason = readiness.reason;
      } else {
        refresh.attempted = true;
        try {
          const result = await ebay.searchCompletedSales({
            query: cardQuery(card),
            limit: Math.max(1, Math.min(200, Number(completedLimit) || DEFAULT_COMPLETED_LIMIT)),
            dateFrom: new Date(now.getTime() - lookbackDays * 24 * 60 * 60_000).toISOString(),
            dateTo: now.toISOString(),
            cardContext: cleanCardContext(card),
            importedBy: actor?.userId || 'automatic_pricing_engine',
          });
          const ingest = await ingestPricingData({
            rows: result.sales,
            cards: catalog(),
            store,
            source: {
              provider: 'eBay Marketplace Insights',
              sourceMode: 'production',
              authorizationBasis: 'ebay_api',
              dataRightsStatus: 'ebay_marketplace_insights_limited_release',
              refreshPolicy: 'automatic_confirmed_card_refresh',
              rightsNotes: 'Automatically refreshed after a user confirmed an exact card identity. Requires eBay-approved Marketplace Insights access. Active listings remain excluded from market value.',
              importedBy: actor?.userId || 'automatic_pricing_engine',
            },
            actor,
            config,
            now,
          });
          refresh.performed = true;
          refresh.reason = 'authorized_completed_sales_refreshed';
          refresh.imported = Number(ingest.result?.added || 0);
          refresh.updated = Number(ingest.result?.updated || 0);
          refresh.rejected = Number(ingest.rejected?.length || 0);
          refresh.review = Number(ingest.review?.length || 0);
          refresh.rawCount = Number(result.rawCount || 0);
        } catch (error) {
          refresh.error = publicFailure(error);
          refresh.reason = 'provider_refresh_failed';
        }
      }

      let askingListings = [];
      let askingError = null;
      if (typeof activeAskingListingsForCard === 'function') {
        try {
          const context = await activeAskingListingsForCard(card, { limit: activeLimit });
          askingListings = Array.isArray(context?.listings) ? context.listings : [];
          askingError = context?.error || null;
        } catch (error) {
          askingError = String(error?.message || error).slice(0, 800);
        }
      }

      const currentSales = salesForCard(card);
      const valuation = calculateValuation(currentSales, {
        card,
        now,
        demoMode: config.demoMode,
        overrides: store.compOverrides?.() || {},
        askingListings,
        includeCompDetails: true,
      });
      const result = {
        status: pricingStatus(valuation, currentSales, refresh),
        cardId: card.id,
        cardIdentity: cleanCardContext(card),
        marketMode: marketMode(config, currentSales),
        valuation,
        completedSaleCount: currentSales.filter((sale) => sale.isCompletedSale !== false).length,
        productionCompletedSaleCount: currentSales.filter((sale) => sale.sourceMode !== 'demo' && sale.isCompletedSale !== false).length,
        refresh,
        askingPriceContext: {
          listings: askingListings,
          error: askingError,
          valuationUse: false,
          explanation: 'Active listings are asking-price context only and never set ManeFlow market value.',
        },
        generatedAt: now.toISOString(),
        methodology: 'ManeFlow automatically refreshes authorized completed-sale evidence after exact identity confirmation, scores and deduplicates comps, and calculates the value. The user does not enter comparable prices.',
      };

      if (refresh.attempted && typeof store.audit === 'function') {
        await store.audit({
          type: refresh.performed ? 'automatic_pricing_refresh_completed' : 'automatic_pricing_refresh_failed',
          userId: actor?.userId || null,
          cardId: card.id,
          reason,
          provider: refresh.provider,
          imported: refresh.imported,
          updated: refresh.updated,
          rejected: refresh.rejected,
          review: refresh.review,
          errorCode: refresh.error?.code || null,
          createdAt: now.toISOString(),
        });
      }
      cache.set(cacheKey, result, cacheTtlMs);
      return result;
    })();

    inFlight.set(cacheKey, task);
    try {
      return await task;
    } finally {
      inFlight.delete(cacheKey);
    }
  }

  return {
    priceCard: calculate,
    clear(cardId = null) {
      if (cardId) return cache.delete(`automatic-pricing:${cardId}`);
      return false;
    },
  };
}

export const automaticPricingInternals = {
  cardQuery,
  cleanCardContext,
  latestProviderEvidenceAt,
  marketMode,
  pricingStatus,
  providerReadiness,
};
