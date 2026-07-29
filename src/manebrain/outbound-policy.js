import crypto from 'node:crypto';
import {
  metaOperationMode,
  requirePlatformOwner,
} from './owner-authority.js';

function policyError(code, message, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

export function hashApprovedText(text) {
  if (typeof text !== 'string' || !text.trim()) {
    throw policyError('META_APPROVED_TEXT_REQUIRED', 'Approved text must be a non-empty string.', 400);
  }
  return crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

export function holdApprovedMetaReply({
  conversationId,
  draftId,
  approvedText,
  actor,
}, config = {}, {
  now = Date.now(),
} = {}) {
  const owner = requirePlatformOwner(actor, config, { requireRecentReauth: true, now });
  if (metaOperationMode(config) === 'KILL_SWITCHED') {
    throw policyError('META_KILL_SWITCHED', 'Meta processing is disabled by the emergency kill switch.', 503);
  }
  if (!conversationId || !draftId) {
    throw policyError('META_APPROVAL_REFERENCE_REQUIRED', 'Conversation and draft references are required.', 400);
  }
  return {
    conversationId: String(conversationId),
    draftId: String(draftId),
    approvedText,
    approvedTextSha256: hashApprovedText(approvedText),
    approvedBy: owner.userId,
    approvedAt: new Date(now).toISOString(),
    status: 'HELD_POLICY_REVIEW',
    attempts: 0,
  };
}

export function queueApprovedMetaReply({
  job,
  currentDraftText,
  actor,
}, config = {}, {
  now = Date.now(),
  maxAttempts = 3,
} = {}) {
  const owner = requirePlatformOwner(actor, config, { requireRecentReauth: true, now });
  const mode = metaOperationMode(config);
  if (mode !== 'OWNER_APPROVAL_REQUIRED') {
    const code = mode === 'KILL_SWITCHED' ? 'META_KILL_SWITCHED' : 'META_OUTBOUND_DISABLED';
    throw policyError(code, 'Meta outbound sending is not enabled for owner-approved operation.', 503);
  }
  if (!job || !['HELD_POLICY_REVIEW', 'SEND_FAILED'].includes(job.status)) {
    throw policyError('META_OUTBOUND_STATE_CONFLICT', 'Only held or failed owner-approved jobs may be queued.');
  }
  if (job.approvedBy !== owner.userId) {
    throw policyError('META_APPROVAL_OWNER_MISMATCH', 'Only the owner who approved this exact draft may queue it.', 403);
  }
  if (Number(job.attempts || 0) >= Math.max(1, Number(maxAttempts || 3))) {
    throw policyError('META_OUTBOUND_ATTEMPTS_EXHAUSTED', 'The outbound retry limit has been reached.');
  }
  const currentHash = hashApprovedText(currentDraftText);
  if (job.approvedText !== currentDraftText || job.approvedTextSha256 !== currentHash) {
    throw policyError(
      'META_APPROVED_CONTENT_CHANGED',
      'The draft changed after approval and must be approved again.',
    );
  }
  return {
    ...job,
    status: 'SEND_QUEUED',
    updatedAt: new Date(now).toISOString(),
  };
}
