const authPanel = document.querySelector('#auth-panel');
const workspace = document.querySelector('#intake-workspace');
const accountStatus = document.querySelector('#account-status');
const dropZone = document.querySelector('#drop-zone');
const folderInput = document.querySelector('#folder-input');
const fileInput = document.querySelector('#file-input');
const chooseFolder = document.querySelector('#choose-folder');
const chooseFiles = document.querySelector('#choose-files');
const selectionSummary = document.querySelector('#selection-summary');
const rightsConsent = document.querySelector('#rights-consent');
const startUploadButton = document.querySelector('#start-upload');
const clearSelectionButton = document.querySelector('#clear-selection');
const jobPanel = document.querySelector('#job-panel');
const jobTitle = document.querySelector('#job-title');
const jobStatus = document.querySelector('#job-status');
const progressFill = document.querySelector('#progress-fill');
const metricUploaded = document.querySelector('#metric-uploaded');
const metricProcessed = document.querySelector('#metric-processed');
const metricSucceeded = document.querySelector('#metric-succeeded');
const metricFailed = document.querySelector('#metric-failed');
const jobMessage = document.querySelector('#job-message');
const resumeUploadButton = document.querySelector('#resume-upload');
const refreshJobButton = document.querySelector('#refresh-job');
const cancelJobButton = document.querySelector('#cancel-job');
const newJobButton = document.querySelector('#new-job');
const resultsPanel = document.querySelector('#results-panel');
const resultCount = document.querySelector('#result-count');
const resultList = document.querySelector('#result-list');
const loadMoreResultsButton = document.querySelector('#load-more-results');
const toast = document.querySelector('#toast');

const SUPPORTED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);
const SUPPORTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const TERMINAL_STATUSES = new Set(['complete', 'partial', 'failed', 'cancelled']);
const LAST_JOB_KEY = 'maneflow:last-durable-scan-job';
const UPLOAD_CONCURRENCY = 4;
const UPLOAD_RETRIES = 2;
const RESULT_PAGE_SIZE = 50;

const state = {
  auth: null,
  entries: [],
  clientJobId: null,
  currentJob: null,
  uploadedClientItemIds: new Set(),
  pollTimer: null,
  resultsOffset: 0,
  uploadAbortController: null,
  uploadInProgress: false,
};

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[character]));
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 3500);
}

function formatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let amount = bytes / 1024;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  return `${amount >= 10 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function statusIsRetryable(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function api(path, options = {}, retryAttempt = 0) {
  const method = String(options.method || 'GET').toUpperCase();
  const headers = {
    ...(options.body ? { 'content-type': 'application/json' } : {}),
    ...(!['GET', 'HEAD', 'OPTIONS'].includes(method) && state.auth?.csrfToken
      ? { 'x-maneflow-csrf': state.auth.csrfToken }
      : {}),
    ...(options.headers || {}),
  };
  let response;
  try {
    response = await fetch(path, {
      credentials: 'include',
      ...options,
      method,
      headers,
    });
  } catch (error) {
    if (retryAttempt < UPLOAD_RETRIES && error?.name !== 'AbortError') {
      await sleep(700 * (2 ** retryAttempt));
      return api(path, options, retryAttempt + 1);
    }
    throw error;
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (retryAttempt < UPLOAD_RETRIES && statusIsRetryable(response.status)) {
      const retryAfterSeconds = Number(response.headers.get('retry-after'));
      const delay = Number.isFinite(retryAfterSeconds)
        ? Math.min(30_000, retryAfterSeconds * 1000)
        : 700 * (2 ** retryAttempt);
      await sleep(delay);
      return api(path, options, retryAttempt + 1);
    }
    const error = new Error(payload.message || `Request failed with status ${response.status}.`);
    error.status = response.status;
    error.code = payload.error || 'REQUEST_FAILED';
    error.retryable = payload.retryable === true;
    throw error;
  }
  return payload;
}

function extensionFor(file, relativePath = '') {
  const candidate = String(relativePath || file.name || '').split('.').pop().toLowerCase();
  return SUPPORTED_EXTENSIONS.has(candidate) ? candidate : '';
}

function normalizedMimeType(file, relativePath = '') {
  if (SUPPORTED_TYPES.has(file.type)) return file.type;
  const extension = extensionFor(file, relativePath);
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  return '';
}

function normalizeEntry(file, relativePath = '') {
  const pathValue = String(relativePath || file.webkitRelativePath || file.name || 'image')
    .replaceAll('\\', '/')
    .replace(/^\/+/, '')
    .slice(0, 600);
  const mimeType = normalizedMimeType(file, pathValue);
  if (!mimeType) return null;
  return {
    file,
    relativePath: pathValue || file.name,
    mimeType,
    size: Number(file.size || 0),
    lastModified: Number(file.lastModified || 0),
    clientItemId: null,
  };
}

function deduplicateEntries(entries) {
  const map = new Map();
  for (const entry of entries) {
    const key = `${entry.relativePath}\u0000${entry.size}\u0000${entry.lastModified}`;
    if (!map.has(key)) map.set(key, entry);
  }
  return [...map.values()].sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function sha256Text(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function buildManifest(entries) {
  const manifestLines = entries.map((entry) => [
    entry.relativePath,
    entry.size,
    entry.lastModified,
    entry.mimeType,
  ].join('|'));
  const clientJobId = `browser-folder-v1-${await sha256Text(manifestLines.join('\n'))}`;
  await Promise.all(entries.map(async (entry) => {
    entry.clientItemId = `image-v1-${await sha256Text([
      clientJobId,
      entry.relativePath,
      entry.size,
      entry.lastModified,
    ].join('|'))}`;
  }));
  return clientJobId;
}

function selectionRoot(entries) {
  const firstPath = entries[0]?.relativePath || '';
  return firstPath.includes('/') ? firstPath.split('/')[0] : 'Selected images';
}

async function applySelection(entries) {
  const normalized = deduplicateEntries(entries.filter(Boolean));
  if (!normalized.length) {
    showToast('No supported JPEG, PNG, or WebP images were found.');
    return;
  }
  if (normalized.length > 2000) {
    showToast(`This browser intake supports up to 2,000 images per job; ${normalized.length} were selected.`);
    return;
  }
  state.entries = normalized;
  state.clientJobId = await buildManifest(normalized);
  const totalBytes = normalized.reduce((sum, entry) => sum + entry.size, 0);
  selectionSummary.classList.remove('empty-selection');
  selectionSummary.innerHTML = `<strong>${escapeHtml(selectionRoot(normalized))} · ${normalized.length.toLocaleString()} images</strong><span>${escapeHtml(formatBytes(totalBytes))} total · manifest ready</span>`;
  clearSelectionButton.disabled = false;
  updateStartState();
  updateResumeState();
}

function clearSelection() {
  state.entries = [];
  state.clientJobId = null;
  folderInput.value = '';
  fileInput.value = '';
  rightsConsent.checked = false;
  selectionSummary.classList.add('empty-selection');
  selectionSummary.innerHTML = '<strong>No images selected</strong><span>Choose or drop a folder to build the upload manifest.</span>';
  clearSelectionButton.disabled = true;
  updateStartState();
  updateResumeState();
}

function updateStartState() {
  startUploadButton.disabled = state.uploadInProgress
    || !state.entries.length
    || !rightsConsent.checked
    || !state.auth?.authenticated;
}

function updateResumeState() {
  const resumable = state.currentJob
    && state.currentJob.status === 'accepting'
    && state.currentJob.uploadedCount < state.currentJob.totalItems
    && state.clientJobId === state.currentJob.clientJobId
    && state.entries.length === state.currentJob.totalItems;
  resumeUploadButton.hidden = !resumable;
}

function filesFromInput(fileList) {
  return [...(fileList || [])]
    .map((file) => normalizeEntry(file, file.webkitRelativePath || file.name))
    .filter(Boolean);
}

function readAllDirectoryEntries(reader) {
  return new Promise((resolve, reject) => {
    const collected = [];
    function readBatch() {
      reader.readEntries((batch) => {
        if (!batch.length) {
          resolve(collected);
          return;
        }
        collected.push(...batch);
        readBatch();
      }, reject);
    }
    readBatch();
  });
}

async function traverseEntry(entry, parentPath = '') {
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    return [normalizeEntry(file, `${parentPath}${entry.name}`)].filter(Boolean);
  }
  if (!entry.isDirectory) return [];
  const childEntries = await readAllDirectoryEntries(entry.createReader());
  const directoryPath = `${parentPath}${entry.name}/`;
  const nested = await Promise.all(childEntries.map((child) => traverseEntry(child, directoryPath)));
  return nested.flat();
}

async function entriesFromDrop(dataTransfer) {
  const items = [...(dataTransfer?.items || [])];
  const fileSystemEntries = items
    .map((item) => item.webkitGetAsEntry?.())
    .filter(Boolean);
  if (fileSystemEntries.length) {
    const nested = await Promise.all(fileSystemEntries.map((entry) => traverseEntry(entry)));
    return nested.flat();
  }
  return [...(dataTransfer?.files || [])]
    .map((file) => normalizeEntry(file, file.name))
    .filter(Boolean);
}

function fileToDataUrl(entry, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Upload cancelled.', 'AbortError'));
      return;
    }
    const reader = new FileReader();
    const abort = () => reader.abort();
    signal?.addEventListener('abort', abort, { once: true });
    reader.onload = () => {
      signal?.removeEventListener('abort', abort);
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      if (comma < 0) {
        reject(new Error('The browser could not encode this image.'));
        return;
      }
      resolve(`data:${entry.mimeType};base64,${result.slice(comma + 1)}`);
    };
    reader.onerror = () => {
      signal?.removeEventListener('abort', abort);
      reject(reader.error || new Error('The browser could not read this image.'));
    };
    reader.onabort = () => {
      signal?.removeEventListener('abort', abort);
      reject(new DOMException('Upload cancelled.', 'AbortError'));
    };
    reader.readAsDataURL(entry.file);
  });
}

function setUploadBusy(value) {
  state.uploadInProgress = value;
  startUploadButton.textContent = value ? 'Uploading…' : 'Upload and identify';
  clearSelectionButton.disabled = value || !state.entries.length;
  chooseFolder.disabled = value;
  chooseFiles.disabled = value;
  updateStartState();
}

async function fetchStoredItemIds(jobId) {
  const ids = new Set();
  let offset = 0;
  for (;;) {
    const payload = await api(`/api/scan-jobs/${encodeURIComponent(jobId)}/items?offset=${offset}&limit=200`);
    const items = payload.job?.items || [];
    for (const item of items) ids.add(item.clientItemId);
    const nextOffset = payload.job?.pagination?.nextOffset;
    if (nextOffset == null) break;
    offset = nextOffset;
  }
  return ids;
}

async function uploadEntry(jobId, entry, index, signal) {
  if (state.uploadedClientItemIds.has(entry.clientItemId)) return { reused: true };
  const dataUrl = await fileToDataUrl(entry, signal);
  const payload = await api(`/api/scan-jobs/${encodeURIComponent(jobId)}/items`, {
    method: 'POST',
    body: JSON.stringify({
      clientItemId: entry.clientItemId,
      index,
      fileName: entry.relativePath,
      dataUrl,
    }),
    signal,
  });
  state.uploadedClientItemIds.add(entry.clientItemId);
  return payload;
}

async function uploadEntries(jobId) {
  state.uploadAbortController?.abort();
  state.uploadAbortController = new AbortController();
  const signal = state.uploadAbortController.signal;
  state.uploadedClientItemIds = await fetchStoredItemIds(jobId);
  const pending = state.entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => !state.uploadedClientItemIds.has(entry.clientItemId));
  let cursor = 0;
  let firstError = null;
  const workers = Array.from({ length: Math.min(UPLOAD_CONCURRENCY, Math.max(1, pending.length)) }, async () => {
    while (cursor < pending.length && !signal.aborted) {
      const task = pending[cursor];
      cursor += 1;
      try {
        await uploadEntry(jobId, task.entry, task.index, signal);
        jobMessage.textContent = `Stored ${state.uploadedClientItemIds.size.toLocaleString()} of ${state.entries.length.toLocaleString()} images. Processing starts only after the complete manifest is present.`;
        metricUploaded.textContent = state.uploadedClientItemIds.size.toLocaleString();
        progressFill.style.width = `${Math.round((state.uploadedClientItemIds.size / state.entries.length) * 30)}%`;
      } catch (error) {
        firstError ||= error;
        if (error?.name === 'AbortError') return;
      }
    }
  });
  await Promise.all(workers);
  if (firstError) throw firstError;
  if (signal.aborted) throw new DOMException('Upload cancelled.', 'AbortError');
  const status = await api(`/api/scan-jobs/${encodeURIComponent(jobId)}`);
  if (status.job.uploadedCount !== status.job.totalItems) {
    const error = new Error(`Upload paused after ${status.job.uploadedCount} of ${status.job.totalItems} images. Reselect the same folder to resume.`);
    error.code = 'UPLOAD_INCOMPLETE';
    throw error;
  }
  await api(`/api/scan-jobs/${encodeURIComponent(jobId)}/start`, {
    method: 'POST',
    body: '{}',
  });
}

async function beginOrResumeUpload() {
  if (!state.entries.length || !rightsConsent.checked) return;
  setUploadBusy(true);
  jobPanel.hidden = false;
  resultsPanel.hidden = true;
  jobMessage.textContent = 'Creating an account-scoped resumable job…';
  try {
    const created = await api('/api/scan-jobs', {
      method: 'POST',
      body: JSON.stringify({
        clientJobId: state.clientJobId,
        totalItems: state.entries.length,
        autoStart: true,
      }),
    });
    state.currentJob = created.job;
    localStorage.setItem(LAST_JOB_KEY, state.currentJob.id);
    renderJob(state.currentJob);
    if (TERMINAL_STATUSES.has(state.currentJob.status)) {
      showToast('This exact image manifest was already processed. Showing its recorded draft results.');
      await refreshJob(true);
      return;
    }
    await uploadEntries(state.currentJob.id);
    clearSelection();
    showToast('Folder stored. Server-side identification is continuing.');
    await refreshJob(true);
    schedulePolling();
  } catch (error) {
    if (error?.name !== 'AbortError') {
      jobMessage.textContent = error.message;
      showToast(error.message);
      await refreshJob().catch(() => {});
    }
  } finally {
    setUploadBusy(false);
    updateResumeState();
  }
}

function statusLabel(status = '') {
  return ({
    accepting: 'Uploading',
    queued: 'Queued',
    processing: 'Identifying',
    complete: 'Complete',
    partial: 'Review needed',
    failed: 'Failed',
    cancelled: 'Cancelled',
  })[status] || status || 'Unknown';
}

function renderJob(job) {
  if (!job) return;
  state.currentJob = job;
  jobPanel.hidden = false;
  jobTitle.textContent = `${job.totalItems.toLocaleString()}-image intake`;
  jobStatus.textContent = statusLabel(job.status);
  jobStatus.dataset.status = job.status;
  progressFill.style.width = `${Math.max(0, Math.min(100, Number(job.progressPercent || 0)))}%`;
  metricUploaded.textContent = Number(job.uploadedCount || 0).toLocaleString();
  metricProcessed.textContent = Number(job.processedCount || 0).toLocaleString();
  metricSucceeded.textContent = Number(job.succeededCount || 0).toLocaleString();
  metricFailed.textContent = Number((job.failedCount || 0) + (job.cancelledCount || 0)).toLocaleString();
  cancelJobButton.hidden = TERMINAL_STATUSES.has(job.status);
  if (job.status === 'accepting') {
    jobMessage.textContent = `Stored ${job.uploadedCount.toLocaleString()} of ${job.totalItems.toLocaleString()} images. Reselect the same folder to resume without duplicating completed uploads.`;
  } else if (job.status === 'queued') {
    jobMessage.textContent = 'The full folder is stored. ManeFlow will start it when bounded worker capacity is available.';
  } else if (job.status === 'processing') {
    jobMessage.textContent = `ManeFlow processed ${job.processedCount.toLocaleString()} of ${job.totalItems.toLocaleString()} images. Temporary failures retry only within the strict server limit.`;
  } else if (job.status === 'complete') {
    jobMessage.textContent = 'Every image reached a terminal draft result. Confirm identities and exact variants before saving or listing.';
  } else if (job.status === 'partial') {
    jobMessage.textContent = `${job.succeededCount.toLocaleString()} images produced draft results; ${job.failedCount.toLocaleString()} require review or a better image.`;
  } else if (job.status === 'cancelled') {
    jobMessage.textContent = 'Remaining work was cancelled. Completed draft results were preserved.';
  } else if (job.status === 'failed') {
    jobMessage.textContent = job.lastError?.message || 'The job could not produce a draft result. No forced card identities were created.';
  }
  updateResumeState();
}

function itemHeadline(item) {
  const match = item.result?.matches?.[0];
  if (match) {
    return [match.year, match.brand, match.set, match.player, match.cardNumber ? `#${match.cardNumber}` : null, match.parallel]
      .filter(Boolean)
      .join(' ');
  }
  if (item.status === 'complete') return 'Draft unresolved — confirmation required';
  if (item.status === 'failed') return item.error?.message || 'Image could not be processed';
  return statusLabel(item.status);
}

