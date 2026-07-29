import test from 'node:test';
import assert from 'node:assert/strict';
import cards from '../src/data/cards.json' with { type: 'json' };
import { identifyCard } from '../src/services/identification.js';

test('manual identification ranks exact player/year card first', () => {
  const result = identifyCard({ cards, manualText: '2018 Shohei Ohtani US1 PSA 10' });
  assert.equal(result.matches[0].id, 'card_ohtani_2018_update_us1_psa10');
  assert.ok(result.matches[0].confidence > 0.75);
});

test('vision field confidence feeds the catalog matcher as a second brain', () => {
  const result = identifyCard({
    cards,
    vision: {
      facts: {
        player: 'Shohei Ohtani',
        year: 2018,
        brand: 'Topps',
        set: 'Update Series',
        cardNumber: 'US1',
        parallel: 'Base Rookie Debut',
        grader: 'PSA',
        grade: '10',
        visibleText: ['Topps', 'US1', 'Ohtani'],
      },
      fieldConfidence: {
        player: 0.95,
        year: 0.93,
        set: 0.85,
        cardNumber: 0.98,
        parallel: 0.72,
        grade: 0.9,
      },
      candidateDescriptions: [{ description: '2018 Topps Update Shohei Ohtani US1 PSA 10', confidence: 0.9 }],
    },
  });
  assert.equal(result.mode, 'vision_catalog_match');
  assert.equal(result.matches[0].id, 'card_ohtani_2018_update_us1_psa10');
  assert.ok(result.matches[0].confidence > 0.85);
});

test('camera filename alone is never treated as card identity evidence', () => {
  const result = identifyCard({ cards, imageName: 'IMG_2018_TOPPS_OHTANI_US1_PSA10.jpg' });
  assert.equal(result.identityStatus, 'Unresolved');
  assert.equal(result.outcome, 'unknown');
  assert.equal(result.matches.length, 0);
  assert.equal(result.query, '');
});

test('automatic vision evidence returns a structured exact/likely/unresolved outcome', () => {
  const result = identifyCard({
    cards,
    vision: {
      facts: {
        player: 'Shohei Ohtani',
        year: 2018,
        brand: 'Topps',
        set: 'Update Series',
        cardNumber: 'US1',
        grader: 'PSA',
        grade: '10',
      },
      fieldConfidence: { player: 0.98, year: 0.97, brand: 0.96, set: 0.96, cardNumber: 0.99, grader: 0.99, grade: 0.99 },
    },
  });
  assert.ok(['exact_variant', 'exact_card'].includes(result.outcome));
  assert.equal(result.identityStatus, 'Exact');
  assert.equal(result.exact, true);
});
