const MAX_IMPORT_BATCH = 5000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IMAGE_SIDES = new Set(['front', 'back', 'label', 'other']);

export class CatalogPipelineError extends Error {
  constructor(message, { cause, code = 'CATALOG_PIPELINE_ERROR', details = {} } = {}) {
    super(message, { cause });
    this.name = 'CatalogPipelineError';
    this.code = code;
    this.details = details;
  }
}

function requiredString(value, name, maxLength) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new TypeError(`${name} is required.`);
  if (normalized.length > maxLength) throw new TypeError(`${name} exceeds ${maxLength} characters.`);
  return normalized;
}

function optionalString(value, maxLength) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function optionalInteger(value, name, minimum, maximum) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new TypeError(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function objectValue(value, name) {
  if (value === null || value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
  return structuredClone(value);
}

function normalizeCard(input, sourceNamespace) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('record.card must be an object.');
  return {
    canonical_key: requiredString(input.canonicalKey, 'card.canonicalKey', 500),
    sport_or_game: requiredString(input.sportOrGame, 'card.sportOrGame', 100),
    release_year: optionalInteger(input.releaseYear, 'card.releaseYear', 1800, 2200),
    manufacturer: optionalString(input.manufacturer, 255),
    brand: optionalString(input.brand, 255),
    set_name: requiredString(input.setName, 'card.setName', 500),
    set_code: optionalString(input.setCode, 100),
    card_number: requiredString(input.cardNumber, 'card.cardNumber', 100),
    subject_name: requiredString(input.subjectName, 'card.subjectName', 500),
    team_or_faction: optionalString(input.teamOrFaction, 255),
    parallel_name: requiredString(input.parallelName || 'BASE', 'card.parallelName', 255),
    language_code: requiredString(input.languageCode || 'en', 'card.languageCode', 30),
    serial_numbered_to: optionalInteger(input.serialNumberedTo, 'card.serialNumberedTo', 1, 10_000_000),
    is_rookie: Boolean(input.isRookie),
    source_namespace: sourceNamespace,
    source_record_id: optionalString(input.sourceRecordId, 500),
    metadata: objectValue(input.metadata, 'card.metadata'),
  };
}

function normalizeReference(input, canonicalKey, sourceNamespace, defaultAuthorizationBasis) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('referenceImages entries must be objects.');
  const side = requiredString(input.side || 'other', 'referenceImages[].side', 20).toLowerCase();
  if (!IMAGE_SIDES.has(side)) throw new TypeError(`Unsupported reference image side '${side}'.`);
  const sha256 = optionalString(input.sha256, 64)?.toLowerCase() || null;
  if (sha256 && !SHA256_PATTERN.test(sha256)) throw new TypeError('referenceImages[].sha256 must be lowercase SHA-256 hex.');
  return {
    canonical_key: canonicalKey,
    image_side: side,
    source_namespace: sourceNamespace,
    source_record_id: optionalString(input.sourceRecordId, 500),
    image_uri: requiredString(input.uri, 'referenceImages[].uri', 2048),
    image_sha256: sha256,
    mime_type: optionalString(input.mimeType, 100),
    width: optionalInteger(input.width, 'referenceImages[].width', 1, 100_000),
    height: optionalInteger(input.height, 'referenceImages[].height', 1, 100_000),
    authorization_basis: requiredString(input.authorizationBasis || defaultAuthorizationBasis, 'referenceImages[].authorizationBasis', 200),
    commercial_use_allowed: Boolean(input.commercialUseAllowed),
    training_use_allowed: Boolean(input.trainingUseAllowed),
    canonical_display_allowed: Boolean(input.canonicalDisplayAllowed),
    metadata: objectValue(input.metadata, 'referenceImages[].metadata'),
  };
}

function normalizeImport(records, options) {
  if (!Array.isArray(records) || records.length < 1 || records.length > MAX_IMPORT_BATCH) {
    throw new TypeError(`records must contain between 1 and ${MAX_IMPORT_BATCH} entries.`);
  }
  const sourceNamespace = requiredString(options.sourceNamespace, 'sourceNamespace', 100);
  const authorizationBasis = requiredString(options.authorizationBasis, 'authorizationBasis', 200);
  const cards = [];
  const references = [];
  for (const record of records) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw new TypeError('Each catalog record must be an object.');
    const card = normalizeCard(record.card || record, sourceNamespace);
    cards.push(card);
    const images = Array.isArray(record.referenceImages) ? record.referenceImages : [];
    for (const image of images) references.push(normalizeReference(image, card.canonical_key, sourceNamespace, authorizationBasis));
  }
  return {
    cards,
    references,
    sourceNamespace,
    authorizationBasis,
    modelName: requiredString(options.modelName, 'modelName', 128),
    modelVersion: requiredString(options.modelVersion, 'modelVersion', 128),
    priority: optionalInteger(options.priority ?? 100, 'priority', 0, 1000),
  };
}

