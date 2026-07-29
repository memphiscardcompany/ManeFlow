// File: src/db/inventoryRepository.js
// Runtime: Node.js 22+ ESM

import pg from 'pg';

const { Pool } = pg;

const EMBEDDING_DIMENSIONS = 1152;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;
const DEFAULT_HNSW_EF_SEARCH = 100;
const DEFAULT_STATEMENT_TIMEOUT_MS = 15_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @typedef {object} InventoryRepositoryOptions
 * @property {string} [embeddingModelName]
 * @property {string} [embeddingModelVersion]
 * @property {number} [hnswEfSearch]
 * @property {number} [statementTimeoutMs]
 */

/**
 * @typedef {object} VisualMatch
 * @property {string} catalogCardId
 * @property {string} canonicalKey
 * @property {string} sportOrGame
 * @property {number | null} releaseYear
 * @property {string | null} manufacturer
 * @property {string | null} brand
 * @property {string} setName
 * @property {string | null} setCode
 * @property {string} cardNumber
 * @property {string} subjectName
 * @property {string | null} teamOrFaction
 * @property {string} parallelName
 * @property {string} languageCode
 * @property {number | null} serialNumberedTo
 * @property {string} embeddingModelName
 * @property {string} embeddingModelVersion
 * @property {number} cosineDistance
 * @property {number} cosineSimilarity
 * @property {number} shopQuantity
 * @property {number | null} lowestShopListPrice
 * @property {number | null} highestShopListPrice
 */

/**
 * @typedef {object} DatabasePoolOptions
 * @property {string} connectionString
 * @property {number} [max]
 * @property {number} [idleTimeoutMillis]
 * @property {number} [connectionTimeoutMillis]
 * @property {boolean} [ssl]
 * @property {string} [applicationName]
 */

export class InventoryRepositoryError extends Error {
  /**
   * @param {string} message
   * @param {{ cause?: unknown, code?: string, details?: Record<string, unknown> }} [options]
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'InventoryRepositoryError';
    this.code = options.code ?? 'INVENTORY_REPOSITORY_ERROR';
    this.details = options.details ?? {};
  }
}

/**
 * Creates a hardened node-postgres connection pool for ManeFlow.
 * The database login used by this pool must inherit the NOBYPASSRLS
 * `maneflow_app` role created by the migration.
 *
 * @param {DatabasePoolOptions} options
 * @returns {InstanceType<typeof Pool>}
 */
export function createInventoryDatabasePool(options) {
  if (!options || typeof options !== 'object') {
    throw new TypeError('Database pool options are required.');
  }

  if (typeof options.connectionString !== 'string' || options.connectionString.trim() === '') {
    throw new TypeError('A non-empty PostgreSQL connectionString is required.');
  }

  const max = validateIntegerRange(options.max ?? 20, 'max', 1, 200);
  const idleTimeoutMillis = validateIntegerRange(
    options.idleTimeoutMillis ?? 30_000,
    'idleTimeoutMillis',
    1_000,
    600_000,
  );
  const connectionTimeoutMillis = validateIntegerRange(
    options.connectionTimeoutMillis ?? 10_000,
    'connectionTimeoutMillis',
    1_000,
    120_000,
  );

  const ssl = options.ssl === true
    ? { rejectUnauthorized: true }
    : undefined;

  const pool = new Pool({
    connectionString: options.connectionString,
    max,
    idleTimeoutMillis,
    connectionTimeoutMillis,
    allowExitOnIdle: false,
    application_name: options.applicationName ?? 'maneflow-api-server',
    ssl,
  });

  pool.on('error', (error) => {
    // An idle-client failure cannot be thrown back to the originating request.
    // Emit a structured log without leaking the connection string.
    console.error(JSON.stringify({
      level: 'error',
      event: 'postgres_pool_idle_client_error',
      message: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    }));
  });

  return pool;
}

export class InventoryRepository {
  /**
   * @param {InstanceType<typeof Pool>} pool
   * @param {InventoryRepositoryOptions} [options]
   */
  constructor(pool, options = {}) {
    if (!pool || typeof pool.connect !== 'function') {
      throw new TypeError('InventoryRepository requires a pg.Pool-compatible instance.');
    }

    this.pool = pool;
    this.embeddingModelName = normalizeRequiredString(
      options.embeddingModelName ?? 'siglip2-so400m-naflex',
      'embeddingModelName',
      128,
    );
    this.embeddingModelVersion = normalizeRequiredString(
      options.embeddingModelVersion ?? '1',
      'embeddingModelVersion',
      128,
    );
    this.hnswEfSearch = validateIntegerRange(
      options.hnswEfSearch ?? DEFAULT_HNSW_EF_SEARCH,
      'hnswEfSearch',
      1,
      10_000,
    );
    this.statementTimeoutMs = validateIntegerRange(
      options.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS,
      'statementTimeoutMs',
      100,
      120_000,
    );
  }

