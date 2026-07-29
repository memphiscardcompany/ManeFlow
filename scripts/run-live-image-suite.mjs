import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sampleDir = path.join(root, 'sample-data', 'live-psa');

async function exists(filePath) {
  try { await fs.access(filePath); return true; } catch { return false; }
}

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('exit', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
}

const candidates = [
  ['node', ['scripts/run-recognition-folder-benchmark.mjs', '--folder', sampleDir]],
  ['node', ['scripts/run-recognition-folder-benchmark.mjs', sampleDir]],
  ['node', ['scripts/run-recognition-benchmark.mjs', '--folder', sampleDir]]
];

let attempted = false;
let passed = false;
for (const [command, args] of candidates) {
  const script = path.join(root, args[0]);
  if (!(await exists(script))) continue;
  attempted = true;
  console.log(`Running image benchmark: ${command} ${args.join(' ')}`);
  const code = await run(command, args);
  if (code === 0) { passed = true; break; }
}

if (!attempted) {
  console.error('No compatible ManeFlow recognition benchmark script was found. Expected scripts/run-recognition-folder-benchmark.mjs or scripts/run-recognition-benchmark.mjs.');
  process.exit(1);
}
if (!passed) process.exit(1);
