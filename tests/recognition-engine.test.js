import test from 'node:test';
import assert from 'node:assert/strict';
import cards from '../src/data/cards.json' with { type: 'json' };
import { classifyRecognitionScene, recognizeCardScene } from '../src/services/recognition-engine.js';

const image = (char = 'a', length = 7000) => `data:image/jpeg;base64,${char.repeat(length)}`;

function market(card) {
  return {
    ...card,
    market: {
      value: card.player === 'Michael Jordan' ? 5000 : 125,
      confidence: 82,
      volume90: 8,
    },
  };
}

test('recognition engine classifies binder scenes and recognizes multiple regions', () => {
  const recognition = recognizeCardScene({
    cards,
    body: { frontDataUrl: image(), backDataUrl: image('b'), imageName: 'binder-page.jpg' },
    sceneAnalysis: {
      scene: { type: 'binder_page', cardCount: 2, layoutRows: 3, layoutColumns: 3, difficulty: 'hard' },
      detectedCards: [
        {
          regionId: 'pocket_1',
          boundingBox: { x: 0.05, y: 0.06, width: 0.28, height: 0.28 },
          facts: { player: 'Shohei Ohtani', year: 2018, brand: 'Topps', set: 'Update Series', cardNumber: 'US1', parallel: 'Base Rookie Debut' },
          fieldConfidence: { player: 0.96, year: 0.94, brand: 0.9, set: 0.88, cardNumber: 0.95, parallel: 0.76 },
          imageQuality: { blur: 'none', glare: 'mild', crop: 'full_card', lighting: 'good', angle: 'flat' },
        },
        {
          regionId: 'pocket_2',
          boundingBox: { x: 0.37, y: 0.06, width: 0.28, height: 0.28 },
          facts: { player: 'Charizard', year: 1999, brand: 'Wizards of the Coast', set: 'Pokemon Base Set', cardNumber: '4/102', parallel: 'Holo Unlimited' },
          fieldConfidence: { player: 0.97, year: 0.92, brand: 0.86, set: 0.9, cardNumber: 0.96, parallel: 0.82 },
          imageQuality: { blur: 'none', glare: 'none', crop: 'full_card', lighting: 'good', angle: 'flat' },
        },
      ],
    },
    enrichCard: market,
  });
  assert.equal(recognition.scene.type, 'binder_page');
  assert.equal(recognition.summary.detectedCards, 2);
  assert.equal(recognition.items[0].matches[0].id, 'card_ohtani_2018_update_us1_psa10');
  assert.equal(recognition.items[1].matches[0].id, 'card_charizard_1999_base_4_psa9');
  assert.ok(recognition.items.every((item) => item.boundingBox.width > 0));
  assert.ok(Object.keys(recognition.summary.pathCounts).length >= 1);
});

test('recognition engine returns top candidates and requires confirmation for uncertain parallels', () => {
  const customCards = [
    { id: 'card_prizm_gold', year: 2023, brand: 'Panini', set: 'Prizm Basketball', player: 'Victor Wembanyama', cardNumber: '136', parallel: 'Gold Prizm', sport: 'Basketball', grade: { company: 'Raw', grade: 'Raw' } },
    { id: 'card_prizm_silver', year: 2023, brand: 'Panini', set: 'Prizm Basketball', player: 'Victor Wembanyama', cardNumber: '136', parallel: 'Silver Prizm', sport: 'Basketball', grade: { company: 'Raw', grade: 'Raw' } },
    { id: 'card_prizm_base', year: 2023, brand: 'Panini', set: 'Prizm Basketball', player: 'Victor Wembanyama', cardNumber: '136', parallel: 'Base', sport: 'Basketball', grade: { company: 'Raw', grade: 'Raw' } },
  ];
  const recognition = recognizeCardScene({
    cards: customCards,
    body: { frontDataUrl: image(), imageName: 'table-layout.jpg' },
    sceneAnalysis: {
      scene: { type: 'multi_card_table', cardCount: 1, difficulty: 'hard' },
      detectedCards: [{
        boundingBox: { x: 0.1, y: 0.1, width: 0.5, height: 0.7 },
        facts: { player: 'Victor Wembanyama', year: 2023, brand: 'Panini', set: 'Prizm Basketball', cardNumber: '136', parallel: 'uncertain' },
        fieldConfidence: { player: 0.92, year: 0.9, brand: 0.86, set: 0.82, cardNumber: 0.9, parallel: 0.32 },
        candidateDescriptions: [{ description: '2023 Prizm Victor Wembanyama 136 possible Silver or Base', confidence: 0.62 }],
      }],
    },
    enrichCard: (card) => ({ ...card, market: { value: 450, confidence: 70, volume90: 2 } }),
  });
  assert.equal(recognition.items[0].requiresManualConfirmation, true);
  assert.ok(recognition.items[0].topCandidates.length >= 3);
  assert.ok(recognition.items[0].scanConfidence.manualConfirmationReasons.some((reason) => /parallel/i.test(reason)));
  assert.ok(['accurate_path', 'dual_path'].includes(recognition.items[0].path));
});

