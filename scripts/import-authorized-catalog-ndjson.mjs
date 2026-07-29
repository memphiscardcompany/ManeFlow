import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { CatalogPipelineRepository } from '../src/db/catalogPipelineRepository.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try { process.loadEnvFile?.(path.join(root, '.env')); } catch (error) { if (error.code !== 'ENOENT') throw error; }

function argument(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

const file = argument('file');
const sourceNamespace = argument('source');
const authorizationBasis = argument('authorization');
const modelName = argument('model-name', process.env.EMBEDDING_MODEL_NAME || 'siglip2-so400m-card-front-v1');
const modelVersion = argument('model-version', process.env.EMBEDDING_MODEL_VERSION || '1');
const batchSize = Math.max(1, Math.min(5000, Number(argument('batch-size', '2000')) || 2000));
const checkpointFile = path.resolve(argument('checkpoint', file ? `${file}.checkpoint.json` : './catalog-import.checkpoint.json'));
const resume = process.argv.includes('--resume');

if (!file || !sourceNamespace || !authorizationBasis) {
  console.error('Usage: node scripts/import-authorized-catalog-ndjson.mjs --file catalog.ndjson --source provider --authorization official_api [--resume]');
  process.exit(2);
}
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');

const inputPath = path.resolve(file);
const inputStat = await fsp.stat(inputPath);
if (!inputStat.isFile()) throw new Error(`Catalog input is not a file: ${inputPath}`);

async function sha256File(filePath) {
  const digest = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => digest.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return digest.digest('hex');
}

const inputSha256 = await sha256File(inputPath);
let checkpoint = { line: 0, recordsRead: 0, cardsUpserted: 0, imagesUpserted: 0, embeddingJobsEnqueued: 0, rejectedRecords: 0, jobId: null };
if (resume) {
  checkpoint = { ...checkpoint, ...JSON.parse(await fsp.readFile(checkpointFile, 'utf8')) };
  if (checkpoint.inputSha256 && checkpoint.inputSha256 !== inputSha256) {
    throw new Error('Checkpoint input hash does not match the current catalog file.');
  }
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 4,
  application_name: 'maneflow-catalog-import',
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' } : undefined,
});
const repository = new CatalogPipelineRepository(pool);

try {
  if (!checkpoint.jobId) {
    const job = await repository.createSyncJob({
      sourceNamespace,
      authorizationBasis,
      inputUri: inputPath,
      inputSha256,
      metadata: { fileSize: inputStat.size, modelName, modelVersion },
    });
    checkpoint.jobId = job.id;
  }

  const input = fs.createReadStream(inputPath, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let lineNumber = 0;
  let batch = [];

  async function flush() {
    if (!batch.length) return;
    const result = await repository.importBatch(batch, {
      sourceNamespace,
      authorizationBasis,
      modelName,
      modelVersion,
      priority: 100,
    });
    checkpoint.cardsUpserted += result.cardsUpserted;
    checkpoint.imagesUpserted += result.referencesUpserted;
    checkpoint.embeddingJobsEnqueued += result.embeddingJobsEnqueued;
    batch = [];
    checkpoint.line = lineNumber;
    checkpoint.inputSha256 = inputSha256;
    await fsp.writeFile(checkpointFile, JSON.stringify(checkpoint, null, 2) + '\n');
    await repository.updateSyncJob(checkpoint.jobId, {
      status: 'running',
      checkpoint: { line: checkpoint.line, inputSha256 },
      ...checkpoint,
    });
  }

  for await (const rawLine of lines) {
    lineNumber += 1;
    if (lineNumber <= checkpoint.line) continue;
    const line = rawLine.trim();
    if (!line) continue;
    checkpoint.recordsRead += 1;
    try {
      batch.push(JSON.parse(line));
    } catch (error) {
      checkpoint.rejectedRecords += 1;
      console.error(`Rejected line ${lineNumber}: ${error.message}`);
    }
    if (batch.length >= batchSize) await flush();
  }
  await flush();
  await repository.updateSyncJob(checkpoint.jobId, {
    status: 'complete',
    checkpoint: { line: checkpoint.line, inputSha256 },
    ...checkpoint,
  });
  console.log(JSON.stringify({ status: 'complete', ...checkpoint }, null, 2));
} catch (error) {
  if (checkpoint.jobId) {
    await repository.updateSyncJob(checkpoint.jobId, {
      status: 'failed',
      checkpoint: { line: checkpoint.line, inputSha256 },
      ...checkpoint,
      errorCode: error.code || 'CATALOG_IMPORT_FAILED',
      errorMessage: error.message,
    }).catch(() => {});
  }
  throw error;
} finally {
  await pool.end();
}
