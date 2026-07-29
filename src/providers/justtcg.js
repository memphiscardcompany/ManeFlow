import { ProviderAdapter } from './base.js';
import { normalizeText, roundMoney } from '../services/utils.js';

const DEFAULT_BASE_URL = 'https://api.justtcg.com/v1';
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_BATCH_SIZE = 200;

function text(value) {
  return String(value ?? '').trim();
}

function finite(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function isoFromTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    const milliseconds = numeric > 10_000_000_000 ? numeric : numeric * 1000;
    const parsed = new Date(milliseconds);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeVariant(variant = {}) {
  const price = finite(variant.price, null);
  return {
    id: text(variant.id || variant.uuid),
    uuid: text(variant.uuid),
    condition: text(variant.condition),
    printing: text(variant.printing),
    language: text(variant.language || 'English'),
    price: price === null ? null : roundMoney(price),
    priceChange24hr: finite(variant.priceChange24hr ?? variant.price_change_24hr, null),
    lastUpdated: isoFromTimestamp(variant.lastUpdated ?? variant.last_updated),
    priceHistory: Array.isArray(variant.priceHistory ?? variant.price_history)
      ? (variant.priceHistory ?? variant.price_history)
        .map((row) => ({
          price: finite(row?.p ?? row?.price, null),
          at: isoFromTimestamp(row?.t ?? row?.timestamp ?? row?.at),
        }))
        .filter((row) => row.price !== null)
      : [],
    statistics: variant.statistics || null,
  };
}

export function normalizeJustTcgCard(card = {}) {
  return {
    provider: 'JustTCG',
    providerCardId: text(card.id || card.uuid),
    uuid: text(card.uuid),
    name: text(card.name),
    game: text(card.game),
    setId: text(card.set || card.setId),
    setName: text(card.set_name || card.setName),
    rarity: text(card.rarity),
    number: text(card.number || card.card_number || card.cardNumber),
    details: text(card.details) || null,
    tcgplayerId: text(card.tcgplayerId || card.tcgplayer_id),
    mtgjsonId: text(card.mtgjsonId || card.mtgjson_id),
    scryfallId: text(card.scryfallId || card.scryfall_id),
    imageUrl: text(card.image || card.imageUrl || card.image_url) || null,
    variants: Array.isArray(card.variants) ? card.variants.map(normalizeVariant) : [],
    sourceType: 'current_market_context',
    valuationUse: false,
    authorizationBasis: 'official_api',
    dataRightsStatus: 'licensed_api_current_market_context',
    publicExplanation: 'JustTCG provides current TCG catalog, variant, and market context. ManeFlow does not label these snapshots as verified completed-sale comps.',
  };
}

function sdkResponseParts(payload = {}) {
  return {
    data: Array.isArray(payload.data) ? payload.data : [],
    pagination: payload.pagination || payload.meta || null,
    usage: payload.usage || payload._metadata || null,
  };
}

export class JustTcgProvider extends ProviderAdapter {
  constructor(config = {}) {
    const configured = Boolean(config.justTcgApiKey);
    super({
      name: 'JustTCG',
      mode: configured ? 'official_sdk_configured' : 'credentials_required',
      freshnessMinutes: configured ? 15 : null,
      capabilities: configured ? ['tcg_catalog_search', 'tcg_variant_pricing', 'tcg_price_history', 'batch_lookup'] : [],
      notes: configured
        ? 'Official JustTCG API/SDK configured for TCG catalog identity, printing and condition variants, and current market context. It is not labeled as a completed-sale feed.'
        : 'Add JUSTTCG_API_KEY server-side to enable TCG catalog and current pricing context.',
      authorizationBasis: configured ? 'official_api' : 'unknown',
      sourceMode: 'production',
      supportsCompletedSales: false,
      supportsActiveListings: false,
      refreshPolicy: configured ? 'live_api_with_cache' : 'credentials_required',
      requiresCredential: true,
      dataRightsStatus: configured ? 'licensed_api_current_market_context' : 'credentials_required',
    });
    this.apiKey = config.justTcgApiKey || '';
    this.baseUrl = text(config.justTcgBaseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.fetchImpl = config.justTcgFetch || globalThis.fetch;
    this.timeoutMs = Math.max(3000, Number(config.justTcgTimeoutMs || DEFAULT_TIMEOUT_MS));
    this.sdkClient = config.justTcgSdkClient || null;
    this.sdkClientFactory = config.justTcgSdkClientFactory || null;
    this.preferSdk = config.justTcgPreferSdk !== false && !config.justTcgFetch;
    this.sdkLoadAttempted = Boolean(this.sdkClient);
    this.sdkUnavailableReason = null;
    this.lastRequestAt = null;
    this.lastError = null;
    this.usage = null;
  }

  status() {
    return {
      ...super.status(),
      integration: this.sdkClient ? 'official_js_sdk' : this.preferSdk ? 'official_js_sdk_with_rest_fallback' : 'official_rest_api',
      sdkAvailable: Boolean(this.sdkClient),
      sdkUnavailableReason: this.sdkUnavailableReason,
      lastRequestAt: this.lastRequestAt,
      lastError: this.lastError,
      usage: this.usage,
    };
  }

  async getSdkClient() {
    if (!this.preferSdk) return null;
    if (this.sdkClient) return this.sdkClient;
    if (this.sdkLoadAttempted) return null;
    this.sdkLoadAttempted = true;
    try {
      if (this.sdkClientFactory) {
        this.sdkClient = await this.sdkClientFactory({ apiKey: this.apiKey });
      } else {
        const module = await import('justtcg-js');
        this.sdkClient = new module.JustTCG({ apiKey: this.apiKey });
      }
      this.sdkUnavailableReason = null;
      return this.sdkClient;
    } catch (error) {
      this.sdkUnavailableReason = error?.message || 'Official JustTCG SDK is unavailable; REST fallback enabled.';
      return null;
    }
  }

  async request(path, { method = 'GET', query = null, body = null } = {}) {
    if (!this.apiKey) throw new Error('JUSTTCG_API_KEY is not configured.');
    if (!this.fetchImpl) throw new Error('fetch is not available in this runtime.');
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query || {})) {
      if (value === null || value === undefined || value === '') continue;
      if (Array.isArray(value)) value.forEach((item) => url.searchParams.append(key, String(item)));
      else url.searchParams.set(key, String(value));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      this.lastRequestAt = new Date().toISOString();
      const response = await this.fetchImpl(url, {
        method,
        headers: { accept: 'application/json', 'content-type': 'application/json', 'x-api-key': this.apiKey },
        body: body === null ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.error) {
        throw new Error(payload.error || payload.message || `JustTCG request failed with HTTP ${response.status}.`);
      }
      this.usage = payload._metadata || payload.usage || null;
      this.lastError = null;
      return payload;
    } catch (error) {
      this.lastError = error.name === 'AbortError' ? 'JustTCG request timed out.' : error.message;
      throw new Error(this.lastError);
    } finally {
      clearTimeout(timer);
    }
  }

  buildSearchParams({ query, game = null, set = null, number = null, limit = 20, offset = 0, condition = ['NM'], printing = null, includePriceHistory = true, priceHistoryDuration = '30d', includeStatistics = null } = {}) {
    return {
      query: text(query),
      game: text(game) || undefined,
      set: text(set) || undefined,
      number: text(number) || undefined,
      limit: Math.max(1, Math.min(MAX_BATCH_SIZE, Number(limit) || 20)),
      offset: Math.max(0, Number(offset) || 0),
      condition: Array.isArray(condition) ? condition.filter(Boolean) : condition ? [condition] : undefined,
      printing: Array.isArray(printing) ? printing.filter(Boolean) : printing ? [printing] : undefined,
      include_price_history: Boolean(includePriceHistory),
      priceHistoryDuration,
      include_statistics: includeStatistics || undefined,
    };
  }

  async searchCards(options = {}) {
    if (!this.apiKey) throw new Error('JUSTTCG_API_KEY is not configured.');
    const params = this.buildSearchParams(options);
    let payload;
    const client = await this.getSdkClient();
    try {
      this.lastRequestAt = new Date().toISOString();
      if (client?.v1?.cards?.get) {
        payload = await client.v1.cards.get(params);
      } else {
        payload = await this.request('/cards', { query: params });
      }
      if (payload?.error) throw new Error(payload.error);
      const response = sdkResponseParts(payload);
      this.usage = response.usage;
      this.lastError = null;
      const cards = response.data.map(normalizeJustTcgCard);
      const needle = normalizeText(options.query);
      cards.sort((a, b) => {
        const aText = normalizeText(`${a.name} ${a.setName} ${a.number}`);
        const bText = normalizeText(`${b.name} ${b.setName} ${b.number}`);
        return Number(bText.includes(needle)) - Number(aText.includes(needle));
      });
      return { provider: 'JustTCG', cards, pagination: response.pagination, usage: response.usage };
    } catch (error) {
      this.lastError = error?.message || 'JustTCG search failed.';
      throw new Error(this.lastError);
    }
  }

  async batchCards(lookups = []) {
    if (!this.apiKey) throw new Error('JUSTTCG_API_KEY is not configured.');
    if (!Array.isArray(lookups) || lookups.length === 0) return { provider: 'JustTCG', cards: [], usage: null };
    const batches = [];
    for (let index = 0; index < lookups.length; index += MAX_BATCH_SIZE) batches.push(lookups.slice(index, index + MAX_BATCH_SIZE));
    const cards = [];
    let usage = null;
    const client = await this.getSdkClient();
    for (const batch of batches) {
      this.lastRequestAt = new Date().toISOString();
      let payload;
      if (client?.v1?.cards?.getByBatch) payload = await client.v1.cards.getByBatch(batch);
      else if (client?.cards?.batch) payload = await client.cards.batch(batch);
      else payload = await this.request('/cards', { method: 'POST', body: batch });
      if (payload?.error) throw new Error(payload.error);
      const response = sdkResponseParts(payload);
      cards.push(...response.data.map(normalizeJustTcgCard));
      usage = response.usage || usage;
    }
    this.usage = usage;
    this.lastError = null;
    return { provider: 'JustTCG', cards, usage };
  }
}