test('recognition engine learns from prior user corrections when candidates are otherwise close', () => {
  const customCards = [
    { id: 'card_test_gold', year: 2026, brand: 'Topps', set: 'Chrome Baseball', player: 'Test Player', cardNumber: '101', parallel: 'Gold', sport: 'Baseball', grade: { company: 'Raw', grade: 'Raw' } },
    { id: 'card_test_base', year: 2026, brand: 'Topps', set: 'Chrome Baseball', player: 'Test Player', cardNumber: '101', parallel: 'Base', sport: 'Baseball', grade: { company: 'Raw', grade: 'Raw' } },
  ];
  const recognition = recognizeCardScene({
    cards: customCards,
    body: { frontDataUrl: image(), imageName: 'scan.jpg' },
    sceneAnalysis: {
      scene: { type: 'single_card', cardCount: 1 },
      detectedCards: [{
        boundingBox: { x: 0.1, y: 0.1, width: 0.6, height: 0.8 },
        facts: { player: 'Test Player', year: 2026, brand: 'Topps', set: 'Chrome Baseball', cardNumber: '101' },
        fieldConfidence: { player: 0.9, year: 0.9, brand: 0.86, set: 0.86, cardNumber: 0.9, parallel: 0.2 },
      }],
    },
    corrections: [{ selectedCardId: 'card_test_base', correctedFields: { parallel: 'Base', set: 'Chrome Baseball' }, reason: 'User selected base after checking the back.' }],
    enrichCard: (card) => ({ ...card, market: { value: 20, confidence: 66, volume90: 3 } }),
  });
  assert.equal(recognition.items[0].matches[0].id, 'card_test_base');
  assert.ok(recognition.items[0].matches[0].learnedCorrectionBoost > 0);
  assert.equal(recognition.trustPolicy.correctionsImproveFutureRanking, true);
});

test('recognition engine degrades honestly to manual text when no image or AI scene exists', () => {
  const scene = classifyRecognitionScene({ body: { manualText: '1986 Fleer Michael Jordan 57 PSA 8' } });
  assert.equal(scene.type, 'manual_text');
  const recognition = recognizeCardScene({
    cards,
    body: { manualText: '1986 Fleer Michael Jordan 57 PSA 8' },
    enrichCard: market,
  });
  assert.equal(recognition.scene.type, 'manual_text');
  assert.equal(recognition.summary.detectedCards, 1);
  assert.equal(recognition.items[0].matches[0].id, 'card_jordan_1986_fleer_57_psa8');
  assert.equal(recognition.items[0].requiresManualConfirmation, true);
});

test('image-only input without detector or identity evidence creates no card region', () => {
  const recognition = recognizeCardScene({
    cards,
    body: { frontDataUrl: image(), imageName: 'collection-room.jpg' },
    enrichCard: market,
  });
  assert.equal(recognition.scene.type, 'unknown');
  assert.equal(recognition.scene.cardCount, 0);
  assert.equal(recognition.summary.detectedCards, 0);
  assert.equal(recognition.items.length, 0);
  assert.equal(recognition.primary, null);
  assert.match(recognition.message, /No individual physical card region was confirmed/i);
  assert.equal(recognition.trustPolicy.unconfirmedImagesCreateNoRegion, true);
});

test('explicit no-card scene rejects detector-like fallback content', () => {
  const recognition = recognizeCardScene({
    cards,
    body: { frontDataUrl: image(), imageName: 'phone-screenshot.png' },
    sceneAnalysis: {
      scene: { type: 'no_card', cardCount: 0, processingStrategy: 'physical_presence_gate' },
      detectedCards: [{
        boundingBox: { x: 0, y: 0, width: 1, height: 1 },
        facts: { visibleText: ['Memphis Card Company'] },
      }],
    },
    enrichCard: market,
  });
  assert.equal(recognition.scene.type, 'no_card');
  assert.equal(recognition.summary.detectedCards, 0);
  assert.equal(recognition.items.length, 0);
});

test('supported single-card vision evidence remains reviewable without a detector region', () => {
  const vision = {
    facts: {
      player: 'Shohei Ohtani',
      year: 2018,
      brand: 'Topps',
      set: 'Update Series',
      cardNumber: 'US1',
    },
    fieldConfidence: {
      player: 0.96,
      year: 0.94,
      brand: 0.9,
      set: 0.88,
      cardNumber: 0.95,
    },
    confidence: 0.91,
    provider: 'verified_test_vision',
  };
  const recognition = recognizeCardScene({
    cards,
    body: { frontDataUrl: image(), imageName: 'single-card.jpg' },
    sceneAnalysis: {
      scene: { type: 'single_card', cardCount: 1, processingStrategy: 'vision_scene' },
      detectedCards: [],
      primaryCard: vision,
    },
    vision,
    enrichCard: market,
  });
  assert.equal(recognition.scene.type, 'single_card');
  assert.equal(recognition.summary.detectedCards, 1);
  assert.equal(recognition.items[0].matches[0].id, 'card_ohtani_2018_update_us1_psa10');
});
