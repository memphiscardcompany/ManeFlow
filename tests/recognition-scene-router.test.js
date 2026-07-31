import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RECOGNITION_SCENE_ROUTES,
  routeRecognitionScene,
} from '../src/services/recognition-scene-router.js';

test('routes explicit no-card scenes without creating a card record', () => {
  const result = routeRecognitionScene({ noCard: true, sceneType: 'empty_scene' });
  assert.equal(result.route, RECOGNITION_SCENE_ROUTES.NO_CARD);
  assert.equal(result.plan.allowCardRecord, false);
  assert.equal(result.plan.expectedRegionCount, 0);
});

test('routes one detected slab to the cert-first fast path', () => {
  const result = routeRecognitionScene({
    detectedCardCount: 1,
    slabCount: 1,
    detectorConfidence: 0.96,
    detections: [{ class: 'slab', confidence: 0.96 }],
  });
  assert.equal(result.route, RECOGNITION_SCENE_ROUTES.SINGLE_SLAB);
  assert.equal(result.plan.strategy, 'cert_first');
  assert.ok(result.plan.nextStages.includes('official_cert_verification'));
});

test('routes binder evidence before generic multi-card evidence', () => {
  const result = routeRecognitionScene({
    sceneType: 'binder_page',
    detectedCardCount: 9,
    binderPocketCount: 9,
    occupiedPocketCount: 8,
    detectorConfidence: 0.92,
  });
  assert.equal(result.route, RECOGNITION_SCENE_ROUTES.BINDER_PAGE);
  assert.equal(result.plan.strategy, 'binder_grid');
  assert.equal(result.plan.expectedRegionCount, 9);
});

test('routes dense loose spreads to tiled microbatches', () => {
  const result = routeRecognitionScene({
    sceneType: 'multi_card_spread',
    detectedCardCount: 36,
    detectorConfidence: 0.9,
  });
  assert.equal(result.route, RECOGNITION_SCENE_ROUTES.MULTI_CARD);
  assert.equal(result.plan.strategy, 'tiled_microbatch');
  assert.equal(result.plan.expectedRegionCount, 36);
});

test('rejects weak scene-sized single-region evidence as uncertain or overview', () => {
  const result = routeRecognitionScene({
    detectedCardCount: 1,
    detectorConfidence: 0.42,
    largestRegionAreaRatio: 0.97,
    collectionOverviewConfidence: 0.72,
  });
  assert.ok([
    RECOGNITION_SCENE_ROUTES.COLLECTION_OVERVIEW,
    RECOGNITION_SCENE_ROUTES.UNCERTAIN,
  ].includes(result.route));
  assert.equal(result.plan.allowCardRecord, false);
});

test('keeps a detector-confirmed partial card reviewable', () => {
  const result = routeRecognitionScene({
    detectedCardCount: 1,
    detectorConfidence: 0.88,
    cropQuality: 'partial-card',
    edgeCompleteness: 0.54,
  });
  assert.equal(result.route, RECOGNITION_SCENE_ROUTES.PARTIAL_CARD);
  assert.equal(result.plan.allowCardRecord, true);
  assert.equal(result.plan.strategy, 'partial_evidence');
});

test('abstains when route confidence or separation is insufficient', () => {
  const result = routeRecognitionScene({
    detectedCardCount: 1,
    detectorConfidence: 0.6,
    stackConfidence: 0.62,
    cropQuality: 'single-card',
    minimumRouteMargin: 0.2,
  });
  assert.equal(result.route, RECOGNITION_SCENE_ROUTES.UNCERTAIN);
  assert.equal(result.plan.allowCardRecord, false);
  assert.ok(result.warnings.length > 0);
});

test('returns deterministic route metadata and bounded timing', () => {
  const input = {
    detectedCardCount: 1,
    detectorConfidence: 0.95,
    cardType: 'raw',
    cropQuality: 'single-card',
  };
  const first = routeRecognitionScene(input);
  const second = routeRecognitionScene(input);
  assert.equal(first.route, second.route);
  assert.deepEqual(first.rankedRoutes, second.rankedRoutes);
  assert.ok(first.timingMs >= 0);
  assert.ok(first.timingMs < 100);
});
