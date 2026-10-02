import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const migrationsDir = path.join(rootDir, 'db', 'migrations');
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();

if (!DATABASE_URL) {
  console.error('DATABASE_URL is required.');
  process.exit(64);
}

function checksum(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function migrations() {
  const names = (await fs.readdir(migrationsDir))
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort((left, right) => left.localeCompare(right, 'en'));
  return Promise.all(names.map(async (name) => {
    const sql = await fs.readFile(path.join(migrationsDir, name), 'utf8');
    return { name, sql, checksum: checksum(sql) };
  }));
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 1,
  connectionTimeoutMillis: 15_000,
  application_name: 'maneflow-migrations',
  ssl: /(?:sslmode=require|supabase\.co|neon\.tech)/i.test(DATABASE_URL)
    ? { rejectUnauthorized: true }
    : undefined,
});

const client = await pool.connect();
try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.maneflow_schema_migrations (
      name text PRIMARY KEY,
      checksum_sha256 char(64) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )
  `);
  await client.query(`SELECT pg_advisory_lock(hashtext('maneflow-schema-migrations'))`);

  for (const migration of await migrations()) {
    const existing = await client.query(
      'SELECT checksum_sha256 FROM public.maneflow_schema_migrations WHERE name = $1',
      [migration.name],
    );
    if (existing.rowCount) {
      if (existing.rows[0].checksum_sha256 !== migration.checksum) {
        throw new Error(`Migration checksum mismatch: ${migration.name}`);
      }
      console.log(`skip ${migration.name}`);
      continue;
    }

    console.log(`apply ${migration.name}`);
    try {
      await client.query('BEGIN');
      await client.query(migration.sql);
      await client.query(
        `INSERT INTO public.maneflow_schema_migrations (name, checksum_sha256) VALUES ($1, $2)`,
        [migration.name, migration.checksum],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw new Error(`Migration failed: ${migration.name}: ${error.message}`, { cause: error });
    }
  }

  const appRolePassword = String(process.env.MANEFLOW_DATABASE_APP_PASSWORD || '').trim();
  if (appRolePassword) {
    const quoted = await client.query('SELECT quote_literal($1) AS value', [appRolePassword]);
    await client.query(`ALTER ROLE maneflow_app LOGIN PASSWORD ${quoted.rows[0].value}`);
    console.log('updated maneflow_app database password');
  }

  console.log('ManeFlow PostgreSQL migrations are current.');
} finally {
  await client.query(`SELECT pg_advisory_unlock(hashtext('maneflow-schema-migrations'))`).catch(() => {});
  client.release();
  await pool.end();
}
