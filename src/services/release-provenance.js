const FULL_SHA_PATTERN = /^[a-f0-9]{40}$/i;
const SHA256_PATTERN = /^(?:sha256:)?[a-f0-9]{64}$/i;

function clean(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function fullSha(value) {
  const text = clean(value);
  return text && FULL_SHA_PATTERN.test(text) ? text.toLowerCase() : null;
}

function sha256Digest(value) {
  const text = clean(value);
  if (!text || !SHA256_PATTERN.test(text)) return null;
  return text.toLowerCase().startsWith('sha256:')
    ? text.toLowerCase()
    : `sha256:${text.toLowerCase()}`;
}

function isoTimestamp(value) {
  const text = clean(value);
  if (!text) return null;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function component({ id, digest = null, version = null } = {}) {
  return {
    id: clean(id),
    version: clean(version),
    digest: sha256Digest(digest),
  };
}

export function buildReleaseProvenance({ config = {}, env = process.env } = {}) {
  const gitSha = fullSha(
    env.MANEFLOW_GIT_SHA
    || env.RELEASE_COMMIT_SHA
    || config.releaseCommitSha,
  );
  const deployedAt = isoTimestamp(
    env.MANEFLOW_DEPLOYED_AT
    || env.RELEASE_DEPLOYED_AT
    || config.releaseDeployedAt,
  );
  const appImageDigest = sha256Digest(
    env.MANEFLOW_APP_IMAGE_DIGEST
    || env.APP_IMAGE_DIGEST,
  );
  const visionImageDigest = sha256Digest(
    env.MANEFLOW_VISION_IMAGE_DIGEST
    || env.VISION_IMAGE_DIGEST,
  );
  const benchmarkManifestDigest = sha256Digest(
    env.MANEFLOW_BENCHMARK_MANIFEST_SHA256
    || env.BENCHMARK_MANIFEST_SHA256,
  );
  const releaseManifestDigest = sha256Digest(
    env.MANEFLOW_RELEASE_MANIFEST_SHA256
    || env.RELEASE_MANIFEST_SHA256,
  );

  const missing = [];
  if (!gitSha) missing.push('source.git_sha');
  if (!deployedAt) missing.push('deployment.deployed_at');
  if (!appImageDigest) missing.push('artifacts.application.digest');
  if (!visionImageDigest) missing.push('artifacts.vision.digest');
  if (!clean(env.MANEFLOW_DETECTOR_MODEL_VERSION)) missing.push('models.detector.version');
  if (!sha256Digest(env.MANEFLOW_DETECTOR_MODEL_SHA256)) missing.push('models.detector.digest');
  if (!clean(env.MANEFLOW_CATALOG_VERSION)) missing.push('data.catalog_version');
  if (!benchmarkManifestDigest) missing.push('data.benchmark_manifest_digest');

  const environment = clean(
    env.MANEFLOW_RELEASE_ENVIRONMENT
    || env.RELEASE_ENVIRONMENT
    || config.releaseEnvironment
    || config.releaseChannel,
  ) || 'unknown';

  return {
    contract_version: 'maneflow-release-provenance-v2',
    product: 'ManeFlow',
    version: clean(config.version),
    release_channel: clean(config.releaseChannel),
    canonical_repository: clean(env.MANEFLOW_CANONICAL_REPOSITORY) || 'memphiscardcompany/ManeFlow',
    environment,
    source: {
      git_sha: gitSha,
      git_ref: clean(env.MANEFLOW_GIT_REF || env.RELEASE_GIT_REF),
      dirty: bool(env.MANEFLOW_BUILD_DIRTY, false),
      verified: Boolean(gitSha) && !bool(env.MANEFLOW_BUILD_DIRTY, false),
    },
    deployment: {
      provider: clean(env.MANEFLOW_DEPLOYMENT_PROVIDER),
      deployed_at: deployedAt,
      appdeploy_app_id: clean(env.MANEFLOW_APPDEPLOY_APP_ID),
      appdeploy_snapshot: clean(env.MANEFLOW_APPDEPLOY_SNAPSHOT),
      web_release_id: clean(config.webReleaseId || env.MANEFLOW_WEB_RELEASE_ID || env.WEB_RELEASE_ID),
      api_release_id: clean(config.apiReleaseId || env.MANEFLOW_API_RELEASE_ID || env.API_RELEASE_ID),
      vision_release_id: clean(config.visionReleaseId || env.MANEFLOW_VISION_RELEASE_ID || env.VISION_RELEASE_ID),
    },
    artifacts: {
      application: component({
        id: env.MANEFLOW_APP_IMAGE_ID,
        digest: appImageDigest,
      }),
      vision: component({
        id: env.MANEFLOW_VISION_IMAGE_ID,
        digest: visionImageDigest,
      }),
      release_manifest_digest: releaseManifestDigest,
      sbom_digest: sha256Digest(env.MANEFLOW_SBOM_SHA256),
    },
    models: {
      detector: component({
        id: env.MANEFLOW_DETECTOR_MODEL_ID,
        version: env.MANEFLOW_DETECTOR_MODEL_VERSION,
        digest: env.MANEFLOW_DETECTOR_MODEL_SHA256,
      }),
      ocr: component({
        id: env.MANEFLOW_OCR_MODEL_ID,
        version: env.MANEFLOW_OCR_MODEL_VERSION,
        digest: env.MANEFLOW_OCR_MODEL_SHA256,
      }),
      encoder: component({
        id: env.MANEFLOW_ENCODER_MODEL_ID,
        version: env.MANEFLOW_ENCODER_MODEL_VERSION || config.embeddingModelVersion,
        digest: env.MANEFLOW_ENCODER_MODEL_SHA256,
      }),
      identity_policy_version: clean(env.MANEFLOW_IDENTITY_POLICY_VERSION),
      calibration_version: clean(env.MANEFLOW_CALIBRATION_VERSION),
    },
    data: {
      catalog_version: clean(env.MANEFLOW_CATALOG_VERSION),
      benchmark_manifest_digest: benchmarkManifestDigest,
      knowledge_runtime_version: clean(env.MANEFLOW_KNOWLEDGE_RUNTIME_VERSION),
    },
    database: {
      schema_version: clean(
        env.MANEFLOW_SCHEMA_VERSION
        || config.migrationVersion
        || env.MANEFLOW_MIGRATION_VERSION
        || env.MIGRATION_VERSION,
      ),
    },
    verification: {
      complete: missing.length === 0,
      missing,
      production_claim_allowed: environment === 'production' && missing.length === 0,
    },
  };
}

export function releaseProvenanceHeaders(manifest) {
  return {
    'cache-control': 'no-store, max-age=0',
    pragma: 'no-cache',
    'x-maneflow-git-sha': manifest?.source?.git_sha || 'unverified',
    'x-maneflow-provenance-complete': String(Boolean(manifest?.verification?.complete)),
  };
}
