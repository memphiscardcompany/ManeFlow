import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const releaseFolder = `ManeFlow-v${pkg.version}-Windows-Beta`;
const stagingRoot = path.resolve(root, '..', '.windows-beta-staging');
const staged = path.join(stagingRoot, releaseFolder);
const output = path.resolve(root, '..', `ManeFlow-v${pkg.version}-Full-Windows-Beta.zip`);

for (const target of [output, stagingRoot]) {
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
}

const excludedNames = new Set([
  '.git', '.runtime', '.runtime-build', 'node_modules', '.env', '.DS_Store',
  '.pytest_cache', '__pycache__', '.venv', '.venv-windows', '.venv-beta',
  'dist', 'build', 'coverage', 'backups', 'screenshots', 'imported-contributions',
  '.release-staging', '.windows-beta-staging',
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

const manifestRows = [];
function collect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(absolute);
    else manifestRows.push({
      file: path.relative(staged, absolute).replaceAll(path.sep, '/'),
      bytes: fs.statSync(absolute).size,
    });
  }
}
collect(staged);
manifestRows.sort((a, b) => a.file.localeCompare(b.file, 'en'));
fs.writeFileSync(
  path.join(staged, 'PACKAGE-MANIFEST.txt'),
  [
    `ManeFlow ${pkg.version} Windows Beta`,
    '',
    ...manifestRows.map((row) => `${String(row.bytes).padStart(12)}  ${row.file}`),
    '',
  ].join('\n'),
);

const result = process.platform === 'win32'
  ? spawnSync('powershell', [
      '-NoProfile', '-Command',
      `$ErrorActionPreference='Stop'; Compress-Archive -Path '${releaseFolder}' -DestinationPath '${output}' -Force`,
    ], { cwd: stagingRoot, stdio: 'inherit' })
  : spawnSync('zip', ['-qr', output, releaseFolder], { cwd: stagingRoot, stdio: 'inherit' });

if (result.status !== 0) throw new Error('Could not create ManeFlow Windows beta ZIP.');
fs.rmSync(stagingRoot, { recursive: true, force: true });
console.log(output);
