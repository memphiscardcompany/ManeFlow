import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const port = 4399;
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'maneflow-smoke-'));
const child = spawn(process.execPath, ['server.js'], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', PUBLIC_BASE_URL: `http://127.0.0.1:${port}`, MANEFLOW_STATE_FILE: path.join(directory, 'state.json') },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stderr = '';
child.stderr.on('data', (chunk) => { stderr += chunk; });
try {
  let health;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) { health = await response.json(); break; }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!health?.ok) throw new Error(`Server did not become healthy. ${stderr}`);
  const page = await fetch(`http://127.0.0.1:${port}/`);
  const html = await page.text();
  if (!page.ok || !html.includes('ManeFlow')) throw new Error('PWA shell failed smoke test');
  const search = await fetch(`http://127.0.0.1:${port}/api/cards?q=Ohtani`);
  const payload = await search.json();
  if (!search.ok || !payload.cards?.length) throw new Error('Card search failed smoke test');
  console.log(`Smoke test passed: ${health.name} ${health.version}; ${payload.cards.length} search result(s).`);
} finally {
  child.kill('SIGTERM');
  await fs.rm(directory, { recursive: true, force: true });
}
