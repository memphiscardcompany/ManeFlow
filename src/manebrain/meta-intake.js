import crypto from 'node:crypto';
import { isTimestampAcceptable, verifyMetaSignature } from './meta-security.js';
import { normalizeMetaWebhook } from './meta-normalizer.js';
import { validateMetaAsset } from './owner-authority.js';

function payloadSha256(rawBody) {
  return crypto.createHash('sha256').update(rawBody).digest('hex');
}

function rawBuffer(rawBody) {
  if (Buffer.isBuffer(rawBody)) return rawBody;
  if (rawBody instanceof Uint8Array) return Buffer.from(
    rawBody.buffer,
    rawBody.byteOffset,
    rawBody.byteLength,
  );
  throw new TypeError('Meta intake requires the exact raw request bytes.');
}

export async function ingestMetaWebhook({
  rawBody,
  signature,
  config,
  repository,
  ownerUserId,
  now = Date.now(),
}) {
  if (config.metaIntakeEnabled !== true || config.metaKillSwitch !== false) {
    return { status: 503, body: { error: 'META_INTAKE_DISABLED' } };
  }
  if (!repository || typeof repository.ingestBatch !== 'function') {
    return { status: 503, body: { error: 'META_INBOX_NOT_READY' } };
  }
  const bytes = rawBuffer(rawBody);
  if (!bytes.length || bytes.length > Math.min(config.maxRequestBytes || 1_000_000, 1_000_000)) {
    return { status: 413, body: { error: 'META_WEBHOOK_SIZE_INVALID' } };
  }
  if (!verifyMetaSignature(bytes, String(signature || ''), config.metaAppSecret)) {
    return { status: 401, body: { error: 'META_SIGNATURE_INVALID' } };
  }
  let payload;
  try {
    payload = JSON.parse(bytes.toString('utf8'));
  } catch {
    return { status: 400, body: { error: 'META_WEBHOOK_JSON_INVALID' } };
  }
  let normalized;
  try {
    normalized = normalizeMetaWebhook(payload);
  } catch (error) {
    return {
      status: 400,
      body: {
        error: 'META_WEBHOOK_UNSUPPORTED',
        reason: error instanceof RangeError ? 'LIMIT_EXCEEDED' : 'MALFORMED_EVENT',
      },
    };
  }
  const acceptedEvents = [];
  let rejected = normalized.ignored.length;
  for (const event of normalized.events) {
    const asset = validateMetaAsset(event, config);
    if (!asset.allowed || !isTimestampAcceptable(Date.parse(event.receivedAt), { now })) {
      rejected += 1;
      continue;
    }
    acceptedEvents.push(event);
  }
  if (!acceptedEvents.length) {
    return {
      status: 202,
      body: {
        accepted: 0,
        duplicates: 0,
        rejected,
      },
    };
  }
  const result = await repository.ingestBatch(ownerUserId, {
    events: acceptedEvents,
    payloadSha256: payloadSha256(bytes),
  });
  const echoes = acceptedEvents.filter((event) => event.isEcho === true);
  if (echoes.length && typeof repository.reconcileEchoes === 'function') {
    await repository.reconcileEchoes(ownerUserId, echoes);
  }
  return {
    status: 202,
    body: {
      accepted: result.accepted.length,
      duplicates: result.duplicates.length,
      rejected,
    },
  };
}
