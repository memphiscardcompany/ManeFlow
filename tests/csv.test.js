import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../src/services/csv.js';

test('parses quoted CSV cells', () => {
  const rows = parseCsv('name,notes\n"Ohtani, Shohei","A ""great"" card"');
  assert.equal(rows[0].name, 'Ohtani, Shohei');
  assert.equal(rows[0].notes, 'A "great" card');
  assert.equal(rows[0].__row, 2);
});
