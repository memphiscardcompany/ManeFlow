import test from 'node:test';
import assert from 'node:assert/strict';
import cards from '../src/data/cards.json' with { type: 'json' };
import { pairImagesWithBenchmarkCases, benchmarkImageKey, isSupportedBenchmarkImage } from '../src/services/recognition-folder-benchmark.js';
import { runRecognitionBenchmark } from '../src/services/recognition-benchmark.js';

test('folder benchmark pairs image files to JSON/CSV label cases', () => {
  const images = [
    { imagePath: '/bench/binder-page-01.jpg', imageRef: 'binder-page-01.jpg', imageName: 'binder-page-01.jpg' },
    { imagePath: '/bench/table-lot-02.png', imageRef: 'table-lot-02.png', imageName: 'table-lot-02.png' },
    { imagePath: '/bench/unlabeled.webp', imageRef: 'unlabeled.webp', imageName: 'unlabeled.webp' },
  ];
  const cases = [
    { imageName: 'binder-page-01.jpg', sceneType: 'binder_page', expectedCards: [{ player: 'Shohei Ohtani', year: 2018, brand: 'Topps', set: 'Update Series', cardNumber: 'US1' }] },
    { imageName: 'table-lot-02.png', sceneType: 'multi_card_table', expectedCards: [{ player: 'Charizard', year: 1999, brand: 'Wizards of the Coast', set: 'Pokemon Base Set', cardNumber: '4/102' }] },
  ];
  const paired = pairImagesWithBenchmarkCases(images, cases, { sourceName: 'Owner Phone Photos' });
  assert.equal(paired.summary.imagesFound, 3);
  assert.equal(paired.summary.labeledImages, 2);
  assert.equal(paired.summary.unlabeledImages, 1);
  assert.equal(paired.pairedCases[0].folderImage.imageName, 'binder-page-01.jpg');
  assert.equal(benchmarkImageKey('Binder Page 01.JPG'), 'binderpage01');
  assert.equal(isSupportedBenchmarkImage('scan.avif'), true);
});

test('recognition reports include field, scene, multi-card focus, and failure summaries', () => {
  const cases = [
    { imageName: 'binder-page-01.jpg', sceneType: 'binder_page', expectedCards: [
      { player: 'Shohei Ohtani', year: 2018, brand: 'Topps', set: 'Update Series', cardNumber: 'US1', parallel: 'Base Rookie Debut' },
      { player: 'Charizard', year: 1999, brand: 'Wizards of the Coast', set: 'Pokemon Base Set', cardNumber: '4/102', parallel: 'Holo Unlimited' },
    ] },
    {
      imageName: 'table-unknown.jpg',
      sceneType: 'multi_card_table',
      expectedCards: [
        { player: 'Uncataloged Prospect', year: 2026, brand: 'Future Brand', set: 'Missing Release', cardNumber: 'RC-1', parallel: 'Gold Vinyl 1/1' },
      ],
      sceneAnalysis: {
        scene: { type: 'multi_card_table', cardCount: 1 },
        detectedCards: [{
          facts: { player: 'Wrong Player', year: 2026, brand: 'Wrong Brand', set: 'Wrong Set', cardNumber: 'RC-9', parallel: 'Base' },
          fieldConfidence: { player: 0.88, year: 0.72, brand: 0.78, set: 0.71, cardNumber: 0.8, parallel: 0.48 },
        }],
      },
    },
  ];
  const report = runRecognitionBenchmark(cases, { cards, enrichCard: (card) => card });
  assert.equal(report.metrics.totalCases, 2);
  assert.equal(report.multiCardFocus.cases, 2);
  assert.ok(report.sceneBreakdown.some((row) => row.sceneType === 'binder_page'));
  assert.ok(report.fieldBreakdown.player.total >= 3);
  assert.ok(report.failurePatterns.missedTop1 >= 1);
  assert.ok(report.failurePatterns.weakFields.some((row) => row.field === 'player' || row.field === 'brand' || row.field === 'set'));
});

test('recognition benchmark treats listing-image scaffolds as unlabeled accuracy inputs', () => {
  const report = runRecognitionBenchmark([{
    imageName: 'ebay-lot-scaffold.jpg',
    sceneType: 'multi_card_table',
    manualText: 'Shohei Ohtani lot active listing image',
    expectedCards: [],
  }], { cards, enrichCard: (card) => card });
  assert.equal(report.metrics.totalCases, 1);
  assert.equal(report.metrics.totalExpectedCards, 0);
  assert.equal(report.rows[0].perCard.length, 0);
  assert.ok(report.recommendations.some((item) => /Add expected card labels/i.test(item)));
});
