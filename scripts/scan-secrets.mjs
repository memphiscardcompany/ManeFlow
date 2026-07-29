import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ignoredNames = new Set([
  '.git', 'node_modules', '.runtime', 'backups', 'coverage', 'dist', 'build',
  '.pytest_cache', '__pycache__', '.venv', '.venv-beta', '.venv-vision', 'imported-contributions',
]);
const textExtensions = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.json', '.yaml', '.yml', '.md', '.txt',
  '.html', '.css', '.py', '.ps1', '.cmd', '.sh', '.example', '.toml', '.spec',
]);
const findings = [];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignoredNames.has(entry.name) || entry.name.startsWith('.env') && entry.name !== '.env.example') continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute);
    else inspect(absolute);
  }
}

function inspect(file) {
  if (!textExtensions.has(path.extname(file).toLowerCase()) && path.basename(file) !== 'Dockerfile') return;
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
  const rules = [
    ['OpenAI key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g],
    ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
    ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/g],
    ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g],
  ];
  for (const [label, pattern] of rules) {
    for (const match of text.matchAll(pattern)) {
      const before = text.slice(0, match.index);
      const line = before.split(/\r?\n/).length;
      findings.push(`${path.relative(root, file)}:${line} ${label}`);
    }
  }
}

walk(root);
if (findings.length) {
  console.error('Credential-shaped values detected:');
  findings.forEach((item) => console.error(`- ${item}`));
  process.exit(1);
}
console.log('Credential-pattern scan passed.');