const UPSERT_CARDS = `
  INSERT INTO public.catalog_cards (
    canonical_key, sport_or_game, release_year, manufacturer, brand, set_name, set_code,
    card_number, subject_name, team_or_faction, parallel_name, language_code,
    serial_numbered_to, is_rookie, source_namespace, source_record_id, metadata
  )
  SELECT
    row.canonical_key, row.sport_or_game, row.release_year, row.manufacturer, row.brand,
    row.set_name, row.set_code, row.card_number, row.subject_name, row.team_or_faction,
    row.parallel_name, row.language_code, row.serial_numbered_to, row.is_rookie,
    row.source_namespace, row.source_record_id, COALESCE(row.metadata, '{}'::jsonb)
  FROM jsonb_to_recordset($1::jsonb) AS row(
    canonical_key text, sport_or_game text, release_year integer, manufacturer text, brand text,
    set_name text, set_code text, card_number text, subject_name text, team_or_faction text,
    parallel_name text, language_code text, serial_numbered_to integer, is_rookie boolean,
    source_namespace text, source_record_id text, metadata jsonb
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
    source_namespace = EXCLUDED.source_namespace,
    source_record_id = COALESCE(EXCLUDED.source_record_id, catalog_cards.source_record_id),
    metadata = catalog_cards.metadata || EXCLUDED.metadata,
    is_active = true
  RETURNING id, canonical_key
`;

const UPSERT_REFERENCES = `
  INSERT INTO public.catalog_reference_images (
    catalog_card_id, image_side, source_namespace, source_record_id, image_uri, image_sha256,
    mime_type, width, height, authorization_basis, commercial_use_allowed,
    training_use_allowed, canonical_display_allowed, metadata
  )
  SELECT
    card.id, row.image_side, row.source_namespace, row.source_record_id, row.image_uri,
    row.image_sha256, row.mime_type, row.width, row.height, row.authorization_basis,
    row.commercial_use_allowed, row.training_use_allowed, row.canonical_display_allowed,
    COALESCE(row.metadata, '{}'::jsonb)
  FROM jsonb_to_recordset($1::jsonb) AS row(
    canonical_key text, image_side text, source_namespace text, source_record_id text,
    image_uri text, image_sha256 text, mime_type text, width integer, height integer,
    authorization_basis text, commercial_use_allowed boolean, training_use_allowed boolean,
    canonical_display_allowed boolean, metadata jsonb
  )
  JOIN public.catalog_cards AS card ON card.canonical_key = row.canonical_key
  ON CONFLICT (source_namespace, image_uri) DO UPDATE SET
    catalog_card_id = EXCLUDED.catalog_card_id,
    image_side = EXCLUDED.image_side,
    source_record_id = COALESCE(EXCLUDED.source_record_id, catalog_reference_images.source_record_id),
    image_sha256 = COALESCE(EXCLUDED.image_sha256, catalog_reference_images.image_sha256),
    mime_type = COALESCE(EXCLUDED.mime_type, catalog_reference_images.mime_type),
    width = COALESCE(EXCLUDED.width, catalog_reference_images.width),
    height = COALESCE(EXCLUDED.height, catalog_reference_images.height),
    authorization_basis = EXCLUDED.authorization_basis,
    commercial_use_allowed = EXCLUDED.commercial_use_allowed,
    training_use_allowed = EXCLUDED.training_use_allowed,
    canonical_display_allowed = EXCLUDED.canonical_display_allowed,
    metadata = catalog_reference_images.metadata || EXCLUDED.metadata
  RETURNING id, catalog_card_id, image_side, image_uri
`;

const ENQUEUE_EMBEDDINGS = `
  INSERT INTO public.catalog_embedding_queue (
    catalog_card_id, reference_image_id, model_name, model_version, priority, metadata
  )
  SELECT
    reference.catalog_card_id, reference.id, $2, $3, $4,
    jsonb_build_object('source_namespace', reference.source_namespace, 'image_side', reference.image_side)
  FROM public.catalog_reference_images AS reference
  WHERE reference.id = ANY($1::uuid[])
    AND reference.image_side IN ('front', 'back')
    AND reference.commercial_use_allowed = true
  ON CONFLICT (reference_image_id, model_name, model_version) DO UPDATE SET
    status = CASE WHEN catalog_embedding_queue.status = 'complete' THEN 'complete' ELSE 'pending' END,
    priority = GREATEST(catalog_embedding_queue.priority, EXCLUDED.priority),
    available_at = CASE
      WHEN catalog_embedding_queue.status = 'complete' THEN catalog_embedding_queue.available_at
      ELSE clock_timestamp()
    END,
    last_error_code = NULL,
    last_error_message = NULL,
    metadata = catalog_embedding_queue.metadata || EXCLUDED.metadata
  RETURNING id
`;

