import test from 'node:test';
import assert from 'node:assert/strict';

import {
  inferRecognitionDomain,
  resolveRecognitionDomainPack,
} from '../src/services/recognition-domain-packs.js';
import { runRecognitionPipeline } from '../src/services/recognition-pipeline.js';

const cards = [
  {
    id: 'sports_1',
    sport: 'Baseball',
    brand: 'Topps',
    set: 'Chrome',
    player: 'Shohei Ohtani',
    cardNumber: '1',
    parallel: 'Base',
  },
  {
    id: 'pokemon_1',
    sport: 'Pokemon',
    brand: 'Pokemon',
    set: '151',
    player: 'Charizard ex',
    cardNumber: '199',
    parallel: 'Special Illustration Rare',
    catalogSource: 'Pokemon TCG API',
  },
  {
    id: 'magic_1',
    sport: 'Magic: The Gathering',
    brand: 'Magic: The Gathering',
    set: 'Foundations',
    player: 'Llanowar Elves',
    cardNumber: '227',
    parallel: 'Base',
    catalogSource: 'Scryfall Bulk Data',
  },
  {
    id: 'yugioh_1',
    sport: 'Yu-Gi-Oh!',
    brand: 'Yu-Gi-Oh!',
    set: 'Legend of Blue Eyes',
    player: 'Blue-Eyes White Dragon',
    cardNumber: 'LOB-001',
    parallel: 'Ultra Rare',
    catalogSource: 'YGOPRODeck API',
  },
  {
    id: 'lorcana_1',
    sport: 'Disney Lorcana',
    brand: 'Disney Lorcana',
    set: 'The First Chapter',
    player: 'Elsa - Spirit of Winter',
    cardNumber: '207',
    parallel: 'Enchanted',
    catalogSource: 'Lorcast API',
  },
];

test('domain inference uses observed evidence and does not guess without it', () => {
  assert.equal(inferRecognitionDomain({
    body: { identityFacts: { sport: 'Pokemon', player: 'Charizard ex' } },
  }).domain, 'pokemon');

  assert.equal(inferRecognitionDomain({
    body: { manualText: '2025 Topps Chrome baseball Shohei Ohtani' },
  }).domain, 'sports');

  const unknown = inferRecognitionDomain({ body: { manualText: 'shiny card number 17' } });
  assert.equal(unknown.domain, 'unknown');
  assert.equal(unknown.reason, 'insufficient_observed_domain_evidence');
});

test('conflicting observed domains remain unknown instead of forcing a pack', () => {
  const result = inferRecognitionDomain({
    body: { manualText: 'Pokemon card and Topps Chrome baseball comparison' },
  });
  assert.equal(result.domain, 'unknown');
  assert.equal(result.reason, 'conflicting_observed_domain_evidence');
  assert.deepEqual(new Set(result.observedDomains), new Set(['pokemon', 'sports']));
});

test('domain packs narrow candidates and intersect an existing allowed-id scope', () => {
  const pokemon = resolveRecognitionDomainPack({
    cards,
    body: { identityFacts: { game: 'Pokemon', player: 'Charizard ex' } },
  });
  assert.equal(pokemon.domain, 'pokemon');
  assert.deepEqual(pokemon.candidateScope.allowedCardIds, ['pokemon_1']);

  const intersection = resolveRecognitionDomainPack({
    cards,
    body: { identityFacts: { game: 'Pokemon', player: 'Charizard ex' } },
    candidateScope: { allowedCardIds: ['pokemon_1', 'sports_1'], year: '2023' },
  });
  assert.deepEqual(intersection.candidateScope.allowedCardIds, ['pokemon_1']);
  assert.equal(intersection.candidateScope.year, '2023');

  const emptyIntersection = resolveRecognitionDomainPack({
    cards,
    body: { identityFacts: { game: 'Pokemon', player: 'Charizard ex' } },
    candidateScope: { allowedCardIds: ['sports_1'] },
  });
  assert.deepEqual(emptyIntersection.candidateScope.allowedCardIds, []);
});

test('unknown domain preserves caller scope unchanged', () => {
  const candidateScope = { allowedCardIds: ['sports_1'], year: '2025' };
  const result = resolveRecognitionDomainPack({
    cards,
    body: { manualText: 'unidentified collectible' },
    candidateScope,
  });
  assert.equal(result.domain, 'unknown');
  assert.equal(result.scoped, false);
  assert.deepEqual(result.candidateScope, candidateScope);
});

test('dedicated pipeline reports and applies the resolved domain pack', () => {
  const result = runRecognitionPipeline({
    enableDedicatedRouting: true,
    cards,
    body: {
      identityFacts: {
        game: 'Pokemon',
        player: 'Charizard ex',
        cardNumber: '199',
      },
      manualText: 'Pokemon Charizard ex 199',
    },
    sceneAnalysis: {
      scene: {
        type: 'single_card',
        cardCount: 1,
        detectorConfidence: 0.99,
      },
      detectedCards: [{
        regionId: 'region_1',
        overallConfidence: 0.99,
        facts: {
          game: 'Pokemon',
          player: 'Charizard ex',
          cardNumber: '199',
        },
        imageQuality: {
          sharpness: 0.99,
          glare: 0.01,
          exposure: 0.99,
          resolution: 0.99,
          edgeCompleteness: 0.99,
          textReadability: 0.99,
          perspectiveDistortion: 0.01,
          occlusion: 0.01,
          compressionArtifacts: 0.01,
        },
      }],
    },
  });
  assert.equal(result.domain.domain, 'pokemon');
  assert.deepEqual(result.domain.candidateScope.allowedCardIds, ['pokemon_1']);
  assert.equal(result.recognition.primary.matches.every((card) => card.id === 'pokemon_1'), true);
});
