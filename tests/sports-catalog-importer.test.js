import test from 'node:test';
import assert from 'node:assert/strict';
import { importSportsChecklistCsv, importSportsChecklistJson } from '../src/services/sports-catalog-importer.js';
import { catalogCoverage, smartCatalogAutocomplete } from '../src/services/catalog-autocomplete.js';

test('sports checklist CSV imports manufacturer-style rows for PSA-style autocomplete', () => {
  const csv = [
    'year,brand,set,player,team,cardNumber,parallel,sport,imageUrl',
    '2026,Topps,Chrome Baseball,Test Rookie,Memphis,101,Gold Refractor /50,Baseball,https://i.ebayimg.com/images/g/example/s-l500.jpg',
    '2026,Topps,Chrome Baseball,Test Rookie,Memphis,101,Base,Baseball,',
  ].join('\n');
  const result = importSportsChecklistCsv(csv, { sourceName: 'Topps Official Checklists' });
  assert.equal(result.summary.unique, 2);
  assert.equal(result.cards[0].catalogSource, 'Topps Official Checklists');
  const auto = smartCatalogAutocomplete(result.cards, { q: '2026 Topps Chrome Test Rookie 101 Gold', limit: 5 });
  assert.equal(auto.candidates[0].cardNumber, '101');
  assert.match(auto.candidates[0].parallel, /Gold/i);
});

test('sports checklist JSON imports rows and coverage reports loaded sports and sets', () => {
  const result = importSportsChecklistJson({ checklist: [
    { year: 2024, brand: 'Panini', set: 'Prizm Basketball', player: 'Example Guard', number: '12', parallel: 'Silver', sport: 'Basketball' },
    { year: 2024, brand: 'Panini', set: 'Prizm Basketball', player: 'Example Forward', number: '13', parallel: 'Base', sport: 'Basketball' },
  ] }, { sourceName: 'Panini Official Checklists' });
  const coverage = catalogCoverage(result.cards);
  assert.equal(coverage.cardCount, 2);
  assert.equal(coverage.bySport[0].label, 'Basketball');
  assert.equal(coverage.largestSets[0].set, 'Prizm Basketball');
  assert.equal(coverage.checklistDepth.completeUniversalCatalog, false);
});
