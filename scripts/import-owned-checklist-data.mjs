import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dedupeCatalogCards, extractOwnedChecklistCards, sourceNameFromFile } from '../src/services/checklist-importer.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outputIndex = args.indexOf('--out');
const summaryIndex = args.indexOf('--summary');
const outPath = outputIndex >= 0 ? path.resolve(args[outputIndex + 1]) : path.join(root, 'src/data/cards.memphis-owned.json');
const summaryPath = summaryIndex >= 0 ? path.resolve(args[summaryIndex + 1]) : path.join(root, 'docs/OWNED_CHECKLIST_IMPORT_SUMMARY.md');
const files = [];
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === '--out' || arg === '--summary') {
    index += 1;
    continue;
  }
  if (!arg.startsWith('--')) files.push(path.resolve(arg));
}

if (!files.length) {
  console.log('Usage: node scripts/import-owned-checklist-data.mjs <collection-or-ebay-csv> [...more.csv]');
  console.log('Only user-owned exports, licensed checklists, or authorized catalog files should be imported.');
  process.exit(0);
}

const allCards = [];
const fileSummaries = [];
for (const file of files) {
  const text = await fs.readFile(file, 'utf8');
  const result = extractOwnedChecklistCards(text, { sourceName: sourceNameFromFile(file) });
  allCards.push(...result.cards);
  fileSummaries.push({ file: path.basename(file), ...result.summary, errors: result.errors });
}

const merged = dedupeCatalogCards(allCards, { sourceName: 'memphis_owned_exports' });
await fs.mkdir(path.dirname(outPath), { recursive: true });
await fs.writeFile(outPath, JSON.stringify(merged.cards, null, 2) + '\n');

const summary = `# Owned Checklist Import Summary

Generated for ManeFlow from user-owned collection/listing/order exports.

This file intentionally includes only sanitized card identity rows. It does not include buyer names, emails, addresses, order numbers, tracking numbers, prices, payment data, or private customer fields.

## Result

- Output: \`${path.relative(root, outPath).replace(/\\/g, '/')}\`
- Unique catalog rows: ${merged.summary.unique}
- Parsed candidate rows: ${merged.summary.parsed}

## Source Files

${fileSummaries.map((item) => `- ${item.file}: ${item.unique} unique rows from ${item.parsed} parsed candidate rows${item.errors ? `, ${item.errors.length} errors` : ''}`).join('\n')}

## Boundary

These rows expand ManeFlow autocomplete for Memphis Card Company owned/exported data. They are not a universal manufacturer checklist and do not create completed-sale pricing by themselves.
`;
await fs.writeFile(summaryPath, summary);
console.log(`Wrote ${merged.summary.unique} catalog rows to ${outPath}`);
console.log(`Wrote summary to ${summaryPath}`);
