function required(value, name, maximum = 20_000) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new TypeError(`${name} is required.`);
  if (normalized.length > maximum) throw new TypeError(`${name} exceeds ${maximum} characters.`);
  return normalized;
}

function cleanBaseUrl(value) {
  const parsed = new URL(String(value || 'https://api.openai.com/v1').replace(/\/+$/, ''));
  if (parsed.protocol !== 'https:') throw new TypeError('OPENAI_API_BASE_URL must use HTTPS.');
  return parsed.toString().replace(/\/$/, '');
}

function extractOutputText(payload) {
  const output = Array.isArray(payload?.output) ? payload.output : [];
  return output
    .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
    .filter((item) => item?.type === 'output_text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('\n')
    .trim();
}

function safeConversationTranscript(conversation) {
  const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
  return messages.slice(-30).map((message) => {
    const direction = message.direction === 'outbound' ? 'Memphis Card Company' : 'Customer';
    const body = String(message.body || '').trim().slice(0, 4_000);
    return body ? `${direction}: ${body}` : null;
  }).filter(Boolean).join('\n');
}

export class MetaDraftGenerationError extends Error {
  constructor(message, { code = 'META_DRAFT_GENERATION_FAILED', status = 503, cause } = {}) {
    super(message, { cause });
    this.name = 'MetaDraftGenerationError';
    this.code = code;
    this.status = status;
  }
}

export function metaDraftReadiness(config = {}) {
  const missing = [];
  if (!String(config.openaiApiKey || '').trim()) missing.push('OPENAI_API_KEY');
  if (!String(config.manebrainDraftModel || '').trim()) missing.push('MANEBRAIN_DRAFT_MODEL');
  return { ready: missing.length === 0, missing };
}

export async function generateMetaReplyDraft({
  config,
  conversation,
  additionalEvidence = [],
  fetchImpl = globalThis.fetch,
} = {}) {
  const readiness = metaDraftReadiness(config);
  if (!readiness.ready) {
    throw new MetaDraftGenerationError('The AI draft provider is not configured.', {
      code: 'META_DRAFT_PROVIDER_NOT_CONFIGURED',
    });
  }
  if (typeof fetchImpl !== 'function') throw new TypeError('generateMetaReplyDraft requires fetch.');
  const transcript = required(safeConversationTranscript(conversation), 'conversation transcript');
  const evidence = Array.isArray(additionalEvidence) ? additionalEvidence.slice(0, 50) : [];
  const controller = new AbortController();
  const timeoutMs = Math.max(1_000, Math.min(120_000, Number(config.manebrainDraftTimeoutMs || 20_000)));
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  let response;
  try {
    response = await fetchImpl(`${cleanBaseUrl(config.openaiApiBaseUrl)}/responses`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${required(config.openaiApiKey, 'OPENAI_API_KEY', 8_192)}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        model: required(config.manebrainDraftModel, 'MANEBRAIN_DRAFT_MODEL', 160),
        store: false,
        max_output_tokens: 350,
        input: [
          {
            role: 'developer',
            content: [{
              type: 'input_text',
              text: [
                'Draft one concise Memphis Card Company customer-service reply.',
                'Never invent a card identity, grade, certification number, availability, market value, offer, payment, shipping promise, or completed action.',
                'When evidence is insufficient, say that verification is needed.',
                'Do not commit the business to a price or transaction.',
                'Return reply text only. A human owner must review and approve it before anything can be sent.',
              ].join(' '),
            }],
          },
          {
            role: 'user',
            content: [{
              type: 'input_text',
              text: `Conversation:\n${transcript}\n\nVerified evidence JSON:\n${JSON.stringify(evidence)}`,
            }],
          },
        ],
      }),
      signal: controller.signal,
    });
  } catch (error) {
    throw new MetaDraftGenerationError(
      error?.name === 'AbortError' ? 'AI reply drafting timed out.' : 'AI reply drafting could not reach the provider.',
      { code: error?.name === 'AbortError' ? 'META_DRAFT_TIMEOUT' : 'META_DRAFT_NETWORK_FAILURE', cause: error },
    );
  } finally {
    clearTimeout(timer);
  }

  let payload = {};
  try {
    const raw = await response.text();
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = {};
  }
  if (!response.ok) {
    throw new MetaDraftGenerationError('AI reply drafting was rejected by the provider.', {
      code: 'META_DRAFT_PROVIDER_REJECTED',
      status: response.status === 429 ? 429 : 503,
    });
  }
  const body = extractOutputText(payload);
  if (!body) {
    throw new MetaDraftGenerationError('AI reply drafting returned no usable text.', {
      code: 'META_DRAFT_EMPTY_RESPONSE',
    });
  }
  return {
    body: body.slice(0, 4_000),
    source: 'openai_responses_api',
    evidence: [{ type: 'provider_response', responseId: String(payload.id || '').slice(0, 200), model: String(payload.model || config.manebrainDraftModel).slice(0, 160) }],
  };
}
