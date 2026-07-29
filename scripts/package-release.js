import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const releaseFolder = `ManeFlow-v${pkg.version}-Unified-Source`;
const stagingRoot = path.resolve(root, '..', '.release-staging');
const staged = path.join(stagingRoot, releaseFolder);
const output = path.resolve(root, '..', `${releaseFolder}.zip`);

for (const target of [output, stagingRoot]) {
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
}

const excludedNames = new Set([
  '.runtime', '.runtime-build', 'node_modules', '.DS_Store', '.env', 'backups', 'coverage',
  'screenshots', '.release-staging', '.pytest_cache', '__pycache__', '.venv', '.venv-windows',
  '.venv-beta', 'dist', 'build', 'imported-contributions', 'SHA256SUMS.txt',
]);
const excludedSuffixes = ['.sqlite3', '.sqlite', '.db', '.pyc', '.pyo', '.log'];

fs.mkdirSync(stagingRoot, { recursive: true });
fs.cpSync(root, staged, {
  recursive: true,
  filter: (source) => {
    const name = path.basename(source);
    if (name.includes('.before-restore-')) return false;
    if (excludedNames.has(name)) return false;
    return !excludedSuffixes.some((suffix) => name.toLowerCase().endsWith(suffix));
  },
});

const result = process.platform === 'win32'
  ? spawnSync('powershell', [
      '-NoProfile', '-Command',
      `$ErrorActionPreference='Stop'; Compress-Archive -Path '${releaseFolder}' -DestinationPath '${output}' -Force`,
    ], { cwd: stagingRoot, stdio: 'inherit' })
  : spawnSync('zip', ['-qr', output, releaseFolder], { cwd: stagingRoot, stdio: 'inherit' });

if (result.status !== 0) throw new Error('Could not create ManeFlow source ZIP.');
fs.rmSync(stagingRoot, { recursive: true, force: true });
console.log(output);
