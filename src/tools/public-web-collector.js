#!/usr/bin/env node
import { collectApprovedPublicPage } from '../services/public-web-collector.js';
import { JsonStore } from '../services/store.js';

function arg(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

const storePath = arg('store', process.env.MANEFLOW_RUNTIME_FILE || './runtime/maneflow.json');
const provider = arg('provider');
const url = arg('url');
const dryRun = process.argv.includes('--dry-run');

if (!provider || !url) {
  console.error('Usage: node src/tools/public-web-collector.js --store ./runtime/maneflow.json --provider "Approved Source" --url https://example.com/sale --dry-run');
  process.exit(2);
}

const store = await new JsonStore(storePath).init();
const result = await collectApprovedPublicPage({
  store,
  source: provider,
  url,
  actor: { userId: 'cli', role: 'admin', service: true },
  dryRun,
});
console.log(JSON.stringify(result, null, 2));
