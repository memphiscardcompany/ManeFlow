import crypto from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
  let bits = '';
  for (const byte of buffer) bits += byte.toString(2).padStart(8, '0');
  let output = '';
  for (let index = 0; index < bits.length; index += 5) {
    const chunk = bits.slice(index, index + 5).padEnd(5, '0');
    output += BASE32_ALPHABET[Number.parseInt(chunk, 2)];
  }
  return output;
}

function base32Decode(value) {
  const input = String(value || '').toUpperCase().replace(/=+$/g, '').replace(/\s+/g, '');
  if (!input || /[^A-Z2-7]/.test(input)) throw new Error('TOTP secret is invalid.');
  let bits = '';
  for (const char of input) bits += BASE32_ALPHABET.indexOf(char).toString(2).padStart(5, '0');
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret(bytes = 20) {
  const size = Math.max(20, Math.min(64, Number(bytes) || 20));
  return base32Encode(crypto.randomBytes(size));
}

export function totpCode(secret, {
  now = Date.now(),
  period = 30,
  digits = 6,
  algorithm = 'sha1',
} = {}) {
  const counter = Math.floor(Number(now) / 1000 / period);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac(algorithm, base32Decode(secret)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % (10 ** digits)).padStart(digits, '0');
}

export function verifyTotpCode(secret, code, {
  now = Date.now(),
  window = 1,
  period = 30,
  digits = 6,
} = {}) {
  const presented = String(code || '').trim();
  if (!new RegExp(`^\\d{${digits}}$`).test(presented)) return false;
  for (let offset = -Math.max(0, window); offset <= Math.max(0, window); offset += 1) {
    const expected = totpCode(secret, { now: Number(now) + offset * period * 1000, period, digits });
    const left = Buffer.from(expected);
    const right = Buffer.from(presented);
    if (left.length === right.length && crypto.timingSafeEqual(left, right)) return true;
  }
  return false;
}

export function buildTotpEnrollmentUri({ secret, accountName, issuer = 'ManeFlow' }) {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
