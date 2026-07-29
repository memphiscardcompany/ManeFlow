import test from 'node:test';
import assert from 'node:assert/strict';
import { extractOwnedChecklistCards, sourceNameFromFile } from '../src/services/checklist-importer.js';

test('owned collection CSV rows become safe catalog autocomplete rows', () => {
  const csv = [
    'Player,Set/Year,Card #,Parallel,Grade,Location,Private Notes',
    'Shohei Ohtani,2018 Topps Update Series,US1,Base Rookie Debut,PSA 10,Safe Box,Do not export customer notes',
  ].join('\n');
  const result = extractOwnedChecklistCards(csv, { sourceName: 'memphis_collection_export' });
  assert.equal(result.summary.unique, 1);
  const [card] = result.cards;
  assert.equal(card.year, 2018);
  assert.equal(card.brand, 'Topps');
  assert.equal(card.set, 'Update Series');
  assert.equal(card.player, 'Shohei Ohtani');
  assert.equal(card.cardNumber, 'US1');
  assert.equal(card.parallel, 'Base Rookie Debut');
  assert.equal(card.grade.company, 'PSA');
  assert.equal(card.grade.grade, '10');
  assert.equal(card.catalogSource, 'memphis_collection_export');
  assert.doesNotMatch(JSON.stringify(card), /customer notes|Safe Box/i);
});

test('owned eBay listing title rows infer card identity without private order fields', () => {
  const csv = [
    'Item Title,Item number,Buyer username,Buyer email,Ship to address,Tracking number',
    '"2026 Topps Series 1 - Stars of MLB Aaron Judge #SMLB-1 PSA 10",123456789,buyer123,buyer@example.com,"123 Main St",TRACK123',
  ].join('\n');
  const result = extractOwnedChecklistCards(csv, { sourceName: 'ebay_active_export' });
  assert.equal(result.summary.unique, 1);
  const [card] = result.cards;
  assert.equal(card.year, 2026);
  assert.equal(card.brand, 'Topps');
  assert.match(card.set, /Series 1/i);
  assert.equal(card.player, 'Aaron Judge');
  assert.equal(card.cardNumber, 'SMLB-1');
  assert.equal(card.grade.company, 'PSA');
  assert.equal(card.grade.grade, '10');
  assert.doesNotMatch(JSON.stringify(card), /buyer123|buyer@example.com|123 Main|TRACK123/);
});

test('source names from files are stable and filesystem-safe', () => {
  const sourceName = sourceNameFromFile('C:/exports/Memphis Card Company Collection.csv');
  assert.equal(sourceName, 'owned_Memphis Card Company Collection');
  const csv = 'Player,Set/Year,Card #\nAaron Judge,2017 Topps,287';
  const result = extractOwnedChecklistCards(csv, { sourceName });
  assert.equal(result.cards[0].catalogSource, 'owned_Memphis_Card_Company_Collection');
});
