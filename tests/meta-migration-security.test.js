import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const migrationUrl = new URL('../db/migrations/009_manebrain_outbound_send_guards.sql', import.meta.url);

test('Meta send-guard migration makes approval evidence immutable and revokes job deletion', async () => {
  const sql = await fs.readFile(migrationUrl, 'utf8');
  for (const column of ['approved_text', 'approved_text_sha256', 'approved_by', 'approved_at']) {
    assert.match(sql, new RegExp(`NEW\\.${column} IS DISTINCT FROM OLD\\.${column}`));
  }
  assert.match(sql, /CREATE TRIGGER manebrain_outbound_approval_immutable/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS target_provider_message_id text/);
  assert.match(sql, /CREATE TRIGGER manebrain_reply_draft_target_immutable/);
  assert.match(sql, /REVOKE DELETE ON TABLE public\.manebrain_outbound_jobs FROM maneflow_app/);
});
