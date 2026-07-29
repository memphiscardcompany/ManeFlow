import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const html = await fs.readFile(new URL('../public/owner-meta.html', import.meta.url), 'utf8');
const script = await fs.readFile(new URL('../public/owner-meta.js', import.meta.url), 'utf8');
const entry = await fs.readFile(new URL('../public/owner-entry.js', import.meta.url), 'utf8');

test('owner Meta workspace is private-indexing resistant and contains explicit security workflows', () => {
  assert.match(html, /noindex,nofollow,noarchive/);
  assert.match(html, /Enroll authenticator/);
  assert.match(html, /Recent reauthentication/);
  assert.match(html, /Recovery codes/);
  assert.match(html, /Unified queue/);
  assert.match(html, /Draft response/);
  assert.match(html, /Approve exact text and hold/);
  assert.match(html, /Queueing and dispatch remain separate actions/);
  assert.match(html, /Dispatch owner-approved queue/);
});

test('owner workspace never requests or embeds Meta tokens, app secrets, or webhook secrets', () => {
  const combined = `${html}\n${script}`;
  assert.doesNotMatch(combined, /META_PAGE_ACCESS_TOKEN|META_INSTAGRAM_ACCESS_TOKEN|META_APP_SECRET|META_WEBHOOK_VERIFY_TOKEN/);
  assert.doesNotMatch(html, /name=["'](?:token|accessToken|appSecret|webhookSecret)["']/i);
  assert.doesNotMatch(combined, /privateObjectKey/);
});

test('owner workspace uses the complete separate approval boundaries', () => {
  assert.match(script, /\/api\/owner\/meta\/conversations/);
  assert.match(script, /\/drafts/);
  assert.match(script, /\/approve/);
  assert.match(script, /\/queue/);
  assert.match(script, /\/api\/owner\/meta\/dispatch\/run/);
  assert.match(script, /window\.confirm\('Approve this exact text/);
  assert.match(script, /window\.confirm\('Queue this exact approved text/);
  assert.match(script, /window\.confirm\('Dispatch only owner-approved queued replies now/);
  assert.doesNotMatch(script, /setInterval\([^)]*dispatch|dispatchMetaBatch|auto.?send/i);
});

test('provider-controlled text is escaped before insertion into the document', () => {
  assert.match(script, /function escapeHtml/);
  assert.match(script, /escapeHtml\(conversation\.latestMessage/);
  assert.match(script, /escapeHtml\(message\.body/);
  assert.match(script, /escapeHtml\(draft\.body/);
});

test('the ManeFlow shell reveals the console link only after the owner security endpoint allows it', () => {
  assert.match(entry, /\/api\/auth\/owner\/security-status/);
  assert.match(entry, /status\.allowlisted !== true/);
  assert.match(entry, /data-owner-meta-console/);
  assert.doesNotMatch(entry, /platformOwnerUserIds|ownerMfaEncryptionKey/);
});
