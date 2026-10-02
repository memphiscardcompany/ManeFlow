import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('PostgreSQL migration IDs are unique and legacy recognition migration is safely aliased', async () => {
  const names = (await fs.readdir(new URL('../db/migrations/', import.meta.url)))
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort();
  const ids = names.map((name) => name.match(/^(\d+)_/)[1]);
  assert.equal(new Set(ids).size, ids.length, `duplicate migration IDs: ${names.join(', ')}`);
  assert.ok(names.includes('005_manebrain_owner_meta.sql'));
  assert.ok(names.includes('010_async_recognition_dag.sql'));
  assert.equal(names.includes('005_async_recognition_dag.sql'), false);

  const runner = await fs.readFile(new URL('../scripts/migrate-postgres.js', import.meta.url), 'utf8');
  assert.match(runner, /010_async_recognition_dag\.sql[^\n]+005_async_recognition_dag\.sql/);
  assert.match(runner, /rejectUnauthorized:\s*true/);
  assert.doesNotMatch(runner, /rejectUnauthorized:\s*false/);
});

test('release workflows pin third-party actions to immutable commits', async () => {
  for (const relative of [
    '../.github/workflows/mobile-store-release.yml',
    '../.github/workflows/windows-beta-build.yml',
    '../.github/workflows/windows-signed-release.yml',
  ]) {
    const workflow = await fs.readFile(new URL(relative, import.meta.url), 'utf8');
    assert.doesNotMatch(workflow, /uses:\s+[^\s]+@v\d+(?:\s|$)/, relative);
    assert.match(workflow, /permissions:\s*\n\s+contents:\s+read/, relative);
  }
});

test('release credentials are scoped to individual steps rather than whole jobs', async () => {
  const mobile = await fs.readFile(new URL('../.github/workflows/mobile-store-release.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(mobile, /jobs:[\s\S]{0,800}?env:\s*\n\s+EXPO_TOKEN:/);
  assert.match(mobile, /name: Build signed iOS[\s\S]{0,220}?env:\s*\n\s+EXPO_TOKEN:/);
  assert.match(mobile, /name: Submit exact production builds[\s\S]{0,220}?env:\s*\n\s+EXPO_TOKEN:/);

  const windows = await fs.readFile(new URL('../.github/workflows/windows-signed-release.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(windows, /jobs:[\s\S]{0,800}?env:\s*\n\s+CSC_LINK:/);
  assert.match(windows, /name: Build signed installer[\s\S]{0,260}?CSC_LINK:/);
});
