const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMBEDDING_DIMENSIONS = 1152;
const MAX_CATALOG_BATCH = 500;
const MAX_EMBEDDING_BATCH = 100;

export class CatalogRepositoryError extends Error {
  constructor(message, { cause, code = 'CATALOG_REPOSITORY_ERROR', details = {} } = {}) {
    super(message, { cause });
    this.name = 'CatalogRepositoryError';
    this.code = code;
    this.details = details;
  }
}

function requiredString(value, name, maxLength = 500) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new TypeError(`${name} is required.`);
  if (normalized.length > maxLength) throw new TypeError(`${name} exceeds ${maxLength} characters.`);
  return normalized;
}

function optionalString(value, maxLength = 1000) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function optionalInteger(value, name, min, max) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new TypeError(`${name} must be an integer between ${min} and ${max}.`);
  }
  return parsed;
}

function metadata(value) {
  if (value === null || value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('metadata must be an object.');
  return structuredClone(value);
}

function uuid(value, name) {
  const normalized = requiredString(value, name, 64).toLowerCase();
  if (!UUID_PATTERN.test(normalized)) throw new TypeError(`${name} must be a UUID.`);
  return normalized;
}

function normalizedVector(value, name, { nullable = false } = {}) {
  if ((value === null || value === undefined) && nullable) return null;
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) {
    throw new TypeError(`${name} must be an array or typed array.`);
  }
  const numbers = Array.from(value, Number);
  if (numbers.length !== EMBEDDING_DIMENSIONS) {
    throw new TypeError(`${name} must contain exactly ${EMBEDDING_DIMENSIONS} values.`);
  }
  if (!numbers.every(Number.isFinite)) throw new TypeError(`${name} contains non-finite values.`);
  const magnitude = Math.sqrt(numbers.reduce((sum, item) => sum + item * item, 0));
  if (!Number.isFinite(magnitude) || magnitude <= 1e-12) throw new TypeError(`${name} must have nonzero magnitude.`);
  return `[${numbers.map((item) => Number((item / magnitude).toPrecision(9))).join(',')}]`;
}

function normalizeCatalogCard(input, index = null) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError(index === null ? 'Catalog card input is required.' : `Catalog card input at index ${index} must be an object.`);
  }
  return {
    canonicalKey: requiredString(input.canonicalKey, 'canonicalKey', 500),
    sportOrGame: requiredString(input.sportOrGame, 'sportOrGame', 100),
    releaseYear: optionalInteger(input.releaseYear, 'releaseYear', 1800, 2200),
    manufacturer: optionalString(input.manufacturer, 255),
    brand: optionalString(input.brand, 255),
    setName: requiredString(input.setName, 'setName', 500),
    setCode: optionalString(input.setCode, 100),
    cardNumber: requiredString(input.cardNumber, 'cardNumber', 100),
    subjectName: requiredString(input.subjectName, 'subjectName', 500),
    teamOrFaction: optionalString(input.teamOrFaction, 255),
    parallelName: requiredString(input.parallelName || 'BASE', 'parallelName', 255),
    languageCode: requiredString(input.languageCode || 'en', 'languageCode', 30),
    serialNumberedTo: optionalInteger(input.serialNumberedTo, 'serialNumberedTo', 1, 10_000_000),
    isRookie: Boolean(input.isRookie),
    sourceNamespace: optionalString(input.sourceNamespace, 100),
    sourceRecordId: optionalString(input.sourceRecordId, 500),
    metadata: metadata(input.metadata),
  };
}

