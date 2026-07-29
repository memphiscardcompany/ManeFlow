import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { timingSafeEqualString } from './utils.js';

const scrypt = promisify(crypto.scrypt);
const COOKIE_NAME = 'mf_session';

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

export async function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = await scrypt(String(password), salt, 64);
  return { salt, hash: Buffer.from(derived).toString('hex') };
}

export async function verifyPassword(password, salt, expectedHash) {
  const { hash } = await hashPassword(password, salt);
  return timingSafeEqualString(hash, expectedHash);
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
  return {
    token: parseCookies(req.headers.cookie || '')[COOKIE_NAME] || '',
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
  const secure = String(config.publicBaseUrl).startsWith('https://') ? '; Secure' : '';
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}; Priority=High${secure}`;
}

export function clearSessionCookie(config) {
  const secure = String(config.publicBaseUrl).startsWith('https://') ? '; Secure' : '';
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Priority=High${secure}`;
}

export function sanitizeUser(user) {
  if (!user) return null;
  const {
    passwordHash,
    passwordSalt,
    ownerMfa,
    ownerMfaEnrollment,
    ...safe
  } = user;
  return safe;
}
