import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRuntimeConfig } from '../src/services/config-runtime.js';

function productionConfig(overrides = {}) {
  return {
    productionMode: true,
    version: 'test',
    releaseChannel: 'production',
    publicBaseUrl: 'https://app.memphiscardcompany.com',
    secureCookies: true,
    requireAuthentication: true,
    requireEmailVerification: true,
    csrfProtection: true,
    allowGuestWrites: false,
    allowLegacyAdminToken: false,
    apiToken: 'configured-in-secret-manager',
    serviceToken: 'configured-in-secret-manager',
    providerWebhookSecret: 'configured-in-secret-manager',
    allowedOrigins: ['https://app.memphiscardcompany.com'],
    demoMode: false,
    exposeDevTokens: false,
    storageMode: 'postgres',
    databaseUrl: 'postgresql://runtime.invalid/maneflow',
    emailWebhookUrl: 'https://email-provider.invalid/maneflow',
    releaseCommitSha: 'a'.repeat(40),
    releaseDeployedAt: '2026-07-29T00:00:00.000Z',
    scanJobDir: '/private/maneflow/scan-jobs',
    scanJobStorageDurable: true,
    scanJobMaxItems: 1_000,
    scanJobConcurrency: 2,
    billingProvider: 'mock',
    metaIntakeEnabled: false,
    metaKillSwitch: true,
    metaOutboundEnabled: false,
    metaOutboundChannels: ['messenger', 'instagram_dm'],
    widgetAllowedOrigins: ['https://app.memphiscardcompany.com'],
    ...overrides,
  };
}

test('production refuses ephemeral scan-job storage', () => {
  const validation = validateRuntimeConfig(productionConfig({ scanJobStorageDurable: false }));
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.some((message) => message.includes('MANEFLOW_SCAN_JOB_STORAGE_DURABLE')));
});

test('production scan-job configuration passes the storage-specific release gate when durability is attested', () => {
  const validation = validateRuntimeConfig(productionConfig());
  assert.equal(validation.errors.some((message) => message.includes('SCAN_JOB')), false);
  assert.equal(validation.safeConfig.scanJobStorageDurable, true);
  assert.equal(validation.safeConfig.scanJobMaxItems, 1_000);
  assert.equal(validation.safeConfig.scanJobConcurrency, 2);
});

test('local development may use the private runtime spool without claiming production durability', () => {
  const validation = validateRuntimeConfig({
    productionMode: false,
    storageMode: 'json',
    scanJobDir: '.runtime/scan-jobs',
    scanJobStorageDurable: false,
    billingProvider: 'mock',
    allowedOrigins: [],
    widgetAllowedOrigins: [],
  });
  assert.equal(validation.ok, true);
});
