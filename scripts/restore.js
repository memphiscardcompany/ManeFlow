import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.js';

const sourceArg = process.argv[2];
if (!sourceArg || !process.argv.includes('--yes')) {
  console.error('Usage: node scripts/restore.js <backup.json> --yes');
  process.exit(2);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try { process.loadEnvFile?.(path.join(root, '.env')); } catch {}
const config = loadConfig();
const source = path.resolve(process.cwd(), sourceArg);
const raw = await fs.readFile(source);
const parsed = JSON.parse(raw.toString('utf8'));
if (!parsed || typeof parsed !== 'object' || !parsed.schemaVersion) throw new Error('Backup is not a valid ManeFlow state file.');
await fs.mkdir(path.dirname(config.runtimeFile), { recursive: true });
try {
  const current = await fs.readFile(config.runtimeFile);
  await fs.writeFile(`${config.runtimeFile}.before-restore-${Date.now()}`, current, { mode: 0o600 });
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const temp = `${config.runtimeFile}.restore.tmp`;
await fs.writeFile(temp, raw, { mode: 0o600 });
await fs.rename(temp, config.runtimeFile);
console.log(`Restored ${source} to ${config.runtimeFile}`);
