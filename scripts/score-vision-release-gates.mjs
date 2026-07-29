import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);

function argument(name, fallback = '') {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] || fallback : fallback;
}

function hasFlag(name) {
  return args.includes(`--${name}`);
}

function assertFiniteNumber(value, label, { min = -Infinity, max = Infinity } = {}) {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new TypeError(`${label} must be a finite number between ${min} and ${max}.`);
  }
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new TypeError('Benchmark manifest must be an object.');
  }
  if (manifest.schemaVersion !== 'maneflow-vision-benchmark-v1.0') {
    throw new TypeError('Unsupported benchmark schemaVersion.');
  }
  if (!String(manifest.benchmarkName || '').trim()) throw new TypeError('benchmarkName is required.');
  if (!Number.isInteger(manifest.humanLabeledImages) || manifest.humanLabeledImages < 0) {
    throw new TypeError('humanLabeledImages must be a non-negative integer.');
  }
  if (!manifest.metrics || typeof manifest.metrics !== 'object') throw new TypeError('metrics is required.');
  const probabilityMetrics = [
    'rawCardDetectionRecall',
    'slabIdentityCertAccuracy',
    'multiCardSegmentationRecall',
    'exactIdentityTop1Accuracy',
    'exactParallelVariantAccuracy',
    'falseConfidentMatchRate',
    'duplicateGroupingF1',
  ];
  for (const key of probabilityMetrics) assertFiniteNumber(manifest.metrics[key], `metrics.${key}`, { min: 0, max: 1 });
  for (const key of ['edgeP95LatencyMs', 'cloudP95LatencyMs']) assertFiniteNumber(manifest.metrics[key], `metrics.${key}`, { min: 0 });
  if (!Array.isArray(manifest.evidence) || manifest.evidence.length < 1) throw new TypeError('At least one evidence record is required.');
  for (const [index, evidence] of manifest.evidence.entries()) {
    if (!String(evidence?.kind || '').trim()) throw new TypeError(`evidence[${index}].kind is required.`);
    if (!String(evidence?.path || '').trim()) throw new TypeError(`evidence[${index}].path is required.`);
    if (!/^[a-f0-9]{64}$/.test(String(evidence?.sha256 || ''))) throw new TypeError(`evidence[${index}].sha256 must be lowercase SHA-256.`);
  }
}

function compare(value, rule) {
  if (rule.operator === 'gte') return value >= rule.threshold;
  if (rule.operator === 'lte') return value <= rule.threshold;
  throw new TypeError(`Unsupported release gate operator: ${rule.operator}`);
}

export function scoreVisionReleaseGate(manifest, gates, profileName) {
  validateManifest(manifest);
  const profile = gates?.profiles?.[profileName];
  if (!profile) throw new TypeError(`Unknown vision release profile: ${profileName}`);

  const checks = [];
  checks.push({
    metric: 'humanLabeledImages',
    value: manifest.humanLabeledImages,
    operator: 'gte',
    threshold: profile.minimumHumanLabeledImages,
    passed: manifest.humanLabeledImages >= profile.minimumHumanLabeledImages,
  });

  for (const [metric, rule] of Object.entries(profile.metrics || {})) {
    const value = manifest.metrics[metric];
    checks.push({ metric, value, operator: rule.operator, threshold: rule.threshold, passed: compare(value, rule) });
  }

  if (profile.requiresHeadToHeadComparison) {
    checks.push({
      metric: 'headToHeadComparisonCompleted',
      value: Boolean(manifest.headToHeadComparisonCompleted),
      operator: 'eq',
      threshold: true,
      passed: manifest.headToHeadComparisonCompleted === true,
    });
  }

  return {
    schemaVersion: 'maneflow-vision-gate-result-v1.0',
    generatedAt: new Date().toISOString(),
    benchmarkName: manifest.benchmarkName,
    profile: profileName,
    description: profile.description,
    passed: checks.every((item) => item.passed),
    checks,
    failedChecks: checks.filter((item) => !item.passed),
    evidence: manifest.evidence,
    disclaimer: profileName === 'superiority_claim'
      ? 'Passing these internal thresholds is necessary but not sufficient. The public claim must be supported by a reproducible, contemporaneous, identical-input comparison against each named competitor.'
      : 'This gate does not establish superiority over any competitor.',
  };
}

async function sha256File(filePath) {
  const bytes = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

async function verifyEvidence(manifest, manifestDirectory) {
  const results = [];
  for (const evidence of manifest.evidence) {
    const resolved = path.isAbsolute(evidence.path) ? evidence.path : path.resolve(manifestDirectory, evidence.path);
    try {
      const digest = await sha256File(resolved);
      results.push({ ...evidence, resolvedPath: resolved, actualSha256: digest, integrityPassed: digest === evidence.sha256 });
    } catch (error) {
      results.push({ ...evidence, resolvedPath: resolved, actualSha256: null, integrityPassed: false, error: error.message });
    }
  }
  return results;
}

async function main() {
  const manifestArg = argument('manifest');
  if (!manifestArg) {
    console.log('Usage: node scripts/score-vision-release-gates.mjs --manifest reports/vision-benchmark-manifest.json --profile private_beta --out reports/vision-gate-result.json');
    process.exitCode = 2;
    return;
  }

  const manifestPath = path.resolve(manifestArg);
  const gatesPath = path.resolve(argument('gates', 'config/vision-release-gates.json'));
  const profile = argument('profile', 'private_beta');
  const [manifest, gates] = await Promise.all([
    fs.readFile(manifestPath, 'utf8').then(JSON.parse),
    fs.readFile(gatesPath, 'utf8').then(JSON.parse),
  ]);

  const result = scoreVisionReleaseGate(manifest, gates, profile);
  if (!hasFlag('skip-evidence-integrity')) {
    result.evidenceIntegrity = await verifyEvidence(manifest, path.dirname(manifestPath));
    const failedIntegrity = result.evidenceIntegrity.filter((item) => !item.integrityPassed);
    if (failedIntegrity.length) {
      result.passed = false;
      result.failedChecks.push({
        metric: 'evidenceIntegrity',
        value: failedIntegrity.length,
        operator: 'eq',
        threshold: 0,
        passed: false,
      });
    }
  }

  const output = `${JSON.stringify(result, null, 2)}\n`;
  console.log(output.trimEnd());
  const outPath = argument('out');
  if (outPath) {
    const resolved = path.resolve(outPath);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, output);
  }
  if (!result.passed) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 2;
  });
}
