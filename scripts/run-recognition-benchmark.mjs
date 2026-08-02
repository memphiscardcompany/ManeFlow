import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonStore } from '../src/services/store.js';
import { loadBundledCatalog } from '../src/services/catalog-loader.js';
import { parseRecognitionBenchmarkInput, runRecognitionBenchmark } from '../src/services/recognition-benchmark.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

function arg(name, fallback = '') {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] || fallback : fallback;
}

function has(name) {
  return args.includes(`--${name}`);
}

async function readJsonFile(filePath, fallback = []) {
  try {
    return JSON.parse(await fs.readFile(path.resolve(filePath), 'utf8'));
  } catch (error) {
    if (fallback !== undefined && error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function loadCatalog() {
  const bundled = await loadBundledCatalog(root);
  const extraPath = arg('catalog');
  const extra = extraPath ? await readJsonFile(extraPath, []) : [];
  const storePath = arg('store');
  if (!storePath) return { cards: [...bundled, ...extra], corrections: [] };
  const store = await new JsonStore(path.resolve(storePath)).init();
  return {
    cards: [...bundled, ...extra, ...(store.state.customCards || [])],
    corrections: store.state.scanCorrections || [],
  };
}

const inputFile = arg('file');
if (!inputFile) {
  console.log('Usage: node scripts/run-recognition-benchmark.mjs --file ./benchmark.json --source "GotThatData Sports Cards Dataset" --out ./recognition-report.json');
  console.log('Input may be JSON, JSON array, or CSV. It can include expectedCards/cards/labels, metadata/text JSON, imageName/imagePath/imageUrl, and optional observed sceneAnalysis.');
  console.log('This tool is for internal recognition testing only. It never imports pricing data or stores dataset images.');
  process.exit(0);
}

const sourceName = arg('source', 'Recognition Benchmark Dataset');
const input = await fs.readFile(path.resolve(inputFile), 'utf8');
const cases = parseRecognitionBenchmarkInput(input, { sourceName });
const { cards, corrections } = await loadCatalog();
const report = runRecognitionBenchmark(cases, {
  cards,
  corrections,
  enrichCard: (card) => card,
});

if (has('summary')) {
  console.log(JSON.stringify({ version: report.version, generatedAt: report.generatedAt, metrics: report.metrics, recommendations: report.recommendations, policy: report.policy }, null, 2));
} else {
  console.log(JSON.stringify(report, null, 2));
}

const outPath = arg('out');
if (outPath) {
  await fs.mkdir(path.dirname(path.resolve(outPath)), { recursive: true });
  await fs.writeFile(path.resolve(outPath), JSON.stringify(report, null, 2) + '\n');
}
