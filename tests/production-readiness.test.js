import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { validateRuntimeConfig } from '../src/services/config-runtime.js';
import { JsonStore } from '../src/services/store.js';
import { recordUsage, summarizeUsage, usageGate } from '../src/services/usage-metering.js';
import { subscriptionFromStripeEvent, upsertBillingEntitlement, verifyStripeSignature } from '../src/services/billing.js';
import { createStorageAdapter } from '../src/services/storage/index.js';
import { redactSecrets } from '../src/services/errors.js';

async function makeStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'maneflow-prod-'));
  const store = await new JsonStore(path.join(dir, 'state.json')).init();
  return { store, dir };
}

test('production config validation fails closed for unsafe launch settings', () => {
  const config = loadConfig({ NODE_ENV: 'production', PUBLIC_BASE_URL: 'http://example.com' });
  const validation = validateRuntimeConfig(config, { NODE_ENV: 'production' });
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.some((error) => error.includes('HTTPS')));
});

test('production validation accepts configured PostgreSQL and internal service security', () => {
  const config = loadConfig({
    NODE_ENV: 'production',
    RELEASE_CHANNEL: 'production',
    PUBLIC_BASE_URL: 'https://mane.example.com',
    ALLOWED_ORIGINS: 'https://mane.example.com',
    MANEFLOW_API_TOKEN: 'api-secret-value',
    MANEFLOW_SERVICE_TOKEN: 'service-secret-value',
    PROVIDER_WEBHOOK_SECRET: 'webhook-secret-value',
    MANEFLOW_EMAIL_WEBHOOK_URL: 'https://email.example.com/maneflow',
    STORAGE_MODE: 'postgres',
    DATABASE_URL: 'postgresql://maneflow_app:password@db.example.com/maneflow',
    MANEFLOW_DEMO_MODE: 'false',
    MANEFLOW_EXPOSE_DEV_TOKENS: 'false',
  });
  const validation = validateRuntimeConfig(config, { NODE_ENV: 'production' });
  assert.equal(validation.ok, true, validation.errors.join('; '));
  assert.deepEqual(validation.errors, []);
});

test('production Meta outbound fails closed without owner and exact asset allowlists', () => {
  const common = {
    NODE_ENV: 'production',
    RELEASE_CHANNEL: 'production',
    PUBLIC_BASE_URL: 'https://mane.example.com',
    ALLOWED_ORIGINS: 'https://mane.example.com',
    MANEFLOW_API_TOKEN: 'api-secret-value',
    MANEFLOW_SERVICE_TOKEN: 'service-secret-value',
    PROVIDER_WEBHOOK_SECRET: 'webhook-secret-value',
    MANEFLOW_EMAIL_WEBHOOK_URL: 'https://email.example.com/maneflow',
    STORAGE_MODE: 'postgres',
    DATABASE_URL: 'postgresql://maneflow_app:password@db.example.com/maneflow',
    MANEFLOW_DEMO_MODE: 'false',
    MANEFLOW_EXPOSE_DEV_TOKENS: 'false',
    MANEBRAIN_META_OUTBOUND_ENABLED: 'true',
  };
  const blocked = validateRuntimeConfig(loadConfig(common), common);
  assert.equal(blocked.ok, false);
  assert.ok(blocked.errors.some((error) => error.includes('PLATFORM_OWNER')));
  assert.ok(blocked.errors.some((error) => error.includes('META_PAGE_ID')));
  assert.ok(blocked.errors.some((error) => error.includes('KILL_SWITCH')));

  const configured = {
    ...common,
    MANEBRAIN_META_KILL_SWITCH: 'false',
    MANEFLOW_PLATFORM_OWNER_USER_IDS: '00000000-0000-4000-8000-000000000001',
    META_APP_ID: 'app-1',
    META_BUSINESS_ID: 'business-1',
    META_PAGE_ID: 'page-1',
    META_INSTAGRAM_ACCOUNT_ID: 'instagram-1',
  };
  const allowed = validateRuntimeConfig(loadConfig(configured), configured);
  assert.equal(allowed.ok, true, allowed.errors.join('; '));
  assert.equal(allowed.safeConfig.metaMode, 'owner_approval');
});

test('json storage adapter initializes local store and postgres mode requires database config', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'maneflow-storage-'));
  const jsonAdapter = createStorageAdapter({ storageMode: 'json', runtimeFile: path.join(dir, 'state.json') });
  const store = await jsonAdapter.init();
  assert.equal((await jsonAdapter.health()).ok, true);
  assert.equal(store.state.schemaVersion >= 8, true);
  const pg = createStorageAdapter({ storageMode: 'postgres', databaseUrl: '' });
  await assert.rejects(() => pg.init(), /DATABASE_URL/);
  const pgConfigured = createStorageAdapter({ storageMode: 'postgres', databaseUrl: 'postgres://example.invalid/maneflow' });
  await assert.rejects(() => pgConfigured.init(), /pg package|required|connect|ENOTFOUND|ECONN/i);
  await fs.rm(dir, { recursive: true, force: true });
});

test('usage metering records server-side limits and summaries', async () => {
  const { store, dir } = await makeStore();
  const actor = { userId: 'user-1', user: { plan: 'free' } };
  assert.equal(usageGate(store, actor, 'scan').allowed, true);
  await recordUsage(store, actor, 'scan', 2, { source: 'test' }, { now: new Date('2026-07-21T12:00:00Z') });
  const summary = summarizeUsage(store, actor.userId, { now: new Date('2026-07-21T12:00:00Z') });
  assert.equal(summary.scan, 2);
  await fs.rm(dir, { recursive: true, force: true });
});

test('billing verifies Stripe signatures and syncs entitlements without secrets', async () => {
  const body = JSON.stringify({ id: 'evt_1', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'active', metadata: { maneflow_plan: 'merchant' } } } });
  const timestamp = Math.floor(Date.now() / 1000);
  const secret = 'whsec_test_secret';
  const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  assert.equal(verifyStripeSignature(body, `t=${timestamp},v1=${signature}`, secret), true);
  const subscription = subscriptionFromStripeEvent(JSON.parse(body));
  assert.equal(subscription.status, 'active');
  assert.equal(subscription.plan, 'merchant');
  const { store, dir } = await makeStore();
  await store.createUser({ email: 'merchant@example.com', name: 'Merchant', passwordHash: 'h', passwordSalt: 's', role: 'merchant' });
  const user = store.findUserByEmail('merchant@example.com');
  const entitlement = await upsertBillingEntitlement(store, { userId: 'owner', role: 'admin' }, { ...subscription, userId: user.id });
  assert.equal(entitlement.plan, 'merchant');
  assert.equal(store.findUserById(user.id).plan, 'merchant');
  await fs.rm(dir, { recursive: true, force: true });
});

test('secret redaction removes credential-shaped fields and values', () => {
  const safe = redactSecrets({
    stripeSecretKey: 'stripe-test-secret-value',
    nested: { accessToken: 'Bearer abcdefghijklmnop', publicValue: 'visible' },
  });
  assert.equal(safe.stripeSecretKey, '[REDACTED]');
  assert.equal(safe.nested.accessToken, '[REDACTED]');
  assert.equal(safe.nested.publicValue, 'visible');
});
