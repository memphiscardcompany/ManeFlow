import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function read(relativePath) {
  return fs.readFile(path.join(root, relativePath), 'utf8');
}

test('container publication runs only after a green main verification or explicit manual SHA', async () => {
  const workflow = await read('.github/workflows/publish-containers.yml');
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /workflows: \["Verify ManeFlow"\]/);
  assert.match(workflow, /branches: \[main\]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /pull_request:/);
  assert.match(workflow, /github\.event\.workflow_run\.event == 'push'/);
  assert.match(workflow, /github\.event\.workflow_run\.head_branch == 'main'/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /git rev-parse --verify origin\/main/);
  assert.match(workflow, /git merge-base --is-ancestor "\$RELEASE_SHA" origin\/main/);
  assert.doesNotMatch(workflow, /git fetch --no-tags origin main/);
  assert.match(workflow, /No successful main-branch Verify ManeFlow run exists/);
});

test('container publication has minimum required write permissions and no deployment authority', async () => {
  const workflow = await read('.github/workflows/publish-containers.yml');
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /actions: read/);
  assert.match(workflow, /packages: write/);
  assert.match(workflow, /id-token: write/);
  assert.doesNotMatch(workflow, /contents: write/);
  assert.doesNotMatch(workflow, /deployments: write/);
  assert.doesNotMatch(workflow, /secrets\./);
  assert.doesNotMatch(workflow, /ssh\s|scp\s|kubectl|docker compose up|deploy-staging\.sh/);
});

test('all third-party release actions are pinned to full immutable commit SHAs', async () => {
  const workflow = await read('.github/workflows/publish-containers.yml');
  const uses = [...workflow.matchAll(/uses:\s+([^\s#]+)/g)].map((match) => match[1]);
  assert.ok(uses.length >= 6);
  for (const action of uses) {
    assert.match(action, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.\/-]+@[0-9a-f]{40}$/, action);
  }
  assert.match(workflow, /docker\/login-action@4907a6ddec9925e35a0a9e82d7399ccc52663121/);
  assert.match(workflow, /docker\/setup-buildx-action@d7f5e7f509e45cec5c76c4d5afdd7de93d0b3df5/);
  assert.match(workflow, /docker\/build-push-action@f9f3042f7e2789586610d6e8b85c8f03e5195baf/g);
  assert.match(workflow, /sigstore\/cosign-installer@6f9f17788090df1f26f669e9d70d6ae9567deba6/);
});

test('published images are digest-addressed, SBOM-enabled, provenance-enabled, signed, and verified', async () => {
  const workflow = await read('.github/workflows/publish-containers.yml');
  assert.match(workflow, /tags: \$\{\{ steps\.images\.outputs\.application \}\}:sha-\$\{\{ steps\.release\.outputs\.sha \}\}/);
  assert.match(workflow, /tags: \$\{\{ steps\.images\.outputs\.vision \}\}:sha-\$\{\{ steps\.release\.outputs\.sha \}\}/);
  assert.equal((workflow.match(/provenance: mode=max/g) || []).length, 2);
  assert.equal((workflow.match(/sbom: true/g) || []).length, 2);
  assert.match(workflow, /cosign sign --yes "\$\{APPLICATION_IMAGE\}@\$\{APPLICATION_DIGEST\}"/);
  assert.match(workflow, /cosign sign --yes "\$\{VISION_IMAGE\}@\$\{VISION_DIGEST\}"/);
  assert.equal((workflow.match(/cosign verify \\/g) || []).length, 2);
  assert.match(workflow, /cosign sign-blob --yes/);
  assert.match(workflow, /cosign verify-blob/);
  assert.match(workflow, /sha256sum --check SHA256SUMS/);
});

test('ordinary verification builds and smoke-tests both non-root release containers', async () => {
  const workflow = await read('.github/workflows/verify.yml');
  assert.match(workflow, /container-build:/);
  assert.match(workflow, /SOURCE_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
  assert.equal((workflow.match(/ref: \$\{\{ env\.SOURCE_SHA \}\}/g) || []).length, 5);
  assert.equal((workflow.match(/test "\$\(git rev-parse HEAD\)" = "\$SOURCE_SHA"/g) || []).length, 5);
  assert.match(workflow, /docker build --pull[\s\S]*--tag "maneflow-ci:\$\{SOURCE_SHA\}"/);
  assert.match(workflow, /docker build --pull[\s\S]*--tag "maneflow-vision-ci:\$\{SOURCE_SHA\}"/);
  assert.match(workflow, /\.Config\.User/);
  assert.match(workflow, /= "node"/);
  assert.match(workflow, /= "maneflow"/);
  assert.match(workflow, /from app\.main import app/);
});

test('container release manifest generator validates inputs and emits only immutable references', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'maneflow-container-release-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const output = path.join(directory, 'manifest.json');
  const appDigest = `sha256:${'a'.repeat(64)}`;
  const visionDigest = `sha256:${'b'.repeat(64)}`;
  const result = spawnSync(process.execPath, [
    path.join(root, 'scripts/create-container-release-manifest.mjs'),
    '--source-commit', 'c'.repeat(40),
    '--source-verify-run-id', '12345',
    '--release-workflow-run-id', '67890',
    '--application-image', 'ghcr.io/memphiscardcompany/maneflow',
    '--application-digest', appDigest,
    '--vision-image', 'ghcr.io/memphiscardcompany/maneflow-vision',
    '--vision-digest', visionDigest,
    '--output', output,
  ], {
    encoding: 'utf8',
    env: { ...process.env, GITHUB_REPOSITORY: 'memphiscardcompany/ManeFlow' },
  });
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(await fs.readFile(output, 'utf8'));
  assert.equal(manifest.source.commitSha, 'c'.repeat(40));
  assert.equal(manifest.build.images.application.immutableReference, `ghcr.io/memphiscardcompany/maneflow@${appDigest}`);
  assert.equal(manifest.build.images.vision.immutableReference, `ghcr.io/memphiscardcompany/maneflow-vision@${visionDigest}`);
  assert.equal(manifest.supplyChain.signatureType, 'sigstore_keyless_oidc');
  assert.equal(manifest.deployment.performed, false);
  assert.equal(manifest.deployment.productionEnabled, false);
  assert.equal(manifest.safety.containsSecrets, false);
  assert.equal(JSON.stringify(manifest).includes('password'), false);
});

test('container release manifest generator rejects mutable or malformed references', async () => {
  const result = spawnSync(process.execPath, [
    path.join(root, 'scripts/create-container-release-manifest.mjs'),
    '--source-commit', 'not-a-sha',
    '--source-verify-run-id', '12345',
    '--release-workflow-run-id', '67890',
    '--application-image', 'ghcr.io/memphiscardcompany/maneflow:latest',
    '--application-digest', `sha256:${'a'.repeat(64)}`,
    '--vision-image', 'ghcr.io/memphiscardcompany/maneflow-vision',
    '--vision-digest', `sha256:${'b'.repeat(64)}`,
    '--output', '/tmp/should-not-exist.json',
  ], {
    encoding: 'utf8',
    env: { ...process.env, GITHUB_REPOSITORY: 'memphiscardcompany/ManeFlow' },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /source-commit is invalid/);
});
