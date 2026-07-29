import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try { process.loadEnvFile?.(path.join(root, '.env')); } catch {}
const config = loadConfig();
const backupDir = path.join(root, 'backups');
await fs.mkdir(backupDir, { recursive: true, mode: 0o700 });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const destination = path.join(backupDir, `maneflow-state-${stamp}.json`);
try {
  const raw = await fs.readFile(config.runtimeFile);
  JSON.parse(raw.toString('utf8'));
  await fs.writeFile(destination, raw, { mode: 0o600, flag: 'wx' });
  console.log(destination);
} catch (error) {
  if (error.code === 'ENOENT') throw new Error(`No runtime state exists at ${config.runtimeFile}`);
  throw error;
}
