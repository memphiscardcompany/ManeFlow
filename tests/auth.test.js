import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, validatePassword, validateEmail } from '../src/services/auth.js';

test('password hashing verifies valid passwords and rejects invalid ones', async () => {
  const result = await hashPassword('a-strong-password');
  assert.equal(await verifyPassword('a-strong-password', result.salt, result.hash), true);
  assert.equal(await verifyPassword('wrong-password', result.salt, result.hash), false);
});

test('account validators reject weak credentials', () => {
  assert.equal(validateEmail('collector@example.com'), true);
  assert.equal(validateEmail('not-an-email'), false);
  assert.match(validatePassword('short'), /10 characters/);
  assert.equal(validatePassword('long-enough-password'), null);
});
