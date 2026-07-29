import {
  csrfTokenForSession,
  hashSessionToken,
  requestCredential,
  verifyPassword,
} from './services/auth.js';
import { RateLimiter } from './services/rate-limit.js';
import {
  consumeRecoveryCode,
  decryptOwnerSecret,
  encryptOwnerSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  ownerMfaKey,
  ownerTotpUri,
  verifyTotp,
} from './services/owner-mfa.js';
import {
  forbidden,
  json,
  readJson,
  timingSafeEqualString,
  unauthorized,
} from './services/utils.js';

function originAllowed(req, config) {
  const origin = String(req.headers.origin || '');
  if (!origin) return true;
  try {
    const own = new URL(config.publicBaseUrl).origin;
    return origin === own || (config.allowedOrigins || []).includes(origin);
  } catch {
    return false;
  }
}

function sessionActor(req, config, store) {
  const credential = requestCredential(req);
  const token = credential.token;
  if (!token) return null;
  if (
    (config.serviceToken && timingSafeEqualString(token, config.serviceToken))
    || (config.apiToken && timingSafeEqualString(token, config.apiToken))
    || (config.adminToken && timingSafeEqualString(token, config.adminToken))
  ) return null;
  const tokenHash = hashSessionToken(token);
  const session = store.findSession(tokenHash);
  if (!session) return null;
  const user = store.findUserById(session.userId);
  if (!user || user.disabledAt) return null;
  if (config.requireEmailVerification && !user.emailVerifiedAt) return null;
  return {
    userId: user.id,
    user,
    session,
    tokenHash,
    authSource: credential.source,
    csrfToken: csrfTokenForSession(token),
  };
}

function ownerAllowlisted(actor, config) {
  return Boolean(
    actor?.userId
    && Array.isArray(config.platformOwnerUserIds)
    && config.platformOwnerUserIds.length === 1
    && String(config.platformOwnerUserIds[0]) === String(actor.userId),
  );
}

function mutationAllowed(req, config, actor) {
  if (!originAllowed(req, config)) return { allowed: false, message: 'Request origin is not allowed.' };
  if (config.csrfProtection && actor.authSource === 'cookie') {
    const supplied = String(req.headers['x-maneflow-csrf'] || '');
    if (!actor.csrfToken || !timingSafeEqualString(supplied, actor.csrfToken)) {
      return { allowed: false, message: 'A valid CSRF token is required.' };
    }
  }
  return { allowed: true };
}