export class CatalogPipelineRepository {
  constructor(pool) {
    if (!pool || typeof pool.connect !== 'function') throw new TypeError('CatalogPipelineRepository requires a pg.Pool-compatible instance.');
    this.pool = pool;
  }

  async importBatch(records, options) {
    const normalized = normalizeImport(records, options || {});
    const client = await this.pool.connect();
    let transactionOpen = false;
    let discardClient = false;
    try {
      await client.query('BEGIN');
      transactionOpen = true;
      const cardsResult = await client.query(UPSERT_CARDS, [JSON.stringify(normalized.cards)]);
      let referenceRows = [];
      if (normalized.references.length) {
        const referenceResult = await client.query(UPSERT_REFERENCES, [JSON.stringify(normalized.references)]);
        referenceRows = referenceResult.rows;
      }
      let embeddingRows = [];
      if (referenceRows.length) {
        const embeddingResult = await client.query(ENQUEUE_EMBEDDINGS, [
          referenceRows.map((row) => row.id),
          normalized.modelName,
          normalized.modelVersion,
          normalized.priority,
        ]);
        embeddingRows = embeddingResult.rows;
      }
      await client.query('COMMIT');
      transactionOpen = false;
      return {
        cardsUpserted: cardsResult.rowCount,
        referencesUpserted: referenceRows.length,
        embeddingJobsEnqueued: embeddingRows.length,
        cards: cardsResult.rows,
      };
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
      const cause = rollbackError
        ? new AggregateError([error, rollbackError], 'Catalog import and rollback both failed.')
        : error;
      throw new CatalogPipelineError('Authorized catalog batch import failed and was rolled back.', {
        cause,
        code: 'CATALOG_BATCH_IMPORT_FAILED',
        details: {
          records: normalized.cards.length,
          references: normalized.references.length,
          sourceNamespace: normalized.sourceNamespace,
        },
      });
    } finally {
      client.release(discardClient ? new Error('Discarding PostgreSQL client after rollback failure.') : undefined);
    }
  }

  async createSyncJob({ sourceNamespace, authorizationBasis, inputUri = null, inputSha256 = null, metadata = {} }) {
    const source = requiredString(sourceNamespace, 'sourceNamespace', 100);
    const basis = requiredString(authorizationBasis, 'authorizationBasis', 200);
    const sha = optionalString(inputSha256, 64)?.toLowerCase() || null;
    if (sha && !SHA256_PATTERN.test(sha)) throw new TypeError('inputSha256 must be lowercase SHA-256 hex.');
    const result = await this.pool.query(
      `INSERT INTO public.catalog_sync_jobs (
         source_namespace, authorization_basis, input_uri, input_sha256, metadata
       ) VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING *`,
      [source, basis, optionalString(inputUri, 2048), sha, JSON.stringify(objectValue(metadata, 'metadata'))],
    );
    return result.rows[0];
  }

  async updateSyncJob(jobId, patch) {
    const id = requiredString(jobId, 'jobId', 64).toLowerCase();
    if (!UUID_PATTERN.test(id)) throw new TypeError('jobId must be a UUID.');
    const status = requiredString(patch.status || 'running', 'status', 20);
    if (!new Set(['running', 'complete', 'failed', 'cancelled']).has(status)) throw new TypeError('Unsupported sync job status.');
    const values = [
      id,
      status,
      objectValue(patch.checkpoint, 'checkpoint'),
      Number(patch.recordsRead || 0),
      Number(patch.cardsUpserted || 0),
      Number(patch.imagesUpserted || 0),
      Number(patch.embeddingJobsEnqueued || 0),
      Number(patch.rejectedRecords || 0),
      optionalString(patch.errorCode, 100),
      optionalString(patch.errorMessage, 2000),
    ];
    if (!values.slice(3, 8).every((value) => Number.isSafeInteger(value) && value >= 0)) {
      throw new TypeError('Sync counters must be non-negative safe integers.');
    }
    const result = await this.pool.query(
      `UPDATE public.catalog_sync_jobs SET
         status = $2,
         checkpoint = $3::jsonb,
         records_read = $4,
         cards_upserted = $5,
         images_upserted = $6,
         embedding_jobs_enqueued = $7,
         rejected_records = $8,
         error_code = $9,
         error_message = $10,
         completed_at = CASE WHEN $2 IN ('complete', 'failed', 'cancelled') THEN clock_timestamp() ELSE NULL END
       WHERE id = $1
       RETURNING *`,
      [values[0], values[1], JSON.stringify(values[2]), ...values.slice(3)],
    );
    if (!result.rowCount) throw new CatalogPipelineError('Catalog sync job was not found.', { code: 'SYNC_JOB_NOT_FOUND' });
    return result.rows[0];
  }
}
