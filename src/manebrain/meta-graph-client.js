const DIRECT_CHANNELS = new Set(['messenger', 'instagram_dm']);
const COMMENT_CHANNELS = new Set(['facebook_comment', 'instagram_comment']);
const SUPPORTED_CHANNELS = new Set([...DIRECT_CHANNELS, ...COMMENT_CHANNELS]);

function cleanBaseUrl(value, fallback) {
  const candidate = String(value || fallback || '').trim().replace(/\/+$/, '');
  const parsed = new URL(candidate);
  if (parsed.protocol !== 'https:') throw new TypeError('Meta Graph API base URLs must use HTTPS.');
  return parsed.toString().replace(/\/$/, '');
}

function required(value, name, maximum = 4_000) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new TypeError(`${name} is required.`);
  if (normalized.length > maximum) throw new TypeError(`${name} exceeds ${maximum} characters.`);
  return normalized;
}

function graphVersion(value) {
  const normalized = required(value, 'META_GRAPH_API_VERSION', 32);
  if (!/^v\d+\.\d+$/.test(normalized)) {
    throw new TypeError('META_GRAPH_API_VERSION must use an explicit version such as v23.0.');
  }
  return normalized;
}

function truncate(value, maximum = 240) {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').slice(0, maximum);
}

function providerMetadata(response, payload = null) {
  const error = payload?.error && typeof payload.error === 'object' ? payload.error : {};
  return {
    httpStatus: Number(response?.status || 0) || null,
    providerCode: Number.isFinite(Number(error.code)) ? Number(error.code) : null,
    providerSubcode: Number.isFinite(Number(error.error_subcode)) ? Number(error.error_subcode) : null,
    providerType: truncate(error.type, 120) || null,
    providerTraceId: truncate(error.fbtrace_id, 160) || null,
    providerTransient: error.is_transient === true,
  };
}

