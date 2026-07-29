import { JsonStore, createDefaultStoreState, migrateStoreState } from '../store.js';
import { ConfigurationError } from '../errors.js';

export class PostgresStateConflictError extends Error {
  constructor(message, { expectedRevision, actualRevision } = {}) {
    super(message);
    this.name = 'PostgresStateConflictError';
    this.code = 'POSTGRES_STATE_REVISION_CONFLICT';
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

export class PostgresStateStore extends JsonStore {
  constructor({ databaseUrl, poolOptions = {} }) {
    super('postgres://maneflow-application-state');
    if (typeof databaseUrl !== 'string' || databaseUrl.trim() === '') {
      throw new ConfigurationError('DATABASE_URL is required for PostgreSQL state storage.');
    }
    this.databaseUrl = databaseUrl;
    this.poolOptions = poolOptions;
    this.pool = null;
    this.revision = 0;
    this.writeChain = Promise.resolve();
  }

  async init() {
    let pg;
    try {
      pg = await import('pg');
    } catch (error) {
      throw new ConfigurationError('The pg package is required for STORAGE_MODE=postgres.', { cause: error });
    }
    const Pool = pg.Pool || pg.default?.Pool;
    if (!Pool) throw new ConfigurationError('The installed pg package does not export Pool.');
    this.pool = new Pool({
      connectionString: this.databaseUrl,
      max: this.poolOptions.max ?? 10,
      idleTimeoutMillis: this.poolOptions.idleTimeoutMillis ?? 30_000,
      connectionTimeoutMillis: this.poolOptions.connectionTimeoutMillis ?? 10_000,
      application_name: this.poolOptions.applicationName ?? 'maneflow-state-store',
      ssl: this.poolOptions.ssl ? { rejectUnauthorized: true } : undefined,
    });

    const initial = createDefaultStoreState();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO public.maneflow_application_state (id, schema_version, revision, state)
         VALUES (1, $1, 0, $2::jsonb)
         ON CONFLICT (id) DO NOTHING`,
        [initial.schemaVersion, JSON.stringify(initial)],
      );
      const result = await client.query(
        `SELECT schema_version, revision, state
         FROM public.maneflow_application_state
         WHERE id = 1
         FOR UPDATE`,
      );
      if (result.rowCount !== 1) throw new Error('ManeFlow application state row could not be initialized.');
      this.state = migrateStoreState(result.rows[0].state);
      this.revision = Number(result.rows[0].revision);
      this.cleanupExpiredSessions();
      this.cleanupExpiredAccountTokens();
      await client.query(
        `UPDATE public.maneflow_application_state
         SET schema_version = $1, state = $2::jsonb, revision = revision + 1, updated_at = clock_timestamp()
         WHERE id = 1`,
        [this.state.schemaVersion, JSON.stringify(this.state)],
      );
      this.revision += 1;
      await client.query('COMMIT');
      return this;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async persist() {
    if (!this.pool) throw new ConfigurationError('PostgreSQL state store has not been initialized.');
    const operation = this.writeChain.catch(() => {}).then(async () => {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        const current = await client.query(
          `SELECT revision FROM public.maneflow_application_state WHERE id = 1 FOR UPDATE`,
        );
        if (current.rowCount !== 1) throw new Error('ManeFlow application state row is missing.');
        const actualRevision = Number(current.rows[0].revision);
        if (actualRevision !== this.revision) {
          throw new PostgresStateConflictError(
            'The ManeFlow application state changed in another process; reload before retrying the write.',
            { expectedRevision: this.revision, actualRevision },
          );
        }
        const result = await client.query(
          `UPDATE public.maneflow_application_state
           SET schema_version = $1,
               state = $2::jsonb,
               revision = revision + 1,
               updated_at = clock_timestamp()
           WHERE id = 1 AND revision = $3
           RETURNING revision`,
          [this.state.schemaVersion, JSON.stringify(this.state), this.revision],
        );
        if (result.rowCount !== 1) {
          throw new PostgresStateConflictError('ManeFlow application state revision changed during persistence.', {
            expectedRevision: this.revision,
            actualRevision,
          });
        }
        this.revision = Number(result.rows[0].revision);
        await client.query('COMMIT');
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch {}
        throw error;
      } finally {
        client.release();
      }
    });
    this.writeChain = operation;
    return operation;
  }

  async health() {
    if (!this.pool) return { mode: 'postgres', ok: false, reason: 'not_initialized' };
    try {
      const result = await this.pool.query(
        `SELECT revision, schema_version, updated_at FROM public.maneflow_application_state WHERE id = 1`,
      );
      return {
        mode: 'postgres',
        ok: result.rowCount === 1,
        revision: result.rowCount ? Number(result.rows[0].revision) : null,
        schemaVersion: result.rowCount ? Number(result.rows[0].schema_version) : null,
        updatedAt: result.rowCount ? result.rows[0].updated_at : null,
      };
    } catch (error) {
      return { mode: 'postgres', ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  async close() {
    const pool = this.pool;
    this.pool = null;
    if (pool) await pool.end();
  }
}
