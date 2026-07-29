import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluatePlatformOwner,
  metaOperationMode,
  validateMetaAsset,
} from '../src/manebrain/owner-authority.js';
import {
  isTimestampAcceptable,
  metaReplayKey,
  signMetaPayload,
  verifyMetaChallenge,
  verifyMetaSignature,
} from '../src/manebrain/meta-security.js';
import {
  holdApprovedMetaReply,
  queueApprovedMetaReply,
} from '../src/manebrain/outbound-policy.js';
import {
  validateMetaAttachmentRedirect,
  validateMetaAttachmentUrl,
} from '../src/manebrain/attachment-policy.js';

const now = Date.parse('2026-07-28T12:00:00.000Z');
const config = {
  platformOwnerUserIds: ['user-owner-fixed-id'],
  ownerRecentReauthMinutes: 15,
  metaKillSwitch: true,
  metaOutboundEnabled: false,
  metaAppId: 'app-1',
  metaBusinessId: 'business-1',
  metaPageId: 'page-1',
  metaInstagramAccountId: 'instagram-1',
};

test('platform owner authority requires immutable allowlist, MFA, and recent reauthentication', () => {
  const base = {
    userId: 'user-owner-fixed-id',
    user: { id: 'user-owner-fixed-id', email: 'owner@example.com' },
    service: false,
    session: {},
  };
  assert.equal(evaluatePlatformOwner(base, config, { now }).reason, 'OWNER_MFA_REQUIRED');
  const mfa = { ...base, session: { mfaVerifiedAt: '2026-07-28T11:00:00.000Z' } };
  assert.equal(evaluatePlatformOwner(mfa, config, { now }).allowed, true);
  assert.equal(evaluatePlatformOwner(mfa, config, { now, requireRecentReauth: true }).reason, 'OWNER_RECENT_REAUTH_REQUIRED');
  const recent = { ...base, session: {
    mfaVerifiedAt: '2026-07-28T11:00:00.000Z',
    reauthenticatedAt: '2026-07-28T11:50:00.000Z',
  } };
  const accepted = evaluatePlatformOwner(recent, config, { now, requireRecentReauth: true });
  assert.equal(accepted.allowed, true);
  assert.equal(accepted.actor.role, 'platform_owner');
});

test('email, role, service tokens, and client-shaped identities cannot create owner authority', () => {
  const session = {
    mfaVerifiedAt: '2026-07-28T11:00:00.000Z',
    reauthenticatedAt: '2026-07-28T11:50:00.000Z',
  };
  assert.equal(evaluatePlatformOwner({
    userId: 'different-user',
    user: { email: 'owner@example.com', role: 'platform_owner' },
    session,
  }, config, { now }).reason, 'OWNER_NOT_ALLOWLISTED');
  assert.equal(evaluatePlatformOwner({
    userId: 'user-owner-fixed-id',
    user: { id: 'user-owner-fixed-id' },
    service: true,
    session,
  }, config, { now }).reason, 'OWNER_SESSION_REQUIRED');
});

test('Meta signatures, challenge verification, replay keys, and timestamp windows fail closed', () => {
  const body = JSON.stringify({ object: 'page', entry: [] });
  const rawBody = Buffer.from(body, 'utf8');
  const signature = signMetaPayload(rawBody, 'app-secret');
  assert.equal(verifyMetaSignature(body, signature, 'app-secret'), true);
  assert.equal(verifyMetaSignature(rawBody, signature, 'app-secret'), true);
  assert.equal(verifyMetaSignature(new Uint8Array(rawBody), signature, 'app-secret'), true);
  assert.equal(verifyMetaSignature(`${body} `, signature, 'app-secret'), false);
  assert.equal(verifyMetaSignature(JSON.parse(body), signature, 'app-secret'), false);
  assert.equal(verifyMetaSignature(rawBody, `sha1=${signature.slice(7)}`, 'app-secret'), false);
  assert.equal(verifyMetaSignature(rawBody, 'sha256=not-a-digest', 'app-secret'), false);
  assert.equal(verifyMetaChallenge({
    mode: 'subscribe',
    token: 'verify-token',
    challenge: '123',
  }, 'verify-token').challenge, '123');
  assert.equal(verifyMetaChallenge({
    mode: 'subscribe',
    token: 'wrong',
    challenge: '123',
  }, 'verify-token').status, 403);
  assert.equal(metaReplayKey({
    providerMessageId: 'message-1',
    providerAccountId: 'page-1',
  }), metaReplayKey({
    providerMessageId: 'message-1',
    providerAccountId: 'page-1',
  }));
  assert.equal(isTimestampAcceptable(now - 1_000, { now }), true);
  assert.equal(isTimestampAcceptable(now - 25 * 60 * 60 * 1_000, { now }), false);
});

