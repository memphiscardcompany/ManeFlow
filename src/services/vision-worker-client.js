import { createHash, createHmac, randomBytes } from 'node:crypto';
import { validateVisionExtractionResult } from '../contracts/visionExtractionContract.js';
import {
  AdaptiveConcurrencyController,
  runAdaptiveBatch,
} from './adaptive-batch-scheduler.js';
import {
  exponentialRetryDelayMs,
  isTransientVisionStatus,
  parseRetryAfterMs,
} from './vision-retry-policy.js';

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function imageDigest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function privateIdempotencyKey(bytes, secret) {
  return createHmac('sha256', secret).update(bytes).digest('hex');
}

async function responsePayload(response) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return response.json();
  return response.text();
}

function visionWorkerError(response, payload) {
  const detail = payload?.detail || payload?.message || String(payload || `HTTP ${response.status}`);
  const error = new Error(`ManeFlow vision worker: ${detail}`);
  error.status = response.status;
  error.retryAfter = response.headers.get('retry-after');
  return error;
}

function hasIdentityEvidence(payload) {
  const card = payload?.predicted_card || {};
  return [
    card.player_name,
    card.character_name,
    card.year,
    card.brand,
    card.set_name,
    card.card_number,
    card.parallel,
    card.cert_number,
  ].some((value) => value !== null && value !== undefined && String(value).trim() !== '');
}

export function classifyWorkerScanResult(payload) {
  const detectedObjectCount = Math.max(
    0,
    Math.round(Number(payload?.detected_object_count || 0)),
  );
  const identityConfidence = Number(payload?.identity_confidence || 0);
  const state = String(
    payload?.pipeline_state
      || payload?.scene_type
      || payload?.status
      || '',
  ).trim().toLowerCase();
  const explicitNoCard = [
    'no_card',
    'no-card',
    'no card',
    'rejected_no_card',
  ].includes(state);

  if (detectedObjectCount > 0) {
    return {
      terminalState: hasIdentityEvidence(payload) && identityConfidence >= 0.85
        ? 'detected'
        : 'review_required',
      result: payload,
    };
  }
  if (hasIdentityEvidence(payload)) {
    return { terminalState: 'review_required', result: payload };
  }
  if (explicitNoCard) {
    return { terminalState: 'rejected_no_card', result: payload };
  }
  return { terminalState: 'insufficient_evidence', result: payload };
}

export class VisionWorkerClient {
  constructor({
    baseUrl = 'http://127.0.0.1:8741',
    timeoutMs = 120_000,
    maxRetries = 2,
    retryBaseMs = 250,
    retryMaxMs = 15_000,
    sleepFn = sleep,
    nowFn = Date.now,
    idempotencySecret = randomBytes(32),
  } = {}) {
    this.baseUrl = cleanBaseUrl(baseUrl);
    this.timeoutMs = timeoutMs;
    this.maxRetries = Math.max(0, Math.floor(Number(maxRetries) || 0));
    this.retryBaseMs = Math.max(1, Math.floor(Number(retryBaseMs) || 250));
    this.retryMaxMs = Math.max(this.retryBaseMs, Math.floor(Number(retryMaxMs) || 15_000));
    this.sleepFn = sleepFn;
    this.nowFn = nowFn;
    this.cooldownUntil = 0;
    this.inflightScans = new Map();
    const suppliedSecret = Buffer.isBuffer(idempotencySecret)
      ? idempotencySecret
      : Buffer.from(String(idempotencySecret || ''), 'utf8');
    this.idempotencySecret = suppliedSecret.length ? suppliedSecret : randomBytes(32);
  }

  async waitForSharedCooldown() {
    const remaining = Math.max(0, this.cooldownUntil - this.nowFn());
    if (remaining > 0) await this.sleepFn(remaining);
  }