function renderResultItems(items, append = false) {
  const html = items.map((item) => {
    const confidence = item.result?.scanConfidence?.scanConfidenceScore;
    const details = [
      `${item.attempts || 0} attempt${item.attempts === 1 ? '' : 's'}`,
      Number.isFinite(Number(confidence)) ? `${Math.round(Number(confidence))}% scan confidence` : null,
      item.result?.needsConfirmation === false ? 'ready for review' : 'human confirmation required',
    ].filter(Boolean).join(' · ');
    return `<article class="result-row">
      <div><h3>${escapeHtml(item.fileName)}</h3><p>${escapeHtml(itemHeadline(item))}</p><p>${escapeHtml(details)}</p></div>
      <div class="result-row-meta"><span class="item-status ${escapeHtml(item.status)}">${escapeHtml(statusLabel(item.status))}</span></div>
    </article>`;
  }).join('');
  if (append) resultList.insertAdjacentHTML('beforeend', html);
  else resultList.innerHTML = html || '<p>No stored item records are available yet.</p>';
}

async function loadResults({ reset = false } = {}) {
  if (!state.currentJob) return;
  if (reset) state.resultsOffset = 0;
  const payload = await api(`/api/scan-jobs/${encodeURIComponent(state.currentJob.id)}/items?offset=${state.resultsOffset}&limit=${RESULT_PAGE_SIZE}`);
  const job = payload.job;
  renderJob(job);
  resultsPanel.hidden = false;
  renderResultItems(job.items || [], state.resultsOffset > 0);
  state.resultsOffset += (job.items || []).length;
  resultCount.textContent = `${job.pagination?.total || 0} records`;
  loadMoreResultsButton.hidden = job.pagination?.nextOffset == null;
}

