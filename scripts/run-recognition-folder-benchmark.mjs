import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonStore } from '../src/services/store.js';
import { loadBundledCatalog } from '../src/services/catalog-loader.js';
import { analyzeCardScene } from '../src/services/vision.js';
import { parseRecognitionBenchmarkInput, runRecognitionBenchmark } from '../src/services/recognition-benchmark.js';
import { isSupportedBenchmarkImage, pairImagesWithBenchmarkCases } from '../src/services/recognition-folder-benchmark.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const LABEL_FILE_NAMES = new Set([
  'labels.json',
  'labels.csv',
  'annotations.json',
  'annotations.csv',
  'benchmark.json',
  'benchmark.csv',
  'recognition-labels.json',
  'recognition-labels.csv',
]);

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

async function walkFiles(directory) {
  const output = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await walkFiles(absolute));
    else output.push(absolute);
  }
  return output;
}

function relativeName(filePath, folder) {
  return path.relative(folder, filePath).replaceAll(path.sep, '/');
}

async function readLabelFile(filePath, sourceName) {
  const text = await fs.readFile(filePath, 'utf8');
  return parseRecognitionBenchmarkInput(text, { sourceName });
}

async function collectLabelCases(folder, images, sourceName) {
  const explicit = arg('labels');
  const labelFiles = [];
  if (explicit) {
    labelFiles.push(path.resolve(explicit));
  } else {
    for (const file of await walkFiles(folder)) {
      if (LABEL_FILE_NAMES.has(path.basename(file).toLowerCase())) labelFiles.push(file);
    }
  }

  const cases = [];
  for (const labelFile of labelFiles) cases.push(...await readLabelFile(labelFile, sourceName));

  const labelFileSet = new Set(labelFiles.map((file) => path.resolve(file).toLowerCase()));
  for (const image of images) {
    const parsed = path.parse(image.imagePath);
    const sidecar = path.join(parsed.dir, `${parsed.name}.json`);
    if (labelFileSet.has(path.resolve(sidecar).toLowerCase())) continue;
    try {
      const sidecarCases = await readLabelFile(sidecar, sourceName);
      cases.push(...sidecarCases.map((testCase) => ({
        ...testCase,
        imageRef: testCase.imageRef || image.imageRef,
        body: { ...testCase.body, imageName: testCase.body?.imageName || image.imageName },
      })));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return cases;
}

function mimeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.avif') return 'image/avif';
  return 'application/octet-stream';
}

async function dataUrlFor(filePath) {
  const mime = mimeFor(filePath);
  if (mime === 'image/avif') throw new Error(`Vision mode does not support AVIF yet. Convert to JPEG/PNG/WebP first: ${filePath}`);
  const body = await fs.readFile(filePath);
  return `data:${mime};base64,${body.toString('base64')}`;
}

async function applyVision(cases, { apiKey, model }) {
  const enriched = [];
  for (const testCase of cases) {
    const imagePath = testCase.folderImage?.imagePath;
    if (!imagePath) {
      enriched.push(testCase);
      continue;
    }
    const frontDataUrl = await dataUrlFor(imagePath);
    const sceneAnalysis = await analyzeCardScene({ frontDataUrl, apiKey, model });
    enriched.push({
      ...testCase,
      benchmarkEvidence: {
        ...(testCase.benchmarkEvidence || {}),
        realImage: true,
        liveVision: true,
        heldOut: ['evaluation', 'test', 'validation', 'heldout', 'holdout'].includes(String(testCase.split || 'evaluation').toLowerCase()),
      },
      sceneAnalysis: sceneAnalysis || testCase.sceneAnalysis,
      body: {
        ...testCase.body,
        frontDataUrl,
      },
    });
  }
  return enriched;
}

function renderMarkdown(report) {
  const lines = [];
  lines.push(`# ManeFlow Recognition Folder Benchmark`);
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Source: ${report.folderInput.sourceName}`);
  lines.push(`Mode: ${report.folderInput.visionMode ? 'live vision scene analysis' : 'label/observed-scene benchmark'}`);
  lines.push('');
  lines.push(`## Folder Intake`);
  lines.push('');
  lines.push(`- Images found: ${report.folderInput.imagesFound}`);
  lines.push(`- Labeled images: ${report.folderInput.labeledImages}`);
  lines.push(`- Unlabeled images: ${report.folderInput.unlabeledImages}`);
  lines.push(`- Labels loaded: ${report.folderInput.labelsLoaded}`);
  lines.push(`- Unmatched labels: ${report.folderInput.unmatchedLabels}`);
  lines.push('');
  lines.push(`## Accuracy`);
  lines.push('');
  lines.push(`| Metric | Result |`);
  lines.push(`|---|---:|`);
  for (const [key, value] of Object.entries(report.metrics)) lines.push(`| ${key} | ${value} |`);
  lines.push('');
  lines.push(`## Multi-Card / Binder Focus`);
  lines.push('');
  lines.push(`| Cases | Cards | Scene accuracy | Top-1 | Top-3 | Field accuracy | False confident | Needs confirmation |`);
  lines.push(`|---:|---:|---:|---:|---:|---:|---:|---:|`);
  const focus = report.multiCardFocus || {};
  lines.push(`| ${focus.cases || 0} | ${focus.expectedCards || 0} | ${focus.sceneAccuracy || 0}% | ${focus.top1Accuracy || 0}% | ${focus.top3Accuracy || 0}% | ${focus.fieldAccuracy || 0}% | ${focus.falseConfidentRate || 0}% | ${focus.needsConfirmationRate || 0}% |`);
  lines.push('');
  lines.push(`## Scene Breakdown`);
  lines.push('');
  lines.push(`| Scene | Cases | Cards | Scene accuracy | Top-1 | Top-3 |`);
  lines.push(`|---|---:|---:|---:|---:|---:|`);
  for (const scene of report.sceneBreakdown || []) {
    lines.push(`| ${scene.sceneType} | ${scene.cases} | ${scene.expectedCards} | ${scene.sceneAccuracy}% | ${scene.top1Accuracy}% | ${scene.top3Accuracy}% |`);
  }
  lines.push('');
  lines.push(`## Field Accuracy`);
  lines.push('');
  lines.push(`| Field | Accuracy | Correct / Total |`);
  lines.push(`|---|---:|---:|`);
  for (const [field, value] of Object.entries(report.fieldBreakdown || {})) {
    lines.push(`| ${field} | ${value.accuracy}% | ${value.correct} / ${value.total} |`);
  }
  lines.push('');
  lines.push(`## Failure Patterns`);
  lines.push('');
  const failures = report.failurePatterns || {};
  lines.push(`- Scene misses: ${failures.sceneMisses || 0}`);
  lines.push(`- Missed top-1 matches: ${failures.missedTop1 || 0}`);
  lines.push(`- Correct card present in top-3 but not first: ${failures.correctInTop3 || 0}`);
  lines.push(`- False-confident misses: ${failures.falseConfident || 0}`);
  lines.push(`- Cards requiring confirmation: ${failures.needsConfirmation || 0}`);
  lines.push(`- Weakest fields: ${(failures.weakFields || []).slice(0, 5).map((item) => `${item.field} ${item.accuracy}%`).join(', ') || 'none measured'}`);
  lines.push('');
  lines.push(`## Recommendations`);
  lines.push('');
  for (const item of report.recommendations || []) lines.push(`- ${item}`);
  if (!report.folderInput.visionMode) {
    lines.push('- This run did not call the live vision model. Add `--vision` with server-side vision credentials to measure actual image analysis instead of label/observed-scene matching.');
  }
  if (report.folderInput.unlabeledImages > 0) {
    lines.push('- Label the unlabeled images to turn them into measurable accuracy cases.');
  }
  return `${lines.join('\n')}\n`;
}

const folderArg = arg('images') || arg('folder');
if (!folderArg) {
  console.log('Usage: node scripts/run-recognition-folder-benchmark.mjs --images ./card-photos --labels ./card-photos/labels.json --source "Owner Phone Photos" --out ./reports/folder-benchmark.json');
  console.log('Use --vision to run live scene analysis when OPENAI_API_KEY/MANEFLOW_OPENAI_API_KEY and OPENAI_VISION_MODEL/MANEFLOW_OPENAI_VISION_MODEL are configured.');
  console.log('Labels may be labels.json/csv, annotations.json/csv, benchmark.json/csv, recognition-labels.json/csv, or per-image sidecar JSON files.');
  process.exit(0);
}

const folder = path.resolve(folderArg);
const sourceName = arg('source', 'Folder Recognition Benchmark');
const allFiles = await walkFiles(folder);
const limit = Number(arg('limit', '0')) || Infinity;
const images = allFiles
  .filter(isSupportedBenchmarkImage)
  .slice(0, limit)
  .map((imagePath) => ({
    imagePath,
    imageName: path.basename(imagePath),
    imageRef: relativeName(imagePath, folder),
  }));

const rawCases = await collectLabelCases(folder, images, sourceName);
const pairing = pairImagesWithBenchmarkCases(images, rawCases, { sourceName });
const { cards, corrections } = await loadCatalog();
const visionMode = has('vision');
let cases = pairing.pairedCases;
if (visionMode) {
  const apiKey = process.env.MANEFLOW_OPENAI_API_KEY || process.env.OPENAI_API_KEY || '';
  const model = process.env.MANEFLOW_OPENAI_VISION_MODEL || process.env.OPENAI_VISION_MODEL || '';
  if (!apiKey || !model) throw new Error('Vision mode requires MANEFLOW_OPENAI_API_KEY/OPENAI_API_KEY and MANEFLOW_OPENAI_VISION_MODEL/OPENAI_VISION_MODEL.');
  cases = await applyVision(cases, { apiKey, model });
}

const benchmark = cases.length
  ? runRecognitionBenchmark(cases, { cards, corrections, enrichCard: (card) => card })
  : {
    version: 'recognition-benchmark-v1.0',
    generatedAt: new Date().toISOString(),
    metrics: { totalCases: 0, totalExpectedCards: 0, sceneAccuracy: 0, top1Accuracy: 0, top3Accuracy: 0, fieldAccuracy: 0, falseConfidentRate: 0, needsConfirmationRate: 0 },
    fieldBreakdown: {},
    sceneBreakdown: [],
    multiCardFocus: { sceneType: 'multi_card_binder_focus', cases: 0, expectedCards: 0, sceneAccuracy: 0, top1Accuracy: 0, top3Accuracy: 0, fieldAccuracy: 0, falseConfidentRate: 0, needsConfirmationRate: 0 },
    failurePatterns: { sceneMisses: 0, missedTop1: 0, correctInTop3: 0, falseConfident: 0, needsConfirmation: 0, weakFields: [], multiCardOrBinderCases: 0, multiCardOrBinderTop1Accuracy: 0, examples: { missedTop1: [], falseConfident: [], sceneMisses: [] } },
    recommendations: ['No labeled benchmark images were found. Add labels.json/csv or per-image sidecar JSON labels before measuring accuracy.'],
    rows: [],
    policy: { benchmarkOnly: true, doesNotCreateMarketValues: true, doesNotPublishDatasetImages: true, useOnlyAuthorizedDatasets: true },
  };

const report = {
  ...benchmark,
  folderInput: {
    folder,
    sourceName,
    visionMode,
    ...pairing.summary,
    duplicateLabelKeys: pairing.duplicateLabelKeys,
    unlabeledImageRefs: pairing.unlabeledImages.slice(0, 100).map((item) => item.imageRef),
    unmatchedLabelIds: pairing.unmatchedLabels.slice(0, 100).map((item) => item.id),
  },
};

if (has('summary')) {
  console.log(JSON.stringify({ folderInput: report.folderInput, metrics: report.metrics, multiCardFocus: report.multiCardFocus, failurePatterns: report.failurePatterns, recommendations: report.recommendations }, null, 2));
} else {
  console.log(JSON.stringify(report, null, 2));
}

const outPath = arg('out');
if (outPath) {
  const resolved = path.resolve(outPath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, JSON.stringify(report, null, 2) + '\n');
  const markdownPath = arg('markdown', resolved.replace(/\.[^.]+$/, '.md'));
  await fs.writeFile(path.resolve(markdownPath), renderMarkdown(report));
}
