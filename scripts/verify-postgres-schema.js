import pg from 'pg';

const { Pool } = pg;
const connectionString = String(process.env.DATABASE_URL || '').trim();
if (!connectionString) {
  console.error('DATABASE_URL is required.');
  process.exit(64);
}

const pool = new Pool({
  connectionString,
  max: 2,
  application_name: 'maneflow-schema-verifier',
  ssl: /(?:sslmode=require|supabase\.co|neon\.tech)/i.test(connectionString)
    ? { rejectUnauthorized: false }
    : undefined,
});

const requiredRelations = [
  'shops',
  'catalog_cards',
  'catalog_card_embeddings',
  'shop_inventory',
  'price_evidence',
  'recognition_jobs',
  'recognition_evidence',
  'catalog_reference_images',
  'catalog_embedding_queue',
  'catalog_sync_jobs',
  'platform_owner_authority',
  'manebrain_meta_assets',
  'manebrain_webhook_events',
  'manebrain_conversations',
  'manebrain_messages',
  'manebrain_reply_drafts',
  'manebrain_outbound_jobs',
  'manebrain_outbound_attempts',
  'manebrain_audit_log',
];

try {
  const extension = await pool.query(`SELECT extversion FROM pg_extension WHERE extname = 'vector'`);
  if (!extension.rowCount) throw new Error('pgvector extension is missing.');

  const relations = await pool.query(
    `SELECT c.relname AS tablename, c.relrowsecurity AS rowsecurity, c.relforcerowsecurity AS force_rowsecurity
     FROM pg_class AS c
     JOIN pg_namespace AS n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND c.relname = ANY($1::text[])`,
    [requiredRelations],
  );
  const found = new Map(relations.rows.map((row) => [row.tablename, row]));
  const missing = requiredRelations.filter((name) => !found.has(name));
  if (missing.length) throw new Error(`Missing tables: ${missing.join(', ')}`);

  for (const table of [
    'shop_inventory',
    'price_evidence',
    'recognition_jobs',
    'recognition_evidence',
    'platform_owner_authority',
    'manebrain_meta_assets',
    'manebrain_webhook_events',
    'manebrain_conversations',
    'manebrain_messages',
    'manebrain_reply_drafts',
    'manebrain_outbound_jobs',
    'manebrain_outbound_attempts',
    'manebrain_audit_log',
  ]) {
    if (!found.get(table)?.rowsecurity) throw new Error(`RLS is not enabled on ${table}.`);
    if (!found.get(table)?.force_rowsecurity) throw new Error(`FORCE ROW LEVEL SECURITY is not enabled on ${table}.`);
  }

  const runtimeRole = await pool.query(`
    SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls
    FROM pg_roles
    WHERE rolname = 'maneflow_app'
  `);
  if (!runtimeRole.rowCount) throw new Error('maneflow_app runtime role is missing.');
  const role = runtimeRole.rows[0];
  if (!role.rolcanlogin) throw new Error('maneflow_app cannot log in; set MANEFLOW_DATABASE_APP_PASSWORD during migration.');
  if (role.rolsuper || role.rolcreatedb || role.rolcreaterole || role.rolbypassrls) {
    throw new Error('maneflow_app has unsafe PostgreSQL privileges.');
  }

  const hnsw = await pool.query(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'catalog_card_embeddings'
      AND indexdef ILIKE '%USING hnsw%'
      AND indexdef ILIKE '%vector_cosine_ops%'
  `);
  if (!hnsw.rowCount) throw new Error('HNSW cosine index is missing.');

  const queueIndex = await pool.query(`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'catalog_embedding_queue'
      AND indexname = 'catalog_embedding_queue_work_idx'
  `);
  if (!queueIndex.rowCount) throw new Error('Catalog embedding queue work index is missing.');

  const requiredOperationalIndexes = [
    'manebrain_webhook_queue_idx',
    'manebrain_conversation_owner_cursor_idx',
    'manebrain_messages_conversation_cursor_idx',
    'manebrain_drafts_conversation_version_idx',
    'manebrain_outbound_queue_idx',
  ];
  const operationalIndexes = await pool.query(`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = ANY($1::text[])
  `, [requiredOperationalIndexes]);
  const foundOperationalIndexes = new Set(
    operationalIndexes.rows.map((row) => row.indexname),
  );
  const missingOperationalIndexes = requiredOperationalIndexes.filter(
    (name) => !foundOperationalIndexes.has(name),
  );
  if (missingOperationalIndexes.length) {
    throw new Error(`Missing operational indexes: ${missingOperationalIndexes.join(', ')}`);
  }

  console.log(JSON.stringify({
    ok: true,
    pgvectorVersion: extension.rows[0].extversion,
    tables: requiredRelations,
    hnswIndexes: hnsw.rows.map((row) => row.indexname),
    operationalIndexes: [...foundOperationalIndexes].sort(),
    runtimeRole: { canLogin: role.rolcanlogin, bypassRls: role.rolbypassrls },
  }, null, 2));
} finally {
  await pool.end();
}
