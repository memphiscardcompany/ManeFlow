import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.js';
import { DatabaseRuntime } from '../src/db/databaseRuntime.js';
import { MetaGraphClient } from '../src/manebrain/meta-graph-client.js';
import { MetaOutboundWorker } from '../src/manebrain/meta-outbound-worker.js';
import { loadMetaDispatchEnvelope } from '../src/manebrain/meta-dispatch-envelope.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile?.(path.resolve(__dirname, '../.env'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const config = loadConfig();
if (config.metaKillSwitch !== false) throw new Error('MANEBRAIN_META_KILL_SWITCH must be false to start the Meta worker.');
if (config.metaOutboundEnabled !== true) throw new Error('MANEBRAIN_META_OUTBOUND_ENABLED must be true to start the Meta worker.');
if (config.metaIntakeEnabled !== true) throw new Error('MANEBRAIN_META_INTAKE_ENABLED must be true to start the Meta worker.');
if (config.platformOwnerUserIds.length !== 1) {
  throw new Error('Exactly one immutable platform-owner UUID is required to start the Meta worker.');
}
if (!config.databaseUrl) throw new Error('DATABASE_URL is required to start the Meta worker.');

const databaseRuntime = new DatabaseRuntime(config);
await databaseRuntime.initialize();
const repository = databaseRuntime.requireMetaOutboundRepository();
const graphClient = new MetaGraphClient({
  pageAccessToken: config.metaPageAccessToken,
  instagramAccessToken: config.metaInstagramAccessToken,
  graphApiVersion: config.metaGraphApiVersion,
  messengerGraphBaseUrl: config.metaMessengerGraphBaseUrl,
  instagramGraphBaseUrl: config.metaInstagramGraphBaseUrl,
  requestTimeoutMs: config.metaRequestTimeoutMs,
});
const ownerUserId = config.platformOwnerUserIds[0];
const worker = new MetaOutboundWorker({
  ownerUserId,
  repository,
  graphClient,
  dispatchAllowed: true,
  pollIntervalMs: config.metaWorkerPollIntervalMs,
  loadEnvelope: ({ jobId, leaseToken }) => loadMetaDispatchEnvelope(
    databaseRuntime.pool,
    ownerUserId,
    { jobId, leaseToken },
  ),
});

const controller = new AbortController();
function stop(signal) {
  console.log(JSON.stringify({ event: 'meta_worker_stopping', signal }));
  controller.abort(new Error(signal));
}
process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));

console.log(JSON.stringify({
  event: 'meta_worker_started',
  ownerUserId,
  graphApiVersion: config.metaGraphApiVersion,
  outboundMode: 'owner_approval_required',
}));
try {
  await worker.run({ signal: controller.signal });
} catch (error) {
  if (!controller.signal.aborted) throw error;
} finally {
  await databaseRuntime.close();
  console.log(JSON.stringify({ event: 'meta_worker_stopped' }));
}
