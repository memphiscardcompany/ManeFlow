import fs from 'node:fs/promises';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '../src/config.js';
import { DatabaseRuntime } from '../src/db/databaseRuntime.js';
import {
  assertMetaDispatchLease,
  metaDispatcherReadiness,
} from '../src/manebrain/meta-dispatcher.js';
import { runMetaOutboundCycles } from '../src/manebrain/meta-outbound-worker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../.env');
const continuous = process.argv.includes('--continuous');

async function loadWorkerConfig() {
  let fileEnv = {};
  try {
    fileEnv = parseEnv(await fs.readFile(envPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  // Re-read the file every cycle so a kill-switch change takes effect before
  // another batch is claimed. File values intentionally override startup env.
  return loadConfig({ ...process.env, ...fileEnv });
}

const initialConfig = await loadWorkerConfig();
assertMetaDispatchLease(initialConfig);
const ownerIds = initialConfig.platformOwnerUserIds || [];
if (ownerIds.length !== 1) {
  throw new Error('MANEFLOW_PLATFORM_OWNER_USER_IDS must contain exactly one immutable owner UUID.');
}

const runtime = new DatabaseRuntime(initialConfig);
await runtime.initialize();
const repository = runtime.requireMetaOutboundRepository();
const readiness = metaDispatcherReadiness(initialConfig, repository);
if (!readiness.ready) {
  console.error(JSON.stringify({
    event: 'meta_dispatch_not_ready',
    mode: readiness.mode,
    missing: readiness.missing,
  }));
  await runtime.close();
  process.exit(2);
}

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { stopping = true; });
}

try {
  await runMetaOutboundCycles({
    repository,
    configLoader: loadWorkerConfig,
    ownerUserId: ownerIds[0],
    continuous,
    shouldStop: () => stopping,
    onEvent(event) {
      console.log(JSON.stringify(event));
    },
  });
} finally {
  await runtime.close();
}
