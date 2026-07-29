import { clamp, median, normalizeText, percentile, roundMoney } from './utils.js';

export const ASKING_PRICE_CONTEXT_VERSION = 'asking-price-context-v1.0';

function money(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? roundMoney(parsed) : null;
}

function text(value) {
  return String(value ?? '').trim();
}

function lower(value) {
  return normalizeText(value || '');
}

function buyingOptionsOf(listing = {}) {
  const options = listing.buyingOptions || listing.buyingOption || listing.purchaseOptions || [];
  return (Array.isArray(options) ? options : String(options).split(','))
    .map((option) => lower(option).replace(/\s+/g, '_'))
    .filter(Boolean);
}

function isFixedPriceAsking(listing = {}) {
  const sourceType = lower(listing.sourceType || listing.type);
  const listingType = lower(listing.listingType);
  const saleType = lower(listing.saleType);
  const options = buyingOptionsOf(listing);
  const explicitlyCompleted = listing.isCompletedSale === true || ['sold', 'completed', 'completed_sale'].includes(sourceType) || ['sold', 'completed', 'completed_sale'].includes(listingType);
  if (explicitlyCompleted) return false;
  if (options.length) return options.includes('fixed_price') || options.includes('buy_it_now');
  return ['active_listing', 'active', 'asking', 'current'].includes(sourceType)
    || ['active', 'asking', 'buy_it_now_asking', 'fixed_price_active'].includes(listingType)
    || ['asking', 'buy_it_now_asking', 'fixed_price'].includes(saleType);
}

function listingKey(listing = {}) {
  return [
    text(listing.provider || 'unknown'),
    text(listing.itemId || listing.rawProviderId || listing.id || ''),
    lower(listing.title || '').slice(0, 140),
    String(listing.askPrice ?? listing.price ?? ''),
    text(listing.url || listing.rawUrl || ''),
  ].filter(Boolean).join('|');
}

export function normalizeAskingListing(listing = {}, { source = null } = {}) {
  const itemPrice = money(listing.itemPrice ?? listing.price ?? listing.currentPrice ?? listing.askPrice);
  const shipping = money(listing.shipping ?? listing.shippingPrice ?? listing.shippingCost) ?? 0;
  const askPrice = money(listing.askPrice ?? listing.allInAskPrice ?? (itemPrice === null ? null : itemPrice + shipping));
  return {
    id: text(listing.id || listing.itemId || listing.rawProviderId || listingKey(listing)),
    provider: text(listing.provider || source || 'Active Listing'),
    sourceType: 'active_listing',
    listingType: text(listing.listingType || 'buy_it_now_asking'),
    saleType: text(listing.saleType || 'asking'),
    authorizationBasis: text(listing.authorizationBasis || 'ebay_api'),
    sourceMode: text(listing.sourceMode || 'production'),
    dataRightsStatus: text(listing.dataRightsStatus || 'active_listings_only_not_for_valuation'),
    title: text(listing.title),
    itemPrice,
    shipping,
    askPrice,
    currency: text(listing.currency || 'USD'),
    url: listing.url || listing.rawUrl || null,
    imageUrl: listing.imageUrl || null,
    condition: listing.condition || null,
    cardId: listing.cardId || null,
    itemId: listing.itemId || listing.rawProviderId || null,
    buyingOptions: buyingOptionsOf(listing),
    sellerFeedbackScore: Number.isFinite(Number(listing.sellerFeedbackScore)) ? Number(listing.sellerFeedbackScore) : null,
    observedAt: listing.observedAt || listing.importedAt || new Date().toISOString(),
    valuationUse: false,
    contextUse: isFixedPriceAsking(listing),
    publicExplanation: 'Active Buy It Now listing used only as asking-price context. It is not a completed-sale comp and cannot set market value.',
  };
}

function trimOutliers(listings) {
  if (listings.length < 5) return { included: listings, excluded: [] };
  const prices = listings.map((listing) => listing.askPrice).sort((a, b) => a - b);
  const q1 = percentile(prices, 0.25);
  const q3 = percentile(prices, 0.75);
  const iqr = q3 - q1;
  const low = Math.max(0, q1 - 1.5 * iqr);
  const high = q3 + 1.5 * iqr;
  return {
    included: listings.filter((listing) => listing.askPrice >= low && listing.askPrice <= high),
    excluded: listings.filter((listing) => listing.askPrice < low || listing.askPrice > high),
  };
}

function alignment(medianAsk, value) {
  if (!medianAsk || !value) return 'context_only';
  const pct = ((medianAsk - value) / value) * 100;
  if (pct > 45) return 'asks_far_above_sales';
  if (pct > 18) return 'asks_above_sales';
  if (pct < -35) return 'asks_far_below_sales';
  if (pct < -15) return 'asks_below_sales';
  return 'aligned_with_sales';
}

function ratingFor({ count, spreadPct, alignmentLabel, value }) {
  if (!count) return 'unavailable';
  if (count < 3) return 'thin_context';
  if (spreadPct !== null && spreadPct > 80) return 'noisy_asks';
  if (value && ['asks_far_above_sales', 'asks_far_below_sales'].includes(alignmentLabel)) return 'market_disagreement';
  if (count >= 8 && spreadPct !== null && spreadPct <= 35) return 'strong_pricing_context';
  return 'useful_pricing_context';
}

