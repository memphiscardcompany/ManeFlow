import assert from 'node:assert/strict';
import test from 'node:test';
import { validateVisionExtractionResult, VisionContractError } from '../src/contracts/visionExtractionContract.js';

function validPayload() {
  return {
    contract_version: 'vision-extraction.v1',
    scan_id: '2f8e78be-c814-4aa5-9f48-5e2016e5468f',
    predicted_card: {},
    identity_confidence: 0.75,
    variant_confidence: 0.5,
    detected_object_count: 1,
    pricing_status: 'price_unverifiable',
    confidence_score: 0,
    comps_used: 0,
    outliers_removed: 0,
    explanation: 'No verified sold comps were available.',
    warnings: [],
    created_at: new Date().toISOString(),
  };
}

test('vision contract accepts a complete result without an optional embedding', () => {
  const payload = validPayload();
  assert.equal(validateVisionExtractionResult(payload), payload);
});

test('vision contract accepts a normalized 1152-dimensional embedding', () => {
  const payload = validPayload();
  payload.visual_embedding = {
    vector: Array.from({ length: 1152 }, (_, index) => index / 1152),
    model_name: 'siglip2-card-front-v1',
    provider: 'CUDAExecutionProvider',
    dimensions: 1152,
    normalized: true,
  };
  assert.equal(validateVisionExtractionResult(payload, { requireEmbedding: true }), payload);
});

test('vision contract rejects malformed confidence and vector dimensions', () => {
  const payload = validPayload();
  payload.identity_confidence = 1.2;
  payload.visual_embedding = {
    vector: [1, 2, 3], model_name: 'bad', provider: 'cpu', dimensions: 3, normalized: false,
  };
  assert.throws(
    () => validateVisionExtractionResult(payload),
    (error) => error instanceof VisionContractError && /1152/.test(error.message) && /identity_confidence/.test(error.message),
  );
});
