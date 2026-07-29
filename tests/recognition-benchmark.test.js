import test from 'node:test';
import assert from 'node:assert/strict';
import cards from '../src/data/cards.json' with { type: 'json' };
import { parseRecognitionBenchmarkInput, runRecognitionBenchmark } from '../src/services/recognition-benchmark.js';

test('recognition benchmark parses dataset-style label rows and reports accuracy', () => {
  const input = {
    sourceName: 'GotThatData Sports Cards Dataset',
    cases: [{
      id: 'binder_ohtani_charizard',
      imageName: 'binder_page_sample.jpg',
      text: JSON.stringify({
        sceneType: 'binder_page',
        observedScene: {
          scene: { type: 'binder_page', cardCount: 2, processingStrategy: 'test_observed_regions' },
          detectedCards: [
            { regionId: 'region_1', facts: { player: 'Shohei Ohtani', year: 2018, brand: 'Topps', set: 'Update Series', cardNumber: 'US1', parallel: 'Base Rookie Debut' } },
            { regionId: 'region_2', facts: { player: 'Charizard', year: 1999, brand: 'Wizards of the Coast', set: 'Pokemon Base Set', cardNumber: '4/102', parallel: 'Holo Unlimited' } },
          ],
        },
        expectedCards: [
          { player: 'Shohei Ohtani', year: 2018, brand: 'Topps', set: 'Update Series', cardNumber: 'US1', parallel: 'Base Rookie Debut' },
          { player: 'Charizard', year: 1999, brand: 'Wizards of the Coast', set: 'Pokemon Base Set', cardNumber: '4/102', parallel: 'Holo Unlimited' },
        ],
      }),
    }],
  };
  const cases = parseRecognitionBenchmarkInput(input);
  assert.equal(cases.length, 1);
  assert.equal(cases[0].sceneType, 'binder_page');
  assert.equal(cases[0].expectedCards.length, 2);

  const report = runRecognitionBenchmark(cases, { cards, enrichCard: (card) => card });
  assert.equal(report.metrics.totalCases, 1);
  assert.equal(report.metrics.totalExpectedCards, 2);
  assert.equal(report.metrics.scorableCases, 1);
  assert.equal(report.metrics.sceneAccuracy, 100);
  assert.equal(report.metrics.top3Accuracy, 100);
  assert.equal(report.policy.benchmarkOnly, true);
  assert.equal(report.policy.doesNotCreateMarketValues, true);
});

test('recognition benchmark refuses to score ground-truth labels as model observations', () => {
  const cases = parseRecognitionBenchmarkInput([{
    id: 'unknown_new_release_parallel',
    sourceName: 'Owner Phone Photos',
    imageName: 'table_new_release_unknown.jpg',
    expectedCards: [{ player: 'New Player', year: 2026, brand: 'Future Brand', set: 'Uncataloged Chrome', cardNumber: 'RC-1', parallel: 'Blue Wave /99' }],
  }]);
  const report = runRecognitionBenchmark(cases, { cards, enrichCard: (card) => card });
  assert.equal(report.metrics.scorableCases, 0);
  assert.equal(report.metrics.unscorableCases, 1);
  assert.equal(report.metrics.totalExpectedCards, 0);
  assert.equal(report.metrics.top1Accuracy, 0);
  assert.ok(report.recommendations.some((entry) => /observed|ground-truth|labels/i.test(entry)));
  assert.equal(report.rows[0].scorable, false);
  assert.equal(report.policy.doesNotPublishDatasetImages, true);
});
