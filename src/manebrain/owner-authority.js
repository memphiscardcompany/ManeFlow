function timestamp(value) {
  const result = Date.parse(String(value || ''));
  return Number.isFinite(result) ? result : null;
}

export function evaluatePlatformOwner(actor, config = {}, {
  requireRecentReauth = false,
  now = Date.now(),
} = {}) {
  if (!actor?.userId || !actor.user || actor.service) {
    return { allowed: false, reason: 'OWNER_SESSION_REQUIRED' };
  }
  const allowlist = new Set((config.platformOwnerUserIds || []).map(String));
  if (!allowlist.size || !allowlist.has(String(actor.userId))) {
    return { allowed: false, reason: 'OWNER_NOT_ALLOWLISTED' };
  }
  const mfaVerifiedAt = timestamp(actor.session?.mfaVerifiedAt);
  if (!mfaVerifiedAt) {
    return { allowed: false, reason: 'OWNER_MFA_REQUIRED' };
  }
  if (requireRecentReauth) {
    const reauthenticatedAt = timestamp(actor.session?.reauthenticatedAt);
    const maximumAgeMs = Math.max(1, Number(config.ownerRecentReauthMinutes || 15)) * 60_000;
    if (!reauthenticatedAt || now - reauthenticatedAt > maximumAgeMs || reauthenticatedAt > now + 60_000) {
      return { allowed: false, reason: 'OWNER_RECENT_REAUTH_REQUIRED' };
    }
  }
  return {
    allowed: true,
    actor: {
      id: actor.userId,
      userId: actor.userId,
      role: 'platform_owner',
      mfaVerifiedAt: new Date(mfaVerifiedAt).toISOString(),
    },
  };
}

export function requirePlatformOwner(actor, config, options) {
  const result = evaluatePlatformOwner(actor, config, options);
  if (!result.allowed) {
    const error = new Error('Platform owner authorization is required.');
    error.code = result.reason;
    error.status = 403;
    throw error;
  }
  return result.actor;
}

export function validateMetaAsset(event, config = {}) {
  const expected = {
    appId: String(config.metaAppId || ''),
    businessId: String(config.metaBusinessId || ''),
    pageId: String(config.metaPageId || ''),
    instagramAccountId: String(config.metaInstagramAccountId || ''),
  };
  if (!expected.appId || !expected.businessId || !expected.pageId || !expected.instagramAccountId) {
    return { allowed: false, reason: 'META_ASSET_ALLOWLIST_INCOMPLETE' };
  }
  const providerAccountId = String(event?.providerAccountId || '');
  const channel = String(event?.channel || '');
  const accountAllowed = channel.startsWith('instagram')
    ? providerAccountId === expected.instagramAccountId
    : providerAccountId === expected.pageId;
  if (!accountAllowed) return { allowed: false, reason: 'META_ASSET_NOT_ALLOWLISTED' };
  if (event?.appId && String(event.appId) !== expected.appId) {
    return { allowed: false, reason: 'META_APP_NOT_ALLOWLISTED' };
  }
  if (event?.businessId && String(event.businessId) !== expected.businessId) {
    return { allowed: false, reason: 'META_BUSINESS_NOT_ALLOWLISTED' };
  }
  return { allowed: true };
}

export function metaOperationMode(config = {}) {
  if (config.metaKillSwitch !== false) return 'KILL_SWITCHED';
  if (config.metaOutboundEnabled !== true) return 'DRAFT_ONLY';
  return 'OWNER_APPROVAL_REQUIRED';
}
