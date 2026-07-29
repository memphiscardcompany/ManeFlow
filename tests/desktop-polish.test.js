import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

test('desktop shell exposes startup, secure settings, diagnostics, and service recovery controls', () => {
  const main = read('apps/desktop-electron/src/main.js');
  const preload = read('apps/desktop-electron/src/preload.js');
  assert.match(main, /prepareRuntimePorts/);
  assert.match(main, /createDiagnosticsBundle/);
  assert.match(main, /safeStorage\.encryptString/);
  assert.match(main, /scheduleRecovery/);
  assert.match(preload, /createDiagnostics/);
  assert.match(preload, /onStartupProgress/);
});

test('desktop installer launches Electron and disables public beta account exposure', () => {
  const installer = read('scripts/windows-online-install.ps1');
  const main = read('apps/desktop-electron/src/main.js');
  assert.match(installer, /node_modules\\electron\\dist\\electron\.exe/);
  assert.match(installer, /Microsoft\\Windows\\CurrentVersion\\Uninstall\\ManeFlow/);
  assert.match(installer, /Migrating existing ManeFlow beta data/);
  assert.match(main, /MANEFLOW_ALLOW_PUBLIC_SIGNUPS: 'false'/);
  assert.match(main, /MANEFLOW_EXPOSE_DEV_TOKENS: 'false'/);
});
