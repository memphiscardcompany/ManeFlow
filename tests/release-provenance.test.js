import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildReleaseProvenance,
  releaseProvenanceHeaders,
} from '../src/services/release-provenance.js';
import { createReleaseProvenanceRouter } from '../src/release-provenance-router.js';

const FULL_SHA = 'a'.repeat(40);
const APP_DIGEST = `sha256:${'b'.repeat(64)}`;
const VISION_DIGEST = `sha256:${'c'.repeat(64)}`;
const MODEL_DIGEST = 'd'.repeat(64);
const BENCHMARK_DIGEST = 'e'.repeat(64);

function completeEnvironment() {
  return {
    MANEFLOW_GIT_SHA: FULL_SHA,
    MANEFLOW_GIT_REF: 'refs/heads/main',
    MANEFLOW_DEPLOYED_AT: '2026-08-01T06:00:00Z',
    MANEFLOW_DEPLOYMENT_PROVIDER: 'canonical-container-runtime',
    MANEFLOW_APP_IMAGE_ID: 'ghcr.io/memphiscardcompany/maneflow-app',
    MANEFLOW_APP_IMAGE_DIGEST: APP_DIGEST,
    MANEFLOW_VISION_IMAGE_ID: 'ghcr.io/memphiscardcompany/maneflow-vision',
    MANEFLOW_VISION_IMAGE_DIGEST: VISION_DIGEST,
    MANEFLOW_DETECTOR_MODEL_ID: 'card-detector-v2',
    MANEFLOW_DETECTOR_MODEL_VERSION: '2.0.0',
    MANEFLOW_DETECTOR_MODEL_SHA256: MODEL_DIGEST,
    MANEFLOW_CATALOG_VERSION: 'catalog-2026-08-01',
    MANEFLOW_BENCHMARK_MANIFEST_SHA256: BENCHMARK_DIGEST,
    MANEFLOW_IDENTITY_POLICY_VERSION: 'identity-policy-v3',
    MANEFLOW_CALIBRATION_VERSION: 'calibration-v2',
    MANEFLOW_SCHEMA_VERSION: '009',
    MANEFLOW_RELEASE_ENVIRONMENT: 'production',
  };
}

const config = {
  version: '2.22.0-beta.1',
  releaseChannel: 'production',
  releaseEnvironment: 'production',
  migrationVersion: '009',
  embeddingModelVersion: '1',
};

test('complete release provenance permits an evidence-based production claim', () => {
  const manifest = buildReleaseProvenance({ config, env: completeEnvironment() });
  assert.equal(manifest.contract_version, 'maneflow-release-provenance-v2');
  assert.equal(manifest.source.git_sha, FULL_SHA);
  assert.equal(manifest.source.verified, true);
  assert.equal(manifest.artifacts.application.digest, APP_DIGEST);
  assert.equal(manifest.artifacts.vision.digest, VISION_DIGEST);
  assert.equal(manifest.models.detector.digest, `sha256:${MODEL_DIGEST}`);
  assert.equal(manifest.data.benchmark_manifest_digest, `sha256:${BENCHMARK_DIGEST}`);
  assert.equal(manifest.verification.complete, true);
  assert.equal(manifest.verification.production_claim_allowed, true);
  assert.deepEqual(manifest.verification.missing, []);
});

test('incomplete or invalid provenance fails closed without inventing deployment evidence', () => {
  const manifest = buildReleaseProvenance({
    config: {
      ...config,
      releaseCommitSha: 'unverified',
      releaseDeployedAt: 'not-a-date',
    },
    env: {
      MANEFLOW_RELEASE_ENVIRONMENT: 'production',
      MANEFLOW_APP_IMAGE_DIGEST: 'not-a-digest',
      MANEFLOW_BUILD_DIRTY: 'true',
    },
  });

  assert.equal(manifest.source.git_sha, null);
  assert.equal(manifest.source.verified, false);
  assert.equal(manifest.deployment.deployed_at, null);
  assert.equal(manifest.artifacts.application.digest, null);
  assert.equal(manifest.verification.complete, false);
  assert.equal(manifest.verification.production_claim_allowed, false);
  assert.ok(manifest.verification.missing.includes('source.git_sha'));
  assert.ok(manifest.verification.missing.includes('artifacts.vision.digest'));
});

test('release provenance headers are explicit and non-cacheable', () => {
  const manifest = buildReleaseProvenance({ config, env: completeEnvironment() });
  assert.deepEqual(releaseProvenanceHeaders(manifest), {
    'cache-control': 'no-store, max-age=0',
    pragma: 'no-cache',
    'x-maneflow-git-sha': FULL_SHA,
    'x-maneflow-provenance-complete': 'true',
  });
});

function responseRecorder() {
  return {
    status: null,
    headers: null,
    body: '',
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body = '') {
      this.body = body;
      this.writableEnded = true;
    },
  };
}

test('release router serves GET and HEAD and declines unrelated routes', async () => {
  const router = createReleaseProvenanceRouter({ config, env: completeEnvironment() });

  const getResponse = responseRecorder();
  assert.equal(await router({ method: 'GET', url: '/api/release' }, getResponse), true);
  assert.equal(getResponse.status, 200);
  assert.equal(getResponse.headers['cache-control'], 'no-store, max-age=0');
  assert.equal(JSON.parse(getResponse.body).source.git_sha, FULL_SHA);

  const headResponse = responseRecorder();
  assert.equal(await router({ method: 'HEAD', url: '/api/release' }, headResponse), true);
  assert.equal(headResponse.status, 200);
  assert.equal(headResponse.body, '');

  const unrelated = responseRecorder();
  assert.equal(await router({ method: 'GET', url: '/api/health' }, unrelated), false);
  assert.equal(unrelated.status, null);
});

test('release router rejects mutation methods', async () => {
  const router = createReleaseProvenanceRouter({ config, env: completeEnvironment() });
  const response = responseRecorder();
  assert.equal(await router({ method: 'POST', url: '/api/release' }, response), true);
  assert.equal(response.status, 405);
  assert.equal(response.headers.allow, 'GET, HEAD');
  assert.equal(JSON.parse(response.body).error, 'METHOD_NOT_ALLOWED');
});
