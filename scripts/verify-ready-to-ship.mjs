import { spawn } from 'node:child_process';
import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('exit', (code) => resolve(code ?? 1));
    child.on('error', (error) => { console.error(error.message); resolve(1); });
  });
}

const stages = [
  ['Existing ManeFlow beta verification', 'npm', ['run', 'verify:beta']],
  ['Live PSA partner validation', 'node', ['scripts/psa-live-smoke.mjs']],
  ['Accessible PSA image benchmark', 'node', ['scripts/run-live-image-suite.mjs']]
];

for (const [label, command, args] of stages) {
  console.log(`\n=== ${label} ===`);
  const code = await run(command, args);
  if (code !== 0) {
    console.error(`READY-TO-SHIP GATE FAILED: ${label}`);
    process.exit(code);
  }
}
console.log('\nREADY-TO-SHIP PROVIDER GATE PASSED.');
