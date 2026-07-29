const SUPPORTED_CHANNELS = new Set(['messenger', 'instagram_dm']);

function requiredString(value, name, maximum = 4_000) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new TypeError(`${name} is required.`);
  if (normalized.length > maximum) throw new TypeError(`${name} exceeds ${maximum} characters.`);
  return normalized;
}

function httpsBase(value, name) {
  let parsed;
  try {
    parsed = new URL(String(value || ''));
  } catch {
    throw new TypeError(`${name} must be a valid HTTPS URL.`);
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new TypeError(`${name} must be a credential-free HTTPS origin.`);
  }
  return parsed.toString().replace(/\/+$/, '');
}

function apiVersion(value) {
  const normalized = String(value || '').trim();
  if (!/^v\d+\.\d+$/.test(normalized)) throw new TypeError('Meta Graph API version must use the vNN.N format.');
  return normalized;
}

function responseHeader(response, name) {
  try {
    return response?.headers?.get?.(name) || null;
  } catch {
    return null;
  }
}

async function responseJson(response) {
  try {
    const text = await response.text();
    if (!text) return {};
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function safeProviderMetadata(response, body = {}) {
  const providerError = body?.error && typeof body.error === 'object' ? body.error : {};
  return {
    httpStatus: Number(response?.status || 0) || null,
    requestId: responseHeader(response, 'x-fb-request-id'),
    traceId: responseHeader(response, 'x-fb-trace-id'),
    providerErrorCode: providerError.code ?? null,
    providerErrorSubcode: providerError.error_subcode ?? null,
    providerErrorType: providerError.type ?? null,
    providerErrorMessage: providerError.message ? String(providerError.message).slice(0, 500) : null,
  };
}

export class MetaGraphClientError extends Error {
  constructor(message, {
    code = 'META_GRAPH_REQUEST_FAILED',
    outcome = 'outcome_unknown',
    retryable = false,
    metadata = {},
    cause,
  } = {}) {
    super(message, { cause });
    this.name = 'MetaGraphClientError';
    this.code = code;
    this.outcome = outcome;
    this.retryable = retryable;
    this.metadata = metadata;
  }
}

export class MetaGraphClient {
  constructor({
    pageAccessToken,
    instagramAccessToken,
    graphApiVersion = 'v25.0',
    messengerGraphBaseUrl = 'https://graph.facebook.com',
    instagramGraphBaseUrl = 'https://graph.instagram.com',
    requestTimeoutMs = 15_000,
    fetchImpl = globalThis.fetch,
  } = {}) {
    if (typeof fetchImpl !== 'function') throw new TypeError('MetaGraphClient requires fetch.');
    this.pageAccessToken = requiredString(pageAccessToken, 'pageAccessToken', 20_000);
    this.instagramAccessToken = requiredString(instagramAccessToken || pageAccessToken, 'instagramAccessToken', 20_000);
    this.graphApiVersion = apiVersion(graphApiVersion);
    this.messengerGraphBaseUrl = httpsBase(messengerGraphBaseUrl, 'messengerGraphBaseUrl');
    this.instagramGraphBaseUrl = httpsBase(instagramGraphBaseUrl, 'instagramGraphBaseUrl');
    this.requestTimeoutMs = Math.max(1_000, Math.min(120_000, Number(requestTimeoutMs || 15_000)));
    this.fetchImpl = fetchImpl;
  }

  endpointFor(channel, accountId) {
    const id = encodeURIComponent(requiredString(accountId, 'accountId', 500));
    if (channel === 'messenger') {
      return `${this.messengerGraphBaseUrl}/${this.graphApiVersion}/${id}/messages`;
    }
    if (channel === 'instagram_dm') {
      return `${this.instagramGraphBaseUrl}/${this.graphApiVersion}/${id}/messages`;
    }
    throw new MetaGraphClientError('Meta outbound channel is not enabled for direct messages.', {
      code: 'META_CHANNEL_UNSUPPORTED_FOR_SEND',
      outcome: 'rejected_before_acceptance',
      retryable: false,
      metadata: { channel: String(channel || '') },
    });
  }

  tokenFor(channel) {
    return channel === 'instagram_dm' ? this.instagramAccessToken : this.pageAccessToken;
  }

  payloadFor(channel, recipientId, text) {
    const payload = {
      recipient: { id: requiredString(recipientId, 'recipientId', 500) },
      message: { text: requiredString(text, 'text', 2_000) },
    };
    if (channel === 'messenger') payload.message_type = 'RESPONSE';
    return payload;
  }

  async sendText({ channel, accountId, recipientId, text }) {
    if (!SUPPORTED_CHANNELS.has(channel)) {
      return this.endpointFor(channel, accountId);
    }
    const endpoint = this.endpointFor(channel, accountId);
    const payload = this.payloadFor(channel, recipientId, text);
    let response;
    try {
      response = await this.fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.tokenFor(channel)}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(payload),
        redirect: 'error',
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch (error) {
      throw new MetaGraphClientError('Meta provider request ended without a trustworthy acceptance result.', {
        code: error?.name === 'TimeoutError' ? 'META_GRAPH_TIMEOUT' : 'META_GRAPH_NETWORK_ERROR',
        outcome: 'outcome_unknown',
        retryable: false,
        metadata: { channel },
        cause: error,
      });
    }

    const body = await responseJson(response);
    const metadata = safeProviderMetadata(response, body);
    if (!response.ok) {
      const status = Number(response.status || 0);
      const rejectedBeforeAcceptance = status >= 400 && status < 500;
      throw new MetaGraphClientError(
        rejectedBeforeAcceptance
          ? 'Meta rejected the message before a successful acceptance response.'
          : 'Meta returned a server result with ambiguous delivery outcome.',
        {
          code: rejectedBeforeAcceptance ? 'META_GRAPH_REJECTED' : 'META_GRAPH_OUTCOME_UNKNOWN',
          outcome: rejectedBeforeAcceptance ? 'rejected_before_acceptance' : 'outcome_unknown',
          retryable: status === 408 || status === 429,
          metadata,
        },
      );
    }

    const providerMessageId = body.message_id || body.messageId || null;
    if (!providerMessageId) {
      throw new MetaGraphClientError('Meta returned success without a stable provider message identifier.', {
        code: 'META_GRAPH_ACCEPTANCE_UNCONFIRMED',
        outcome: 'outcome_unknown',
        retryable: false,
        metadata,
      });
    }
    return {
      providerMessageId: requiredString(providerMessageId, 'providerMessageId', 500),
      recipientId: body.recipient_id ? String(body.recipient_id).slice(0, 500) : null,
      metadata,
    };
  }
}
