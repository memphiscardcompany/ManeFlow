import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importTcgCatalog } from '../src/services/tcg-catalog-importer.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

function arg(name, fallback = '') {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] || fallback : fallback;
}

const inputFile = arg('file');
const format = arg('format', 'generic-csv');
const sourceName = arg('source', format);
const outPath = path.resolve(arg('out', path.join(root, 'src/data/cards.tcg-imported.json')));

if (!inputFile) {
  console.log('Usage: node scripts/import-tcg-catalog-data.mjs --file ./pokemon-cards.json --format pokemon-tcg-api --source "Pokemon TCG API"');
  console.log('Formats: pokemon-tcg-api, tcgdex-api, scryfall-bulk, ygoprodeck-api, lorcast-api, generic-csv. Use only API exports, bulk files, or CSVs you are authorized to store.');
  process.exit(0);
}

const body = await fs.readFile(path.resolve(inputFile), 'utf8');
const result = importTcgCatalog(body, { format, sourceName });
await fs.mkdir(path.dirname(outPath), { recursive: true });
await fs.writeFile(outPath, JSON.stringify(result.cards, null, 2) + '\n');
console.log(`Wrote ${result.summary.unique} TCG catalog rows to ${outPath}`);
console.log(`Parsed ${result.summary.parsed} rows with ${result.summary.errors} errors.`);
