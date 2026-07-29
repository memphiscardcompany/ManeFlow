import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { scoreVisionReleaseGate } from '../scripts/score-vision-release-gates.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gates = JSON.parse(fs.readFileSync(path.join(root, 'config/vision-release-gates.json'), 'utf8'));

function manifest(overrides = {}) {
  const { metrics: metricOverrides = {}, ...topLevelOverrides } = overrides;
  return {
    schemaVersion: 'maneflow-vision-benchmark-v1.0',
    benchmarkName: 'Test benchmark',
    generatedAt: new Date().toISOString(),
    humanLabeledImages: 600,
    headToHeadComparisonCompleted: false,
    evidence: [{ kind: 'test', path: 'evidence.json', sha256: 'a'.repeat(64) }],
    ...topLevelOverrides,
    metrics: {
      rawCardDetectionRecall: 0.99,
      slabIdentityCertAccuracy: 0.98,
      multiCardSegmentationRecall: 0.95,
      exactIdentityTop1Accuracy: 0.91,
      exactParallelVariantAccuracy: 0.85,
      falseConfidentMatchRate: 0.01,
      duplicateGroupingF1: 0.94,
      edgeP95LatencyMs: 180,
      cloudP95LatencyMs: 1800,
      ...metricOverrides,
    },
  };
}

test('private beta profile passes a complete qualifying manifest', () => {
  const result = scoreVisionReleaseGate(manifest(), gates, 'private_beta');
  assert.equal(result.passed, true);
  assert.equal(result.failedChecks.length, 0);
});

test('false confident rate blocks release when above threshold', () => {
  const result = scoreVisionReleaseGate(manifest({ metrics: { falseConfidentMatchRate: 0.04 } }), gates, 'private_beta');
  assert.equal(result.passed, false);
  assert.equal(result.failedChecks.some((item) => item.metric === 'falseConfidentMatchRate'), true);
});

test('superiority profile requires labeled scale and completed head-to-head comparison', () => {
  const result = scoreVisionReleaseGate(manifest(), gates, 'superiority_claim');
  assert.equal(result.passed, false);
  assert.equal(result.failedChecks.some((item) => item.metric === 'humanLabeledImages'), true);
  assert.equal(result.failedChecks.some((item) => item.metric === 'headToHeadComparisonCompleted'), true);
});
