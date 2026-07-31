const dropZone = document.querySelector('#drop-zone');
const cameraInput = document.querySelector('#camera-input');
const folderInput = document.querySelector('#folder-input');
const filesInput = document.querySelector('#files-input');
const chooseCamera = document.querySelector('#choose-camera');
const chooseFolder = document.querySelector('#choose-folder');
const chooseFiles = document.querySelector('#choose-files');
const clearSelectionButton = document.querySelector('#clear-selection');
const rightsConfirmed = document.querySelector('#rights-confirmed');
const trainingConsent = document.querySelector('#training-consent');
const startButton = document.querySelector('#start-upload');
const retryButton = document.querySelector('#retry-failed');
const cancelButton = document.querySelector('#cancel-job');
const selectionTitle = document.querySelector('#selection-title');
const selectedCount = document.querySelector('#selected-count');
const uploadedCount = document.querySelector('#uploaded-count');
const completeCount = document.querySelector('#complete-count');
const failedCount = document.querySelector('#failed-count');
const progressFill = document.querySelector('#progress-fill');
const jobState = document.querySelector('#job-state');
const fileList = document.querySelector('#file-list');
const message = document.querySelector('#message');

const STORAGE_KEY = 'maneflow.activeScanJobId';
const SUPPORTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const SUPPORTED_EXTENSIONS = /\.(?:jpe?g|png|webp)$/i;
const TERMINAL_JOB_STATUSES = new Set(['complete', 'partial', 'failed', 'canceled']);
const state = {
  auth: null,
  selected: [],
  localItems: new Map(),
  job: null,
  pollingTimer: null,
  uploading: false,
  nextSelectionId: 1,
};

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[character]));
}

function setMessage(text, tone = '') {
  message.innerHTML = text ? `<div class="notice-local ${escapeHtml(tone)}">${escapeHtml(text)}</div>` : '';
}

