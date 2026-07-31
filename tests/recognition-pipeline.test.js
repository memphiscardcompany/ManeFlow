import test from 'node:test';
import assert from 'node:assert/strict';

import { runRecognitionPipeline } from '../src/services/recognition-pipeline.js';

const card = {
  id: 'card-1',
  year: '2024',
  brand: 'Topps',
  set: 'Chrome',
  player: 'Example Player',
  cardNumber: '1',
  confidence: 0.96,
};

function supportedVision(overrides = {}) {
  return {
    physicalCardCount: 1,
    physicalCardDetected: true,
    detectorConfidence: 0.97,
    cropQuality: 'single-card',
    cardType: 'raw',
    facts: {
      year: '2024',
      brand: 'Topps',
      set: 'Chrome',
      player: 'Example Player',
      cardNumber: '1',
    },
    fieldConfidence: {
      year: 0.95,
      brand: 0.95,
      set: 0.95,
      player: 0.95,
      cardNumber: 0.95,
      parallel: 0.95,
    },
    imageQuality: {
      sharpness: 0.95,
      glare: 0.05,
      exposure: 0.9,
      resolution: 0.95,
      edgeCompleteness: 0.95,
      textReadability: 0.9,
      perspectiveDistortion: 0.05,
      occlusion: 0.02,
      compressionArtifacts: 0.03,
    },
    confidence: 0.95,
    ...overrides,
  };
}

test('keeps dedicated routing disabled by default', () => {
  const result = runRecognitionPipeline({ cards: [card], vision: supportedVision() });
  assert.equal(result.mode, 'legacy_safe_fallback');
  assert.equal(result.dedicatedRoutingEnabled, false);
  assert.equal(result.routing, null);
});

test('rejects explicit no-card scenes before identity work', () => {
  const result = runRecognitionPipeline({
    cards: [card],
    enableDedicatedRouting: true,
    sceneAnalysis: {
      scene: { type: 'no_card', cardCount: 0, noCard: true },
      detectedCards: [],
    },
    vision: { noCard: true, isCard: false },
  });
  assert.equal(result.routing.route, 'no_card');
  assert.equal(result.recognition.items.length, 0);
  assert.equal(result.recognition.primary, null);
  assert.match(result.recognition.message, /No physical card was detected/i);
});

test('runs supported single cards through routing and quality gates', () => {
  const result = runRecognitionPipeline({
    cards: [card],
    enableDedicatedRouting: true,
    vision: supportedVision(),
  });
  assert.equal(result.mode, 'dedicated_routing');
  assert.equal(result.routing.route, 'single_raw');
  assert.equal(result.quality[0].tier, 'fast_path');
  assert.equal(result.recognition.trustPolicy.dedicatedRoutingEnabled, true);
  assert.equal(result.recognition.trustPolicy.qualityGateEnforced, true);
});

test('quality gate removes exact acceptance for insufficient evidence', () => {
  const result = runRecognitionPipeline({
    cards: [card],
    enableDedicatedRouting: true,
    vision: supportedVision({
      imageQuality: {
        sharpness: 0.12,
        glare: 0.92,
        exposure: 0.4,
        resolution: 0.2,
        edgeCompleteness: 0.2,
        textReadability: 0.1,
        perspectiveDistortion: 0.7,
        occlusion: 0.75,
        compressionArtifacts: 0.6,
      },
    }),
  });
  assert.equal(result.quality[0].tier, 'insufficient_evidence');
  assert.equal(result.recognition.items[0].exact, false);
  assert.equal(result.recognition.items[0].requiresManualConfirmation, true);
  assert.ok(result.recognition.items[0].warnings.some((warning) => warning.startsWith('Image quality:')));
});

test('feature flag accepts environment-style string values', () => {
  const result = runRecognitionPipeline({
    cards: [card],
    featureFlags: { dedicatedRecognitionRouting: 'enabled' },
    vision: supportedVision(),
  });
  assert.equal(result.dedicatedRoutingEnabled, true);
});
