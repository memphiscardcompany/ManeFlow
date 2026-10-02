import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { timingSafeEqualString } from './utils.js';

const scrypt = promisify(crypto.scrypt);
const LEGACY_COOKIE_NAME = 'mf_session';
const HOST_COOKIE_NAME = '__Host-mf_session';

export const PASSWORD_SCRYPT_PARAMS = Object.freeze({ N: 2 ** 15, r: 8, p: 1, keylen: 64 });
const LEGACY_SCRYPT_PARAMS = Object.freeze({ N: 2 ** 14, r: 8, p: 1, keylen: 64 });
const DUMMY_LOGIN_SALT = 'maneflow-dummy-login-v1';
const DUMMY_LOGIN_HASH = crypto.scryptSync(
  'not-a-real-user-password', DUMMY_LOGIN_SALT, PASSWORD_SCRYPT_PARAMS.keylen,
  { N: PASSWORD_SCRYPT_PARAMS.N, r: PASSWORD_SCRYPT_PARAMS.r, p: PASSWORD_SCRYPT_PARAMS.p, maxmem: 64 * 1024 * 1024 },
).toString('hex');

function normalizedScryptParams(params, fallback = LEGACY_SCRYPT_PARAMS) {
  const source = params && typeof params === 'object' ? params : fallback;
  const N = Number(source.N);
  const r = Number(source.r);
  const p = Number(source.p);
  const keylen = Number(source.keylen);
  if (!Number.isSafeInteger(N) || N < 2 ** 14 || (N & (N - 1)) !== 0) throw new Error('Stored scrypt N parameter is invalid.');
  if (!Number.isSafeInteger(r) || r < 1 || r > 32) throw new Error('Stored scrypt r parameter is invalid.');
  if (!Number.isSafeInteger(p) || p < 1 || p > 16) throw new Error('Stored scrypt p parameter is invalid.');
  if (!Number.isSafeInteger(keylen) || keylen < 32 || keylen > 128) throw new Error('Stored scrypt key length is invalid.');
  return { N, r, p, keylen };
}

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function validateEmail(value) {
  const email = normalizeEmail(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 320;
}

export function validatePassword(value) {
  const password = String(value || '');
  if (password.length < 10) return 'Password must contain at least 10 characters.';
  if (password.length > 200) return 'Password is too long.';
  return null;
}

export async function hashPassword(password, salt = crypto.randomBytes(16).toString('hex'), params = PASSWORD_SCRYPT_PARAMS) {
  const normalized = normalizedScryptParams(params, PASSWORD_SCRYPT_PARAMS);
  const derived = await scrypt(String(password), salt, normalized.keylen, {
    N: normalized.N, r: normalized.r, p: normalized.p, maxmem: 64 * 1024 * 1024,
  });
  return { salt, hash: Buffer.from(derived).toString('hex'), params: normalized };
}

export async function verifyPassword(password, salt, expectedHash, params = PASSWORD_SCRYPT_PARAMS) {
  const normalized = normalizedScryptParams(params, PASSWORD_SCRYPT_PARAMS);
  const { hash } = await hashPassword(password, salt, normalized);
  return timingSafeEqualString(hash, expectedHash);
}

export async function verifyLoginPassword(user, password) {
  if (!user) {
    await verifyPassword(password, DUMMY_LOGIN_SALT, DUMMY_LOGIN_HASH, PASSWORD_SCRYPT_PARAMS);
    return false;
  }
  return verifyPassword(
    password,
    user.passwordSalt,
    user.passwordHash,
    user.passwordParams || LEGACY_SCRYPT_PARAMS,
  );
}

export function passwordHashNeedsUpgrade(user) {
  if (!user?.passwordParams) return true;
  try {
    const params = normalizedScryptParams(user.passwordParams);
    return params.N < PASSWORD_SCRYPT_PARAMS.N || params.r !== PASSWORD_SCRYPT_PARAMS.r || params.p !== PASSWORD_SCRYPT_PARAMS.p || params.keylen !== PASSWORD_SCRYPT_PARAMS.keylen;
  } catch {
    return true;
  }
}

export function createSessionToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashSessionToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

export function parseCookies(header = '') {
  const cookies = {};
  for (const pair of String(header).split(';')) {
    const index = pair.indexOf('=');
    if (index < 0) continue;
    const key = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

export function requestToken(req) {
  return requestCredential(req).token;
}

export function requestCredential(req) {
  const authorization = String(req.headers.authorization || '');
  if (authorization.startsWith('Bearer ')) {
    return { token: authorization.slice(7).trim(), source: 'bearer' };
  }
  const cookies = parseCookies(req.headers.cookie || '');
  return {
    token: cookies[HOST_COOKIE_NAME] || cookies[LEGACY_COOKIE_NAME] || '',
    source: 'cookie',
  };
}

export function csrfTokenForSession(token) {
  return crypto.createHash('sha256')
    .update('maneflow-csrf-v1\0')
    .update(String(token || ''))
    .digest('base64url');
}

export function sessionCookie(token, config) {
  const maxAge = Math.max(1, config.sessionDays) * 86_400;
  const secure = String(config.publicBaseUrl).startsWith('https://');
  const name = secure ? HOST_COOKIE_NAME : LEGACY_COOKIE_NAME;
  return `${name}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}; Priority=High${secure ? '; Secure' : ''}`;
}

export function clearSessionCookie(config) {
  const secure = String(config.publicBaseUrl).startsWith('https://');
  const name = secure ? HOST_COOKIE_NAME : LEGACY_COOKIE_NAME;
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Priority=High${secure ? '; Secure' : ''}`;
}

export function sanitizeUser(user) {
  if (!user) return null;
  const { passwordHash, passwordSalt, passwordParams, mfaTotpSecret, mfaTotpPendingSecret, ...safe } = user;
  return { ...safe, mfaEnabled: Boolean(user.mfaTotpSecret && user.mfaEnabledAt) };
}
