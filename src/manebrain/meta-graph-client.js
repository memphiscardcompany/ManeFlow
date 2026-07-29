const MESSAGE_CHANNELS = new Set(['messenger', 'instagram_dm']);
const COMMENT_CHANNELS = new Set(['facebook_comment', 'instagram_comment']);

export class MetaGraphClientError extends Error {
  constructor(message, { code = 'META_GRAPH_CLIENT_ERROR', details = {}, cause } = {}) {
    super(message, { cause });
    this.name = 'MetaGraphClientError';
    this.code = code;
    this.details = details;
  }
}

function required(value, name, maximum = 5_000) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new MetaGraphClientError(`${name} is required.`, { code: 'META_GRAPH_CONFIGURATION_INCOMPLETE' });
  if (normalized.length > maximum) throw new MetaGraphClientError(`${name} exceeds ${maximum} characters.`, { code: 'META_GRAPH_VALUE_TOO_LONG' });
  return normalized;
}

function safeHeader(response, name) {
  return String(response?.headers?.get?.(name) || '').slice(0, 500) || null;
}

function sanitizedProviderError(payload) {
  const error = payload?.error && typeof payload.error === 'object' ? payload.error : {};
  return {
    type: String(error.type || '').slice(0, 160) || null,
    code: Number.isFinite(Number(error.code)) ? Number(error.code) : null,
    subcode: Number.isFinite(Number(error.error_subcode)) ? Number(error.error_subcode) : null,
    message: String(error.message || '').slice(0, 500) || null,
    traceId: String(error.fbtrace_id || '').slice(0, 200) || null,
  };
}

async function boundedJson(response, maximumBytes) {
  const contentLength = Number(response.headers?.get?.('content-length') || 0);
  if (contentLength > maximumBytes) {
    throw new MetaGraphClientError('Meta response exceeded the configured size limit.', {
      code: 'META_GRAPH_RESPONSE_TOO_LARGE',
      details: { status: response.status, contentLength },
    });
  }
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > maximumBytes) {
    throw new MetaGraphClientError('Meta response exceeded the configured size limit.', {
      code: 'META_GRAPH_RESPONSE_TOO_LARGE',
      details: { status: response.status },
    });
  }
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { unparsed: text.slice(0, 500) };
  }
}

function responseWindowCheck(job, now, responseWindowSeconds) {
  if (!MESSAGE_CHANNELS.has(job.channel)) return;
  const latestInbound = Date.parse(String(job.latest_inbound_at || ''));
  if (!Number.isFinite(latestInbound)) {
    throw new MetaGraphClientError('The latest inbound message time is unavailable.', {
      code: 'META_RESPONSE_WINDOW_UNVERIFIED',
    });
  }
  const maximumAgeMs = Math.max(60, Number(responseWindowSeconds || 86_400)) * 1_000;
  if (latestInbound > now + 60_000 || now - latestInbound > maximumAgeMs) {
    throw new MetaGraphClientError('The standard Meta response window is not verified as open.', {
      code: 'META_RESPONSE_WINDOW_CLOSED',
      details: { latestInboundAt: new Date(latestInbound).toISOString() },
    });
  }
}

function endpointAndPayload(job, config) {
  const channel = required(job.channel, 'channel', 80);
  const text = required(job.approved_text || job.approvedText, 'approved text', 2_000);
  const senderId = required(job.provider_sender_id, 'provider sender ID', 500);
  const conversationId = required(job.provider_conversation_id, 'provider conversation ID', 500);

  if (channel === 'messenger') {
    const pageId = required(job.page_id || config.metaPageId, 'Meta page ID', 500);
    return {
      path: `${encodeURIComponent(pageId)}/messages`,
      token: required(config.metaPageAccessToken, 'Meta page access token', 20_000),
      body: {
        recipient: { id: senderId },
        messaging_type: 'RESPONSE',
        message: { text },
      },
    };
  }
  if (channel === 'instagram_dm') {
    const accountId = required(job.instagram_account_id || config.metaInstagramAccountId, 'Instagram account ID', 500);
    return {
      path: `${encodeURIComponent(accountId)}/messages`,
      token: required(config.metaInstagramAccessToken, 'Instagram access token', 20_000),
      body: { recipient: { id: senderId }, message: { text } },
    };
  }
  if (channel === 'facebook_comment') {
    return {
      path: `${encodeURIComponent(conversationId)}/comments`,
      token: required(config.metaPageAccessToken, 'Meta page access token', 20_000),
      body: { message: text },
    };
  }
  if (channel === 'instagram_comment') {
    return {
      path: `${encodeURIComponent(conversationId)}/replies`,
      token: required(config.metaInstagramAccessToken, 'Instagram access token', 20_000),
      body: { message: text },
    };
  }
  throw new MetaGraphClientError(`Unsupported Meta channel: ${channel}`, { code: 'META_CHANNEL_UNSUPPORTED' });
}

