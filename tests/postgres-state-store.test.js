import test from 'node:test';
import assert from 'node:assert/strict';
import { PostgresStateStore } from '../src/services/storage/postgresStateStore.js';
import { createDefaultStoreState } from '../src/services/store.js';

function clientFor({ failRevisionRead = false, revision = 0 } = {}) {
  const calls = [];
  return {
    calls,
    async query(text, values) {
      calls.push({ text, values });
      if (text.startsWith('SELECT revision') && failRevisionRead) throw new Error('transient database failure');
      if (text.startsWith('SELECT revision')) return { rowCount: 1, rows: [{ revision }] };
      if (text.startsWith('UPDATE public.maneflow_application_state')) return { rowCount: 1, rows: [{ revision: revision + 1 }] };
      return { rowCount: 0, rows: [] };
    },
    release() {},
  };
}

test('PostgreSQL state persistence recovers after a failed queued write', async () => {
  const first = clientFor({ failRevisionRead: true });
  const second = clientFor({ revision: 0 });
  const clients = [first, second];
  const store = new PostgresStateStore({ databaseUrl: 'postgresql://test.invalid/maneflow' });
  store.pool = { async connect() { return clients.shift(); } };
  store.state = createDefaultStoreState();
  store.revision = 0;

  await assert.rejects(() => store.persist(), /transient database failure/);
  await store.persist();

  assert.equal(store.revision, 1);
  assert.ok(first.calls.some((call) => call.text === 'ROLLBACK'));
  assert.ok(second.calls.some((call) => call.text === 'COMMIT'));
});
