import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { captureEasBuildEvidence } from '../scripts/capture-eas-build-evidence.mjs';

const COMMIT = 'a'.repeat(40);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function build(platform, overrides = {}) {
  return {
    id: `${platform}-build-12345678`,
    platform: platform.toUpperCase(),
    status: 'FINISHED',
    buildProfile: 'production',
    gitCommitHash: COMMIT,
    appVersion: '2.22.0',
    appBuildVersion: platform === 'ios' ? '19' : '21',
    channel: 'production',
    distribution: 'STORE',
    ...overrides,
  };
}

test('captures one exact finished build per platform regardless of EAS result order', () => {
  const evidence = captureEasBuildEvidence([build('android'), build('ios')], {
    expectedCommit: COMMIT,
    expectedProfile: 'production',
    expectedAppVersion: '2.22.0',
    sourceRef: 'refs/tags/v2.22.0',
    workflowRunUrl: 'https://github.com/example/maneflow/actions/runs/123',
    generatedAt: '2026-07-29T12:00:00.000Z',
  });

  assert.equal(evidence.schemaVersion, 'maneflow-mobile-build-evidence-v1.0');
  assert.equal(evidence.sourceCommit, COMMIT);
  assert.equal(evidence.sourceRef, 'refs/tags/v2.22.0');
  assert.equal(evidence.workflowRunUrl, 'https://github.com/example/maneflow/actions/runs/123');
  assert.equal(evidence.appVersion, '2.22.0');
  assert.equal(evidence.builds.ios.id, 'ios-build-12345678');
  assert.equal(evidence.builds.android.id, 'android-build-12345678');
  assert.equal(evidence.builds.ios.appBuildVersion, '19');
  assert.equal(evidence.generatedAt, '2026-07-29T12:00:00.000Z');
});

test('rejects missing, duplicate, unfinished, and unexpected build records', () => {
  const options = { expectedCommit: COMMIT, expectedProfile: 'production', expectedAppVersion: '2.22.0' };

  assert.throws(
    () => captureEasBuildEvidence([build('ios')], options),
    /exactly one android build/,
  );
  assert.throws(
    () => captureEasBuildEvidence([build('ios'), build('ios'), build('android')], options),
    /exactly one ios build/,
  );
  assert.throws(
    () => captureEasBuildEvidence([build('ios', { status: 'ERRORED' }), build('android')], options),
    /only FINISHED builds/,
  );
  assert.throws(
    () => captureEasBuildEvidence([build('ios'), build('android'), build('web')], options),
    /received 3 total records/,
  );
});

test('rejects commit, profile, version, channel, distribution, and output-injection mismatches', () => {
  const options = { expectedCommit: COMMIT, expectedProfile: 'production', expectedAppVersion: '2.22.0' };

  assert.throws(
    () => captureEasBuildEvidence([build('ios', { gitCommitHash: 'b'.repeat(40) }), build('android')], options),
    /belongs to/,
  );
  assert.throws(
    () => captureEasBuildEvidence([build('ios', { buildProfile: 'preview' }), build('android')], options),
    /uses profile preview/,
  );
  assert.throws(
    () => captureEasBuildEvidence([build('ios', { appVersion: '2.21.0' }), build('android')], options),
    /app version 2\.21\.0/,
  );
  assert.throws(
    () => captureEasBuildEvidence([build('ios', { channel: 'preview' }), build('android')], options),
    /uses channel preview/,
  );
  assert.throws(
    () => captureEasBuildEvidence([build('ios', { distribution: 'INTERNAL' }), build('android')], options),
    /distribution INTERNAL/,
  );
  assert.throws(
    () => captureEasBuildEvidence([build('ios', { id: 'unsafe\noutput=true' }), build('android')], options),
    /unsafe format/,
  );
});

test('mobile publication workflow promotes only exact IDs behind a serialized environment gate', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'mobile-store-release.yml'), 'utf8');

  assert.match(workflow, /environment:\s*\r?\n\s+name: mobile-store-production/);
  assert.match(workflow, /group: maneflow-mobile-store-production/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.equal(workflow.match(/npm install --global eas-cli@16\.32\.0/g)?.length, 2);
  assert.match(workflow, /IOS_BUILD_ID: \$\{\{ needs\.verify_and_build_mobile\.outputs\.ios_build_id \}\}/);
  assert.match(workflow, /ANDROID_BUILD_ID: \$\{\{ needs\.verify_and_build_mobile\.outputs\.android_build_id \}\}/);
  assert.match(workflow, /--platform ios --profile production --id "\$IOS_BUILD_ID"/);
  assert.match(workflow, /--platform android --profile production --id "\$ANDROID_BUILD_ID"/);
  assert.doesNotMatch(workflow, /--latest\b/);
});
