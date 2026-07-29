import { extractTradingCardFields } from './cardFieldParser.js';

const SUPPORTED_MEDIA_TYPES = new Set(['image/jpeg', 'image/png']);

export class OcrServiceError extends Error {
  constructor(message, { code = 'OCR_SERVICE_ERROR', cause = undefined, retryable = false } = {}) {
    super(message, { cause });
    this.name = 'OcrServiceError';
    this.code = code;
    this.retryable = retryable;
  }
}

function decodeDataUrl(dataUrl) {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ''));
  if (!match) throw new OcrServiceError('OCR input must be a base64 image data URL.', { code: 'OCR_INVALID_DATA_URL' });
  const mediaType = match[1].toLowerCase();
  if (!SUPPORTED_MEDIA_TYPES.has(mediaType)) {
    throw new OcrServiceError(`Local OCR supports JPEG and PNG only; received ${mediaType}.`, { code: 'OCR_UNSUPPORTED_MEDIA_TYPE' });
  }
  const bytes = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  if (!bytes.length) throw new OcrServiceError('OCR input image is empty.', { code: 'OCR_EMPTY_IMAGE' });
  return { bytes, mediaType };
}

function normalizeResult(result = {}) {
  const pages = Array.isArray(result.pages) ? result.pages : [];
  const pageLines = pages.flatMap((page) => Array.isArray(page.lines) ? page.lines : []);
  const directLines = Array.isArray(result.lines) ? result.lines : [];
  const lines = (pageLines.length ? pageLines : directLines).map((line) => ({
    id: String(line.id || ''),
    text: String(line.text || '').trim(),
    confidence: Math.max(0, Math.min(1, Number(line.confidence) || 0)),
    box: Array.isArray(line.box) ? line.box.map((point) => ({ x: Number(point.x) || 0, y: Number(point.y) || 0 })) : [],
  })).filter((line) => line.text);
  return {
    schemaVersion: Number(result.schemaVersion || 1),
    lines,
    pages: pages.map((page, index) => ({
      index: Number.isInteger(page.index) ? page.index : index,
      width: Number(page.width) || null,
      height: Number(page.height) || null,
      coordinateSpace: page.coordinateSpace || 'pageSpace',
    })),
  };
}

export class LightOcrService {
  constructor({
    enabled = true,
    provider = 'auto',
    queueCapacity = 4,
    timeoutMs = 20_000,
    moduleLoader = () => import('@arcships/light-ocr'),
  } = {}) {
    this.enabled = Boolean(enabled);
    this.provider = ['auto', 'cpu', 'apple', 'webgpu'].includes(provider) ? provider : 'auto';
    this.queueCapacity = Math.max(1, Math.min(32, Number(queueCapacity) || 4));
    this.timeoutMs = Math.max(1_000, Math.min(120_000, Number(timeoutMs) || 20_000));
    this.moduleLoader = moduleLoader;
    this.engine = null;
    this.enginePromise = null;
    this.initializationError = null;
    this.closed = false;
  }

  async initialize() {
    if (!this.enabled) return null;
    if (this.closed) throw new OcrServiceError('OCR service is closed.', { code: 'OCR_SERVICE_CLOSED' });
    if (this.engine) return this.engine;
    if (this.enginePromise) return this.enginePromise;

    this.enginePromise = (async () => {
      try {
        const module = await this.moduleLoader();
        if (typeof module.createEngine !== 'function') {
          throw new TypeError('@arcships/light-ocr did not export createEngine().');
        }
        const engine = await module.createEngine({
          execution: { provider: this.provider },
          queueCapacity: this.queueCapacity,
        });
        if (!engine || typeof engine.recognizeEncoded !== 'function' || typeof engine.close !== 'function') {
          throw new TypeError('@arcships/light-ocr returned an invalid engine instance.');
        }
        this.engine = engine;
        this.initializationError = null;
        return engine;
      } catch (error) {
        this.initializationError = error;
        throw new OcrServiceError('Local PP-OCRv6 engine could not be initialized.', {
          code: 'OCR_INITIALIZATION_FAILED',
          cause: error,
          retryable: true,
        });
      } finally {
        this.enginePromise = null;
      }
    })();

    return this.enginePromise;
  }

  async recognizeBuffer(imageBytes, { region = undefined, applyExif = true, signal = undefined } = {}) {
    if (!this.enabled) throw new OcrServiceError('Local OCR is disabled.', { code: 'OCR_DISABLED' });
    if (!Buffer.isBuffer(imageBytes) && !(imageBytes instanceof Uint8Array)) {
      throw new OcrServiceError('OCR input must be a Buffer or Uint8Array.', { code: 'OCR_INVALID_IMAGE_BYTES' });
    }

    const engine = await this.initialize();
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(new Error('OCR request timed out.')), this.timeoutMs);
    timeout.unref?.();

    const abort = () => timeoutController.abort(signal?.reason || new Error('OCR request aborted.'));
    if (signal) {
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    }

    try {
      const result = await engine.recognizeEncoded(imageBytes, {
        applyExif,
        ...(region ? { region } : {}),
        signal: timeoutController.signal,
      });
      const normalized = normalizeResult(result);
      return {
        ...normalized,
        ...extractTradingCardFields(normalized.lines),
        provider: '@arcships/light-ocr',
        executionProvider: engine.info?.execution?.sessions?.recognition?.actualProviderChain
          || engine.info?.execution?.sessions?.detection?.actualProviderChain
          || this.provider,
        processedRemotely: false,
      };
    } catch (error) {
      const timedOut = timeoutController.signal.aborted && !signal?.aborted;
      throw new OcrServiceError(timedOut ? 'Local OCR request timed out.' : 'Local OCR recognition failed.', {
        code: timedOut ? 'OCR_TIMEOUT' : 'OCR_RECOGNITION_FAILED',
        cause: error,
        retryable: true,
      });
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener?.('abort', abort);
    }
  }

  async recognizeDataUrl(dataUrl, options = {}) {
    const { bytes, mediaType } = decodeDataUrl(dataUrl);
    const result = await this.recognizeBuffer(bytes, options);
    return { ...result, mediaType, byteLength: bytes.length };
  }

  readiness() {
    return {
      enabled: this.enabled,
      available: Boolean(this.engine),
      initializing: Boolean(this.enginePromise),
      providerRequested: this.provider,
      queueCapacity: this.queueCapacity,
      package: '@arcships/light-ocr',
      modelFamily: 'PP-OCRv6 Small',
      processedRemotely: false,
      error: this.initializationError instanceof Error ? this.initializationError.message : null,
      engineInfo: this.engine?.info || null,
    };
  }

  async close() {
    this.closed = true;
    const engine = this.engine || (this.enginePromise ? await this.enginePromise.catch(() => null) : null);
    this.engine = null;
    if (engine) await engine.close();
  }
}
