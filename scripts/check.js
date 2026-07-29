import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ignored = new Set(['node_modules', '.git', '.runtime', 'backups']);
const files = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute);
    else files.push(absolute);
  }
}
walk(root);

const javascript = files.filter((file) => file.endsWith('.js'));
for (const file of javascript) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${path.relative(root, file)} failed syntax validation\n${result.stderr}`);
}
for (const file of files.filter((item) => item.endsWith('.json') || item.endsWith('.webmanifest'))) {
  JSON.parse(fs.readFileSync(file, 'utf8'));
}
const textFiles = files.filter((file) => /\.(js|ts|tsx|json|md|yaml|yml|html|css|txt|example)$/.test(file));
for (const file of textFiles) {
  const text = fs.readFileSync(file, 'utf8');
  if (text.includes(['REPLACE','WITH','EAS','PROJECT','ID'].join('_'))) throw new Error(`Unresolved project placeholder in ${path.relative(root, file)}`);
}
const firstRun = fs.readFileSync(path.join(root, 'scripts', 'first-run.js'), 'utf8');
if (!/\['RELEASE_CHANNEL',\s*'production-foundation-beta'\]/.test(firstRun)) {
  throw new Error('first-run setup must create the production-foundation beta release channel.');
}
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const openapi = fs.readFileSync(path.join(root, 'integrations', 'openapi.yaml'), 'utf8');
const escapedVersion = pkg.version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
if (!(new RegExp(`version:\\s*${escapedVersion}`)).test(openapi)) throw new Error(`OpenAPI version must match ${pkg.version}.`);
console.log(`Validated ${javascript.length} JavaScript files, JSON manifests, and release placeholders.`);