function bytes(value) {
  const size = Number(value || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 ** 2).toFixed(1)} MB`;
}

async function auth() {
  const response = await fetch('/api/auth/me', { credentials: 'include', cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.authenticated) {
    location.href = '/#/account';
    throw new Error('Sign in to use durable card intake.');
  }
  state.auth = data;
  return data;
}

async function api(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const headers = { ...(options.headers || {}) };
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && state.auth?.csrfToken) {
    headers['x-maneflow-csrf'] = state.auth.csrfToken;
  }
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(path, {
    credentials: 'include',
    cache: 'no-store',
    ...options,
    headers,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || `Request failed: ${response.status}`);
    error.status = response.status;
    error.code = data.error;
    throw error;
  }
  return data;
}

function isTransientNetworkError(error) {
  const status = Number(error?.status || 0);
  return !status || [408, 409, 425, 429].includes(status) || status >= 500;
}

async function withOneNetworkRetry(operation) {
  try {
    return await operation();
  } catch (error) {
    if (!isTransientNetworkError(error)) throw error;
    await new Promise((resolve) => setTimeout(resolve, 900));
    return operation();
  }
}

async function sha256(value) {
  const input = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const hash = await crypto.subtle.digest('SHA-256', input);
  return [...new Uint8Array(hash)].map((part) => part.toString(16).padStart(2, '0')).join('');
}

function supported(file) {
  return SUPPORTED_TYPES.has(String(file.type || '').toLowerCase()) || SUPPORTED_EXTENSIONS.test(file.name || '');
}

function jobIsActive() {
  return Boolean(state.job && !TERMINAL_JOB_STATUSES.has(state.job.status));
}

function prepareForNewSelection() {
  if (jobIsActive() || state.uploading) {
    setMessage('The current server-owned job must finish or be canceled before changing its image queue.', 'error');
    return false;
  }
  if (state.job && TERMINAL_JOB_STATUSES.has(state.job.status)) {
    state.selected = [];
    state.localItems.clear();
    state.job = null;
    state.nextSelectionId = 1;
    localStorage.removeItem(STORAGE_KEY);
  }
  return true;
}

async function appendSelection(entries) {
  if (!prepareForNewSelection()) return;
  const accepted = [];
  let skipped = 0;
  for (const entry of entries) {
    const file = entry.file || entry;
    if (!(file instanceof File) || !supported(file)) {
      skipped += 1;
      continue;
    }
    const relativePath = String(entry.relativePath || file.webkitRelativePath || file.name).replace(/^\/+/, '');
    const selectionId = state.nextSelectionId;
    state.nextSelectionId += 1;
    const queueKey = `${selectionId}:${relativePath}`;
    accepted.push({ file, relativePath, selectionId, queueKey });
  }

  for (const entry of accepted) {
    state.selected.push(entry);
    state.localItems.set(entry.queueKey, {
      status: 'selected',
      fileName: entry.relativePath,
      size: entry.file.size,
      queueKey: entry.queueKey,
    });
  }

  if (skipped) {
    setMessage(`${skipped} unsupported or non-image file${skipped === 1 ? ' was' : 's were'} skipped.`, '');
  } else if (accepted.length) {
    setMessage(`${accepted.length} image${accepted.length === 1 ? '' : 's'} added to the same queue.`, 'success');
  }
  render();
}

function clearSelection() {
  if (jobIsActive() || state.uploading) {
    setMessage('Cancel or finish the active job before clearing the queue.', 'error');
    return;
  }
  state.selected = [];
  state.localItems.clear();
  state.job = null;
  state.nextSelectionId = 1;
  cameraInput.value = '';
  filesInput.value = '';
  folderInput.value = '';
  localStorage.removeItem(STORAGE_KEY);
  setMessage('Queue cleared.');
  render();
}

function readDirectoryEntries(reader) {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

async function walkEntry(entry, prefix = '') {
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    return [{ file, relativePath: `${prefix}${file.name}` }];
  }
  if (!entry.isDirectory) return [];
  const reader = entry.createReader();
  const children = [];
  while (true) {
    const page = await readDirectoryEntries(reader);
    if (!page.length) break;
    children.push(...page);
  }
  const nested = await Promise.all(children.map((child) => walkEntry(child, `${prefix}${entry.name}/`)));
  return nested.flat();
}

async function entriesFromDrop(event) {
  const items = [...(event.dataTransfer?.items || [])];
  const fileSystemEntries = items.map((item) => item.webkitGetAsEntry?.()).filter(Boolean);
  if (fileSystemEntries.length) {
    const walked = await Promise.all(fileSystemEntries.map((entry) => walkEntry(entry)));
    return walked.flat();
  }
  return [...(event.dataTransfer?.files || [])].map((file) => ({ file, relativePath: file.name }));
}

function canvasBlob(canvas, type = 'image/jpeg', quality = 0.86) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Image optimization failed.'))), type, quality);
  });
}

function blobDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('Image reading failed.'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(blob);
  });
}

async function optimizeImage(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const maximum = 1800;
    const scale = Math.min(1, maximum / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await canvasBlob(canvas);
    return { dataUrl: await blobDataUrl(blob), size: blob.size, mimeType: blob.type };
  } finally {
    bitmap.close();
  }
}

async function jobKey() {
  const signature = state.selected.map(({ file, relativePath, queueKey }) => `${queueKey}:${relativePath}:${file.size}:${file.lastModified}`).join('|');
  return `intake-${(await sha256(signature)).slice(0, 48)}`;
}

async function itemKey(entry) {
  return `image-${(await sha256(`${entry.queueKey}:${entry.relativePath}:${entry.file.size}:${entry.file.lastModified}`)).slice(0, 48)}`;
}

function resultSummary(result = {}) {
  const match = result.matches?.[0];
  if (!match) return result.message || 'No exact catalog identity resolved.';
  const identity = [match.year, match.brand, match.set, match.player, match.cardNumber ? `#${match.cardNumber}` : '', match.parallel]
    .filter(Boolean).join(' ');
  const market = match.market;
  const value = market?.estimate != null ? ` · $${Number(market.estimate).toFixed(2)}` : '';
  return `${identity || match.name || 'Draft match'}${value}`;
}

function renderFiles(items) {
  const visible = items.slice(0, 200);
  const rows = visible.map((item) => {
    const status = item.status || 'selected';
    const detail = item.error?.message || (item.result ? resultSummary(item.result) : `${bytes(item.size)} · ${item.attempts || 0} attempt(s)`);
    return `<article class="file-row"><div><strong title="${escapeHtml(item.fileName)}">${escapeHtml(item.fileName)}</strong><small title="${escapeHtml(detail)}">${escapeHtml(detail)}</small>${item.result ? `<div class="result-card">${escapeHtml(resultSummary(item.result))}</div>` : ''}</div><span class="status-chip ${escapeHtml(status)}">${escapeHtml(status.replaceAll('_', ' '))}</span></article>`;
  }).join('');
  const remainder = items.length > visible.length ? `<div class="notice-local">Showing the first ${visible.length} of ${items.length} images. Job totals include every image.</div>` : '';
  fileList.innerHTML = rows || '<div class="notice-local">Take a photo, choose files or a folder, or drag images here.</div>';
  if (remainder) fileList.insertAdjacentHTML('beforeend', remainder);
}