  /**
   * Performs an approximate nearest-neighbor search against the canonical
   * 1152-dimensional front-view embedding index. The transaction-local
   * shop context is also applied to the lateral inventory aggregation, so
   * PostgreSQL RLS prevents cross-shop inventory visibility.
   *
   * @param {readonly number[]} embedding
   * @param {string} shopId
   * @param {number} [limit]
   * @returns {Promise<VisualMatch[]>}
   */
  async findVisualMatches(embedding, shopId, limit = DEFAULT_LIMIT) {
    const normalizedShopId = validateUuid(shopId, 'shopId');
    const normalizedLimit = validateIntegerRange(limit, 'limit', 1, MAX_LIMIT);
    const vectorLiteral = serializeNormalizedEmbedding(embedding);

    const client = await this.pool.connect();
    let transactionOpen = false;
    let destroyClient = false;

    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY');
      transactionOpen = true;

      // PostgreSQL does not support bind parameters directly in SET syntax.
      // set_config(..., true) is the parameterized, transaction-local equivalent
      // of SET LOCAL app.current_shop_id = '<uuid>'.
      await client.query(
        `SELECT set_config('app.current_shop_id', $1, true)`,
        [normalizedShopId],
      );

      await client.query(
        `SELECT set_config('hnsw.ef_search', $1, true)`,
        [String(this.hnswEfSearch)],
      );

      await client.query(
        `SELECT set_config('hnsw.iterative_scan', 'strict_order', true)`,
      );

      await client.query(
        `SELECT set_config('statement_timeout', $1, true)`,
        [`${this.statementTimeoutMs}ms`],
      );

      const query = {
        name: 'maneflow-find-visual-matches-v1',
        text: `
          WITH nearest_embeddings AS MATERIALIZED (
            SELECT
              embedding.catalog_card_id,
              embedding.model_name,
              embedding.model_version,
              embedding.front_vector <=> $1::vector AS cosine_distance
            FROM public.catalog_card_embeddings AS embedding
            WHERE embedding.model_name = $2
              AND embedding.model_version = $3
            ORDER BY embedding.front_vector <=> $1::vector ASC
            LIMIT $4
          )
          SELECT
            card.id AS catalog_card_id,
            card.canonical_key,
            card.sport_or_game,
            card.release_year,
            card.manufacturer,
            card.brand,
            card.set_name,
            card.set_code,
            card.card_number,
            card.subject_name,
            card.team_or_faction,
            card.parallel_name,
            card.language_code,
            card.serial_numbered_to,
            nearest.model_name AS embedding_model_name,
            nearest.model_version AS embedding_model_version,
            nearest.cosine_distance,
            GREATEST(
              0.0::double precision,
              LEAST(1.0::double precision, 1.0 - nearest.cosine_distance)
            ) AS cosine_similarity,
            COALESCE(shop_rollup.shop_quantity, 0)::integer AS shop_quantity,
            shop_rollup.lowest_shop_list_price,
            shop_rollup.highest_shop_list_price
          FROM nearest_embeddings AS nearest
          INNER JOIN public.catalog_cards AS card
            ON card.id = nearest.catalog_card_id
          LEFT JOIN LATERAL (
            SELECT
              COALESCE(SUM(inventory.quantity), 0) AS shop_quantity,
              MIN(inventory.list_price) FILTER (
                WHERE inventory.list_price IS NOT NULL
              ) AS lowest_shop_list_price,
              MAX(inventory.list_price) FILTER (
                WHERE inventory.list_price IS NOT NULL
              ) AS highest_shop_list_price
            FROM public.shop_inventory AS inventory
            WHERE inventory.catalog_card_id = card.id
              AND inventory.is_active = true
              AND inventory.quantity > 0
          ) AS shop_rollup ON true
          WHERE card.is_active = true
          ORDER BY nearest.cosine_distance ASC, card.id ASC
        `,
        values: [
          vectorLiteral,
          this.embeddingModelName,
          this.embeddingModelVersion,
          normalizedLimit,
        ],
      };

      const result = await client.query(query);

      await client.query('COMMIT');
      transactionOpen = false;

      return result.rows.map(mapVisualMatchRow);
    } catch (error) {
      let rollbackError;

      if (transactionOpen) {
        try {
          await client.query('ROLLBACK');
          transactionOpen = false;
        } catch (caughtRollbackError) {
          rollbackError = caughtRollbackError;
          destroyClient = true;
        }
      }

      if (rollbackError) {
        throw new InventoryRepositoryError(
          'Visual similarity query failed and the PostgreSQL transaction could not be rolled back.',
          {
            cause: new AggregateError(
              [toError(error), toError(rollbackError)],
              'Visual query and rollback both failed.',
            ),
            code: 'VISUAL_MATCH_QUERY_AND_ROLLBACK_FAILED',
            details: {
              shopId: normalizedShopId,
              limit: normalizedLimit,
              embeddingModelName: this.embeddingModelName,
              embeddingModelVersion: this.embeddingModelVersion,
            },
          },
        );
      }

      throw new InventoryRepositoryError(
        'Visual similarity query failed and was rolled back.',
        {
          cause: error,
          code: 'VISUAL_MATCH_QUERY_FAILED',
          details: {
            shopId: normalizedShopId,
            limit: normalizedLimit,
            embeddingModelName: this.embeddingModelName,
            embeddingModelVersion: this.embeddingModelVersion,
          },
        },
      );
    } finally {
      // Passing an error to release removes a potentially corrupted client
      // from the pool instead of returning it to the idle-client queue.
      client.release(
        destroyClient
          ? new Error('Discarding PostgreSQL client after rollback failure.')
          : undefined,
      );
    }
  }

