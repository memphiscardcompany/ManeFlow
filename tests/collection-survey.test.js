import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../src/services/store.js';
import { buildCollectionSurvey, estimateSurveyObject, saveCollectionSurvey } from '../src/services/collection-survey.js';

test('container capacity returns conservative range instead of false precision', () => {
  const result = estimateSurveyObject({ kind: 'five_row_box', contentType: 'raw', fullness: .75, confidence: .6 });
  assert.equal(result.method, 'container_capacity');
  assert.ok(result.low < result.expected);
  assert.ok(result.expected < result.high);
  assert.equal(result.expected % 100, 0);
});

test('non-inventory objects never enter collection totals', () => {
  const survey = buildCollectionSurvey({ objects: [
    { kind: 'five_row_box', contentType: 'raw', fullness: 1, confidence: .8 },
    { kind: 'furniture', category: 'non_inventory', directCount: 1, confidence: .99 },
  ] });
  assert.equal(survey.objects[1].excluded, true);
  assert.equal(survey.countEstimate.expected, 4000);
});

test('multi-view stable keys create duplicate-review records and prevent double counting', () => {
  const survey = buildCollectionSurvey({ objects: [
    { kind: 'graded_card_box', contentType: 'slab', fullness: 1, confidence: .8, stableKey: 'shelf-a-box-1' },
    { kind: 'graded_card_box', contentType: 'slab', fullness: 1, confidence: .8, stableKey: 'shelf-a-box-1' },
  ] });
  assert.equal(survey.scene.uniqueObjects, 1);
  assert.equal(survey.scene.possibleDuplicates.length, 1);
  assert.equal(survey.countEstimate.expected, 110);
  assert.equal(survey.review.humanReviewRequired, true);
});

test('survey persistence is user scoped and audited', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'maneflow-survey-'));
  try {
    const store = await new JsonStore(path.join(dir, 'state.json')).init();
    const survey = await saveCollectionSurvey(store, { userId: 'owner' }, { title: 'Storage room', objects: [{ kind: 'one_row_box', fullness: .5, contentType: 'raw' }] });
    assert.equal(survey.userId, 'owner');
    assert.equal(store.state.collectionSurveys.length, 1);
    assert.ok(store.state.auditLog.some((event) => event.type === 'collection_survey_created'));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