function render() {
  const selected = state.selected.length;
  const progress = state.job?.progress || {};
  const localValues = [...state.localItems.values()];
  const uploaded = state.job ? Number(progress.total || 0) : localValues.filter((item) => !['selected', 'optimizing', 'uploading', 'upload_failed'].includes(item.status)).length;
  const complete = Number(progress.complete || 0);
  const failed = Number(progress.failed || 0);
  selectedCount.textContent = String(selected || progress.total || 0);
  uploadedCount.textContent = String(uploaded);
  completeCount.textContent = String(complete);
  failedCount.textContent = String(failed);
  progressFill.style.width = `${Number(progress.percent || 0)}%`;
  selectionTitle.textContent = selected ? `${selected} image${selected === 1 ? '' : 's'} ready` : state.job ? `Job ${state.job.id.slice(0, 8)}` : 'No images selected';
  const status = state.job?.status || (state.uploading ? 'uploading' : 'not started');
  jobState.textContent = status.replaceAll('_', ' ');
  jobState.className = `status-chip ${status}`;
  const items = state.job?.items?.length ? state.job.items : localValues;
  renderFiles(items);

  const selectionLocked = state.uploading || jobIsActive();
  chooseCamera.disabled = selectionLocked;
  chooseFiles.disabled = selectionLocked;
  chooseFolder.disabled = selectionLocked;
  clearSelectionButton.disabled = selectionLocked || (!selected && !state.job);
  startButton.disabled = state.uploading || !selected || !rightsConfirmed.checked || jobIsActive();
  retryButton.disabled = !state.job || failed < 1 || state.uploading;
  cancelButton.disabled = !state.job || TERMINAL_JOB_STATUSES.has(state.job.status);
}

async function createJob() {
  const idempotencyKey = await jobKey();
  const data = await api('/api/scan-jobs', {
    method: 'POST',
    headers: { 'idempotency-key': idempotencyKey },
    body: JSON.stringify({
      idempotencyKey,
      expectedItems: state.selected.length,
      processingAuthorization: rightsConfirmed.checked,
      trainingConsent: trainingConsent.checked,
    }),
  });
  state.job = data.job;
  localStorage.setItem(STORAGE_KEY, state.job.id);
  return state.job;
}

async function uploadOne(entry) {
  const local = state.localItems.get(entry.queueKey);
  local.status = 'optimizing';
  render();
  const optimized = await optimizeImage(entry.file);
  local.status = 'uploading';
  local.size = optimized.size;
  render();
  const key = await itemKey(entry);
  const response = await withOneNetworkRetry(() => api(`/api/scan-jobs/${encodeURIComponent(state.job.id)}/items`, {
    method: 'POST',
    body: JSON.stringify({
      itemKey: key,
      fileName: entry.relativePath,
      mimeType: optimized.mimeType,
      size: optimized.size,
      dataUrl: optimized.dataUrl,
    }),
  }));
  local.status = response.item.status;
  local.serverItemId = response.item.id;
  render();
}

async function uploadBounded(entries, concurrency = 2) {
  let cursor = 0;
  const failures = [];
  const workers = Array.from({ length: Math.min(concurrency, entries.length) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= entries.length) return;
      const entry = entries[index];
      try {
        await uploadOne(entry);
      } catch (error) {
        const local = state.localItems.get(entry.queueKey);
        local.status = 'upload_failed';
        local.error = { message: error.message };
        failures.push({ entry, error });
        render();
      }
    }
  });
  await Promise.all(workers);
  return failures;
}

async function refreshJob({ allItems = false } = {}) {
  if (!state.job?.id) return null;
  const first = await api(`/api/scan-jobs/${encodeURIComponent(state.job.id)}?offset=0&limit=250`);
  const job = first.job;
  if (allItems && job.pagination?.nextOffset != null) {
    const items = [...job.items];
    let offset = job.pagination.nextOffset;
    while (offset != null) {
      const page = await api(`/api/scan-jobs/${encodeURIComponent(job.id)}?offset=${offset}&limit=250`);
      items.push(...page.job.items);
      offset = page.job.pagination?.nextOffset;
    }
    job.items = items;
  }
  state.job = job;
  render();
  return job;
}

function stopPolling() {
  clearTimeout(state.pollingTimer);
  state.pollingTimer = null;
}

