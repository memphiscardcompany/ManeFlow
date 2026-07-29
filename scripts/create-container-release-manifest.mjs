#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

function parseArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) throw new TypeError(`Unexpected argument: ${key}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new TypeError(`Missing value for ${key}`);
    result[key.slice(2)] = value;
    index += 1;
  }
  return result;
}

function required(value, name, pattern = null) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new TypeError(`${name} is required.`);
  if (pattern && !pattern.test(normalized)) throw new TypeError(`${name} is invalid.`);
  return normalized;
}

function imageName(value, name) {
  const normalized = required(value, name, /^ghcr\.io\/[a-z0-9](?:[a-z0-9._/-]*[a-z0-9])?$/);
  if (normalized.includes('@') || normalized.includes(':sha-')) {
    throw new TypeError(`${name} must be an untagged image name.`);
  }
  return normalized;
}

function digest(value, name) {
  return required(value, name, /^sha256:[0-9a-f]{64}$/);
}

const args = parseArguments(process.argv.slice(2));
const sourceCommit = required(args['source-commit'], 'source-commit', /^[0-9a-f]{40}$/);
const application = {
  name: imageName(args['application-image'], 'application-image'),
  digest: digest(args['application-digest'], 'application-digest'),
};
const vision = {
  name: imageName(args['vision-image'], 'vision-image'),
  digest: digest(args['vision-digest'], 'vision-digest'),
};
if (application.digest === vision.digest) throw new TypeError('Application and vision digests must be different.');

const repository = required(process.env.GITHUB_REPOSITORY, 'GITHUB_REPOSITORY', /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
const workflowIdentity = `https://github.com/${repository}/.github/workflows/publish-containers.yml@refs/heads/main`;
const output = path.resolve(required(args.output, 'output'));
const generatedAt = new Date().toISOString();

const manifest = {
  schemaVersion: 1,
  product: 'ManeFlow',
  releaseType: 'signed_private_container_candidate',
  source: {
    repository,
    commitSha: sourceCommit,
    sourceUrl: `https://github.com/${repository}/commit/${sourceCommit}`,
    verificationWorkflow: 'Verify ManeFlow',
    verificationWorkflowRunId: required(args['source-verify-run-id'], 'source-verify-run-id', /^[A-Za-z0-9._:-]+$/),
  },
  build: {
    releaseWorkflow: 'Publish ManeFlow containers',
    releaseWorkflowRunId: required(args['release-workflow-run-id'], 'release-workflow-run-id', /^\d+$/),
    generatedAt,
    targetPlatform: 'linux/amd64',
    registry: 'ghcr.io',
    images: {
      application: {
        ...application,
        immutableReference: `${application.name}@${application.digest}`,
        sourceDockerfile: 'Dockerfile',
      },
      vision: {
        ...vision,
        immutableReference: `${vision.name}@${vision.digest}`,
        sourceDockerfile: 'vision-worker/Dockerfile',
      },
    },
  },
  supplyChain: {
    buildkitProvenance: 'mode=max',
    buildkitSbom: true,
    signatureType: 'sigstore_keyless_oidc',
    signatureIssuer: 'https://token.actions.githubusercontent.com',
    signatureIdentity: workflowIdentity,
    transparencyLog: 'public_sigstore_rekor',
  },
  deployment: {
    performed: false,
    productionEnabled: false,
    requiredReferenceForm: 'name@sha256:digest',
  },
  safety: {
    containsSecrets: false,
    containsPrivateCustomerData: false,
    containsTrainingImages: false,
    containsModelWeights: false,
  },
};

await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({
  ok: true,
  output,
  sourceCommit,
  application: manifest.build.images.application.immutableReference,
  vision: manifest.build.images.vision.immutableReference,
}, null, 2));
