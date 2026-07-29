import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'scripts', 'check-external-release-gates.mjs');

function run(args = []) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: 'utf8',
  });
}

test('external release checker falls back to the shipped incomplete example', () => {
  const result = run();
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.passed, false);
  assert.equal(report.usingExample, true);
  assert.match(report.file, /external-release-gates\.example\.json$/);
  assert.ok(report.failed.length > 0);
});

test('external release checker accepts an explicitly completed state file', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'maneflow-release-gates-'));
  const file = path.join(directory, 'external-release-gates.json');
  const completed = {
    schemaVersion: 'maneflow-external-release-gates-v1.0',
    productionInfrastructure: {
      apiBaseUrl: 'https://api.example.test',
      healthEndpoint: 'https://api.example.test/health',
      privacyPolicyUrl: 'https://example.test/privacy',
      termsUrl: 'https://example.test/terms',
      supportUrl: 'https://example.test/support',
    },
    windows: {
      partnerCenterAccountApproved: true,
      publisherSubject: 'CN=Memphis Card Company LLC',
      codeSigningIdentityApproved: true,
      signedInstallerVerified: true,
      storePackageValidated: true,
    },
    apple: {
      developerProgramActive: true,
      appStoreConnectRecordCreated: true,
      bundleIdentifierRegistered: true,
      distributionCertificateConfigured: true,
      privacyQuestionnaireCompleted: true,
      reviewBuildSubmitted: true,
    },
    googlePlay: {
      developerAccountActive: true,
      applicationRecordCreated: true,
      playAppSigningEnabled: true,
      serviceAccountConfigured: true,
      dataSafetyCompleted: true,
      closedTestingCompleted: true,
      reviewBuildSubmitted: true,
    },
  };
  fs.writeFileSync(file, JSON.stringify(completed));

  try {
    const result = run(['--file', file]);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.passed, true);
    assert.equal(report.usingExample, false);
    assert.deepEqual(report.failed, []);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