  async request(path, options = {}) {
    const {
      timeoutMs = this.timeoutMs,
      retryable = false,
      maxRetries = this.maxRetries,
      bodyFactory = null,
      onTransientFault = null,
      ...fetchOptions
    } = options;

    let attempt = 0;
    while (true) {
      await this.waitForSharedCooldown();
      const requestOptions = {
        ...fetchOptions,
        signal: AbortSignal.timeout(timeoutMs),
      };
      if (bodyFactory) requestOptions.body = bodyFactory();

      const response = await fetch(`${this.baseUrl}${path}`, requestOptions);
      const payload = await responsePayload(response);
      if (response.ok) return payload;

      const error = visionWorkerError(response, payload);
      const mayRetry = retryable
        && attempt < maxRetries
        && isTransientVisionStatus(response.status);
      if (!mayRetry) throw error;

      if (typeof onTransientFault === 'function') {
        try {
          onTransientFault(error);
        } catch {
          // Scheduler observers must not prevent the bounded retry policy.
        }
      }

      const providerDelay = parseRetryAfterMs(response.headers.get('retry-after'), {
        now: this.nowFn(),
        minimumMs: 1_000,
        maximumMs: this.retryMaxMs,
      });
      const fallbackDelay = exponentialRetryDelayMs(attempt, {
        baseMs: this.retryBaseMs,
        maximumMs: this.retryMaxMs,
      });
      const delayMs = providerDelay ?? fallbackDelay;
      this.cooldownUntil = Math.max(this.cooldownUntil, this.nowFn() + delayMs);
      attempt += 1;
    }
  }

  health() { return this.request('/health', { timeoutMs: 5_000 }); }
  readiness() { return this.request('/readiness', { timeoutMs: 8_000 }); }

  async scanDataUrl(dataUrl, {
    filename = 'card-scan.jpg',
    onTransientFault = null,
  } = {}) {
    const { mediaType, bytes } = parseDataUrl(dataUrl);
    const digest = imageDigest(bytes);
    const singleFlightKey = `${mediaType}:${digest}`;
    const existing = this.inflightScans.get(singleFlightKey);
    if (existing) return existing;

    const idempotencyKey = privateIdempotencyKey(bytes, this.idempotencySecret);
    const operation = this.request('/v1/scan', {
      method: 'POST',
      headers: { 'x-maneflow-idempotency-key': idempotencyKey },
      bodyFactory: () => {
        const form = new FormData();
        form.append('image', new Blob([bytes], { type: mediaType }), filename);
        return form;
      },
      retryable: true,
      onTransientFault,
    }).then((payload) => {
      if (payload?.contract_version) validateVisionExtractionResult(payload);
      return payload;
    }).finally(() => {
      this.inflightScans.delete(singleFlightKey);
    });

    this.inflightScans.set(singleFlightKey, operation);
    return operation;
  }

  async scanDataUrls(images, {
    initialConcurrency = 4,
    minimumConcurrency = 1,
    maximumConcurrency = 8,
    healthyWindow = 20,
    queueGenerationId = undefined,
    onProgress = null,
    shouldStop = null,
    controller = null,
  } = {}) {
    if (!Array.isArray(images) || images.length === 0) {
      throw new Error('At least one scan image is required.');
    }
    const adaptiveController = controller || new AdaptiveConcurrencyController({
      initialConcurrency,
      minimumConcurrency,
      maximumConcurrency,
      healthyWindow,
    });

    return runAdaptiveBatch({
      items: images,
      controller: adaptiveController,
      queueGenerationId,
      onProgress,
      shouldStop,
      nowFn: this.nowFn,
      worker: (entry, context) => {
        const source = typeof entry === 'string' ? { dataUrl: entry } : entry;
        if (!source?.dataUrl) throw new Error('Each scan image requires a dataUrl.');
        return this.scanDataUrl(source.dataUrl, {
          filename: source.filename || context.filename,
          onTransientFault: (error) => adaptiveController.recordFault(error),
        });
      },
      classifyResult: classifyWorkerScanResult,
    });
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
  const detectedObjectCount = Math.max(0, Math.round(Number(workerScan?.detected_object_count || 0)));
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
    physicalCardCount: detectedObjectCount,
    physicalCardDetected: detectedObjectCount === 1,
    cropQuality: detectedObjectCount === 1 ? 'single-card' : detectedObjectCount > 1 ? 'multiple-cards' : 'no-card',
    warnings: workerScan?.warnings || [],
    provider: workerScan?.identity_provider || 'maneflow_vision_worker',
    imageProcessedRemotely: Boolean(workerScan?.image_processed_remotely),
    surfaceAnalysis,
    centeringAssessment,
  };
}