function normalizeEmbedding(input, index = null) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError(index === null ? 'Card embedding input is required.' : `Card embedding input at index ${index} must be an object.`);
  }
  const frontQualityScore = Number(input.frontQualityScore ?? 1);
  const backQualityScore = input.backQualityScore == null ? null : Number(input.backQualityScore);
  if (!Number.isFinite(frontQualityScore) || frontQualityScore < 0 || frontQualityScore > 1) {
    throw new TypeError('frontQualityScore must be between 0 and 1.');
  }
  if (backQualityScore != null && (!Number.isFinite(backQualityScore) || backQualityScore < 0 || backQualityScore > 1)) {
    throw new TypeError('backQualityScore must be between 0 and 1.');
  }
  return {
    catalogCardId: uuid(input.catalogCardId, 'catalogCardId'),
    modelName: requiredString(input.modelName, 'modelName', 128),
    modelVersion: requiredString(input.modelVersion, 'modelVersion', 128),
    frontVector: normalizedVector(input.frontVector, 'frontVector'),
    backVector: normalizedVector(input.backVector, 'backVector', { nullable: true }),
    frontReferenceUri: optionalString(input.frontReferenceUri, 2000),
    backReferenceUri: optionalString(input.backReferenceUri, 2000),
    frontQualityScore,
    backQualityScore,
    metadata: metadata(input.metadata),
  };
}

const CATALOG_UPSERT_QUERY = {
  name: 'maneflow-upsert-catalog-card-v1',
  text: `
    INSERT INTO public.catalog_cards (
      canonical_key, sport_or_game, release_year, manufacturer, brand, set_name, set_code,
      card_number, subject_name, team_or_faction, parallel_name, language_code,
      serial_numbered_to, is_rookie, source_namespace, source_record_id, metadata
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb
    )
    ON CONFLICT (canonical_key) DO UPDATE SET
      sport_or_game = EXCLUDED.sport_or_game,
      release_year = EXCLUDED.release_year,
      manufacturer = EXCLUDED.manufacturer,
      brand = EXCLUDED.brand,
      set_name = EXCLUDED.set_name,
      set_code = EXCLUDED.set_code,
      card_number = EXCLUDED.card_number,
      subject_name = EXCLUDED.subject_name,
      team_or_faction = EXCLUDED.team_or_faction,
      parallel_name = EXCLUDED.parallel_name,
      language_code = EXCLUDED.language_code,
      serial_numbered_to = EXCLUDED.serial_numbered_to,
      is_rookie = EXCLUDED.is_rookie,
      source_namespace = COALESCE(EXCLUDED.source_namespace, catalog_cards.source_namespace),
      source_record_id = COALESCE(EXCLUDED.source_record_id, catalog_cards.source_record_id),
      metadata = catalog_cards.metadata || EXCLUDED.metadata,
      is_active = true
    RETURNING *
  `,
};

const EMBEDDING_UPSERT_QUERY = {
  name: 'maneflow-upsert-card-embedding-v1',
  text: `
    INSERT INTO public.catalog_card_embeddings (
      catalog_card_id, model_name, model_version, front_vector, back_vector,
      front_reference_uri, back_reference_uri, front_quality_score, back_quality_score, metadata
    ) VALUES ($1, $2, $3, $4::vector, $5::vector, $6, $7, $8, $9, $10::jsonb)
    ON CONFLICT (catalog_card_id, model_name, model_version) DO UPDATE SET
      front_vector = EXCLUDED.front_vector,
      back_vector = COALESCE(EXCLUDED.back_vector, catalog_card_embeddings.back_vector),
      front_reference_uri = COALESCE(EXCLUDED.front_reference_uri, catalog_card_embeddings.front_reference_uri),
      back_reference_uri = COALESCE(EXCLUDED.back_reference_uri, catalog_card_embeddings.back_reference_uri),
      front_quality_score = EXCLUDED.front_quality_score,
      back_quality_score = COALESCE(EXCLUDED.back_quality_score, catalog_card_embeddings.back_quality_score),
      metadata = catalog_card_embeddings.metadata || EXCLUDED.metadata
    RETURNING id, catalog_card_id, model_name, model_version, front_quality_score, back_quality_score, updated_at
  `,
};