  /**
   * Gracefully closes the underlying pool. Call this during application shutdown.
   *
   * @returns {Promise<void>}
   */
  async close() {
    await this.pool.end();
  }
}

/**
 * @param {readonly number[]} embedding
 * @returns {string}
 */
function serializeNormalizedEmbedding(embedding) {
  if (!Array.isArray(embedding)) {
    throw new TypeError('embedding must be an array of finite numbers.');
  }

  if (embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new RangeError(
      `embedding must contain exactly ${EMBEDDING_DIMENSIONS} values; received ${embedding.length}.`,
    );
  }

  const values = new Float64Array(EMBEDDING_DIMENSIONS);
  let squaredNorm = 0;

  for (let index = 0; index < embedding.length; index += 1) {
    const value = embedding[index];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError(`embedding[${index}] must be a finite number.`);
    }

    values[index] = Object.is(value, -0) ? 0 : value;
    squaredNorm += value * value;
  }

  if (!Number.isFinite(squaredNorm) || squaredNorm <= Number.EPSILON) {
    throw new RangeError('embedding must have a finite, non-zero Euclidean norm.');
  }

  const norm = Math.sqrt(squaredNorm);
  const serializedValues = new Array(EMBEDDING_DIMENSIONS);

  for (let index = 0; index < values.length; index += 1) {
    const normalizedValue = values[index] / norm;
    serializedValues[index] = Number(normalizedValue.toPrecision(9)).toString();
  }

  return `[${serializedValues.join(',')}]`;
}

/**
 * @param {unknown} row
 * @returns {VisualMatch}
 */
function mapVisualMatchRow(row) {
  if (!row || typeof row !== 'object') {
    throw new InventoryRepositoryError('PostgreSQL returned an invalid visual-match row.', {
      code: 'INVALID_VISUAL_MATCH_ROW',
    });
  }

  return {
    catalogCardId: String(row.catalog_card_id),
    canonicalKey: String(row.canonical_key),
    sportOrGame: String(row.sport_or_game),
    releaseYear: row.release_year === null ? null : Number(row.release_year),
    manufacturer: nullableString(row.manufacturer),
    brand: nullableString(row.brand),
    setName: String(row.set_name),
    setCode: nullableString(row.set_code),
    cardNumber: String(row.card_number),
    subjectName: String(row.subject_name),
    teamOrFaction: nullableString(row.team_or_faction),
    parallelName: String(row.parallel_name),
    languageCode: String(row.language_code),
    serialNumberedTo: row.serial_numbered_to === null
      ? null
      : Number(row.serial_numbered_to),
    embeddingModelName: String(row.embedding_model_name),
    embeddingModelVersion: String(row.embedding_model_version),
    cosineDistance: Number(row.cosine_distance),
    cosineSimilarity: Number(row.cosine_similarity),
    shopQuantity: Number(row.shop_quantity),
    lowestShopListPrice: nullableNumber(row.lowest_shop_list_price),
    highestShopListPrice: nullableNumber(row.highest_shop_list_price),
  };
}

/**
 * @param {unknown} value
 * @param {string} fieldName
 * @returns {string}
 */
function validateUuid(value, fieldName) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new TypeError(`${fieldName} must be a valid UUID string.`);
  }
  return value.toLowerCase();
}

/**
 * @param {unknown} value
 * @param {string} fieldName
 * @param {number} minimum
 * @param {number} maximum
 * @returns {number}
 */
function validateIntegerRange(value, fieldName, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(
      `${fieldName} must be an integer between ${minimum} and ${maximum}.`,
    );
  }
  return value;
}

/**
 * @param {unknown} value
 * @param {string} fieldName
 * @param {number} maximumLength
 * @returns {string}
 */
function normalizeRequiredString(value, fieldName, maximumLength) {
  if (typeof value !== 'string') {
    throw new TypeError(`${fieldName} must be a string.`);
  }

  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximumLength) {
    throw new RangeError(
      `${fieldName} must contain between 1 and ${maximumLength} characters.`,
    );
  }
  return normalized;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function nullableString(value) {
  return value === null || value === undefined ? null : String(value);
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function nullableNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new InventoryRepositoryError('PostgreSQL returned a non-finite numeric value.', {
      code: 'INVALID_NUMERIC_RESULT',
    });
  }
  return number;
}

/**
 * @param {unknown} value
 * @returns {Error}
 */
function toError(value) {
  return value instanceof Error ? value : new Error(String(value));
}