function timestamp(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function publicStatus(actor, config) {
  const enrolled = Boolean(actor.user.ownerMfa?.enabledAt && actor.user.ownerMfa?.secretCiphertext);
  const mfaVerifiedAt = timestamp(actor.session.mfaVerifiedAt);
  const reauthenticatedAt = timestamp(actor.session.reauthenticatedAt);
  const maximumAgeMs = Math.max(1, Number(config.ownerRecentReauthMinutes || 15)) * 60_000;
  const recentReauthentication = Boolean(
    reauthenticatedAt
    && Date.now() - reauthenticatedAt <= maximumAgeMs
    && reauthenticatedAt <= Date.now() + 60_000,
  );
  return {
    allowlisted: true,
    enrolled,
    recoveryCodesRemaining: Array.isArray(actor.user.ownerMfa?.backupCodeHashes)
      ? actor.user.ownerMfa.backupCodeHashes.length
      : 0,
    mfaVerifiedAt: mfaVerifiedAt ? new Date(mfaVerifiedAt).toISOString() : null,
    reauthenticatedAt: reauthenticatedAt ? new Date(reauthenticatedAt).toISOString() : null,
    recentReauthentication,
    recentReauthenticationMinutes: Number(config.ownerRecentReauthMinutes || 15),
  };
}

async function verifyOwnerPassword(actor, password) {
  if (!actor.user.passwordHash || !actor.user.passwordSalt) return false;
  return verifyPassword(password, actor.user.passwordSalt, actor.user.passwordHash);
}

function verifySecondFactor(actor, code, config) {
  const mfa = actor.user.ownerMfa;
  if (!mfa?.secretCiphertext) return { valid: false, method: null };
  const normalized = String(code || '').trim();
  if (/^\d{6}$/.test(normalized.replace(/\s+/g, ''))) {
    const secret = decryptOwnerSecret(mfa.secretCiphertext, config.ownerMfaEncryptionKey);
    const result = verifyTotp(secret, normalized, { afterStep: Number(mfa.lastUsedStep ?? -1) });
    return { valid: result.valid, method: result.valid ? 'totp' : null, step: result.step };
  }
  const recovery = consumeRecoveryCode(normalized, mfa.backupCodeHashes, config.ownerMfaEncryptionKey);
  return {
    valid: recovery.valid,
    method: recovery.valid ? 'recovery_code' : null,
    remainingHashes: recovery.remainingHashes,
  };
}

async function persist(store) {
  if (typeof store.persist !== 'function') throw new Error('The canonical account store cannot persist owner security state.');
  await store.persist();
}

async function audit(store, actor, eventType, event = {}) {
  if (typeof store.audit !== 'function') return;
  await store.audit({
    type: eventType,
    userId: actor.userId,
    actorUserId: actor.userId,
    sessionId: actor.session.id || null,
    ...event,
  });
}

function routeError(res, error) {
  const message = error instanceof Error ? error.message : String(error);
  const status = Number(error?.status || (/password|code|expired|enroll/i.test(message) ? 400 : 500));
  return json(res, status, {
    error: error?.code || 'OWNER_SECURITY_OPERATION_FAILED',
    message,
  }, { 'cache-control': 'no-store' });
}

export function createOwnerSecurityRouter({ config, store } = {}) {
  const limiter = new RateLimiter({ windowMs: 15 * 60_000, max: 20 });

  return async function handleOwnerSecurityRoute(req, res) {
    let url;
    try {
      url = new URL(req.url || '/', config.publicBaseUrl);
    } catch {
      return false;
    }
    if (!url.pathname.startsWith('/api/auth/owner/')) return false;
    res.setHeader('cache-control', 'no-store');
    const method = String(req.method || 'GET').toUpperCase();
    const actor = sessionActor(req, config, store);
    if (!actor) {
      unauthorized(res);
      return true;
    }
    if (!ownerAllowlisted(actor, config)) {
      forbidden(res, 'Platform owner authorization is required.');
      return true;
    }

    if (method !== 'GET') {
      const security = mutationAllowed(req, config, actor);
      if (!security.allowed) {
        forbidden(res, security.message);
        return true;
      }
      const rate = limiter.check(`owner-security:${actor.userId}`);
      if (!rate.allowed) {
        json(res, 429, { error: 'OWNER_SECURITY_RATE_LIMITED', message: 'Too many owner security attempts.' });
        return true;
      }
    }

    try {
      if (url.pathname === '/api/auth/owner/security-status' && method === 'GET') {
        json(res, 200, publicStatus(actor, config));
        return true;
      }

      if (url.pathname === '/api/auth/owner/mfa/enroll' && method === 'POST') {
        ownerMfaKey(config.ownerMfaEncryptionKey);
        const body = await readJson(req, 20_000);
        if (!await verifyOwnerPassword(actor, body.password)) {
          const error = new Error('Current password is incorrect.');
          error.code = 'OWNER_PASSWORD_INVALID';
          throw error;
        }
        const secret = generateTotpSecret();
        const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
        actor.user.ownerMfaEnrollment = {
          secretCiphertext: encryptOwnerSecret(secret, config.ownerMfaEncryptionKey),
          expiresAt,
          createdAt: new Date().toISOString(),
        };
        await persist(store);
        await audit(store, actor, 'owner_mfa_enrollment_started');
        json(res, 201, {
          secret,
          otpauthUri: ownerTotpUri({
            secret,
            accountName: actor.user.email,
            issuer: config.ownerMfaIssuer || 'ManeFlow',
          }),
          expiresAt,
          message: 'Add this secret to an authenticator, then confirm one current six-digit code.',
        });
        return true;
      }

      if (url.pathname === '/api/auth/owner/mfa/confirm' && method === 'POST') {
        ownerMfaKey(config.ownerMfaEncryptionKey);
        const body = await readJson(req, 20_000);
        const enrollment = actor.user.ownerMfaEnrollment;
        if (!enrollment?.secretCiphertext || Date.parse(enrollment.expiresAt) <= Date.now()) {
          delete actor.user.ownerMfaEnrollment;
          await persist(store);
          const error = new Error('MFA enrollment is missing or expired. Start enrollment again.');
          error.code = 'OWNER_MFA_ENROLLMENT_EXPIRED';
          throw error;
        }
        const secret = decryptOwnerSecret(enrollment.secretCiphertext, config.ownerMfaEncryptionKey);
        const verification = verifyTotp(secret, body.code, { afterStep: -1 });
        if (!verification.valid) {
          const error = new Error('Authenticator code is invalid.');
          error.code = 'OWNER_MFA_CODE_INVALID';
          throw error;
        }
        const recovery = generateRecoveryCodes(config.ownerMfaEncryptionKey, 10);
        const now = new Date().toISOString();
        actor.user.ownerMfa = {
          enabledAt: now,
          secretCiphertext: enrollment.secretCiphertext,
          backupCodeHashes: recovery.hashes,
          lastUsedStep: verification.step,
          lastVerifiedAt: now,
        };
        delete actor.user.ownerMfaEnrollment;
        actor.session.mfaVerifiedAt = now;
        actor.session.reauthenticatedAt = now;
        await persist(store);
        await audit(store, actor, 'owner_mfa_enabled', { recoveryCodeCount: recovery.codes.length });
        json(res, 200, {
          status: publicStatus(actor, config),
          recoveryCodes: recovery.codes,
          message: 'MFA enabled. Store the recovery codes offline; they will not be shown again.',
        });
        return true;
      }

      if (url.pathname === '/api/auth/owner/reauthenticate' && method === 'POST') {
        ownerMfaKey(config.ownerMfaEncryptionKey);
        const body = await readJson(req, 20_000);
        if (!actor.user.ownerMfa?.enabledAt) {
          const error = new Error('Owner MFA enrollment is required.');
          error.code = 'OWNER_MFA_REQUIRED';
          throw error;
        }
        if (!await verifyOwnerPassword(actor, body.password)) {
          const error = new Error('Current password is incorrect.');
          error.code = 'OWNER_PASSWORD_INVALID';
          throw error;
        }
        const verification = verifySecondFactor(actor, body.code, config);
        if (!verification.valid) {
          const error = new Error('Authenticator or recovery code is invalid.');
          error.code = 'OWNER_MFA_CODE_INVALID';
          throw error;
        }
        const now = new Date().toISOString();
        if (verification.method === 'totp') actor.user.ownerMfa.lastUsedStep = verification.step;
        if (verification.method === 'recovery_code') actor.user.ownerMfa.backupCodeHashes = verification.remainingHashes;
        actor.user.ownerMfa.lastVerifiedAt = now;
        actor.session.mfaVerifiedAt = now;
        actor.session.reauthenticatedAt = now;
        await persist(store);
        await audit(store, actor, 'owner_recent_reauthentication', { method: verification.method });
        json(res, 200, {
          status: publicStatus(actor, config),
          recoveryCodeUsed: verification.method === 'recovery_code',
        });
        return true;
      }

      if (url.pathname === '/api/auth/owner/recovery-codes/regenerate' && method === 'POST') {
        ownerMfaKey(config.ownerMfaEncryptionKey);
        const body = await readJson(req, 20_000);
        const status = publicStatus(actor, config);
        if (!status.recentReauthentication) {
          const error = new Error('Recent owner reauthentication is required.');
          error.code = 'OWNER_RECENT_REAUTH_REQUIRED';
          error.status = 403;
          throw error;
        }
        if (!await verifyOwnerPassword(actor, body.password)) {
          const error = new Error('Current password is incorrect.');
          error.code = 'OWNER_PASSWORD_INVALID';
          throw error;
        }
        const verification = verifySecondFactor(actor, body.code, config);
        if (!verification.valid) {
          const error = new Error('Authenticator or recovery code is invalid.');
          error.code = 'OWNER_MFA_CODE_INVALID';
          throw error;
        }
        const recovery = generateRecoveryCodes(config.ownerMfaEncryptionKey, 10);
        const now = new Date().toISOString();
        actor.user.ownerMfa.backupCodeHashes = recovery.hashes;
        actor.user.ownerMfa.lastVerifiedAt = now;
        if (verification.method === 'totp') actor.user.ownerMfa.lastUsedStep = verification.step;
        actor.session.mfaVerifiedAt = now;
        actor.session.reauthenticatedAt = now;
        await persist(store);
        await audit(store, actor, 'owner_recovery_codes_regenerated', { recoveryCodeCount: recovery.codes.length });
        json(res, 200, {
          recoveryCodes: recovery.codes,
          status: publicStatus(actor, config),
          message: 'Previous recovery codes are invalid. Store these new codes offline.',
        });
        return true;
      }

      json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
      return true;
    } catch (error) {
      routeError(res, error);
      return true;
    }
  };
}
