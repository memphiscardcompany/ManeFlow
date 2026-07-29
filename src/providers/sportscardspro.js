import { ProviderAdapter } from './base.js';
import { roundMoney } from '../services/utils.js';

const DEFAULT_BASE_URL = 'https://www.sportscardspro.com';
const DEFAULT_TIMEOUT_MS = 15_000;

function text(value) { return String(value ?? '').trim(); }
function cents(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? roundMoney(number / 100) : null;
}

export function normalizeSportsCardsProProduct(product = {}) {
  return {
    provider: 'SportsCardsPro',
    providerCardId: text(product.id),
    productName: text(product['product-name']),
    setName: text(product['console-name']),
    genre: text(product.genre),
    releaseDate: text(product['release-date']) || null,
    prices: {
      raw: cents(product['loose-price']),
      graded7: cents(product['cib-price']),
      graded8: cents(product['new-price']),
      graded9: cents(product['graded-price']),
      graded95: cents(product['box-only-price']),
      psa10: cents(product['manual-only-price']),
      bgs10: cents(product['bgs-10-price']),
      cgc10: cents(product['condition-17-price']),
      sgc10: cents(product['condition-18-price']),
    },
    retail: {
      rawBuy: cents(product['retail-loose-buy']),
      rawSell: cents(product['retail-loose-sell']),
      graded7Buy: cents(product['retail-cib-buy']),
      graded7Sell: cents(product['retail-cib-sell']),
      graded8Buy: cents(product['retail-new-buy']),
      graded8Sell: cents(product['retail-new-sell']),
    },
    yearlySalesVolume: Number.isFinite(Number(product['sales-volume'])) ? Number(product['sales-volume']) : null,
    sourceType: 'price_guide_context',
    valuationUse: false,
    authorizationBasis: 'official_api',
    dataRightsStatus: 'paid_price_guide_api',
    publicExplanation: 'SportsCardsPro supplies current price-guide values, not historic completed-sale records. ManeFlow keeps this context separate from verified sold comps.',
  };
}

export class SportsCardsProProvider extends ProviderAdapter {
  constructor(config = {}) {
    const configured = Boolean(config.sportsCardsProApiToken);
    super({
      name: 'SportsCardsPro',
      mode: configured ? 'official_api_configured' : 'credentials_required',
      freshnessMinutes: configured ? 1440 : null,
      capabilities: configured ? ['sports_catalog_search', 'sports_price_guide', 'retail_buy_sell_context'] : [],
      notes: configured
        ? 'Paid SportsCardsPro API configured for current sports-card guide values and retail context. Historic sales are not provided by this API.'
        : 'Add SPORTSCARDSPRO_API_TOKEN server-side to enable sports-card catalog and price-guide context.',
      authorizationBasis: configured ? 'official_api' : 'unknown',
      sourceMode: 'production',
      supportsCompletedSales: false,
      supportsActiveListings: false,
      refreshPolicy: configured ? 'daily_price_guide_refresh' : 'credentials_required',
      requiresCredential: true,
      dataRightsStatus: configured ? 'paid_price_guide_api' : 'credentials_required',
    });
    this.apiToken = config.sportsCardsProApiToken || '';
    this.baseUrl = text(config.sportsCardsProBaseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.fetchImpl = config.sportsCardsProFetch || globalThis.fetch;
    this.timeoutMs = Math.max(3000, Number(config.sportsCardsProTimeoutMs || DEFAULT_TIMEOUT_MS));
    this.lastRequestAt = null;
    this.lastError = null;
    this.nextAllowedRequestAt = 0;
  }

  status() { return { ...super.status(), lastRequestAt: this.lastRequestAt, lastError: this.lastError }; }

  async request(path, params = {}) {
    if (!this.apiToken) throw new Error('SPORTSCARDSPRO_API_TOKEN is not configured.');
    if (!this.fetchImpl) throw new Error('fetch is not available in this runtime.');
    const wait = Math.max(0, this.nextAllowedRequestAt - Date.now());
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.set('t', this.apiToken);
    for (const [key, value] of Object.entries(params)) if (value !== null && value !== undefined && value !== '') url.searchParams.set(key, String(value));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      this.lastRequestAt = new Date().toISOString();
      this.nextAllowedRequestAt = Date.now() + 1050;
      const response = await this.fetchImpl(url, { headers: { accept: 'application/json' }, signal: controller.signal });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.status === 'error') throw new Error(payload['error-message'] || `SportsCardsPro request failed with HTTP ${response.status}.`);
      this.lastError = null;
      return payload;
    } catch (error) {
      this.lastError = error.name === 'AbortError' ? 'SportsCardsPro request timed out.' : error.message;
      throw new Error(this.lastError);
    } finally { clearTimeout(timer); }
  }

  async searchProducts(query) {
    const payload = await this.request('/api/products', { q: text(query) });
    return {
      provider: 'SportsCardsPro',
      products: Array.isArray(payload.products) ? payload.products.map(normalizeSportsCardsProProduct) : [],
    };
  }

  async getProduct({ id = null, query = null } = {}) {
    const payload = await this.request('/api/product', id ? { id } : { q: text(query) });
    return { provider: 'SportsCardsPro', product: normalizeSportsCardsProProduct(payload) };
  }
}
