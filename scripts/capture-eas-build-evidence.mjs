import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PLATFORMS = ['ios', 'android'];
const FINISHED_STATUS = 'FINISHED';
const SAFE_BUILD_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/;
const GIT_COMMIT = /^[a-f0-9]{40}$/;

function requiredString(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new TypeError(`${label} is required.`);
  return normalized;
}

function normalizeCommit(value, label) {
  const commit = requiredString(value, label).toLowerCase();
  if (!GIT_COMMIT.test(commit)) throw new TypeError(`${label} must be a full 40-character Git commit SHA.`);
  return commit;
}

function buildProfile(build) {
  return String(build?.buildProfile || build?.profile || '').trim();
}

function normalizeBuild(build, platform, expectedCommit, expectedProfile, expectedAppVersion) {
  const id = requiredString(build?.id, `${platform} build id`);
  if (!SAFE_BUILD_ID.test(id)) throw new TypeError(`${platform} build id has an unsafe format.`);

  const status = requiredString(build?.status, `${platform} build status`).toUpperCase();
  if (status !== FINISHED_STATUS) {
    throw new Error(`${platform} build ${id} is ${status}; only FINISHED builds may be promoted.`);
  }

  const commit = normalizeCommit(build?.gitCommitHash, `${platform} build gitCommitHash`);
  if (commit !== expectedCommit) {
    throw new Error(`${platform} build ${id} belongs to ${commit}, not ${expectedCommit}.`);
  }

  const profile = requiredString(buildProfile(build), `${platform} build profile`);
  if (profile !== expectedProfile) {
    throw new Error(`${platform} build ${id} uses profile ${profile}, not ${expectedProfile}.`);
  }

  const appVersion = requiredString(build?.appVersion, `${platform} build appVersion`);
  if (appVersion !== expectedAppVersion) {
    throw new Error(`${platform} build ${id} has app version ${appVersion}, not ${expectedAppVersion}.`);
  }

  const channel = requiredString(build?.channel, `${platform} build channel`);
  if (channel !== 'production') {
    throw new Error(`${platform} build ${id} uses channel ${channel}, not production.`);
  }

  const distribution = requiredString(build?.distribution, `${platform} build distribution`).toUpperCase();
  if (distribution !== 'STORE') {
    throw new Error(`${platform} build ${id} uses distribution ${distribution}, not STORE.`);
  }

  return {
    id,
    platform,
    status,
    profile,
    gitCommitHash: commit,
    appVersion,
    appBuildVersion: String(build?.appBuildVersion || '').trim() || null,
    channel,
    distribution,
  };
}

export function captureEasBuildEvidence(payload, options = {}) {
  const expectedCommit = normalizeCommit(options.expectedCommit, 'expectedCommit');
  const expectedProfile = requiredString(options.expectedProfile || 'production', 'expectedProfile');
  const expectedAppVersion = requiredString(options.expectedAppVersion, 'expectedAppVersion');
  const builds = Array.isArray(payload) ? payload : payload?.builds;
  if (!Array.isArray(builds)) throw new TypeError('EAS build output must be an array or an object with a builds array.');

  const normalized = {};
  for (const platform of PLATFORMS) {
    const candidates = builds.filter((build) => String(build?.platform || '').trim().toLowerCase() === platform);
    if (candidates.length !== 1) {
      throw new Error(`Expected exactly one ${platform} build, received ${candidates.length}.`);
    }
    normalized[platform] = normalizeBuild(candidates[0], platform, expectedCommit, expectedProfile, expectedAppVersion);
  }

  if (builds.length !== PLATFORMS.length) {
    throw new Error(`Expected only iOS and Android build results, received ${builds.length} total records.`);
  }

  return {
    schemaVersion: 'maneflow-mobile-build-evidence-v1.0',
    sourceCommit: expectedCommit,
    sourceRef: String(options.sourceRef || '').trim() || null,
    workflowRunUrl: String(options.workflowRunUrl || '').trim() || null,
    profile: expectedProfile,
    appVersion: expectedAppVersion,
    generatedAt: options.generatedAt || new Date().toISOString(),
    builds: normalized,
  };
}

function argument(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

async function main() {
  const input = path.resolve(requiredString(argument('input'), '--input'));
  const output = path.resolve(requiredString(argument('output'), '--output'));
  const githubOutput = argument('github-output');
  const payload = JSON.parse(await fs.readFile(input, 'utf8'));
  const evidence = captureEasBuildEvidence(payload, {
    expectedCommit: argument('expected-commit'),
    expectedProfile: argument('expected-profile', 'production'),
    expectedAppVersion: argument('expected-app-version'),
    sourceRef: argument('source-ref'),
    workflowRunUrl: argument('workflow-run-url'),
  });

  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');

  if (githubOutput) {
    await fs.appendFile(
      path.resolve(githubOutput),
      [
        `ios_build_id=${evidence.builds.ios.id}`,
        `android_build_id=${evidence.builds.android.id}`,
        `evidence_path=${output}`,
        '',
      ].join('\n'),
      'utf8',
    );
  }

  console.log(`Captured exact EAS builds for ${evidence.sourceCommit}: iOS ${evidence.builds.ios.id}; Android ${evidence.builds.android.id}.`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