export function summarizeAskingPriceContext(listings = [], { valuation = null, now = new Date(), source = null } = {}) {
  const normalized = [];
  const rejected = [];
  const seen = new Set();
  for (const raw of listings || []) {
    const listing = normalizeAskingListing(raw, { source });
    const key = listingKey(listing);
    if (seen.has(key)) {
      rejected.push({ ...listing, reason: 'duplicate_active_listing' });
      continue;
    }
    seen.add(key);
    if (!listing.contextUse || listing.askPrice === null) {
      rejected.push({ ...listing, reason: listing.askPrice === null ? 'missing_ask_price' : 'not_fixed_price_asking' });
      continue;
    }
    normalized.push(listing);
  }

  const trimmed = trimOutliers(normalized);
  const prices = trimmed.included.map((listing) => listing.askPrice);
  const medianAsk = prices.length ? roundMoney(median(prices)) : null;
  const p25 = prices.length ? roundMoney(percentile(prices, 0.25)) : null;
  const p75 = prices.length ? roundMoney(percentile(prices, 0.75)) : null;
  const low = prices.length ? roundMoney(Math.min(...prices)) : null;
  const high = prices.length ? roundMoney(Math.max(...prices)) : null;
  const spreadPct = medianAsk ? roundMoney(((p75 - p25) / medianAsk) * 100) : null;
  const completedValue = valuation?.value ? Number(valuation.value) : null;
  const alignmentLabel = alignment(medianAsk, completedValue);
  const sourceCount = new Set(trimmed.included.map((listing) => listing.provider)).size;
  const volumeScore = clamp(Math.log10(prices.length + 1) / 1.15, 0, 1);
  const spreadScore = spreadPct === null ? 0 : clamp(1 - (spreadPct / 110), 0, 1);
  const alignmentScore = !completedValue ? 0.55 : alignmentLabel === 'aligned_with_sales' ? 1 : alignmentLabel.includes('far') ? 0.32 : 0.68;
  const contextScore = Math.round(clamp((volumeScore * 0.4 + spreadScore * 0.35 + alignmentScore * 0.25) * 100, prices.length ? 12 : 0, 96));
  const pricingConfidence = valuation?.confidence
    ? Math.round(clamp(Number(valuation.confidence) + (contextScore - 60) * 0.18, 4, 99))
    : prices.length ? Math.round(clamp(contextScore * 0.72, 8, 68)) : 0;
  const askVsValuePct = completedValue && medianAsk ? roundMoney(((medianAsk - completedValue) / completedValue) * 100) : null;
  const newReleaseUsefulness = !valuation?.volume90 || valuation.volume90 < 3
    ? (prices.length >= 3 ? 'useful_for_initial_listing_strategy' : 'insufficient_active_ask_depth')
    : 'secondary_signal_only';

  const warnings = ['BIN context is based on active asking prices, not completed sales.'];
  if (trimmed.excluded.length) warnings.push(`${trimmed.excluded.length} extreme active asks were excluded from the asking context.`);
  if (alignmentLabel === 'asks_far_above_sales') warnings.push('Active asks are far above completed-sale value; patient listings may sit.');
  if (alignmentLabel === 'asks_far_below_sales') warnings.push('Active asks are far below completed-sale value; confirm exact identity and condition.');
  if (!completedValue && prices.length) warnings.push('No completed-sale value anchor is available; use BIN context only for cautious listing guidance.');

  return {
    version: ASKING_PRICE_CONTEXT_VERSION,
    generatedAt: now.toISOString(),
    sourceType: 'active_buy_it_now_context',
    valuationUse: false,
    contextUse: true,
    count: prices.length,
    rejectedCount: rejected.length + trimmed.excluded.length,
    sourceCount,
    low,
    p25,
    medianAsk,
    p75,
    high,
    spreadPct,
    askVsValuePct,
    alignment: alignmentLabel,
    rating: ratingFor({ count: prices.length, spreadPct, alignmentLabel, value: completedValue }),
    contextScore,
    pricingConfidence,
    newReleaseUsefulness,
    suggestedListAnchor: medianAsk && completedValue
      ? roundMoney((completedValue * 0.7) + (medianAsk * 0.3))
      : medianAsk ? roundMoney((p25 || medianAsk) * 0.98) : null,
    warnings,
    methodology: 'Active fixed-price listings are summarized as asking-price context for listing strategy, confidence, and new-release pricing. They never set completed-sale market value.',
    listings: trimmed.included.slice(0, 20).map(publicAskingSummary),
    excluded: [...trimmed.excluded.map((listing) => ({ ...listing, reason: 'active_ask_outlier' })), ...rejected].slice(0, 20).map(publicAskingSummary),
  };
}

export function publicAskingSummary(listing = {}) {
  return {
    id: listing.id || listing.itemId || null,
    provider: listing.provider || 'Active Listing',
    title: listing.title || '',
    askPrice: money(listing.askPrice ?? listing.price),
    itemPrice: money(listing.itemPrice ?? listing.price),
    shipping: money(listing.shipping) ?? 0,
    currency: listing.currency || 'USD',
    url: listing.url || null,
    imageUrl: listing.imageUrl || null,
    condition: listing.condition || null,
    buyingOptions: listing.buyingOptions || [],
    sourceType: 'active_buy_it_now_context',
    valuationUse: false,
    reason: listing.reason || null,
    publicExplanation: listing.publicExplanation || 'Active Buy It Now asking context only; not a completed-sale comp.',
  };
}
