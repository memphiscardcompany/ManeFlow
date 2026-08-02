import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadBundledCatalog } from '../src/services/catalog-loader.js';

async function fixtureRoot(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'maneflow-catalog-loader-'));
  await fs.mkdir(path.join(root, 'src', 'data'), { recursive: true });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('bundled catalog loader includes demo, owner-authorized, and imported catalogs', async (t) => {
  const root = await fixtureRoot(t);
  const data = path.join(root, 'src', 'data');
  await fs.writeFile(path.join(data, 'cards.json'), JSON.stringify([{ id: 'demo' }]));
  await fs.writeFile(path.join(data, 'cards.memphis-owned.json'), JSON.stringify([{ id: 'owned' }]));
  await fs.writeFile(path.join(data, 'cards.tcg-imported.json'), JSON.stringify([{ id: 'tcg' }]));

  const cards = await loadBundledCatalog(root);

  assert.deepEqual(cards.map((card) => card.id), ['demo', 'owned', 'tcg']);
});

test('bundled catalog loader permits absent optional catalogs but requires the base catalog', async (t) => {
  const root = await fixtureRoot(t);
  const data = path.join(root, 'src', 'data');
  await fs.writeFile(path.join(data, 'cards.json'), JSON.stringify([{ id: 'demo' }]));
  assert.equal((await loadBundledCatalog(root)).length, 1);

  await fs.unlink(path.join(data, 'cards.json'));
  await assert.rejects(loadBundledCatalog(root), { code: 'ENOENT' });
});

test('bundled catalog loader rejects malformed catalog shapes', async (t) => {
  const root = await fixtureRoot(t);
  await fs.writeFile(
    path.join(root, 'src', 'data', 'cards.json'),
    JSON.stringify({ id: 'not-an-array' }),
  );

  await assert.rejects(loadBundledCatalog(root), /must contain a JSON array/i);
});
