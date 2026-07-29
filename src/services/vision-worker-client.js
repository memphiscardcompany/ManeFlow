import { validateVisionExtractionResult } from '../contracts/visionExtractionContract.js';

function cleanBaseUrl(value) {
  return String(value || 'http://127.0.0.1:8741').replace(/\/+$/, '');
}

function parseDataUrl(dataUrl) {
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(String(dataUrl || ''));
  if (!match) throw new Error('A base64 image data URL is required.');
  return {
    mediaType: match[1].toLowerCase(),
    bytes: Buffer.from(match[2], 'base64'),
  };
}

async function responsePayload(response) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return response.json();
  return response.text();
}

export class VisionWorkerClient {
  constructor({ baseUrl = 'http://127.0.0.1:8741', timeoutMs = 120_000 } = {}) {
    this.baseUrl = cleanBaseUrl(baseUrl);
    this.timeoutMs = timeoutMs;
  }

  async request(path, options = {}) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      signal: AbortSignal.timeout(options.timeoutMs || this.timeoutMs),
    });
    const payload = await responsePayload(response);
    if (!response.ok) {
      const detail = payload?.detail || payload?.message || String(payload || `HTTP ${response.status}`);
      throw new Error(`ManeFlow vision worker: ${detail}`);
    }
    return payload;
  }

  health() { return this.request('/health', { timeoutMs: 5_000 }); }
  readiness() { return this.request('/readiness', { timeoutMs: 8_000 }); }

  async scanDataUrl(dataUrl, { filename = 'card-scan.jpg' } = {}) {
    const { mediaType, bytes } = parseDataUrl(dataUrl);
    const form = new FormData();
    form.append('image', new Blob([bytes], { type: mediaType }), filename);
    const payload = await this.request('/v1/scan', { method: 'POST', body: form });
    if (payload?.contract_version) validateVisionExtractionResult(payload);
    return payload;
  }

  async analyzeLotDataUrls({ images, listingPrice, inboundShipping = 0, salesTax = 0, sourceType = 'desktop_upload', sourceUrl = null, marketplaceFeeRate, paymentFeeFixed, outboundShippingPerItem = 0, targetRoi } = {}) {
    if (!Array.isArray(images) || !images.length) throw new Error('At least one lot image is required.');
    const form = new FormData();
    images.forEach((entry, index) => {
      const source = typeof entry === 'string' ? { dataUrl: entry } : entry;
      const parsed = parseDataUrl(source.dataUrl);
      form.append('images', new Blob([parsed.bytes], { type: parsed.mediaType }), source.filename || `lot-${index + 1}.jpg`);
    });
    form.append('listing_price', String(listingPrice ?? 0));
    form.append('inbound_shipping', String(inboundShipping ?? 0));
    form.append('sales_tax', String(salesTax ?? 0));
    form.append('source_type', String(sourceType || 'desktop_upload'));
    if (sourceUrl) form.append('source_url', String(sourceUrl));
    if (marketplaceFeeRate != null) form.append('marketplace_fee_rate', String(marketplaceFeeRate));
    if (paymentFeeFixed != null) form.append('payment_fee_fixed', String(paymentFeeFixed));
    form.append('outbound_shipping_per_item', String(outboundShippingPerItem ?? 0));
    if (targetRoi != null) form.append('target_roi', String(targetRoi));
    return this.request('/v1/lots/analyze', { method: 'POST', body: form, timeoutMs: 10 * 60_000 });
  }

  async analyzeEbayListing({ sourceUrl, listingPriceOverride = null, inboundShippingOverride = null, salesTax = 0, marketplaceFeeRate, paymentFeeFixed, outboundShippingPerItem = 0, targetRoi } = {}) {
    if (!sourceUrl) throw new Error('An eBay listing URL is required.');
    const form = new FormData();
    form.append('source_url', String(sourceUrl));
    if (listingPriceOverride != null && listingPriceOverride !== '') form.append('listing_price_override', String(listingPriceOverride));
    if (inboundShippingOverride != null && inboundShippingOverride !== '') form.append('inbound_shipping_override', String(inboundShippingOverride));
    form.append('sales_tax', String(salesTax ?? 0));
    if (marketplaceFeeRate != null) form.append('marketplace_fee_rate', String(marketplaceFeeRate));
    if (paymentFeeFixed != null) form.append('payment_fee_fixed', String(paymentFeeFixed));
    form.append('outbound_shipping_per_item', String(outboundShippingPerItem ?? 0));
    if (targetRoi != null) form.append('target_roi', String(targetRoi));
    return this.request('/v1/lots/analyze-ebay', { method: 'POST', body: form, timeoutMs: 10 * 60_000 });
  }

  getLot(jobId) { return this.request(`/v1/lots/${encodeURIComponent(jobId)}`); }

  correctLotItem(jobId, payload) {
    return this.request(`/v1/lots/${encodeURIComponent(jobId)}/correct`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  getContributors() { return this.request('/v1/contributors'); }
  saveContributor(payload) { return this.request('/v1/contributors/consent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }); }
  revokeContributor(id) { return this.request(`/v1/contributors/${encodeURIComponent(id)}/revoke`, { method: 'POST' }); }
  importRicohFolder(payload) { return this.request('/v1/intake/ricoh/import-folder', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), timeoutMs: 30 * 60_000 }); }
  importPhotoFolder(payload) { return this.request('/v1/intake/photos/import-folder', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), timeoutMs: 60 * 60_000 }); }
  listBatches(limit = 100) { return this.request(`/v1/intake/batches?limit=${encodeURIComponent(limit)}`); }
  getBatch(id) { return this.request(`/v1/intake/batches/${encodeURIComponent(id)}`); }
  processBatch(id, limit = null) { return this.request(`/v1/intake/batches/${encodeURIComponent(id)}/process${limit ? `?limit=${encodeURIComponent(limit)}` : ''}`, { method: 'POST', timeoutMs: 60 * 60_000 }); }
  reviewItem(id, payload) { return this.request(`/v1/intake/items/${encodeURIComponent(id)}/review`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }); }
  contributionStats() { return this.request('/v1/contributions/stats'); }
  contributionDatasetManifest() { return this.request('/v1/contributions/dataset-manifest'); }
  listContributionExamples({ limit = 200, curationStatus = null } = {}) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (curationStatus) params.set('curation_status', String(curationStatus));
    return this.request(`/v1/contributions/examples?${params.toString()}`);
  }
  curateContributionExample(id, payload) {
    return this.request(`/v1/contributions/examples/${encodeURIComponent(id)}/curate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }
}

export function workerCardToLegacyVision(workerScan) {
  const card = workerScan?.predicted_card || {};
  const confidence = Number(workerScan?.identity_confidence || 0);
  const surfaceAnalysis = workerScan?.surface_analysis || null;
  const centeringAssessment = workerScan?.centering_assessment || null;
  const detectedSurfaceType = workerScan?.detected_surface_type || surfaceAnalysis?.detected_surface_type || null;
  const refractorConfidence = Number(workerScan?.refractor_confidence ?? surfaceAnalysis?.refractor_confidence ?? 0);
  const facts = {
    player: card.player_name || null,
    year: card.year || null,
    brand: card.brand || null,
    set: card.set_name || null,
    cardNumber: card.card_number || null,
    parallel: card.parallel || null,
    serialNumber: card.serial_number || null,
    grader: card.grader || null,
    grade: card.grade || null,
    certNumber: card.cert_number || null,
    detectedSurfaceType,
    refractorConfidence,
    visibleText: workerScan?.visible_text || [],
  };
  const fieldConfidence = Object.fromEntries(
    Object.entries(facts)
      .filter(([key, value]) => !['visibleText', 'refractorConfidence'].includes(key) && value != null && value !== '')
      .map(([key]) => [key, key === 'detectedSurfaceType' ? refractorConfidence : confidence]),
  );
  return {
    facts,
    ...facts,
    fieldConfidence,
    confidence,
    warnings: workerScan?.warnings || [],
    provider: workerScan?.identity_provider || 'maneflow_vision_worker',
    imageProcessedRemotely: Boolean(workerScan?.image_processed_remotely),
    surfaceAnalysis,
    centeringAssessment,
  };
}