export class MetaGraphClient {
  constructor(config = {}, { fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
    if (typeof fetchImpl !== 'function') throw new TypeError('MetaGraphClient requires fetch.');
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.now = now;
  }

  readiness() {
    const config = this.config;
    const reasons = [];
    if (config.metaKillSwitch !== false) reasons.push('META_KILL_SWITCHED');
    if (config.metaOutboundEnabled !== true) reasons.push('META_OUTBOUND_DISABLED');
    if (!String(config.metaGraphApiVersion || '').trim()) reasons.push('META_GRAPH_API_VERSION_REQUIRED');
    if (!String(config.metaPageAccessToken || '').trim()) reasons.push('META_PAGE_ACCESS_TOKEN_REQUIRED');
    if (!String(config.metaInstagramAccessToken || '').trim()) reasons.push('META_INSTAGRAM_ACCESS_TOKEN_REQUIRED');
    return { ready: reasons.length === 0, reasons };
  }

  async dispatchApprovedReply(job) {
    const readiness = this.readiness();
    if (!readiness.ready) {
      throw new MetaGraphClientError('Meta outbound dispatch is not ready.', {
        code: readiness.reasons[0],
        details: { reasons: readiness.reasons },
      });
    }
    const config = this.config;
    responseWindowCheck(job, this.now(), config.metaResponseWindowSeconds);
    const request = endpointAndPayload(job, config);
    const base = required(config.metaGraphBaseUrl || 'https://graph.facebook.com', 'Meta Graph base URL');
    const version = required(config.metaGraphApiVersion, 'Meta Graph API version', 40).replace(/^\/+|\/+$/g, '');
    const url = `${base.replace(/\/+$/, '')}/${version}/${request.path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(1_000, Number(config.metaRequestTimeoutMs || 15_000)));
    let response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${request.token}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(request.body),
      });
    } catch (error) {
      return {
        outcome: 'outcome_unknown',
        errorCode: error?.name === 'AbortError' ? 'META_GRAPH_TIMEOUT' : 'META_GRAPH_NETWORK_ERROR',
        responseMetadata: { errorName: String(error?.name || 'Error').slice(0, 100) },
      };
    } finally {
      clearTimeout(timeout);
    }

    let payload;
    try {
      payload = await boundedJson(response, Math.max(1_024, Number(config.metaMaxResponseBytes || 256_000)));
    } catch (error) {
      return {
        outcome: 'outcome_unknown',
        errorCode: error.code || 'META_GRAPH_RESPONSE_INVALID',
        responseMetadata: { status: response.status },
      };
    }
    const providerMessageId = String(payload?.message_id || payload?.id || '').trim();
    const responseMetadata = {
      status: response.status,
      requestId: safeHeader(response, 'x-fb-request-id') || safeHeader(response, 'x-request-id'),
      providerError: sanitizedProviderError(payload),
      channel: job.channel,
    };
    if (response.ok && providerMessageId) {
      return { outcome: 'accepted', providerMessageId, responseMetadata };
    }
    if (response.ok) {
      return { outcome: 'outcome_unknown', errorCode: 'META_GRAPH_ACCEPTANCE_ID_MISSING', responseMetadata };
    }
    if (response.status >= 500 || response.status === 429) {
      return { outcome: 'outcome_unknown', errorCode: `META_GRAPH_HTTP_${response.status}`, responseMetadata };
    }
    return { outcome: 'rejected_before_acceptance', errorCode: `META_GRAPH_HTTP_${response.status}`, responseMetadata };
  }
}

export const metaGraphInternals = {
  boundedJson,
  endpointAndPayload,
  responseWindowCheck,
  sanitizedProviderError,
  MESSAGE_CHANNELS,
  COMMENT_CHANNELS,
};