async function refreshJob(loadItems = false) {
  if (!state.currentJob?.id) return;
  const payload = await api(`/api/scan-jobs/${encodeURIComponent(state.currentJob.id)}`);
  renderJob(payload.job);
  if (loadItems || payload.job.processedCount > 0) await loadResults({ reset: true });
  if (TERMINAL_STATUSES.has(payload.job.status)) stopPolling();
}

function stopPolling() {
  clearTimeout(state.pollTimer);
  state.pollTimer = null;
}

function schedulePolling() {
  stopPolling();
  if (!state.currentJob || TERMINAL_STATUSES.has(state.currentJob.status)) return;
  state.pollTimer = setTimeout(async () => {
    try {
      await refreshJob(state.currentJob.processedCount > 0);
    } catch (error) {
      jobMessage.textContent = `Status refresh paused: ${error.message}`;
    } finally {
      schedulePolling();
    }
  }, 1800);
}

async function restoreLastJob() {
  const jobId = localStorage.getItem(LAST_JOB_KEY);
  if (!jobId) return;
  try {
    const payload = await api(`/api/scan-jobs/${encodeURIComponent(jobId)}`);
    renderJob(payload.job);
    if (payload.job.processedCount > 0) await loadResults({ reset: true });
    schedulePolling();
  } catch {
    localStorage.removeItem(LAST_JOB_KEY);
  }
}

