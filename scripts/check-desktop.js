import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repo = path.resolve('.');
const root = path.resolve('apps/desktop-electron');
for (const file of ['src/main.js', 'src/preload.js', 'src/config.js']) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${file} failed validation\n${result.stderr}`);
}
const release = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (!pkg.scripts?.check || !pkg.scripts?.['package:windows'] || !pkg.scripts?.['package:windows-store']) throw new Error('Desktop Windows and Microsoft Store packaging scripts are missing.');
if (pkg.productName !== 'ManeFlow') throw new Error('Desktop productName must be ManeFlow.');
if (pkg.version !== release.version) throw new Error(`Desktop version ${pkg.version} does not match root release ${release.version}.`);
const resources = JSON.stringify(pkg.build?.extraResources || []);
if (!resources.includes('.runtime-build/windows-python')) throw new Error('Desktop package must include the embedded Windows Python runtime.');
if (!resources.includes('../../vision-worker')) throw new Error('Desktop package must include the local vision-worker source.');
if (pkg.author !== 'Memphis Card Company') throw new Error('Desktop publisher metadata is missing.');
if (pkg.build?.appId !== 'com.memphiscardcompany.maneflow.desktop') throw new Error('Desktop app id is missing.');
if (!fs.existsSync(path.join(root, 'assets', 'icon.png')) || !fs.existsSync(path.join(root, 'assets', 'icon.ico'))) throw new Error('Desktop icon assets are missing.');
const main = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
for (const required of ['contextIsolation: true', 'nodeIntegration: false', 'sandbox: true', 'setWindowOpenHandler', 'safeStorage']) {
  if (!main.includes(required)) throw new Error(`Desktop hardening check missing ${required}`);
}
for (const required of ['startVisionWorker', 'startCore', 'folder:select-ricoh']) {
  if (!main.includes(required)) throw new Error(`Desktop integration check missing ${required}`);
}
if (pkg.build?.appx?.applicationId !== 'ManeFlow') throw new Error('Microsoft Store AppX identity metadata is missing.');
console.log(`Desktop Electron ${pkg.version} configuration validated.`);
