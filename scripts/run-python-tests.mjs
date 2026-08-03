import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const worker = path.join(root, 'vision-worker');
const configured = String(process.env.PYTEST || '').trim();
const candidates = [
  configured,
  path.join(root, '.venv-vision', 'Scripts', 'pytest.exe'),
  path.join(root, '.venv-vision', 'bin', 'pytest'),
  path.join(worker, '.venv', 'Scripts', 'pytest.exe'),
  path.join(worker, '.venv', 'bin', 'pytest'),
  'pytest',
].filter(Boolean);

const executable = candidates.find((candidate) => (
  candidate === 'pytest' || fs.existsSync(candidate)
));
if (!executable) {
  console.error('Pytest is unavailable. Install vision-worker requirements or set PYTEST to an executable path.');
  process.exit(1);
}

const result = spawnSync(executable, ['-q', ...process.argv.slice(2)], {
  cwd: worker,
  stdio: 'inherit',
  shell: false,
  env: process.env,
});
if (result.error) {
  console.error(`Unable to start pytest: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