async function initialize() {
  try {
    state.auth = await api('/api/auth/me');
  } catch {
    state.auth = { authenticated: false };
  }
  if (!state.auth.authenticated) {
    authPanel.hidden = false;
    workspace.hidden = true;
    return;
  }
  authPanel.hidden = true;
  workspace.hidden = false;
  accountStatus.textContent = state.auth.user?.email || state.auth.user?.name || 'Signed in';
  updateStartState();
  await restoreLastJob();
}

chooseFolder.addEventListener('click', () => folderInput.click());
chooseFiles.addEventListener('click', () => fileInput.click());
folderInput.addEventListener('change', () => applySelection(filesFromInput(folderInput.files)));
fileInput.addEventListener('change', () => applySelection(filesFromInput(fileInput.files)));
rightsConsent.addEventListener('change', updateStartState);
clearSelectionButton.addEventListener('click', clearSelection);
startUploadButton.addEventListener('click', beginOrResumeUpload);
resumeUploadButton.addEventListener('click', beginOrResumeUpload);
refreshJobButton.addEventListener('click', () => refreshJob(true).catch((error) => showToast(error.message)));
loadMoreResultsButton.addEventListener('click', () => loadResults().catch((error) => showToast(error.message)));
newJobButton.addEventListener('click', () => {
  stopPolling();
  state.currentJob = null;
  state.resultsOffset = 0;
  resultList.innerHTML = '';
  jobPanel.hidden = true;
  resultsPanel.hidden = true;
  localStorage.removeItem(LAST_JOB_KEY);
  clearSelection();
  dropZone.focus();
});
cancelJobButton.addEventListener('click', async () => {
  if (!state.currentJob) return;
  state.uploadAbortController?.abort();
  try {
    const payload = await api(`/api/scan-jobs/${encodeURIComponent(state.currentJob.id)}/cancel`, {
      method: 'POST',
      body: '{}',
    });
    renderJob(payload.job);
    await loadResults({ reset: true });
    showToast('Remaining work cancelled; completed drafts were preserved.');
  } catch (error) {
    showToast(error.message);
  }
});

dropZone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    folderInput.click();
  }
});
for (const eventName of ['dragenter', 'dragover']) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    event.stopPropagation();
    dropZone.classList.add('drag-active');
  });
}
for (const eventName of ['dragleave', 'drop']) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    event.stopPropagation();
    dropZone.classList.remove('drag-active');
  });
}
dropZone.addEventListener('drop', async (event) => {
  try {
    dropZone.setAttribute('aria-busy', 'true');
    const entries = await entriesFromDrop(event.dataTransfer);
    await applySelection(entries);
  } catch (error) {
    showToast(error.message || 'The dropped folder could not be read.');
  } finally {
    dropZone.removeAttribute('aria-busy');
  }
});

window.addEventListener('beforeunload', () => stopPolling());
initialize();
