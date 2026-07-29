import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const artifactDir = path.resolve(root, '..');
const artifacts = [
  `ManeFlow-v${pkg.version}-Full-Windows-Beta.zip`,
  `ManeFlow-v${pkg.version}-Unified-Source.zip`,
].map((name) => path.join(artifactDir, name));

const lines = artifacts.map((file) => {
  if (!fs.existsSync(file)) throw new Error(`Release artifact missing: ${file}`);
  const digest = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  return `${digest}  ${path.basename(file)}`;
});
const output = path.join(artifactDir, `ManeFlow-v${pkg.version}-SHA256SUMS.txt`);
fs.writeFileSync(output, `${lines.join('\n')}\n`);
console.log(output);
