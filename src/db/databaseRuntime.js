export class DatabaseRuntimeError extends Error {
  constructor(message, { cause, code = 'DATABASE_RUNTIME_ERROR' } = {}) {
    super(message, { cause });
    this.name = 'DatabaseRuntimeError';
    this.code = code;
  }
}

export class DatabaseRuntime {
  constructor(config = {}) {
    this.config = config;
    this.pool = null;
    this.inventoryRepository = null;
    this.catalogRepository = null;
    this.metaInboundRepository = null;
    this.metaOutboundRepository = null;
    this.metaDeliveryRepository = null;
    this.initializationError = null;
  }

  get configured() {
    return typeof this.config.databaseUrl === 'string' && this.config.databaseUrl.trim().length > 0;
  }

  async initialize() {
    if (!this.configured) return this;
    if (this.pool && this.inventoryRepository) return this;
    try {
      const [
        { createInventoryDatabasePool, InventoryRepository },
        { CatalogRepository },
        { MetaInboundRepository },
        { MetaOutboundRepository },
        { MetaDeliveryRepository },
      ] = await Promise.all([
        import('./inventoryRepository.js'),
        import('./catalogRepository.js'),
        import('./metaInboundRepository.js'),
        import('./metaOutboundRepository.js'),
        import('./metaDeliveryRepository.js'),
      ]);
      this.pool = createInventoryDatabasePool({
        connectionString: this.config.databaseUrl,
        max: this.config.databasePoolMax,
        idleTimeoutMillis: this.config.databaseIdleTimeoutMs,
        connectionTimeoutMillis: this.config.databaseConnectTimeoutMs,
        ssl: this.config.databaseSsl,
        applicationName: `maneflow-${this.config.version || 'development'}`,
      });
      this.inventoryRepository = new InventoryRepository(this.pool, {
        embeddingModelName: this.config.embeddingModelName,
        embeddingModelVersion: this.config.embeddingModelVersion,
        hnswEfSearch: this.config.hnswEfSearch,
        statementTimeoutMs: this.config.databaseStatementTimeoutMs,
      });
      this.catalogRepository = new CatalogRepository(this.pool);
      this.metaInboundRepository = new MetaInboundRepository(this.pool);
      this.metaOutboundRepository = new MetaOutboundRepository(this.pool, {
        leaseDurationMs: this.config.metaOutboundLeaseMs,
      });
      this.metaDeliveryRepository = new MetaDeliveryRepository(this.pool);
      this.metaInboundRepository.reconcileEchoes = this.metaDeliveryRepository.reconcileEchoes.bind(this.metaDeliveryRepository);
      await this.pool.query('SELECT 1 AS ok');
      this.initializationError = null;
      return this;
    } catch (error) {
      this.initializationError = error instanceof Error ? error.message : String(error);
      await this.close();
      throw new DatabaseRuntimeError('PostgreSQL runtime initialization failed.', {
        cause: error,
        code: 'DATABASE_INITIALIZATION_FAILED',
      });
    }
  }

  async health() {
    if (!this.configured) {
      return { configured: false, ready: false, mode: 'disabled', reason: 'DATABASE_URL is not configured.' };
    }
    if (!this.pool || !this.inventoryRepository) {
      return { configured: true, ready: false, mode: 'postgres', reason: this.initializationError || 'not_initialized' };
    }
    try {
      const result = await this.pool.query(`
        SELECT
          current_database() AS database_name,
          EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS vector_enabled,
          to_regclass('public.catalog_card_embeddings') IS NOT NULL AS embedding_table_ready,
          to_regclass('public.shop_inventory') IS NOT NULL AS inventory_table_ready
      `);
      const row = result.rows[0] || {};
      const ready = Boolean(row.vector_enabled && row.embedding_table_ready && row.inventory_table_ready);
      return {
        configured: true,
        ready,
        mode: 'postgres',
        databaseName: row.database_name || null,
        vectorEnabled: Boolean(row.vector_enabled),
        embeddingTableReady: Boolean(row.embedding_table_ready),
        inventoryTableReady: Boolean(row.inventory_table_ready),
      };
    } catch (error) {
      return {
        configured: true,
        ready: false,
        mode: 'postgres',
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  requireCatalogRepository() {
    if (!this.catalogRepository) {
      throw new DatabaseRuntimeError('PostgreSQL catalog repository is not ready.', {
        code: 'CATALOG_REPOSITORY_NOT_READY',
      });
    }
    return this.catalogRepository;
  }

  async upsertCatalogCard(input) {
    return this.requireCatalogRepository().upsertCatalogCard(input);
  }

  async upsertCatalogCards(inputs) {
    return this.requireCatalogRepository().upsertCatalogCards(inputs);
  }

  async upsertCardEmbedding(input) {
    return this.requireCatalogRepository().upsertCardEmbedding(input);
  }

  async upsertCardEmbeddings(inputs) {
    return this.requireCatalogRepository().upsertCardEmbeddings(inputs);
  }

  async findVisualMatches({ embedding, shopId, limit = 10 }) {
    if (!this.inventoryRepository) {
      throw new DatabaseRuntimeError('PostgreSQL vector search is not ready.', {
        code: 'VECTOR_SEARCH_NOT_READY',
      });
    }
    return this.inventoryRepository.findVisualMatches(embedding, shopId, limit);
  }

  requireMetaOutboundRepository() {
    if (!this.metaOutboundRepository) {
      throw new DatabaseRuntimeError('PostgreSQL Meta outbox repository is not ready.', {
        code: 'META_OUTBOUND_REPOSITORY_NOT_READY',
      });
    }
    return this.metaOutboundRepository;
  }

  requireMetaInboundRepository() {
    if (!this.metaInboundRepository) {
      throw new DatabaseRuntimeError('PostgreSQL Meta inbox repository is not ready.', {
        code: 'META_INBOUND_REPOSITORY_NOT_READY',
      });
    }
    return this.metaInboundRepository;
  }

  requireMetaDeliveryRepository() {
    if (!this.metaDeliveryRepository) {
      throw new DatabaseRuntimeError('PostgreSQL Meta delivery repository is not ready.', {
        code: 'META_DELIVERY_REPOSITORY_NOT_READY',
      });
    }
    return this.metaDeliveryRepository;
  }

  async close() {
    const pool = this.pool;
    this.pool = null;
    this.inventoryRepository = null;
    this.catalogRepository = null;
    this.metaInboundRepository = null;
    this.metaOutboundRepository = null;
    this.metaDeliveryRepository = null;
    if (pool) await pool.end();
  }
}
