import crypto from 'node:crypto';

const VERSION = 1;
const DEFAULT_TTL_MS = 10 * 60_000;

export class EbayOAuthStateError extends Error {
  constructor(message, code = 'EBAY_OAUTH_STATE_INVALID') {
    super(message);
    this.name = 'EbayOAuthStateError';
    this.code = code;
  }
}

function requiredSecret(secret) {
  const value = String(secret || '').trim();
  if (value.length < 32) {
    throw new EbayOAuthStateError(
      'EBAY_OAUTH_STATE_SECRET must contain at least 32 characters.',
      'EBAY_OAUTH_STATE_SECRET_INVALID',
    );
  }
  return value;
}

function encode(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decode(value) {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch (error) {
    throw new EbayOAuthStateError('eBay OAuth state payload is malformed.');
  }
}

function signature(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function equalSignature(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function stateRecords(storeState) {
  if (!Array.isArray(storeState.oauthStateNonces)) storeState.oauthStateNonces = [];
  return storeState.oauthStateNonces;
}

export function purgeExpiredEbayOAuthStates(storeState, now = Date.now()) {
  const records = stateRecords(storeState);
  storeState.oauthStateNonces = records.filter((entry) => {
    const expiresAt = Number(entry.expiresAt || 0);
    const consumedAt = entry.consumedAt ? Date.parse(entry.consumedAt) : 0;
    return expiresAt > now - 60_000 && (!consumedAt || consumedAt > now - 24 * 60 * 60_000);
  });
  return storeState.oauthStateNonces;
}

export function issueEbayOAuthState({ storeState, secret, actorId, ttlMs = DEFAULT_TTL_MS, now = Date.now() }) {
  const normalizedSecret = requiredSecret(secret);
  const normalizedActorId = String(actorId || '').trim();
  if (!normalizedActorId) throw new EbayOAuthStateError('An authenticated actor is required.');
  const ttl = Math.max(60_000, Math.min(30 * 60_000, Number(ttlMs) || DEFAULT_TTL_MS));
  purgeExpiredEbayOAuthStates(storeState, now);

  const payload = {
    v: VERSION,
    nonce: crypto.randomBytes(24).toString('base64url'),
    actorId: normalizedActorId,
    issuedAt: now,
    expiresAt: now + ttl,
  };
  const encoded = encode(payload);
  const state = `${encoded}.${signature(encoded, normalizedSecret)}`;
  stateRecords(storeState).push({
    nonce: payload.nonce,
    actorId: payload.actorId,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
    consumedAt: null,
  });
  return { state, expiresAt: new Date(payload.expiresAt).toISOString() };
}

export function consumeEbayOAuthState({ storeState, secret, actorId, state, now = Date.now() }) {
  const normalizedSecret = requiredSecret(secret);
  const parts = String(state || '').split('.');
  if (parts.length !== 2) throw new EbayOAuthStateError('eBay OAuth state is missing or malformed.');
  const [encoded, suppliedSignature] = parts;
  const expectedSignature = signature(encoded, normalizedSecret);
  if (!equalSignature(suppliedSignature, expectedSignature)) {
    throw new EbayOAuthStateError('eBay OAuth state signature is invalid.');
  }

  const payload = decode(encoded);
  if (payload.v !== VERSION || typeof payload.nonce !== 'string') {
    throw new EbayOAuthStateError('eBay OAuth state version is unsupported.');
  }
  if (String(payload.actorId) !== String(actorId || '')) {
    throw new EbayOAuthStateError('eBay OAuth state does not belong to this administrator.');
  }
  if (!Number.isFinite(payload.expiresAt) || payload.expiresAt <= now) {
    throw new EbayOAuthStateError('eBay OAuth state has expired.', 'EBAY_OAUTH_STATE_EXPIRED');
  }

  purgeExpiredEbayOAuthStates(storeState, now);
  const record = stateRecords(storeState).find(
    (entry) => entry.nonce === payload.nonce && entry.actorId === payload.actorId,
  );
  if (!record) throw new EbayOAuthStateError('eBay OAuth state was not issued by this ManeFlow instance.');
  if (record.consumedAt) throw new EbayOAuthStateError('eBay OAuth state has already been used.', 'EBAY_OAUTH_STATE_REPLAYED');
  record.consumedAt = new Date(now).toISOString();
  return payload;
}
