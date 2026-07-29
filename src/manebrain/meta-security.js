import crypto from 'node:crypto';

function equalUtf8(left, right) {
  const a = Buffer.from(String(left), 'utf8');
  const b = Buffer.from(String(right), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function normalizeRawBody(rawBody) {
  if (typeof rawBody === 'string') return Buffer.from(rawBody, 'utf8');
  if (Buffer.isBuffer(rawBody)) return rawBody;
  if (rawBody instanceof Uint8Array) {
    return Buffer.from(rawBody.buffer, rawBody.byteOffset, rawBody.byteLength);
  }
  throw new TypeError('Meta signature verification requires the exact raw request bytes.');
}

export function verifyMetaChallenge({ mode, token, challenge }, expectedToken) {
  if (mode !== 'subscribe' || !token || challenge === undefined || challenge === null) {
    return { ok: false, status: 400, error: 'INVALID_VERIFICATION_REQUEST' };
  }
  if (!expectedToken || !equalUtf8(token, expectedToken)) {
    return { ok: false, status: 403, error: 'VERIFICATION_FAILED' };
  }
  return { ok: true, status: 200, challenge: String(challenge) };
}

export function signMetaPayload(rawBody, appSecret) {
  return `sha256=${crypto.createHmac('sha256', String(appSecret)).update(normalizeRawBody(rawBody)).digest('hex')}`;
}

export function verifyMetaSignature(rawBody, signature, appSecret) {
  if (!appSecret || typeof signature !== 'string' || !/^sha256=[a-f0-9]{64}$/i.test(signature)) return false;
  try {
    return equalUtf8(signMetaPayload(rawBody, appSecret), signature);
  } catch {
    return false;
  }
}

export function metaReplayKey({ providerMessageId, rawEventId, providerAccountId }) {
  const material = [providerAccountId, providerMessageId || rawEventId].map((item) => String(item || '')).join('|');
  if (!providerAccountId || (!providerMessageId && !rawEventId)) {
    throw new TypeError('A Meta account and stable provider event identifier are required.');
  }
  return crypto.createHash('sha256').update(material).digest('hex');
}

export function isTimestampAcceptable(timestampMs, {
  now = Date.now(),
  maxAgeMs = 24 * 60 * 60 * 1_000,
  futureSkewMs = 5 * 60 * 1_000,
} = {}) {
  const timestamp = Number(timestampMs);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return false;
  return timestamp <= now + futureSkewMs && timestamp >= now - maxAgeMs;
}
