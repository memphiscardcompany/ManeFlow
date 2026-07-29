import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const release = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const zipPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(root, '..', `ManeFlow-v${release.version}-Unified-Source.zip`);
if (!fs.existsSync(zipPath)) throw new Error(`Release ZIP not found: ${zipPath}`);

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'maneflow-release-verify-'));
try {
  const expand = process.platform === 'win32'
    ? spawnSync('powershell', ['-NoProfile', '-Command', `$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${temp}' -Force`], { encoding: 'utf8' })
    : spawnSync('unzip', ['-q', zipPath, '-d', temp], { encoding: 'utf8' });
  if (expand.status !== 0) throw new Error(expand.stderr || expand.stdout || 'Could not extract release ZIP');

  const forbidden = [];
  const files = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const lower = entry.name.toLowerCase();
      if (['node_modules', '.runtime', '.runtime-build', 'backups', 'coverage', 'screenshots', '.pytest_cache', '__pycache__', '.venv', '.venv-windows', '.venv-beta', 'dist', 'build', 'imported-contributions'].includes(lower)) forbidden.push(absolute);
      if (lower === '.env' || lower.endsWith('.pem') || lower.endsWith('.key') || lower.endsWith('.sqlite3') || lower.endsWith('.pyc')) forbidden.push(absolute);
      if (entry.isDirectory()) walk(absolute);
      else files.push(absolute);
    }
  }
  walk(temp);
  if (forbidden.length) throw new Error(`Forbidden release payload detected:\n${forbidden.join('\n')}`);

  const text = files.filter((file) => /\.(js|mjs|cjs|ts|tsx|json|md|yaml|yml|html|css|txt|example|py|ps1|cmd|sh)$/.test(file));
  for (const file of text) {
    const body = fs.readFileSync(file, 'utf8');
    if (/\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/.test(body)) throw new Error(`Secret-shaped value detected in ${file}`);
    if (/\btcg_[a-f0-9]{32}\b/i.test(body)) throw new Error(`JustTCG key-shaped value detected in ${file}`);
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(body)) throw new Error(`Private key detected in ${file}`);
  }

  const roots = fs.readdirSync(temp, { withFileTypes: true }).filter((item) => item.isDirectory());
  if (roots.length !== 1) throw new Error('Release ZIP must contain exactly one top-level folder.');
  const rootPackage = path.join(temp, roots[0].name, 'package.json');
  if (!fs.existsSync(rootPackage)) throw new Error('Root package.json missing from release ZIP.');
  const pkg = JSON.parse(fs.readFileSync(rootPackage, 'utf8'));
  if (pkg.version !== release.version) throw new Error(`Unexpected release version: ${pkg.version}`);

  const digest = createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex');
  console.log(`Release ZIP verified: ${path.basename(zipPath)}`);
  console.log(`SHA-256 ${digest}`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
