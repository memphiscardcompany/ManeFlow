import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);

async function read(relativePath) {
  return fs.readFile(path.join(root, relativePath), 'utf8');
}

test('durable intake exposes one surface for camera files folders and drag-drop', async () => {
  const html = await read('public/bulk-upload.html');
  const script = await read('public/unified-intake.js');

  assert.equal((html.match(/id="drop-zone"/g) || []).length, 1);
  assert.match(html, /id="camera-input"[^>]*accept="image\/\*"[^>]*capture="environment"/);
  assert.match(html, /id="files-input"[^>]*multiple/);
  assert.match(html, /id="folder-input"[^>]*multiple[^>]*webkitdirectory/);
  assert.match(html, /id="choose-camera"/);
  assert.match(html, /id="choose-files"/);
  assert.match(html, /id="choose-folder"/);
  assert.match(html, /src="\/unified-intake\.js"/);
  assert.match(script, /dropZone\.addEventListener\('drop'/);
});

test('separate selection actions append repeated views to one queue', async () => {
  const script = await read('public/unified-intake.js');

  assert.match(script, /async function appendSelection\(entries\)/);
  assert.match(script, /state\.selected\.push\(entry\)/);
  assert.match(script, /const queueKey = `\$\{selectionId\}:\$\{relativePath\}`/);
  assert.match(script, /sha256\(`\$\{entry\.queueKey\}:\$\{entry\.relativePath\}:\$\{entry\.file\.size\}:\$\{entry\.file\.lastModified\}`\)/);
  assert.match(script, /cameraInput\.value = ''/);
  assert.match(script, /filesInput\.value = ''/);
  assert.match(script, /folderInput\.value = ''/);
  assert.doesNotMatch(script, /const unique = new Map\(\)/);
});

test('large queues remain bounded internally without an artificial UI count cap', async () => {
  const html = await read('public/bulk-upload.html');
  const script = await read('public/unified-intake.js');

  assert.match(html, /does not impose an arbitrary image-count cap/i);
  assert.match(script, /uploadBounded\(state\.selected, 2\)/);
  assert.match(script, /withOneNetworkRetry/);
  assert.match(script, /limit=250/);
  assert.doesNotMatch(script, /MAX_(?:FILES|IMAGES|UPLOAD_COUNT)/);
  assert.doesNotMatch(script, /selected\.slice\(/);
});

test('unified intake preserves durable security and recovery boundaries', async () => {
  const script = await read('public/unified-intake.js');

  assert.match(script, /\/api\/auth\/me/);
  assert.match(script, /x-maneflow-csrf/);
  assert.match(script, /credentials: 'include'/);
  assert.match(script, /idempotency-key/);
  assert.match(script, /processingAuthorization: rightsConfirmed\.checked/);
  assert.match(script, /localStorage\.setItem\(STORAGE_KEY, state\.job\.id\)/);
  assert.match(script, /Resumed server-owned job progress after refresh/);
  assert.match(script, /\/retry-failed/);
  assert.match(script, /\/cancel/);
});

test('customer-facing intake language is provider-neutral and professional', async () => {
  const html = await read('public/bulk-upload.html');
  const publicText = html.replace(/<style>[\s\S]*?<\/style>/, '');

  assert.doesNotMatch(publicText, /\bPSA\b/i);
  assert.doesNotMatch(publicText, /\bowner\b/i);
  assert.doesNotMatch(publicText, /\biPhone\b/i);
  assert.match(publicText, /Results are drafts until reviewed/);
  assert.match(publicText, /does not authenticate cards, assign grades, or guarantee market value/i);
});
