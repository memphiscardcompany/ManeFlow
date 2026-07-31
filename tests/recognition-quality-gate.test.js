import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RECOGNITION_QUALITY_TIERS,
  evaluateRecognitionQuality,
} from '../src/services/recognition-quality-gate.js';

test('routes a clear complete card to the fast path', () => {
  const result = evaluateRecognitionQuality({
    sharpness: 0.94,
    glare: 0.08,
    exposure: 0.88,
    resolution: 0.95,
    edgeCompleteness: 0.96,
    textReadability: 0.9,
    perspectiveDistortion: 0.08,
    occlusion: 0.02,
    compressionArtifacts: 0.05,
  });
  assert.equal(result.tier, RECOGNITION_QUALITY_TIERS.FAST);
  assert.equal(result.allowExactIdentity, true);
  assert.equal(result.allowPricing, false);
});

test('routes moderate glare and readability to controlled enhancement', () => {
  const result = evaluateRecognitionQuality({
    sharpness: 0.7,
    glare: 0.42,
    exposure: 0.72,
    resolution: 0.8,
    edgeCompleteness: 0.82,
    textReadability: 0.58,
    perspectiveDistortion: 0.2,
    occlusion: 0.1,
    compressionArtifacts: 0.12,
  });
  assert.equal(result.tier, RECOGNITION_QUALITY_TIERS.ENHANCE);
  assert.equal(result.allowCandidateRetrieval, true);
  assert.ok(result.actions.includes('generate_controlled_variants'));
});

test('severe blur fails closed before expensive identification', () => {
  const result = evaluateRecognitionQuality({
    sharpness: 0.12,
    glare: 0.1,
    exposure: 0.7,
    resolution: 0.8,
    edgeCompleteness: 0.85,
    textReadability: 0.2,
    perspectiveDistortion: 0.1,
    occlusion: 0.1,
  });
  assert.equal(result.tier, RECOGNITION_QUALITY_TIERS.INSUFFICIENT);
  assert.equal(result.allowCandidateRetrieval, false);
  assert.ok(result.criticalFailures.includes('image_too_blurry'));
});

test('incomplete card edges request another view without inventing identity', () => {
  const result = evaluateRecognitionQuality({
    sharpness: 0.82,
    glare: 0.12,
    exposure: 0.8,
    resolution: 0.85,
    edgeCompleteness: 0.28,
    textReadability: 0.72,
    perspectiveDistortion: 0.12,
    occlusion: 0.18,
  });
  assert.equal(result.tier, RECOGNITION_QUALITY_TIERS.INSUFFICIENT);
  assert.equal(result.allowExactIdentity, false);
  assert.ok(result.actions.includes('request_full_card_edges'));
});

test('quality evaluation is deterministic and fast', () => {
  const input = {
    sharpness: 0.8,
    glare: 0.2,
    exposure: 0.8,
    resolution: 0.8,
    edgeCompleteness: 0.8,
    textReadability: 0.8,
    perspectiveDistortion: 0.1,
    occlusion: 0.1,
    compressionArtifacts: 0.1,
  };
  const first = evaluateRecognitionQuality(input);
  const second = evaluateRecognitionQuality(input);
  assert.equal(first.tier, second.tier);
  assert.equal(first.qualityScore, second.qualityScore);
  assert.ok(first.timingMs >= 0 && first.timingMs < 100);
});