test('Meta asset allowlist separates Facebook and Instagram and kill switch wins', () => {
  assert.equal(validateMetaAsset({
    channel: 'messenger',
    providerAccountId: 'page-1',
    appId: 'app-1',
    businessId: 'business-1',
  }, config).allowed, true);
  assert.equal(validateMetaAsset({
    channel: 'instagram_dm',
    providerAccountId: 'instagram-1',
    appId: 'app-1',
    businessId: 'business-1',
  }, config).allowed, true);
  assert.equal(validateMetaAsset({
    channel: 'instagram_dm',
    providerAccountId: 'page-1',
    appId: 'app-1',
    businessId: 'business-1',
  }, config).reason, 'META_ASSET_NOT_ALLOWLISTED');
  assert.equal(metaOperationMode(config), 'KILL_SWITCHED');
  assert.equal(metaOperationMode({ ...config, metaKillSwitch: false }), 'DRAFT_ONLY');
  assert.equal(metaOperationMode({ ...config, metaKillSwitch: false, metaOutboundEnabled: true }), 'OWNER_APPROVAL_REQUIRED');
});

test('owner-approved Meta replies stay held until outbound is explicitly enabled', () => {
  const actor = {
    userId: 'user-owner-fixed-id',
    user: { id: 'user-owner-fixed-id' },
    session: {
      mfaVerifiedAt: '2026-07-28T11:00:00.000Z',
      reauthenticatedAt: '2026-07-28T11:50:00.000Z',
    },
  };
  assert.throws(() => holdApprovedMetaReply({
    conversationId: 'conversation-1',
    draftId: 'draft-1',
    approvedText: 'Thanks. I will review these cards.',
    actor,
  }, config, { now }), { code: 'META_KILL_SWITCHED' });

  const held = holdApprovedMetaReply({
    conversationId: 'conversation-1',
    draftId: 'draft-1',
    approvedText: 'Thanks. I will review these cards.',
    actor,
  }, { ...config, metaKillSwitch: false }, { now });
  assert.equal(held.status, 'HELD_POLICY_REVIEW');
  assert.equal(held.approvedBy, actor.userId);
  assert.throws(() => queueApprovedMetaReply({
    job: held,
    currentDraftText: held.approvedText,
    actor,
  }, { ...config, metaKillSwitch: false }, { now }), { code: 'META_OUTBOUND_DISABLED' });

  const queued = queueApprovedMetaReply({
    job: held,
    currentDraftText: held.approvedText,
    actor,
  }, {
    ...config,
    metaKillSwitch: false,
    metaOutboundEnabled: true,
  }, { now });
  assert.equal(queued.status, 'SEND_QUEUED');
});

test('Meta send queue rejects draft drift, replayed transitions, and non-owner actors', () => {
  const owner = {
    userId: 'user-owner-fixed-id',
    user: { id: 'user-owner-fixed-id' },
    session: {
      mfaVerifiedAt: '2026-07-28T11:00:00.000Z',
      reauthenticatedAt: '2026-07-28T11:50:00.000Z',
    },
  };
  const enabled = {
    ...config,
    metaKillSwitch: false,
    metaOutboundEnabled: true,
  };
  const held = holdApprovedMetaReply({
    conversationId: 'conversation-1',
    draftId: 'draft-1',
    approvedText: 'Approved exact text.',
    actor: owner,
  }, enabled, { now });
  assert.throws(() => queueApprovedMetaReply({
    job: held,
    currentDraftText: 'Changed after approval.',
    actor: owner,
  }, enabled, { now }), { code: 'META_APPROVED_CONTENT_CHANGED' });
  assert.throws(() => queueApprovedMetaReply({
    job: held,
    currentDraftText: held.approvedText,
    actor: {
      ...owner,
      userId: 'ordinary-user',
      user: { id: 'ordinary-user' },
    },
  }, enabled, { now }), { code: 'OWNER_NOT_ALLOWLISTED' });
  assert.throws(() => queueApprovedMetaReply({
    job: {
      ...held,
      approvedBy: 'different-platform-owner',
    },
    currentDraftText: held.approvedText,
    actor: owner,
  }, enabled, { now }), { code: 'META_APPROVAL_OWNER_MISMATCH' });
  const queued = queueApprovedMetaReply({
    job: held,
    currentDraftText: held.approvedText,
    actor: owner,
  }, enabled, { now });
  assert.throws(() => queueApprovedMetaReply({
    job: queued,
    currentDraftText: held.approvedText,
    actor: owner,
  }, enabled, { now }), { code: 'META_OUTBOUND_STATE_CONFLICT' });
});

test('Meta attachment URLs require HTTPS and an exact configured provider host on every hop', () => {
  const hosts = ['lookaside.example-meta-cdn.test'];
  const accepted = validateMetaAttachmentUrl(
    'https://lookaside.example-meta-cdn.test/card.jpg?token=opaque',
    hosts,
  );
  assert.equal(accepted.allowed, true);
  assert.equal(accepted.hostname, hosts[0]);
  for (const unsafe of [
    'http://lookaside.example-meta-cdn.test/card.jpg',
    'https://lookaside.example-meta-cdn.test:8443/card.jpg',
    'https://user:pass@lookaside.example-meta-cdn.test/card.jpg',
    'https://127.0.0.1/card.jpg',
    'https://169.254.169.254/latest/meta-data/',
    'https://localhost/card.jpg',
    'https://evil-lookaside.example-meta-cdn.test/card.jpg',
    'https://lookaside.example-meta-cdn.test/card.jpg#fragment',
  ]) {
    assert.equal(validateMetaAttachmentUrl(unsafe, hosts).allowed, false, unsafe);
  }
  assert.equal(validateMetaAttachmentRedirect('https://unapproved.example/card.jpg', hosts).allowed, false);
});
