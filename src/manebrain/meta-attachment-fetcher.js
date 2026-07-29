import { validateMetaAttachmentRedirect, validateMetaAttachmentUrl } from './attachment-policy.js';

const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'audio/mpeg',
  'audio/mp4',
  'application/pdf',
]);

function integer(value, fallback, minimum, maximum) {
  const normalized = Number(value ?? fallback);
  if (!Number.isInteger(normalized) || normalized < minimum || normalized > maximum) {
    throw new TypeError(`Expected an integer between ${minimum} and ${maximum}.`);
  }
  return normalized;
}

function contentType(response) {
  return String(response?.headers?.get?.('content-type') || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
}

function contentLength(response) {
  const value = Number(response?.headers?.get?.('content-length') || 0);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export class MetaAttachmentFetchError extends Error {
  constructor(message, { code = 'META_ATTACHMENT_FETCH_FAILED', status = 400, details = {}, cause } = {}) {
    super(message, { cause });
    this.name = 'MetaAttachmentFetchError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class MetaAttachmentFetcher {
  constructor({
    allowedHosts = [],
    maximumBytes = 20_000_000,
    maximumRedirects = 3,
    timeoutMs = 20_000,
    fetchImpl = globalThis.fetch,
  } = {}) {
    if (typeof fetchImpl !== 'function') throw new TypeError('MetaAttachmentFetcher requires fetch.');
    this.allowedHosts = Array.isArray(allowedHosts) ? [...allowedHosts] : String(allowedHosts || '').split(',');
    this.maximumBytes = integer(maximumBytes, 20_000_000, 1_024, 100_000_000);
    this.maximumRedirects = integer(maximumRedirects, 3, 0, 8);
    this.timeoutMs = integer(timeoutMs, 20_000, 1_000, 120_000);
    this.fetchImpl = fetchImpl;
  }

  validate(url, redirect = false) {
    const result = redirect
      ? validateMetaAttachmentRedirect(url, this.allowedHosts)
      : validateMetaAttachmentUrl(url, this.allowedHosts);
    if (!result.allowed) {
      throw new MetaAttachmentFetchError('Meta attachment URL was rejected by policy.', {
        code: result.reason,
        status: 400,
      });
    }
    return result.url;
  }

  async fetch(url) {
    let currentUrl = this.validate(url, false);
    for (let redirectCount = 0; redirectCount <= this.maximumRedirects; redirectCount += 1) {
      let response;
      try {
        response = await this.fetchImpl(currentUrl, {
          method: 'GET',
          headers: { accept: [...ALLOWED_CONTENT_TYPES].join(', ') },
          redirect: 'manual',
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        throw new MetaAttachmentFetchError('Meta attachment request failed.', {
          code: error?.name === 'TimeoutError' ? 'META_ATTACHMENT_TIMEOUT' : 'META_ATTACHMENT_NETWORK_ERROR',
          status: 503,
          cause: error,
        });
      }

      if (response.status >= 300 && response.status < 400) {
        if (redirectCount >= this.maximumRedirects) {
          throw new MetaAttachmentFetchError('Meta attachment redirect limit exceeded.', {
            code: 'META_ATTACHMENT_REDIRECT_LIMIT',
            status: 400,
          });
        }
        const location = response.headers.get('location');
        if (!location) {
          throw new MetaAttachmentFetchError('Meta attachment redirect had no location.', {
            code: 'META_ATTACHMENT_REDIRECT_INVALID',
            status: 400,
          });
        }
        currentUrl = this.validate(new URL(location, currentUrl).toString(), true);
        continue;
      }

      if (!response.ok) {
        throw new MetaAttachmentFetchError('Meta attachment provider returned an error.', {
          code: 'META_ATTACHMENT_HTTP_ERROR',
          status: response.status >= 500 ? 503 : 400,
          details: { httpStatus: response.status },
        });
      }

      const declaredLength = contentLength(response);
      if (declaredLength && declaredLength > this.maximumBytes) {
        throw new MetaAttachmentFetchError('Meta attachment exceeds the configured byte limit.', {
          code: 'META_ATTACHMENT_TOO_LARGE',
          status: 413,
          details: { declaredLength, maximumBytes: this.maximumBytes },
        });
      }
      const type = contentType(response);
      if (!ALLOWED_CONTENT_TYPES.has(type)) {
        throw new MetaAttachmentFetchError('Meta attachment content type is not allowed.', {
          code: 'META_ATTACHMENT_CONTENT_TYPE_BLOCKED',
          status: 415,
          details: { contentType: type || null },
        });
      }

      const reader = response.body?.getReader?.();
      if (!reader) {
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length > this.maximumBytes) {
          throw new MetaAttachmentFetchError('Meta attachment exceeds the configured byte limit.', {
            code: 'META_ATTACHMENT_TOO_LARGE',
            status: 413,
          });
        }
        return { bytes: buffer, contentType: type, sourceUrl: currentUrl, byteLength: buffer.length };
      }

      const chunks = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > this.maximumBytes) {
          await reader.cancel().catch(() => {});
          throw new MetaAttachmentFetchError('Meta attachment exceeds the configured byte limit.', {
            code: 'META_ATTACHMENT_TOO_LARGE',
            status: 413,
          });
        }
        chunks.push(Buffer.from(value));
      }
      return {
        bytes: Buffer.concat(chunks, total),
        contentType: type,
        sourceUrl: currentUrl,
        byteLength: total,
      };
    }
    throw new MetaAttachmentFetchError('Meta attachment retrieval did not complete.', {
      code: 'META_ATTACHMENT_FETCH_INCOMPLETE',
      status: 503,
    });
  }
}
