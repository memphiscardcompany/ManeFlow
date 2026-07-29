import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';

import { validateMetaAttachmentUrl } from './attachment-policy.js';

export class MetaAttachmentFetchError extends Error {
  constructor(message, { code = 'META_ATTACHMENT_FETCH_ERROR', details = {}, cause } = {}) {
    super(message, { cause });
    this.name = 'MetaAttachmentFetchError';
    this.code = code;
    this.details = details;
  }
}

function privateIp(address) {
  const normalized = String(address || '').toLowerCase();
  const family = net.isIP(normalized);
  if (family === 4) {
    const parts = normalized.split('.').map(Number);
    return parts[0] === 10
      || parts[0] === 127
      || (parts[0] === 169 && parts[1] === 254)
      || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      || (parts[0] === 192 && parts[1] === 168)
      || parts[0] === 0
      || parts[0] >= 224;
  }
  if (family === 6) {
    return normalized === '::1'
      || normalized === '::'
      || normalized.startsWith('fc')
      || normalized.startsWith('fd')
      || normalized.startsWith('fe8')
      || normalized.startsWith('fe9')
      || normalized.startsWith('fea')
      || normalized.startsWith('feb');
  }
  return true;
}

async function assertPublicResolution(hostname, resolver) {
  let records;
  try {
    records = await resolver(hostname, { all: true, verbatim: true });
  } catch (error) {
    throw new MetaAttachmentFetchError('Attachment hostname could not be resolved.', {
      code: 'META_ATTACHMENT_DNS_FAILED',
      cause: error,
    });
  }
  const values = Array.isArray(records) ? records : [records];
  if (!values.length || values.some((record) => privateIp(record?.address))) {
    throw new MetaAttachmentFetchError('Attachment hostname resolved to a private or unsafe address.', {
      code: 'META_ATTACHMENT_DNS_UNSAFE',
    });
  }
}

async function readBoundedBody(response, maximumBytes) {
  const declared = Number(response.headers?.get?.('content-length') || 0);
  if (declared > maximumBytes) {
    throw new MetaAttachmentFetchError('Attachment exceeds the configured size limit.', {
      code: 'META_ATTACHMENT_TOO_LARGE',
      details: { declared },
    });
  }
  if (!response.body?.getReader) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maximumBytes) throw new MetaAttachmentFetchError('Attachment exceeds the configured size limit.', { code: 'META_ATTACHMENT_TOO_LARGE' });
    return bytes;
  }
  const chunks = [];
  let total = 0;
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel().catch(() => {});
      throw new MetaAttachmentFetchError('Attachment exceeds the configured size limit.', { code: 'META_ATTACHMENT_TOO_LARGE' });
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

export class MetaAttachmentFetcher {
  constructor(config = {}, {
    fetchImpl = globalThis.fetch,
    resolver = dns.lookup,
  } = {}) {
    if (typeof fetchImpl !== 'function') throw new TypeError('MetaAttachmentFetcher requires fetch.');
    if (typeof resolver !== 'function') throw new TypeError('MetaAttachmentFetcher requires a DNS resolver.');
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.resolver = resolver;
  }

  async fetchImage(sourceUrl) {
    const config = this.config;
    const allowedHosts = config.metaAttachmentAllowedHosts || [];
    const allowedTypes = new Set(config.metaAttachmentAllowedContentTypes || ['image/jpeg', 'image/png', 'image/webp']);
    const maximumBytes = Math.max(1_024, Number(config.metaAttachmentMaxBytes || 10_000_000));
    const maximumRedirects = Math.max(0, Number(config.metaAttachmentMaxRedirects || 2));
    let current = String(sourceUrl || '');

    for (let redirect = 0; redirect <= maximumRedirects; redirect += 1) {
      const validation = validateMetaAttachmentUrl(current, allowedHosts);
      if (!validation.allowed) {
        throw new MetaAttachmentFetchError('Attachment URL failed policy validation.', {
          code: validation.reason,
        });
      }
      await assertPublicResolution(validation.hostname, this.resolver);
      let response;
      try {
        response = await this.fetchImpl(validation.url, {
          method: 'GET',
          redirect: 'manual',
          signal: AbortSignal.timeout(Math.max(1_000, Number(config.metaRequestTimeoutMs || 15_000))),
          headers: { accept: 'image/jpeg,image/png,image/webp' },
        });
      } catch (error) {
        throw new MetaAttachmentFetchError('Attachment request failed.', {
          code: error?.name === 'TimeoutError' || error?.name === 'AbortError'
            ? 'META_ATTACHMENT_TIMEOUT'
            : 'META_ATTACHMENT_NETWORK_ERROR',
          cause: error,
        });
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirect >= maximumRedirects) {
          throw new MetaAttachmentFetchError('Attachment exceeded the redirect limit.', { code: 'META_ATTACHMENT_REDIRECT_LIMIT' });
        }
        const location = response.headers.get('location');
        if (!location) throw new MetaAttachmentFetchError('Attachment redirect omitted Location.', { code: 'META_ATTACHMENT_REDIRECT_INVALID' });
        current = new URL(location, validation.url).toString();
        continue;
      }
      if (!response.ok) {
        throw new MetaAttachmentFetchError(`Attachment provider returned HTTP ${response.status}.`, {
          code: `META_ATTACHMENT_HTTP_${response.status}`,
        });
      }
      const contentType = String(response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
      if (!allowedTypes.has(contentType)) {
        throw new MetaAttachmentFetchError('Attachment content type is not approved.', {
          code: 'META_ATTACHMENT_CONTENT_TYPE_REJECTED',
          details: { contentType },
        });
      }
      const bytes = await readBoundedBody(response, maximumBytes);
      return {
        sourceUrl: String(sourceUrl),
        finalUrl: validation.url,
        hostname: validation.hostname,
        contentType,
        byteLength: bytes.length,
        sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
        bytes,
        retention: 'transient_private_processing_only',
      };
    }
    throw new MetaAttachmentFetchError('Attachment redirect processing failed.', { code: 'META_ATTACHMENT_REDIRECT_INVALID' });
  }
}

export const metaAttachmentFetcherInternals = {
  assertPublicResolution,
  privateIp,
  readBoundedBody,
};