async function pollJob() {
  stopPolling();
  try {
    const job = await refreshJob();
    if (job && !TERMINAL_JOB_STATUSES.has(job.status)) {
      state.pollingTimer = setTimeout(pollJob, 1_500);
      return;
    }
    if (job) {
      await refreshJob({ allItems: true });
      localStorage.removeItem(STORAGE_KEY);
      setMessage(job.status === 'complete' ? 'Card intake completed.' : 'Card intake finished with items requiring review.', job.status === 'complete' ? 'success' : '');
    }
  } catch (error) {
    setMessage(`Progress check failed: ${error.message}. The server-owned job continues running.`, 'error');
    state.pollingTimer = setTimeout(pollJob, 4_000);
  }
}

async function startUpload() {
  if (!rightsConfirmed.checked) return setMessage('Confirm that you own the images or have permission to process them.', 'error');
  state.uploading = true;
  render();
  setMessage('Creating a durable server-owned scan job…');
  try {
    await createJob();
    const failures = await uploadBounded(state.selected, 2);
    if (failures.length === state.selected.length) throw new Error('No images reached the server. The job remains resumable and no processing was started.');
    if (failures.length) {
      setMessage(`${failures.length} image upload${failures.length === 1 ? '' : 's'} failed before processing. Re-select the same images to reuse uploaded items safely.`, 'error');
      return;
    }
    await api(`/api/scan-jobs/${encodeURIComponent(state.job.id)}/commit`, { method: 'POST', body: '{}' });
    setMessage('Uploads committed. ManeFlow is processing the queue in bounded server-side batches.');
    await refreshJob();
    pollJob();
  } catch (error) {
    setMessage(error.message, 'error');
  } finally {
    state.uploading = false;
    render();
  }
}

async function retryFailed() {
  retryButton.disabled = true;
  try {
    const data = await api(`/api/scan-jobs/${encodeURIComponent(state.job.id)}/retry-failed`, { method: 'POST', body: '{}' });
    state.job = data.job;
    setMessage('Failed items were requeued once under the server retry policy.');
    pollJob();
  } catch (error) {
    setMessage(error.message, 'error');
  } finally {
    render();
  }
}

async function cancelJob() {
  cancelButton.disabled = true;
  try {
    const data = await api(`/api/scan-jobs/${encodeURIComponent(state.job.id)}/cancel`, { method: 'POST', body: '{}' });
    state.job = data.job;
    stopPolling();
    localStorage.removeItem(STORAGE_KEY);
    setMessage('The job was canceled. An item already in inference may finish safely before shutdown.', '');
  } catch (error) {
    setMessage(error.message, 'error');
  } finally {
    render();
  }
}

chooseCamera.addEventListener('click', () => cameraInput.click());
chooseFolder.addEventListener('click', () => folderInput.click());
chooseFiles.addEventListener('click', () => filesInput.click());
clearSelectionButton.addEventListener('click', clearSelection);

cameraInput.addEventListener('change', async () => {
  await appendSelection([...cameraInput.files].map((file) => ({ file, relativePath: file.name })));
  cameraInput.value = '';
});
folderInput.addEventListener('change', async () => {
  await appendSelection([...folderInput.files].map((file) => ({ file, relativePath: file.webkitRelativePath || file.name })));
  folderInput.value = '';
});
filesInput.addEventListener('change', async () => {
  await appendSelection([...filesInput.files].map((file) => ({ file, relativePath: file.name })));
  filesInput.value = '';
});
rightsConfirmed.addEventListener('change', render);
trainingConsent.addEventListener('change', render);
startButton.addEventListener('click', startUpload);
retryButton.addEventListener('click', retryFailed);
cancelButton.addEventListener('click', cancelJob);

dropZone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    filesInput.click();
  }
});
for (const eventName of ['dragenter', 'dragover']) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add('dragging');
  });
}
for (const eventName of ['dragleave', 'drop']) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove('dragging');
  });
}
dropZone.addEventListener('drop', async (event) => {
  try {
    setMessage('Reading dropped images and folders…');
    await appendSelection(await entriesFromDrop(event));
  } catch (error) {
    setMessage(`Drop reading failed: ${error.message}`, 'error');
  }
});

(async function initialize() {
  try {
    await auth();
    const activeJobId = localStorage.getItem(STORAGE_KEY);
    if (activeJobId) {
      state.job = { id: activeJobId };
      const job = await refreshJob();
      if (!TERMINAL_JOB_STATUSES.has(job.status)) {
        setMessage('Resumed server-owned job progress after refresh.');
        pollJob();
      } else {
        await refreshJob({ allItems: true });
        localStorage.removeItem(STORAGE_KEY);
      }
    }
  } catch (error) {
    setMessage(error.message, 'error');
  }
  render();
}());