function catalogValues(value) {
  return [
    value.canonicalKey, value.sportOrGame, value.releaseYear, value.manufacturer, value.brand,
    value.setName, value.setCode, value.cardNumber, value.subjectName, value.teamOrFaction,
    value.parallelName, value.languageCode, value.serialNumberedTo, value.isRookie,
    value.sourceNamespace, value.sourceRecordId, JSON.stringify(value.metadata),
  ];
}

function embeddingValues(value) {
  return [
    value.catalogCardId, value.modelName, value.modelVersion, value.frontVector, value.backVector,
    value.frontReferenceUri, value.backReferenceUri, value.frontQualityScore, value.backQualityScore,
    JSON.stringify(value.metadata),
  ];
}

async function runTransaction(pool, work, errorFactory) {
  const client = await pool.connect();
  let transactionOpen = false;
  let discardClient = false;
  try {
    await client.query('BEGIN');
    transactionOpen = true;
    const result = await work(client);
    await client.query('COMMIT');
    transactionOpen = false;
    return result;
  } catch (error) {
    let rollbackError = null;
    if (transactionOpen) {
      try {
        await client.query('ROLLBACK');
        transactionOpen = false;
      } catch (caught) {
        rollbackError = caught;
        discardClient = true;
      }
    }
    throw errorFactory(rollbackError
      ? new AggregateError([error, rollbackError], 'Database operation and rollback both failed.')
      : error);
  } finally {
    client.release(discardClient ? new Error('Discarding PostgreSQL client after rollback failure.') : undefined);
  }
}

export class CatalogRepository {
  constructor(pool) {
    if (!pool || typeof pool.connect !== 'function') throw new TypeError('CatalogRepository requires a pg.Pool-compatible instance.');
    this.pool = pool;
  }

  async upsertCatalogCard(input) {
    return (await this.upsertCatalogCards([input]))[0];
  }

  async upsertCatalogCards(inputs) {
    if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > MAX_CATALOG_BATCH) {
      throw new TypeError(`inputs must contain between 1 and ${MAX_CATALOG_BATCH} catalog cards.`);
    }
    const normalized = inputs.map((item, index) => normalizeCatalogCard(item, index));
    return runTransaction(
      this.pool,
      async (client) => {
        const rows = [];
        for (const value of normalized) {
          const result = await client.query({ ...CATALOG_UPSERT_QUERY, values: catalogValues(value) });
          rows.push(result.rows[0]);
        }
        return rows;
      },
      (cause) => new CatalogRepositoryError('Catalog card batch upsert failed and was rolled back.', {
        cause,
        code: 'CATALOG_CARD_UPSERT_FAILED',
        details: { count: normalized.length, canonicalKeys: normalized.slice(0, 10).map((item) => item.canonicalKey) },
      }),
    );
  }

  async upsertCardEmbedding(input) {
    return (await this.upsertCardEmbeddings([input]))[0];
  }

  async upsertCardEmbeddings(inputs) {
    if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > MAX_EMBEDDING_BATCH) {
      throw new TypeError(`inputs must contain between 1 and ${MAX_EMBEDDING_BATCH} embeddings.`);
    }
    const normalized = inputs.map((item, index) => normalizeEmbedding(item, index));
    return runTransaction(
      this.pool,
      async (client) => {
        const rows = [];
        for (const value of normalized) {
          const result = await client.query({ ...EMBEDDING_UPSERT_QUERY, values: embeddingValues(value) });
          rows.push(result.rows[0]);
        }
        return rows;
      },
      (cause) => new CatalogRepositoryError('Card embedding batch upsert failed and was rolled back.', {
        cause,
        code: 'CARD_EMBEDDING_UPSERT_FAILED',
        details: {
          count: normalized.length,
          catalogCardIds: normalized.slice(0, 10).map((item) => item.catalogCardId),
          modelName: normalized[0]?.modelName,
          modelVersion: normalized[0]?.modelVersion,
        },
      }),
    );
  }
}
