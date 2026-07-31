const CHANNELS = new Set([
  'messenger',
  'instagram_dm',
  'facebook_comment',
  'instagram_comment',
]);
const DIRECTIONS = new Set(['inbound', 'outbound']);

function text(value, maximumLength) {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, maximumLength) : null;
}

function timestamp(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const date = new Date(numeric < 10_000_000_000 ? numeric * 1_000 : numeric);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function attachment(value) {
  const payload = value?.payload || {};
  const type = text(value?.type, 32);
  const mappedType = type === 'file' ? 'document' : type;
  return {
    type: ['image', 'video', 'audio', 'document'].includes(mappedType) ? mappedType : 'unknown',
    providerAttachmentId: text(value?.id || payload.attachment_id || payload.sticker_id, 500),
    url: text(payload.url, 4_096),
    mimeType: text(payload.mime_type || value?.mime_type, 160),
  };
}

function normalizeMessage(body, entry, item) {
  const message = item?.message;
  if (!message) return { ignored: 'NON_MESSAGE_EVENT' };
  const providerMessageId = text(message.mid, 500);
  const providerAccountId = text(entry?.id || item?.recipient?.id, 500);
  const isEcho = message.is_echo === true;
  const providerSenderId = text(isEcho ? item?.recipient?.id : item?.sender?.id, 500);
  const receivedAt = timestamp(item?.timestamp || entry?.time);
  if (!providerMessageId || !providerAccountId || !providerSenderId || !receivedAt) {
    return { ignored: 'UNSTABLE_MESSAGE_IDENTITY' };
  }
  const channel = body.object === 'instagram' ? 'instagram_dm' : 'messenger';
  return {
    event: {
      provider: 'meta',
      channel,
      direction: isEcho ? 'outbound' : 'inbound',
      isEcho,
      providerAccountId,
      providerEventId: providerMessageId,
      providerMessageId,
      providerConversationId: `${channel}:${providerAccountId}:${providerSenderId}`,
      providerSenderId,
      body: text(message.text, 4_000),
      attachments: Array.isArray(message.attachments) ? message.attachments.map(attachment) : [],
      receivedAt,
      replyToProviderMessageId: text(message.reply_to?.mid, 500),
    },
  };
}

function normalizeComment(body, entry, change) {
  const value = change?.value || {};
  const supported = change?.field === 'comments' || value.item === 'comment';
  if (!supported || value.verb === 'remove') return { ignored: 'NON_COMMENT_CHANGE' };
  const providerMessageId = text(value.comment_id || value.id, 500);
  const providerAccountId = text(entry?.id, 500);
  const providerSenderId = text(value.from?.id || value.sender_id, 500);
  const receivedAt = timestamp(
    value.created_time ? Date.parse(value.created_time) : entry?.time,
  );
  if (!providerMessageId || !providerAccountId || !providerSenderId || !receivedAt) {
    return { ignored: 'UNSTABLE_COMMENT_IDENTITY' };
  }
  const channel = body.object === 'instagram' ? 'instagram_comment' : 'facebook_comment';
  const threadId = text(value.post_id || value.media_id, 500) || providerMessageId;
  return {
    event: {
      provider: 'meta',
      channel,
      direction: 'inbound',
      isEcho: false,
      providerAccountId,
      providerEventId: providerMessageId,
      providerMessageId,
      providerConversationId: `${channel}:${providerAccountId}:${threadId}:${providerSenderId}`,
      providerSenderId,
      body: text(value.message, 4_000),
      attachments: [],
      receivedAt,
      providerPostId: threadId,
    },
  };
}

function assertEvent(event) {
  if (!CHANNELS.has(event.channel)) throw new TypeError('Unsupported normalized Meta channel.');
  if (!DIRECTIONS.has(event.direction)) throw new TypeError('Unsupported normalized Meta direction.');
  for (const field of [
    'providerAccountId',
    'providerEventId',
    'providerMessageId',
    'providerConversationId',
    'providerSenderId',
    'receivedAt',
  ]) {
    if (!event[field]) throw new TypeError(`Normalized Meta event is missing ${field}.`);
  }
  return Object.freeze({
    ...event,
    isEcho: event.isEcho === true,
    attachments: Object.freeze(event.attachments.map((item) => Object.freeze(item))),
  });
}

export function normalizeMetaWebhook(payload, {
  maximumEntries = 1_000,
  maximumEvents = 5_000,
} = {}) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.entry)) {
    throw new TypeError('Malformed Meta webhook payload.');
  }
  if (!['page', 'instagram'].includes(payload.object)) {
    return { events: [], ignored: [{ reason: 'UNSUPPORTED_META_OBJECT' }] };
  }
  if (payload.entry.length > maximumEntries) throw new RangeError('Meta webhook entry limit exceeded.');
  const events = [];
  const ignored = [];
  for (const entry of payload.entry) {
    for (const item of Array.isArray(entry?.messaging) ? entry.messaging : []) {
      const normalized = normalizeMessage(payload, entry, item);
      if (normalized.event) events.push(assertEvent(normalized.event));
      else ignored.push({ reason: normalized.ignored });
      if (events.length > maximumEvents) throw new RangeError('Meta webhook event limit exceeded.');
    }
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const normalized = normalizeComment(payload, entry, change);
      if (normalized.event) events.push(assertEvent(normalized.event));
      else ignored.push({ reason: normalized.ignored });
      if (events.length > maximumEvents) throw new RangeError('Meta webhook event limit exceeded.');
    }
  }
  return { events, ignored };
}
