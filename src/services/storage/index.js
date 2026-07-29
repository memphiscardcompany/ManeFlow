import { JsonStore } from '../store.js';
import { ConfigurationError } from '../errors.js';
import { PostgresStateStore } from './postgresStateStore.js';

export class JsonStoreAdapter {
  constructor(filePath) {
    this.mode = 'json';
    this.filePath = filePath;
    this.store = new JsonStore(filePath);
  }

  async init() {
    await this.store.init();
    return this.store;
  }

  async health() {
    return { mode: this.mode, ok: true, filePath: this.filePath };
  }

  async close() {}
}

export class PostgresStoreAdapter {
  constructor({ databaseUrl, poolOptions = {} }) {
    this.mode = 'postgres';
    this.databaseUrl = databaseUrl;
    this.poolOptions = poolOptions;
    this.store = null;
  }

  async init() {
    if (!this.databaseUrl) throw new ConfigurationError('DATABASE_URL is required for STORAGE_MODE=postgres.');
    this.store = new PostgresStateStore({ databaseUrl: this.databaseUrl, poolOptions: this.poolOptions });
    return this.store.init();
  }

  async health() {
    return this.store ? this.store.health() : { mode: this.mode, ok: false, reason: 'not_initialized' };
  }

  async close() {
    await this.store?.close();
  }
}

export function createStorageAdapter(config = {}) {
  if (config.storageMode === 'postgres') {
    return new PostgresStoreAdapter({
      databaseUrl: config.databaseUrl,
      poolOptions: {
        max: config.databasePoolMax,
        idleTimeoutMillis: config.databaseIdleTimeoutMs,
        connectionTimeoutMillis: config.databaseConnectTimeoutMs,
        ssl: config.databaseSsl,
        applicationName: `maneflow-state-${config.version || 'development'}`,
      },
    });
  }
  return new JsonStoreAdapter(config.runtimeFile);
}
