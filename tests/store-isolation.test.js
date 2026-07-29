import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../src/services/store.js';

test('user vaults remain isolated', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'maneflow-store-'));
  const store = await new JsonStore(path.join(directory, 'state.json')).init();
  await store.addCollectionItem('user-a', { name: 'Card A', quantity: 1, purchasePrice: 10 });
  await store.addCollectionItem('user-b', { name: 'Card B', quantity: 2, purchasePrice: 20 });
  assert.equal(store.userSnapshot('user-a').collection.length, 1);
  assert.equal(store.userSnapshot('user-a').collection[0].name, 'Card A');
  assert.equal(store.userSnapshot('user-b').collection[0].name, 'Card B');
  await fs.rm(directory, { recursive: true, force: true });
});
