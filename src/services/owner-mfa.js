import crypto from 'node:crypto';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function normalizedBase32(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
}

export function base32Encode(input) {
  const bytes = Buffer.from(input);
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input) {
  const normalized = normalizedBase32(input);
  if (!normalized) throw new TypeError('A valid Base32 secret is required.');
  let bits = 0;
  let value = 0;
  const output = [];
  for (const character of normalized) {
    const index = BASE32.indexOf(character);
    if (index < 0) throw new TypeError('The Base32 secret is invalid.');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

export function ownerMfaKey(value) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new TypeError('MANEFLOW_OWNER_MFA_ENCRYPTION_KEY is required.');
  let key;
  try {
    key = Buffer.from(normalized, 'base64url');
  } catch {
    throw new TypeError('MANEFLOW_OWNER_MFA_ENCRYPTION_KEY must be a Base64URL value.');
  }
  if (key.length !== 32) throw new TypeError('MANEFLOW_OWNER_MFA_ENCRYPTION_KEY must decode to exactly 32 bytes.');
  return key;
}

export function encryptOwnerSecret(secret, keyValue) {
  const key = ownerMfaKey(keyValue);
  const plaintext = Buffer.from(String(secret || ''), 'utf8');
  if (!plaintext.length) throw new TypeError('MFA secret is required.');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from('maneflow-owner-mfa-v1'));
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), encrypted.toString('base64url'), tag.toString('base64url')].join('.');
}

export function decryptOwnerSecret(payload, keyValue) {
  const key = ownerMfaKey(keyValue);
  const [version, ivValue, encryptedValue, tagValue, extra] = String(payload || '').split('.');
  if (version !== 'v1' || !ivValue || !encryptedValue || !tagValue || extra !== undefined) {
    throw new TypeError('Encrypted MFA secret has an unsupported format.');
  }
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivValue, 'base64url'));
    decipher.setAAD(Buffer.from('maneflow-owner-mfa-v1'));
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new Error('Encrypted MFA secret could not be authenticated.');
  }
}

function hotp(secret, counter, digits = 6) {
  const key = base32Decode(secret);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', key).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % (10 ** digits)).padStart(digits, '0');
}

export function generateTotpSecret(bytes = 20) {
  const length = Math.max(20, Math.min(64, Number(bytes) || 20));
  return base32Encode(crypto.randomBytes(length));
}

export function totpCode(secret, { now = Date.now(), stepSeconds = 30, digits = 6 } = {}) {
  const step = Math.floor(Number(now) / 1_000 / stepSeconds);
  return hotp(secret, step, digits);
}

export function verifyTotp(secret, code, {
  now = Date.now(),
  stepSeconds = 30,
  digits = 6,
  window = 1,
  afterStep = -1,
} = {}) {
  const normalized = String(code || '').replace(/\s+/g, '');
  if (!new RegExp(`^\\d{${digits}}$`).test(normalized)) return { valid: false, step: null };
  const current = Math.floor(Number(now) / 1_000 / stepSeconds);
  for (let offset = -Math.abs(window); offset <= Math.abs(window); offset += 1) {
    const step = current + offset;
    if (step <= Number(afterStep ?? -1)) continue;
    const expected = hotp(secret, step, digits);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(normalized))) return { valid: true, step };
  }
  return { valid: false, step: null };
}

export function ownerTotpUri({ secret, accountName, issuer = 'ManeFlow' }) {
  const normalizedSecret = normalizedBase32(secret);
  const normalizedIssuer = String(issuer || 'ManeFlow').trim().slice(0, 100);
  const account = String(accountName || '').trim().slice(0, 320);
  if (!normalizedSecret || !account) throw new TypeError('MFA secret and account name are required.');
  const label = `${normalizedIssuer}:${account}`;
  const parameters = new URLSearchParams({
    secret: normalizedSecret,
    issuer: normalizedIssuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${parameters.toString()}`;
}

function recoveryCode() {
  const bytes = crypto.randomBytes(10);
  let raw = '';
  for (const byte of bytes) raw += RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length];
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

function normalizedRecoveryCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z2-9]/g, '');
}

export function recoveryCodeHash(code, keyValue) {
  const key = ownerMfaKey(keyValue);
  const normalized = normalizedRecoveryCode(code);
  if (normalized.length !== 10) throw new TypeError('Recovery code is invalid.');
  return crypto.createHmac('sha256', key).update(`owner-recovery-v1:${normalized}`).digest('hex');
}

export function generateRecoveryCodes(keyValue, count = 10) {
  const total = Math.max(6, Math.min(20, Number(count) || 10));
  const codes = new Set();
  while (codes.size < total) codes.add(recoveryCode());
  const values = [...codes];
  return {
    codes: values,
    hashes: values.map((code) => recoveryCodeHash(code, keyValue)),
  };
}

export function consumeRecoveryCode(code, hashes, keyValue) {
  let candidate;
  try {
    candidate = recoveryCodeHash(code, keyValue);
  } catch {
    return { valid: false, remainingHashes: Array.isArray(hashes) ? [...hashes] : [] };
  }
  const current = Array.isArray(hashes) ? hashes.filter((hash) => /^[0-9a-f]{64}$/i.test(String(hash))) : [];
  const index = current.findIndex((hash) => crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(candidate)));
  if (index < 0) return { valid: false, remainingHashes: current };
  return { valid: true, remainingHashes: current.filter((_, currentIndex) => currentIndex !== index) };
}
