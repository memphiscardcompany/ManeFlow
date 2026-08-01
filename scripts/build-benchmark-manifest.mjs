#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  benchmarkManifestDigest,
  buildBenchmarkManifest,
  serializeBenchmarkManifest,
  validateBenchmarkManifest,
} from '../src/services/benchmark-manifest.js';

function argument(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const rootDirectory = argument('root');
const output = argument('output');
const rightsStatus = argument('rights-status');
const split = argument('split', 'unassigned');
const sourceType = argument('source-type', 'owner-controlled-folder');
const trainingUseAllowed = process.argv.includes('--training-use-allowed');

if (!rootDirectory || !output || !rightsStatus) {
  console.error('Usage: node scripts/build-benchmark-manifest.mjs --root <folder> --output <manifest.jsonl> --rights-status <status> [--split <split>] [--training-use-allowed]');
  process.exit(2);
}

const rows = await buildBenchmarkManifest({
  rootDirectory,
  rightsStatus,
  split,
  sourceType,
  trainingUseAllowed,
});
const validation = validateBenchmarkManifest(rows);
if (!validation.valid) {
  console.error(validation.errors.join('\n'));
  process.exit(1);
}

const outputPath = path.resolve(output);
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, serializeBenchmarkManifest(rows), { mode: 0o600 });
const summaryPath = `${outputPath}.summary.json`;
await writeFile(summaryPath, `${JSON.stringify({
  manifest_sha256: benchmarkManifestDigest(rows),
  ...validation.summary,
}, null, 2)}\n`, { mode: 0o600 });

console.log(JSON.stringify({
  output: outputPath,
  summary: summaryPath,
  manifest_sha256: benchmarkManifestDigest(rows),
  ...validation.summary,
}));
