import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  base32Decode,
  base32Encode,
  consumeRecoveryCode,
  decryptOwnerSecret,
  encryptOwnerSecret,
  generateRecoveryCodes,
  ownerMfaKey,
  ownerTotpUri,
  recoveryCodeHash,
  totpCode,
  verifyTotp,
} from '../src/services/owner-mfa.js';

const key = Buffer.alloc(32, 7).toString('base64url');

test('Base32 encoding round trips binary MFA secrets', () => {
  const input = crypto.randomBytes(32);
  const encoded = base32Encode(input);
  assert.match(encoded, /^[A-Z2-7]+$/);
  assert.deepEqual(base32Decode(encoded), input);
});

test('owner MFA encryption uses authenticated AES-GCM and rejects tampering', () => {
  const encrypted = encryptOwnerSecret('JBSWY3DPEHPK3PXP', key);
  assert.doesNotMatch(encrypted, /JBSWY3DPEHPK3PXP/);
  assert.equal(decryptOwnerSecret(encrypted, key), 'JBSWY3DPEHPK3PXP');
  const parts = encrypted.split('.');
  parts[2] = `${parts[2].slice(0, -1)}${parts[2].endsWith('A') ? 'B' : 'A'}`;
  assert.throws(() => decryptOwnerSecret(parts.join('.'), key), /authenticated/);
  assert.throws(() => ownerMfaKey('too-short'), /32 bytes/);
});

test('TOTP follows the RFC 6238 SHA-1 vector and prevents step replay', () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  assert.equal(totpCode(secret, { now: 59_000, digits: 8 }), '94287082');
  const accepted = verifyTotp(secret, '94287082', { now: 59_000, digits: 8, window: 0, afterStep: -1 });
  assert.deepEqual(accepted, { valid: true, step: 1 });
  const replay = verifyTotp(secret, '94287082', { now: 59_000, digits: 8, window: 0, afterStep: 1 });
  assert.deepEqual(replay, { valid: false, step: null });
});

test('TOTP URI contains no password or encryption key material', () => {
  const uri = ownerTotpUri({
    secret: 'JBSWY3DPEHPK3PXP',
    accountName: 'owner@example.com',
    issuer: 'ManeFlow',
  });
  assert.match(uri, /^otpauth:\/\/totp\//);
  assert.match(uri, /secret=JBSWY3DPEHPK3PXP/);
  assert.match(uri, /issuer=ManeFlow/);
  assert.doesNotMatch(uri, new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('recovery codes are HMAC-hashed and consumed exactly once', () => {
  const generated = generateRecoveryCodes(key, 10);
  assert.equal(generated.codes.length, 10);
  assert.equal(generated.hashes.length, 10);
  assert.equal(new Set(generated.codes).size, 10);
  assert.ok(generated.codes.every((code) => /^[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(code)));
  assert.ok(generated.hashes.every((hash) => /^[0-9a-f]{64}$/.test(hash)));
  assert.equal(generated.hashes.includes(generated.codes[0]), false);
  assert.equal(recoveryCodeHash(generated.codes[0], key), generated.hashes[0]);

  const first = consumeRecoveryCode(generated.codes[0], generated.hashes, key);
  assert.equal(first.valid, true);
  assert.equal(first.remainingHashes.length, 9);
  const replay = consumeRecoveryCode(generated.codes[0], first.remainingHashes, key);
  assert.equal(replay.valid, false);
  assert.equal(replay.remainingHashes.length, 9);
});
