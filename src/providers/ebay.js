import { ProviderAdapter } from './base.js';
import { normalizeSale } from '../services/normalizer.js';
import { normalizeText, roundMoney } from '../services/utils.js';
import { scrubInvalidListings } from '../services/listing-title-normalizer.js';

const PRODUCTION_API = 'https://api.ebay.com';
const SANDBOX_API = 'https://api.sandbox.ebay.com';
const MARKETPLACE_INSIGHTS_PATH = '/buy/marketplace_insights/v1_beta/item_sales/search';
const BROWSE_SEARCH_PATH = '/buy/browse/v1/item_summary/search';
const FULFILLMENT_ORDERS_PATH = '/sell/fulfillment/v1/order';
const DEFAULT_MARKETPLACE = 'EBAY_US';
const DEFAULT_CURRENCY = 'USD';
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_USER_SCOPES = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly',
];

function clean(value, fallback = '') {
  const output = String(value ?? fallback).trim();
  return output;
}

export function parseEbayAuthorizationCode(value) {
  const raw = clean(value);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return clean(url.searchParams.get('code') || url.hash.match(/(?:^|[&#])code=([^&]+)/)?.[1] || raw);
  } catch {}
  const match = raw.match(/(?:^|[?&#\s])code=([^&\s]+)/i);
  if (match) {
    try { return decodeURIComponent(match[1]); } catch { return match[1]; }
  }
  try { return decodeURIComponent(raw); } catch { return raw; }
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'y', 'on', 'enabled'].includes(normalizeText(value));
}

function number(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function iso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function moneyValue(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return number(value.replace(/[^0-9.-]/g, ''), null);
  if (typeof value === 'object') {
    return moneyValue(value.value ?? value.convertedFromValue ?? value.amount ?? value.displayValue);
  }
  return null;
}

function moneyCurrency(value, fallback = DEFAULT_CURRENCY) {
  if (value && typeof value === 'object') return clean(value.currency || value.convertedFromCurrency, fallback) || fallback;
  return fallback;
}

function joinFilter(parts = []) {
  return parts.map(clean).filter(Boolean).join(',');
}

function normalizeCategoryIds(value) {
  if (!value) return '';
  if (Array.isArray(value)) return value.map(clean).filter(Boolean).slice(0, 4).join(',');
  return String(value).split(',').map(clean).filter(Boolean).slice(0, 4).join(',');
}

function inferSaleType(item = {}) {
  const options = Array.isArray(item.buyingOptions) ? item.buyingOptions.map(normalizeText) : [];
  if (options.includes('auction')) return 'auction';
  if (options.includes('best offer') || options.includes('best_offer')) return 'best_offer';
  return 'fixed_price';
}

function itemIdOf(item = {}) {
  return clean(item.itemId || item.legacyItemId || item.itemGroupId || item.orderLineItemId || item.lineItemId || item.orderId);
}

function uniqueBy(items = [], keyFn = (item) => item) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

function imageDimensions(image = {}) {
  const width = number(image.width || image.imageWidth, null);
  const height = number(image.height || image.imageHeight, null);
  return { width, height };
}

export function ebayImageCandidates(item = {}) {
  const images = [];
  const add = (image, kind = 'listing_image') => {
    const url = clean(typeof image === 'string' ? image : image?.imageUrl || image?.url);
    if (!/^https:\/\//i.test(url)) return;
    images.push({
      url,
      kind,
      ...imageDimensions(image),
      provider: 'eBay Browse',
      sourceMode: 'production',
      authorizationBasis: 'ebay_api',
      dataRightsStatus: 'active_listing_image_internal_benchmark_only',
      benchmarkOnly: true,
      publicCatalogImage: false,
      valuationUse: false,
      rightsNotes: 'Discovered through the official eBay Browse API for internal scanner benchmarking. Do not redistribute or treat as catalog imagery.',
    });
  };
  add(item.image, 'primary');
  for (const image of item.thumbnailImages || []) add(image, 'thumbnail');
  for (const image of item.additionalImages || []) add(image, 'additional');
  return uniqueBy(images, (image) => image.url);
}

export function inferEbayBenchmarkSceneType(item = {}) {
  const text = normalizeText([item.title, item.shortDescription, item.subtitle].filter(Boolean).join(' '));
  if (/(binder|page|sleeve sheet|9 pocket|nine pocket)/i.test(text)) return 'binder_page';
  if (/(sealed|wax|pack|packs|box|boxes|booster|blaster|hobby|retail|mega|tin|elite trainer|etb|case)/i.test(text)) return 'sealed_product';
  if (/(lot|group|collection|bundle|stack|bulk|mixed|set of|cards)/i.test(text)) return 'multi_card_table';
  if (/(psa|bgs|sgc|cgc|graded|slab|gem mint|cert)/i.test(text)) return 'mixed_raw_slab';
  return 'single_card';
}

function buildUserAgent(config = {}) {
  return clean(config.userAgent || config.ebayUserAgent || 'ManeFlow/1.5 (+https://memphiscardcompany.com)');
}

export function buildCardSearchQuery(card = {}) {
  return [card.year, card.brand, card.set, card.player, card.cardNumber, card.parallel, card.grade?.company, card.grade?.grade]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeEbayMarketplaceSale(item = {}, context = {}) {
  const price = moneyValue(item.price || item.soldPrice || item.lastSoldPrice || item.currentBidPrice || item.itemPrice);
  const shipping = moneyValue(item.shippingOptions?.[0]?.shippingCost || item.shippingCost || item.shipping) || 0;
  const soldAt = iso(item.lastSoldDate || item.soldDate || item.itemEndDate || item.endDate || item.transactionDate);
  const rawProviderId = itemIdOf(item);
  const title = clean(item.title || item.shortDescription || item.legacyItemId || rawProviderId);
  const condition = clean(item.condition || item.conditionDisplayName || '');
  const sale = normalizeSale({
    provider: context.provider || 'eBay Marketplace Insights',
    sourceType: 'sold',
    sourceMode: 'production',
    authorizationBasis: context.authorizationBasis || 'ebay_api',
    dataRightsStatus: context.dataRightsStatus || 'ebay_marketplace_insights_limited_release',
    saleType: inferSaleType(item),
    listingType: 'completed',
    isCompletedSale: true,
    title,
    soldAt,
    price,
    shipping,
    buyerPremium: 0,
    currency: moneyCurrency(item.price || item.soldPrice || item.lastSoldPrice, context.currency || DEFAULT_CURRENCY),
    rawProviderId,
    rawUrl: item.itemWebUrl || item.webUrl || item.itemAffiliateWebUrl || null,
    imageUrl: item.image?.imageUrl || item.thumbnailImages?.[0]?.imageUrl || null,
    condition: condition || null,
    quantity: item.estimatedAvailabilities?.[0]?.estimatedAvailableQuantity || item.quantitySold || 1,
    verified: true,
    confidence: context.confidence ?? 0.9,
    cardId: context.cardId || item.cardId || null,
    player: context.player || item.player || null,
    year: context.year || item.year || null,
    brand: context.brand || item.brand || null,
    set: context.set || item.set || null,
    cardNumber: context.cardNumber || item.cardNumber || null,
    parallel: context.parallel || item.parallel || null,
    grader: context.grader || item.grader || undefined,
    grade: context.grade || item.grade || undefined,
    importedBy: context.importedBy || null,
    rightsNotes: context.rightsNotes || 'Imported through eBay Marketplace Insights API when approved access is configured. Sold-history access is limited/restricted by eBay.',
  }, context.provider || 'eBay Marketplace Insights');
  return {
    ...sale,
    ebay: {
      marketplaceId: context.marketplaceId || DEFAULT_MARKETPLACE,
      categoryIds: (item.categories || []).map((category) => category.categoryId).filter(Boolean),
      buyingOptions: item.buyingOptions || [],
      conditionId: item.conditionId || null,
    },
  };
}

export function normalizeEbaySellerOrder(order = {}, lineItem = {}, context = {}) {
  const price = moneyValue(lineItem.lineItemCost || lineItem.total || lineItem.itemPrice || lineItem.discountedLineItemCost);
  const shipping = moneyValue(order.pricingSummary?.deliveryCost || lineItem.deliveryCost) || 0;
  const soldAt = iso(order.creationDate || order.orderFulfillmentStatusDate || lineItem.lineItemFulfillmentStatusDate);
  const rawProviderId = clean(lineItem.lineItemId || lineItem.legacyItemId || `${order.orderId || 'order'}:${lineItem.sku || lineItem.title || ''}`);
  return normalizeSale({
    provider: context.provider || 'eBay Seller Orders',
    sourceType: 'sold',
    sourceMode: 'production',
    authorizationBasis: context.authorizationBasis || 'ebay_api',
    dataRightsStatus: context.dataRightsStatus || 'seller_account_authorized_orders_only',
    saleType: lineItem.listingMarketplaceId ? 'fixed_price' : 'seller_order',
    listingType: 'completed',
    isCompletedSale: true,
    title: clean(lineItem.title || lineItem.legacyItemId || rawProviderId),
    soldAt,
    price,
    shipping,
    buyerPremium: 0,
    currency: moneyCurrency(lineItem.lineItemCost || lineItem.total || order.pricingSummary?.priceSubtotal, context.currency || DEFAULT_CURRENCY),
    rawProviderId,
    rawUrl: lineItem.itemLocation?.itemWebUrl || lineItem.itemWebUrl || null,
    condition: lineItem.condition || null,
    quantity: Number(lineItem.quantity || 1),
    verified: true,
    confidence: context.confidence ?? 0.86,
    cardId: context.cardId || lineItem.cardId || null,
    importedBy: context.importedBy || null,
    rightsNotes: context.rightsNotes || 'Imported from an authenticated eBay seller account. This is seller-owned order data, not market-wide eBay sold-history coverage.',
  }, context.provider || 'eBay Seller Orders');
}

export class EbayProvider extends ProviderAdapter {
  constructor(config = {}) {
    const clientConfigured = Boolean(config.ebayClientId && config.ebayClientSecret);
    const marketplaceInsightsEnabled = clientConfigured && bool(config.ebayMarketplaceInsightsEnabled, false);
    const sellerOrdersEnabled = Boolean(config.ebayUserAccessToken || config.ebayRefreshToken);
    const capabilities = [];
    if (clientConfigured) capabilities.push('active_listings');
    if (marketplaceInsightsEnabled) capabilities.push('marketplace_insights_completed_sales');
    if (sellerOrdersEnabled) capabilities.push('seller_order_import');
    super({
      name: 'eBay',
      mode: marketplaceInsightsEnabled ? 'marketplace_insights_enabled' : clientConfigured ? 'official-active-listings' : 'credentials_required',
      freshnessMinutes: marketplaceInsightsEnabled ? 15 : clientConfigured ? 5 : null,
      capabilities,
      notes: marketplaceInsightsEnabled
        ? 'Configured for eBay Marketplace Insights completed-sale search where approved access exists. Browse active listings remain separated from completed-sale comps.'
        : 'Browse API active listings can be configured with client credentials. Market-wide eBay completed-sale access requires approved Marketplace Insights access; seller-owned orders can be imported with a user token.',
      authorizationBasis: marketplaceInsightsEnabled || clientConfigured || sellerOrdersEnabled ? 'ebay_api' : 'unknown',
      sourceMode: 'production',
      supportsCompletedSales: marketplaceInsightsEnabled || sellerOrdersEnabled,
      supportsActiveListings: clientConfigured,
      supportsSellerOrders: sellerOrdersEnabled,
      supportsLiveAuctions: marketplaceInsightsEnabled,
      refreshPolicy: marketplaceInsightsEnabled ? 'manual_or_scheduled_marketplace_insights_import' : clientConfigured ? 'near_real_time_active_listing_lookup' : 'credentials_required',
      requiresCredential: true,
      dataRightsStatus: marketplaceInsightsEnabled ? 'marketplace_insights_access_configured' : sellerOrdersEnabled ? 'seller_orders_only_configured' : clientConfigured ? 'active_listings_only' : 'credentials_required',
    });
    this.clientId = config.ebayClientId;
    this.clientSecret = config.ebayClientSecret;
    this.userAccessToken = config.ebayUserAccessToken || '';
    this.userAccessTokenExpiresAt = Number(config.ebayUserAccessTokenExpiresAt || 0);
    this.refreshToken = config.ebayRefreshToken || '';
    this.redirectUriName = config.ebayRedirectUriName || '';
    this.userScopes = Array.isArray(config.ebayUserScopes) && config.ebayUserScopes.length
      ? config.ebayUserScopes.map(clean).filter(Boolean)
      : DEFAULT_USER_SCOPES;
    this.marketplaceId = config.ebayMarketplaceId || DEFAULT_MARKETPLACE;
    this.environment = config.ebayEnvironment === 'sandbox' ? 'sandbox' : 'production';
    this.baseUrl = this.environment === 'sandbox' ? SANDBOX_API : PRODUCTION_API;
    this.marketplaceInsightsEnabled = marketplaceInsightsEnabled;
    this.requestTimeoutMs = Math.max(3000, Number(config.ebayRequestTimeoutMs || DEFAULT_TIMEOUT_MS));
    this.maxRetries = Math.max(0, Math.min(5, Number(config.ebayMaxRetries ?? 3)));
    this.minBackoffMs = Math.max(100, Number(config.ebayMinBackoffMs || 400));
    this.userAgent = buildUserAgent(config);
    this.fetchImpl = config.ebayFetch || globalThis.fetch;
    this.token = null;
    this.tokenExpiresAt = 0;
    this.lastError = null;
    this.lastRequestAt = null;
    this.lastImportAt = null;
    this.rateLimitUntil = null;
  }

  status() {
    return {
      ...super.status(),
      marketplaceId: this.marketplaceId,
      environment: this.environment,
      marketplaceInsightsEnabled: this.marketplaceInsightsEnabled,
      sellerOrdersEnabled: Boolean(this.userAccessToken || this.refreshToken),
      oauthReady: Boolean(this.clientId && this.clientSecret && this.redirectUriName),
      refreshTokenConfigured: Boolean(this.refreshToken),
      lastRequestAt: this.lastRequestAt,
      lastImportAt: this.lastImportAt,
      lastError: this.lastError,
      rateLimitUntil: this.rateLimitUntil,
      completedSalesPath: MARKETPLACE_INSIGHTS_PATH,
      activeListingsPath: BROWSE_SEARCH_PATH,
    };
  }


  buildUserConsentUrl({ state = '', prompt = 'login', locale = 'en-US', scopes = this.userScopes } = {}) {
    if (!this.clientId) throw new Error('eBay client ID is required.');
    if (!this.redirectUriName) throw new Error('eBay RuName / redirect URI name is required.');
    const authBase = this.environment === 'sandbox' ? 'https://auth.sandbox.ebay.com/oauth2/authorize' : 'https://auth.ebay.com/oauth2/authorize';
    const url = new URL(authBase);
    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('redirect_uri', this.redirectUriName);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', (scopes || DEFAULT_USER_SCOPES).join(' '));
    if (state) url.searchParams.set('state', state);
    if (prompt) url.searchParams.set('prompt', prompt);
    if (locale) url.searchParams.set('locale', locale);
    return url.href;
  }

  async exchangeAuthorizationCode(code, { redirectUriName = this.redirectUriName } = {}) {
    const authorizationCode = parseEbayAuthorizationCode(code);
    const redirectUri = clean(redirectUriName);
    if (!authorizationCode) throw new Error('eBay authorization code is required.');
    if (!this.clientId || !this.clientSecret) throw new Error('eBay client ID and client secret are required.');
    if (!redirectUri) throw new Error('eBay RuName / redirect URI name is required.');
    const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const response = await this.request('/identity/v1/oauth2/token', {
      method: 'POST',
      headers: { authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: authorizationCode, redirect_uri: redirectUri }),
      skipAuth: true,
    });
    const data = await response.json();
    this.userAccessToken = clean(data.access_token);
    this.userAccessTokenExpiresAt = Date.now() + Number(data.expires_in || 7200) * 1000;
    if (data.refresh_token) this.refreshToken = clean(data.refresh_token);
    return {
      accessToken: this.userAccessToken,
      accessTokenExpiresAt: this.userAccessTokenExpiresAt,
      refreshToken: this.refreshToken,
      refreshTokenExpiresIn: Number(data.refresh_token_expires_in || 0),
      tokenType: data.token_type || 'User Access Token',
    };
  }

  async refreshUserAccessToken({ refreshToken = this.refreshToken, scopes = this.userScopes } = {}) {
    const token = clean(refreshToken);
    if (!token) throw new Error('eBay refresh token is required.');
    if (!this.clientId || !this.clientSecret) throw new Error('eBay client ID and client secret are required.');
    const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const response = await this.request('/identity/v1/oauth2/token', {
      method: 'POST',
      headers: { authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: token,
        scope: (scopes || DEFAULT_USER_SCOPES).join(' '),
      }),
      skipAuth: true,
    });
    const data = await response.json();
    this.userAccessToken = clean(data.access_token);
    this.userAccessTokenExpiresAt = Date.now() + Number(data.expires_in || 7200) * 1000;
    return { accessToken: this.userAccessToken, accessTokenExpiresAt: this.userAccessTokenExpiresAt };
  }

  async getUserAccessToken() {
    if (this.userAccessToken && (!this.userAccessTokenExpiresAt || this.userAccessTokenExpiresAt > Date.now() + 60_000)) {
      return this.userAccessToken;
    }
    if (this.refreshToken) {
      const refreshed = await this.refreshUserAccessToken();
      return refreshed.accessToken;
    }
    return this.userAccessToken || null;
  }

  async getToken() {
    if (!this.clientId || !this.clientSecret) return null;
    if (this.token && this.tokenExpiresAt > Date.now() + 60_000) return this.token;
    const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const response = await this.request('/identity/v1/oauth2/token', {
      method: 'POST',
      headers: {
        authorization: `Basic ${auth}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        scope: 'https://api.ebay.com/oauth/api_scope',
      }),
      skipAuth: true,
    });
    const data = await response.json();
    this.token = data.access_token;
    this.tokenExpiresAt = Date.now() + Number(data.expires_in || 7200) * 1000;
    return this.token;
  }

  async request(path, options = {}) {
    if (!this.fetchImpl) throw new Error('fetch is not available in this runtime');
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    const startedAt = Date.now();
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
      try {
        this.lastRequestAt = new Date().toISOString();
        const response = await this.fetchImpl(url, {
          ...options,
          signal: controller.signal,
          headers: {
            accept: 'application/json',
            'user-agent': this.userAgent,
            ...(options.headers || {}),
          },
        });
        clearTimeout(timeout);
        if (response.status === 429 || response.status >= 500) {
          const retryAfter = Number(response.headers?.get?.('retry-after') || 0);
          if (response.status === 429 && retryAfter) this.rateLimitUntil = new Date(Date.now() + retryAfter * 1000).toISOString();
          if (attempt < this.maxRetries) {
            await this.sleep(retryAfter ? retryAfter * 1000 : this.minBackoffMs * 2 ** attempt);
            continue;
          }
        }
        if (!response.ok) {
          const body = await response.text().catch(() => '');
          const message = `eBay API request failed: ${response.status} ${response.statusText || ''}`.trim();
          const error = new Error(body ? `${message} — ${body.slice(0, 500)}` : message);
          error.status = response.status;
          throw error;
        }
        this.lastError = null;
        return response;
      } catch (error) {
        clearTimeout(timeout);
        if (attempt < this.maxRetries && (error.name === 'AbortError' || !error.status || error.status >= 500 || error.status === 429)) {
          await this.sleep(this.minBackoffMs * 2 ** attempt);
          continue;
        }
        this.lastError = error.message;
        error.elapsedMs = Date.now() - startedAt;
        throw error;
      }
    }
    throw new Error('eBay API request failed after retries');
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.min(ms, 10_000)));
  }

  async authorizedGet(path, { token = null, headers = {} } = {}) {
    const accessToken = token || await this.getToken();
    if (!accessToken) throw new Error('eBay credentials are not configured.');
    return this.request(path, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'x-ebay-c-marketplace-id': this.marketplaceId,
        ...headers,
      },
    });
  }

  buildMarketplaceInsightsUrl({ query, gtin = null, epid = null, categoryIds, limit = 50, offset = 0, dateFrom = null, dateTo = null, filters = [], conditionIds = [], conditions = [], priceMin = null, priceMax = null, currency = DEFAULT_CURRENCY, sort = 'lastSoldDate' } = {}) {
    const url = new URL(`${this.baseUrl}${MARKETPLACE_INSIGHTS_PATH}`);
    if (clean(query)) url.searchParams.set('q', clean(query));
    if (clean(gtin)) url.searchParams.set('gtin', clean(gtin));
    if (clean(epid)) url.searchParams.set('epid', clean(epid));
    const categories = normalizeCategoryIds(categoryIds);
    if (categories) url.searchParams.set('category_ids', categories);
    url.searchParams.set('limit', String(Math.max(1, Math.min(200, Number(limit) || 50))));
    url.searchParams.set('offset', String(Math.max(0, Math.min(9999, Number(offset) || 0))));
    if (sort) url.searchParams.set('sort', sort);
    const filterParts = [...filters];
    if (dateFrom || dateTo) filterParts.push(`lastSoldDate:[${dateFrom ? new Date(dateFrom).toISOString() : ''}..${dateTo ? new Date(dateTo).toISOString() : ''}]`);
    if (conditionIds?.length) filterParts.push(`conditionIds:{${conditionIds.map(clean).filter(Boolean).join('|')}}`);
    if (conditions?.length) filterParts.push(`conditions:{${conditions.map(clean).filter(Boolean).join('|')}}`);
    if (priceMin !== null || priceMax !== null) {
      filterParts.push(`price:[${priceMin ?? ''}..${priceMax ?? ''}]`);
      filterParts.push(`priceCurrency:${currency || DEFAULT_CURRENCY}`);
    }
    const filter = joinFilter(filterParts);
    if (filter) url.searchParams.set('filter', filter);
    return url;
  }

  async searchCompletedSales(options = {}) {
    if (!this.marketplaceInsightsEnabled) {
      const error = new Error('eBay Marketplace Insights is not enabled. Configure EBAY_MARKETPLACE_INSIGHTS_ENABLED=true only after eBay grants completed-sale access.');
      error.code = 'EBAY_MARKETPLACE_INSIGHTS_DISABLED';
      throw error;
    }
    const url = this.buildMarketplaceInsightsUrl(options);
    const response = await this.authorizedGet(url.href);
    const data = await response.json();
    const items = data.itemSales || data.itemSummaries || data.items || [];
    const targetCardNumber = options.cardContext?.cardNumber || options.cardNumber || null;
    const scrubbed = scrubInvalidListings(items, {
      cardNumber: targetCardNumber,
      requireCardNumber: Boolean(targetCardNumber),
    });
    const sales = scrubbed.cleaned.map((item) => {
      const parsedGrade = item.normalizedGrade?.slabbed
        ? { grader: item.normalizedGrade.company, grade: item.normalizedGrade.grade }
        : {};
      return normalizeEbayMarketplaceSale(item, {
        ...options.cardContext,
        ...parsedGrade,
        provider: 'eBay Marketplace Insights',
        authorizationBasis: 'ebay_api',
        dataRightsStatus: 'ebay_marketplace_insights_limited_release',
        marketplaceId: this.marketplaceId,
        importedBy: options.importedBy || 'admin_ebay_import',
        rightsNotes: 'eBay Marketplace Insights completed-sale import after strict title, lot/spam, card-number, and grade normalization. Requires eBay-approved limited-release access.',
      });
    });
    this.lastImportAt = new Date().toISOString();
    return {
      provider: 'eBay Marketplace Insights',
      sourceMode: 'production',
      authorizationBasis: 'ebay_api',
      dataRightsStatus: 'ebay_marketplace_insights_limited_release',
      query: clean(options.query),
      categoryIds: normalizeCategoryIds(options.categoryIds),
      limit: Number(data.limit || options.limit || sales.length),
      offset: Number(data.offset || options.offset || 0),
      total: Number(data.total || sales.length),
      next: data.next || null,
      href: data.href || url.href,
      sales,
      rawCount: items.length,
      rejectedCount: scrubbed.rejected.length,
      rejectionSummary: scrubbed.rejected.reduce((summary, row) => {
        summary[row.reason] = (summary[row.reason] || 0) + 1;
        return summary;
      }, {}),
      importedAt: new Date().toISOString(),
    };
  }

  async searchActiveListings({ query, limit = 20, categoryIds = null, filters = [], binOnly = true } = {}) {
    const token = await this.getToken();
    if (!token) return [];
    const url = new URL(`${this.baseUrl}${BROWSE_SEARCH_PATH}`);
    url.searchParams.set('q', query);
    url.searchParams.set('limit', String(Math.min(50, Math.max(1, limit))));
    const categories = normalizeCategoryIds(categoryIds);
    if (categories) url.searchParams.set('category_ids', categories);
    const filterParts = [...filters];
    if (binOnly && !filterParts.some((filter) => normalizeText(filter).includes('buyingoptions'))) {
      filterParts.push('buyingOptions:{FIXED_PRICE}');
    }
    const filter = joinFilter(filterParts);
    if (filter) url.searchParams.set('filter', filter);
    const response = await this.authorizedGet(url.href, { token });
    const data = await response.json();
    return (data.itemSummaries || []).map((item) => ({
      provider: 'eBay Browse',
      sourceType: 'active_listing',
      listingType: 'buy_it_now_asking',
      saleType: 'asking',
      isCompletedSale: false,
      title: item.title,
      price: Number(item.price?.value || 0),
      itemPrice: Number(item.price?.value || 0),
      shipping: moneyValue(item.shippingOptions?.[0]?.shippingCost || item.shippingCost || item.shipping) || 0,
      askPrice: roundMoney((Number(item.price?.value || 0)) + (moneyValue(item.shippingOptions?.[0]?.shippingCost || item.shippingCost || item.shipping) || 0)),
      currency: item.price?.currency || DEFAULT_CURRENCY,
      url: item.itemWebUrl,
      imageUrl: item.image?.imageUrl || null,
      images: ebayImageCandidates(item),
      condition: item.condition || null,
      itemId: item.itemId,
      rawProviderId: item.itemId,
      buyingOptions: item.buyingOptions || [],
      observedAt: new Date().toISOString(),
      valuationUse: false,
      sourceMode: 'production',
      authorizationBasis: 'ebay_api',
      dataRightsStatus: 'active_listings_only_not_for_valuation',
      publicExplanation: 'Current eBay Buy It Now asking context only. Active listings are not completed-sale comps and never set ManeFlow market value.',
    }));
  }

  async getBrowseItem(itemId) {
    const cleanId = clean(itemId);
    if (!cleanId) throw new Error('eBay item id is required.');
    const response = await this.authorizedGet(`${BROWSE_SEARCH_PATH.replace('/item_summary/search', '/item')}/${encodeURIComponent(cleanId)}`);
    return response.json();
  }

  async discoverListingImages({ query, limit = 50, categoryIds = null, includeAdditionalImages = false, binOnly = false } = {}) {
    const listings = await this.searchActiveListings({ query, limit, categoryIds, binOnly });
    const items = [];
    for (const listing of listings) {
      let detail = null;
      let detailError = null;
      if (includeAdditionalImages && listing.itemId) {
        try {
          detail = await this.getBrowseItem(listing.itemId);
        } catch (error) {
          detailError = error.message;
        }
      }
      const sourceForImages = detail || {
        image: listing.imageUrl ? { imageUrl: listing.imageUrl } : null,
        thumbnailImages: listing.images?.filter((image) => image.kind === 'thumbnail').map((image) => ({ imageUrl: image.url, width: image.width, height: image.height })) || [],
        additionalImages: [],
      };
      const images = ebayImageCandidates(sourceForImages);
      items.push({
        itemId: listing.itemId,
        title: listing.title,
        url: listing.url,
        price: listing.price,
        askPrice: listing.askPrice,
        currency: listing.currency,
        condition: listing.condition,
        sceneType: inferEbayBenchmarkSceneType({ title: listing.title, condition: listing.condition }),
        images,
        imageCount: images.length,
        detailError,
        labelScaffold: {
          sceneType: inferEbayBenchmarkSceneType({ title: listing.title, condition: listing.condition }),
          expectedCards: [],
          manualText: listing.title,
          labelStatus: 'needs_manual_labeling',
        },
      });
    }
    return {
      provider: 'eBay Browse Listing Images',
      query: clean(query),
      generatedAt: new Date().toISOString(),
      sourceMode: 'production',
      authorizationBasis: 'ebay_api',
      dataRightsStatus: 'active_listing_images_internal_benchmark_only',
      benchmarkOnly: true,
      publicCatalogImage: false,
      valuationUse: false,
      rightsNotes: 'Listing images discovered through the official eBay Browse API for internal scanner QA. They are not completed-sale comps, not catalog assets, and should not be redistributed.',
      totalListings: items.length,
      totalImages: items.reduce((sum, item) => sum + item.imageCount, 0),
      items,
    };
  }

  buildSellerOrdersUrl({ dateFrom = null, dateTo = null, limit = 100, offset = 0, orderFulfillmentStatus = null } = {}) {
    const url = new URL(`${this.baseUrl}${FULFILLMENT_ORDERS_PATH}`);
    const filters = [];
    if (dateFrom || dateTo) filters.push(`creationdate:[${dateFrom ? new Date(dateFrom).toISOString() : ''}..${dateTo ? new Date(dateTo).toISOString() : ''}]`);
    if (orderFulfillmentStatus) filters.push(`orderfulfillmentstatus:{${clean(orderFulfillmentStatus)}}`);
    if (filters.length) url.searchParams.set('filter', filters.join(','));
    url.searchParams.set('limit', String(Math.max(1, Math.min(200, Number(limit) || 100))));
    url.searchParams.set('offset', String(Math.max(0, Number(offset) || 0)));
    return url;
  }

  async fetchSellerOrders(options = {}) {
    const token = options.userAccessToken || await this.getUserAccessToken();
    if (!token) throw new Error('Connect the eBay seller account or provide a valid user access token before importing seller orders.');
    const url = this.buildSellerOrdersUrl(options);
    const response = await this.authorizedGet(url.href, { token });
    const data = await response.json();
    const orders = data.orders || [];
    const sales = [];
    for (const order of orders) {
      for (const lineItem of order.lineItems || []) {
        sales.push(normalizeEbaySellerOrder(order, lineItem, {
          provider: 'eBay Seller Orders',
          authorizationBasis: 'ebay_api',
          dataRightsStatus: 'seller_account_authorized_orders_only',
          marketplaceId: this.marketplaceId,
          importedBy: options.importedBy || 'admin_ebay_seller_order_import',
          rightsNotes: 'Authenticated eBay seller-order import. Data represents the connected seller account only.',
        }));
      }
    }
    this.lastImportAt = new Date().toISOString();
    return {
      provider: 'eBay Seller Orders',
      sourceMode: 'production',
      authorizationBasis: 'ebay_api',
      dataRightsStatus: 'seller_account_authorized_orders_only',
      limit: Number(data.limit || options.limit || sales.length),
      offset: Number(data.offset || options.offset || 0),
      total: Number(data.total || orders.length),
      href: data.href || url.href,
      orders: orders.length,
      sales,
      importedAt: new Date().toISOString(),
    };
  }

  async initialImport(options = {}) {
    return this.searchCompletedSales({ ...options, offset: options.offset || 0 });
  }

  async incrementalImport(options = {}) {
    const dateTo = options.dateTo || new Date().toISOString();
    const dateFrom = options.dateFrom || new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    return this.searchCompletedSales({ ...options, dateFrom, dateTo });
  }
}
