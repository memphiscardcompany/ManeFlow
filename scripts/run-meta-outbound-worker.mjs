import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.js';
import { DatabaseRuntime } from '../src/db/databaseRuntime.js';
import { dispatchMetaBatch, metaDispatcherReadiness } from '../src/manebrain/meta-dispatcher.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile?.(path.resolve(__dirname, '../.env'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const continuous = process.argv.includes('--continuous');
const config = loadConfig();
const ownerIds = config.platformOwnerUserIds || [];
if (ownerIds.length !== 1) {
  throw new Error('MANEFLOW_PLATFORM_OWNER_USER_IDS must contain exactly one immutable owner UUID.');
}

const runtime = new DatabaseRuntime(config);
await runtime.initialize();
const repository = runtime.requireMetaOutboundRepository();
const readiness = metaDispatcherReadiness(config, repository);
if (!readiness.ready) {
  console.error(JSON.stringify({ event: 'meta_dispatch_not_ready', mode: readiness.mode, missing: readiness.missing }));
  await runtime.close();
  process.exit(2);
}

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { stopping = true; });
}

async function cycle() {
  const result = await dispatchMetaBatch({
    repository,
    config,
    ownerUserId: ownerIds[0],
    limit: config.metaMaxDispatchBatch,
  });
  console.log(JSON.stringify({
    event: 'meta_dispatch_cycle',
    time: new Date().toISOString(),
    reconciledExpiredLeases: result.reconciledExpiredLeases,
    attempted: result.attempted,
    states: result.results.map((item) => item.state),
  }));
  return result;
}

try {
  do {
    const result = await cycle();
    if (!continuous || stopping) break;
    const idle = result.attempted === 0;
    await new Promise((resolve) => setTimeout(resolve, idle ? config.metaPollIntervalMs : 250));
  } while (!stopping);
} finally {
  await runtime.close();
}