function isRetryableResponse(status, metadata) {
  return metadata.providerTransient === true || status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function outputMessageId(payload) {
  return String(payload?.message_id || payload?.messageId || payload?.id || '').trim() || null;
}

function jobField(job, camel, snake = camel) {
  return job?.[camel] ?? job?.[snake] ?? null;
}

export class MetaGraphDispatchError extends Error {
  constructor(message, {
    code = 'META_GRAPH_DISPATCH_FAILED',
    certainty = 'outcome_unknown',
    retryable = false,
    responseMetadata = {},
    cause,
  } = {}) {
    super(message, { cause });
    this.name = 'MetaGraphDispatchError';
    this.code = code;
    this.certainty = certainty;
    this.retryable = retryable === true;
    this.responseMetadata = responseMetadata;
  }
}

export function metaGraphReadiness(config = {}) {
  const missing = [];
  if (!String(config.metaGraphApiVersion || '').trim()) missing.push('META_GRAPH_API_VERSION');
  if (!String(config.metaPageAccessToken || '').trim()) missing.push('META_PAGE_ACCESS_TOKEN');
  if (!String(config.metaInstagramAccessToken || '').trim()) missing.push('META_INSTAGRAM_ACCESS_TOKEN');
  if (!String(config.metaPageId || '').trim()) missing.push('META_PAGE_ID');
  if (!String(config.metaInstagramAccountId || '').trim()) missing.push('META_INSTAGRAM_ACCOUNT_ID');
  return { ready: missing.length === 0, missing };
}

export class MetaGraphClient {
  constructor(config = {}, { fetchImpl = globalThis.fetch } = {}) {
    if (typeof fetchImpl !== 'function') throw new TypeError('MetaGraphClient requires fetch.');
    this.fetch = fetchImpl;
    this.version = graphVersion(config.metaGraphApiVersion);
    this.facebookBaseUrl = cleanBaseUrl(config.metaFacebookGraphBaseUrl, 'https://graph.facebook.com');
    this.instagramBaseUrl = cleanBaseUrl(config.metaInstagramGraphBaseUrl, 'https://graph.instagram.com');
    this.pageId = required(config.metaPageId, 'META_PAGE_ID', 500);
    this.instagramAccountId = required(config.metaInstagramAccountId, 'META_INSTAGRAM_ACCOUNT_ID', 500);
    this.pageAccessToken = required(config.metaPageAccessToken, 'META_PAGE_ACCESS_TOKEN', 8_192);
    this.instagramAccessToken = required(config.metaInstagramAccessToken, 'META_INSTAGRAM_ACCESS_TOKEN', 8_192);
    this.timeoutMs = Math.max(1_000, Math.min(120_000, Number(config.metaRequestTimeoutMs || 15_000)));
  }

  requestFor(job) {
    const channel = required(jobField(job, 'channel'), 'channel', 40);
    if (!SUPPORTED_CHANNELS.has(channel)) throw new TypeError(`Unsupported Meta channel: ${channel}`);
    const providerAccountId = required(jobField(job, 'providerAccountId', 'provider_account_id'), 'providerAccountId', 500);
    const providerSenderId = required(jobField(job, 'providerSenderId', 'provider_sender_id'), 'providerSenderId', 500);
    const approvedText = required(jobField(job, 'approvedText', 'approved_text'), 'approvedText', 4_000);
    const targetProviderMessageId = String(jobField(job, 'targetProviderMessageId', 'target_provider_message_id') || '').trim();

    if (channel.startsWith('instagram') && providerAccountId !== this.instagramAccountId) {
      throw new TypeError('The outbound Instagram account does not match the configured allowlist.');
    }
    if (!channel.startsWith('instagram') && providerAccountId !== this.pageId) {
      throw new TypeError('The outbound Facebook Page does not match the configured allowlist.');
    }

    if (channel === 'messenger') {
      return {
        channel,
        url: `${this.facebookBaseUrl}/${this.version}/${encodeURIComponent(this.pageId)}/messages`,
        token: this.pageAccessToken,
        body: { recipient: { id: providerSenderId }, messaging_type: 'RESPONSE', message: { text: approvedText } },
      };
    }
    if (channel === 'instagram_dm') {
      return {
        channel,
        url: `${this.instagramBaseUrl}/${this.version}/${encodeURIComponent(this.instagramAccountId)}/messages`,
        token: this.instagramAccessToken,
        body: { recipient: { id: providerSenderId }, message: { text: approvedText } },
      };
    }
    if (!targetProviderMessageId) {
      throw new TypeError('A provider comment ID is required to publish a comment reply.');
    }
    if (channel === 'facebook_comment') {
      return {
        channel,
        url: `${this.facebookBaseUrl}/${this.version}/${encodeURIComponent(targetProviderMessageId)}/comments`,
        token: this.pageAccessToken,
        body: { message: approvedText },
      };
    }
    return {
      channel,
      url: `${this.instagramBaseUrl}/${this.version}/${encodeURIComponent(targetProviderMessageId)}/replies`,
      token: this.instagramAccessToken,
      body: { message: approvedText },
    };
  }

  async send(job) {
    const request = this.requestFor(job);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    timer.unref?.();
    let response;
    try {
      response = await this.fetch(request.url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${request.token}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(request.body),
        signal: controller.signal,
      });
    } catch (error) {
      const timedOut = error?.name === 'AbortError';
      throw new MetaGraphDispatchError(
        timedOut ? 'Meta Graph request timed out with an unknown delivery outcome.' : 'Meta Graph network failure left delivery outcome unknown.',
        {
          code: timedOut ? 'META_GRAPH_TIMEOUT' : 'META_GRAPH_NETWORK_FAILURE',
          certainty: 'outcome_unknown',
          retryable: false,
          responseMetadata: { channel: request.channel, timedOut },
          cause: error,
        },
      );
    } finally {
      clearTimeout(timer);
    }

    let payload = null;
    try {
      const text = await response.text();
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = {};
    }
    const metadata = { channel: request.channel, ...providerMetadata(response, payload) };
    if (!response.ok) {
      throw new MetaGraphDispatchError('Meta Graph rejected the request before provider acceptance.', {
        code: 'META_GRAPH_REJECTED',
        certainty: 'rejected_before_acceptance',
        retryable: isRetryableResponse(response.status, metadata),
        responseMetadata: metadata,
      });
    }
    const providerMessageId = outputMessageId(payload);
    if (!providerMessageId) {
      throw new MetaGraphDispatchError('Meta Graph returned success without an acceptance identifier.', {
        code: 'META_GRAPH_ACCEPTANCE_UNCONFIRMED',
        certainty: 'outcome_unknown',
        retryable: false,
        responseMetadata: metadata,
      });
    }
    return {
      accepted: true,
      providerMessageId,
      responseMetadata: metadata,
    };
  }
}
