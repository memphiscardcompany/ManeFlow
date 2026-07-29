import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const ACCEPTED_MIME_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

const TERMINAL_JOB_STATUSES = new Set(['complete', 'partial', 'failed', 'cancelled']);
const ACTIVE_ITEM_STATUSES = new Set(['queued', 'retry_wait', 'processing']);

function nowIso() {
  return new Date().toISOString();
}

function integer(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(parsed)));
}

function safeFileName(value = 'card-image') {
  const cleaned = String(value || 'card-image')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/]+/g, '-')
    .replace(/[^a-zA-Z0-9._ -]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
  return cleaned || 'card-image';
}

function imageSignatureMatches(mimeType, bytes) {
  if (mimeType === 'image/jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mimeType === 'image/png') {
    return bytes.length >= 8
      && bytes[0] === 0x89
      && bytes[1] === 0x50
      && bytes[2] === 0x4e
      && bytes[3] === 0x47
      && bytes[4] === 0x0d
      && bytes[5] === 0x0a
      && bytes[6] === 0x1a
      && bytes[7] === 0x0a;
  }
  if (mimeType === 'image/webp') {
    return bytes.length >= 12
      && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
      && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  }
  return false;
}

function parseImageDataUrl(value, maximumBytes) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([a-zA-Z0-9+/=\r\n]+)$/.exec(String(value || ''));
  if (!match) {
    throw new ScanJobError('Upload must be a base64 JPEG, PNG, or WebP data URL.', {
      code: 'SCAN_IMAGE_FORMAT_UNSUPPORTED',
      status: 415,
    });
  }
  const mimeType = match[1].toLowerCase();
  if (!ACCEPTED_MIME_TYPES.has(mimeType)) {
    throw new ScanJobError('Image MIME type is not supported.', {
      code: 'SCAN_IMAGE_FORMAT_UNSUPPORTED',
      status: 415,
    });
  }
  const normalizedBase64 = match[2].replace(/[\r\n]/g, '');
  if (!/^[a-zA-Z0-9+/]*={0,2}$/.test(normalizedBase64)) {
    throw new ScanJobError('Image data is not valid base64.', {
      code: 'SCAN_IMAGE_BASE64_INVALID',
      status: 400,
    });
  }
  const bytes = Buffer.from(normalizedBase64, 'base64');
  if (!bytes.length) {
    throw new ScanJobError('Image upload is empty.', {
      code: 'SCAN_IMAGE_EMPTY',
      status: 400,
    });
  }
  if (bytes.length > maximumBytes) {
    throw new ScanJobError(`Image exceeds the ${maximumBytes}-byte upload limit.`, {
      code: 'SCAN_IMAGE_TOO_LARGE',
      status: 413,
    });
  }
  if (!imageSignatureMatches(mimeType, bytes)) {
    throw new ScanJobError('Image file signature does not match its MIME type.', {
      code: 'SCAN_IMAGE_SIGNATURE_MISMATCH',
      status: 415,
    });
  }
  return {
    bytes,
    mimeType,
    extension: ACCEPTED_MIME_TYPES.get(mimeType),
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
}

function errorSummary(error) {
  return {
    code: String(error?.code || 'SCAN_ITEM_PROCESSING_FAILED').slice(0, 120),
    message: String(error?.message || error || 'Scan processing failed.').slice(0, 800),
    status: Number(error?.status || 0) || null,
    retryable: Boolean(error?.retryable),
  };
}

function isRetryableError(error) {
  if (error?.retryable === true) return true;
  const status = Number(error?.status || 0);
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function compactScanResult(payload = {}) {
  const matches = Array.isArray(payload.matches) ? payload.matches.slice(0, 10) : [];
  const recognitionCards = Array.isArray(payload?.recognition?.cards)
    ? payload.recognition.cards.slice(0, 100)
    : [];
  return {
    exact: Boolean(payload.exact),
    needsConfirmation: payload.needsConfirmation !== false,
    mode: payload.mode || null,
    query: payload.query || '',
    message: payload.message || '',
    matches,
    recognition: payload.recognition
      ? {
          summary: payload.recognition.summary || null,
          primary: payload.recognition.primary || null,
          cards: recognitionCards,
        }
      : null,
    scanConfidence: payload.scanConfidence || null,
    gradedCert: payload.gradedCert || null,
    marketContext: payload.marketContext || null,
    workerError: payload.workerError || null,
    vectorSearchError: payload.vectorSearchError || null,
    visionWorkerUsed: Boolean(payload.visionWorkerUsed),
    imageProcessedRemotely: Boolean(payload.imageProcessedRemotely),
    receivedAt: nowIso(),
  };
}

function publicItem(item) {
  return {
    id: item.id,
    clientItemId: item.clientItemId,
    index: item.index,
    fileName: item.fileName,
    mimeType: item.mimeType,
    byteLength: item.byteLength,
    sha256: item.sha256,
    status: item.status,
    attempts: item.attempts,
    result: item.result || null,
    error: item.error || null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    completedAt: item.completedAt || null,
  };
}

function publicJob(job, { includeItems = false, offset = 0, limit = 50 } = {}) {
  const safeOffset = integer(offset, 0, 0, 1_000_000);
  const safeLimit = integer(limit, 50, 1, 200);
  const payload = {
    id: job.id,
    clientJobId: job.clientJobId,
    status: job.status,
    totalItems: job.totalItems,
    uploadedCount: job.uploadedCount,
    processedCount: job.processedCount,
    succeededCount: job.succeededCount,
    failedCount: job.failedCount,
    cancelledCount: job.cancelledCount,
    progressPercent: job.totalItems > 0
      ? Math.min(100, Math.round((job.processedCount / job.totalItems) * 100))
      : 0,
    autoStart: job.autoStart,
    cancelRequested: Boolean(job.cancelRequested),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt || null,
    completedAt: job.completedAt || null,
    lastError: job.lastError || null,
  };
  if (includeItems) {
    payload.items = job.items.slice(safeOffset, safeOffset + safeLimit).map(publicItem);
    payload.pagination = {
      offset: safeOffset,
      limit: safeLimit,
      total: job.items.length,
      nextOffset: safeOffset + safeLimit < job.items.length ? safeOffset + safeLimit : null,
    };
  }
  return payload;
}

async function removeFileQuietly(filePath) {
  if (!filePath) return;
  try {
    await fs.rm(filePath, { force: true });
  } catch {
    // Cleanup failures are recorded by the job result but never cause duplicate processing.
  }
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class ScanJobError extends Error {
  constructor(message, { code = 'SCAN_JOB_ERROR', status = 400, retryable = false, cause } = {}) {
    super(message, { cause });
    this.name = 'ScanJobError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

export class ScanJobQueue {
  constructor({
    store,
    uploadDirectory,
    processor,
    maximumItems = 2_000,
    maximumImageBytes = 30_000_000,
    concurrentJobs = 1,
    concurrentItems = 2,
    maximumRetries = 2,
    retryBaseDelayMs = 750,
    retainUploads = false,
  } = {}) {
    if (!store?.state || typeof store.persist !== 'function') {
      throw new TypeError('ScanJobQueue requires a persistent ManeFlow store.');
    }
    if (typeof processor !== 'function') {
      throw new TypeError('ScanJobQueue requires an asynchronous scan processor.');
    }
    this.store = store;
    this.uploadDirectory = path.resolve(String(uploadDirectory || '.runtime/scan-jobs'));
    this.processor = processor;
    this.maximumItems = integer(maximumItems, 2_000, 1, 10_000);
    this.maximumImageBytes = integer(maximumImageBytes, 30_000_000, 1_024, 100_000_000);
    this.concurrentJobs = integer(concurrentJobs, 1, 1, 8);
    this.concurrentItems = integer(concurrentItems, 2, 1, 16);
    this.maximumRetries = integer(maximumRetries, 2, 0, 5);
    this.retryBaseDelayMs = integer(retryBaseDelayMs, 750, 100, 30_000);
    this.retainUploads = retainUploads === true;
    this.pendingJobs = [];
    this.activeJobs = new Set();
    this.itemControllers = new Map();
    this.started = false;
    this.closed = false;
    this.store.state.scanJobs ||= [];
  }

  async init() {
    await fs.mkdir(this.uploadDirectory, { recursive: true, mode: 0o700 });
    await fs.chmod(this.uploadDirectory, 0o700).catch(() => {});
    let changed = false;
    for (const job of this.store.state.scanJobs) {
      job.items ||= [];
      if (job.status === 'processing') {
        job.status = 'queued';
        job.lastError = {
          code: 'SCAN_JOB_RECOVERED_AFTER_RESTART',
          message: 'The server restarted while this job was processing. Unfinished items were safely requeued.',
          status: null,
          retryable: true,
        };
        changed = true;
      }
      for (const item of job.items) {
        if (item.status === 'processing') {
          item.status = 'queued';
          item.error = {
            code: 'SCAN_ITEM_RECOVERED_AFTER_RESTART',
            message: 'The server restarted before this item completed. It was safely requeued.',
            status: null,
            retryable: true,
          };
          changed = true;
        }
      }
      if (changed) job.updatedAt = nowIso();
      this.recalculate(job);
    }
    if (changed) await this.store.persist();
    return this;
  }

  start() {
    if (this.closed) throw new ScanJobError('Scan job queue is closed.', { code: 'SCAN_QUEUE_CLOSED', status: 503 });
    this.started = true;
    for (const job of this.store.state.scanJobs) {
      if (job.status === 'queued') this.enqueue(job.id);
    }
    this.pump();
  }

  async close() {
    this.closed = true;
    this.started = false;
    for (const controller of this.itemControllers.values()) controller.abort();
    this.itemControllers.clear();
    await this.store.persist();
  }

  findOwnedJob(userId, jobId) {
    const job = this.store.state.scanJobs.find((entry) => entry.id === jobId && entry.userId === userId);
    if (!job) {
      throw new ScanJobError('Scan job not found.', { code: 'SCAN_JOB_NOT_FOUND', status: 404 });
    }
    return job;
  }

  listJobs(userId, { limit = 50 } = {}) {
    const safeLimit = integer(limit, 50, 1, 100);
    return this.store.state.scanJobs
      .filter((job) => job.userId === userId)
      .slice(0, safeLimit)
      .map((job) => publicJob(job));
  }

  getJob(userId, jobId, options = {}) {
    return publicJob(this.findOwnedJob(userId, jobId), options);
  }

  async createJob(userId, input = {}) {
    const normalizedUserId = String(userId || '').trim();
    if (!normalizedUserId) throw new ScanJobError('Authenticated user is required.', { code: 'SCAN_JOB_USER_REQUIRED', status: 401 });
    const clientJobId = String(input.clientJobId || '').trim().slice(0, 240) || crypto.randomUUID();
    const totalItems = integer(input.totalItems, 0, 1, this.maximumItems);
    if (!totalItems) {
      throw new ScanJobError('A positive totalItems value is required.', { code: 'SCAN_JOB_TOTAL_REQUIRED', status: 400 });
    }
    const existing = this.store.state.scanJobs.find(
      (job) => job.userId === normalizedUserId && job.clientJobId === clientJobId,
    );
    if (existing) return { job: publicJob(existing), reused: true };

    const timestamp = nowIso();
    const job = {
      id: `scan_job_${crypto.randomUUID()}`,
      userId: normalizedUserId,
      clientJobId,
      status: 'accepting',
      totalItems,
      uploadedCount: 0,
      processedCount: 0,
      succeededCount: 0,
      failedCount: 0,
      cancelledCount: 0,
      autoStart: input.autoStart !== false,
      cancelRequested: false,
      items: [],
      createdAt: timestamp,
      updatedAt: timestamp,
      startedAt: null,
      completedAt: null,
      lastError: null,
    };
    this.store.state.scanJobs.unshift(job);
    const ownedJobs = this.store.state.scanJobs.filter((entry) => entry.userId === normalizedUserId);
    for (const stale of ownedJobs.slice(100)) {
      if (TERMINAL_JOB_STATUSES.has(stale.status)) {
        this.store.state.scanJobs = this.store.state.scanJobs.filter((entry) => entry.id !== stale.id);
      }
    }
    await this.store.persist();
    return { job: publicJob(job), reused: false };
  }

  async addItem(userId, jobId, input = {}) {
    const job = this.findOwnedJob(userId, jobId);
    if (!['accepting', 'queued'].includes(job.status)) {
      throw new ScanJobError('This scan job is no longer accepting uploads.', {
        code: 'SCAN_JOB_UPLOADS_CLOSED',
        status: 409,
      });
    }
    const clientItemId = String(input.clientItemId || '').trim().slice(0, 300);
    if (!clientItemId) {
      throw new ScanJobError('clientItemId is required for resumable uploads.', {
        code: 'SCAN_ITEM_ID_REQUIRED',
        status: 400,
      });
    }
    const decoded = parseImageDataUrl(input.dataUrl, this.maximumImageBytes);
    const existing = job.items.find((item) => item.clientItemId === clientItemId);
    if (existing) {
      if (existing.sha256 !== decoded.sha256) {
        throw new ScanJobError('clientItemId already exists with different image content.', {
          code: 'SCAN_ITEM_ID_CONFLICT',
          status: 409,
        });
      }
      return { item: publicItem(existing), reused: true, job: publicJob(job) };
    }
    if (job.items.length >= job.totalItems || job.items.length >= this.maximumItems) {
      throw new ScanJobError('This scan job already contains its declared number of images.', {
        code: 'SCAN_JOB_ITEM_LIMIT_REACHED',
        status: 409,
      });
    }

    const itemId = `scan_item_${crypto.randomUUID()}`;
    const jobDirectory = path.join(this.uploadDirectory, job.id);
    await fs.mkdir(jobDirectory, { recursive: true, mode: 0o700 });
    const sourcePath = path.join(jobDirectory, `${itemId}.${decoded.extension}`);
    const temporaryPath = `${sourcePath}.tmp`;
    await fs.writeFile(temporaryPath, decoded.bytes, { mode: 0o600, flag: 'wx' });
    await fs.rename(temporaryPath, sourcePath);

    const timestamp = nowIso();
    const item = {
      id: itemId,
      clientItemId,
      index: integer(input.index, job.items.length, 0, this.maximumItems - 1),
      fileName: safeFileName(input.fileName || `${itemId}.${decoded.extension}`),
      mimeType: decoded.mimeType,
      byteLength: decoded.bytes.length,
      sha256: decoded.sha256,
      sourcePath,
      status: 'queued',
      attempts: 0,
      result: null,
      error: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null,
    };
    job.items.push(item);
    job.items.sort((left, right) => left.index - right.index || left.createdAt.localeCompare(right.createdAt));
    job.updatedAt = timestamp;
    this.recalculate(job);
    if (job.autoStart && job.uploadedCount >= job.totalItems) {
      job.status = 'queued';
      job.startedAt ||= timestamp;
    }
    await this.store.persist();
    if (job.status === 'queued') this.enqueue(job.id);
    return { item: publicItem(item), reused: false, job: publicJob(job) };
  }

  async startJob(userId, jobId) {
    const job = this.findOwnedJob(userId, jobId);
    if (TERMINAL_JOB_STATUSES.has(job.status)) return publicJob(job);
    if (!job.items.length) {
      throw new ScanJobError('Upload at least one image before starting the job.', {
        code: 'SCAN_JOB_EMPTY',
        status: 409,
      });
    }
    job.status = 'queued';
    job.startedAt ||= nowIso();
    job.updatedAt = nowIso();
    await this.store.persist();
    this.enqueue(job.id);
    return publicJob(job);
  }

  async cancelJob(userId, jobId) {
    const job = this.findOwnedJob(userId, jobId);
    if (TERMINAL_JOB_STATUSES.has(job.status)) return publicJob(job);
    job.cancelRequested = true;
    for (const item of job.items) {
      if (ACTIVE_ITEM_STATUSES.has(item.status) && item.status !== 'processing') {
        item.status = 'cancelled';
        item.updatedAt = nowIso();
        item.completedAt = item.updatedAt;
      }
    }
    for (const [key, controller] of this.itemControllers.entries()) {
      if (key.startsWith(`${job.id}:`)) controller.abort();
    }
    this.recalculate(job);
    if (!job.items.some((item) => item.status === 'processing')) {
      job.status = 'cancelled';
      job.completedAt = nowIso();
    }
    job.updatedAt = nowIso();
    await this.store.persist();
    return publicJob(job);
  }

  enqueue(jobId) {
    if (this.closed || !this.started || this.pendingJobs.includes(jobId) || this.activeJobs.has(jobId)) return;
    this.pendingJobs.push(jobId);
    queueMicrotask(() => this.pump());
  }

  pump() {
    if (this.closed || !this.started) return;
    while (this.activeJobs.size < this.concurrentJobs && this.pendingJobs.length) {
      const jobId = this.pendingJobs.shift();
      if (this.activeJobs.has(jobId)) continue;
      const job = this.store.state.scanJobs.find((entry) => entry.id === jobId);
      if (!job || job.status !== 'queued') continue;
      this.activeJobs.add(jobId);
      this.processJob(job)
        .catch((error) => this.failJob(job, error))
        .finally(() => {
          this.activeJobs.delete(jobId);
          this.pump();
        });
    }
  }

  async processJob(job) {
    if (job.cancelRequested) {
      job.status = 'cancelled';
      job.completedAt = nowIso();
      job.updatedAt = job.completedAt;
      await this.store.persist();
      return;
    }
    job.status = 'processing';
    job.startedAt ||= nowIso();
    job.updatedAt = nowIso();
    await this.store.persist();

    const candidates = job.items.filter((item) => ['queued', 'retry_wait'].includes(item.status));
    let cursor = 0;
    const workers = Array.from(
      { length: Math.min(this.concurrentItems, Math.max(1, candidates.length)) },
      async () => {
        while (cursor < candidates.length && !job.cancelRequested) {
          const item = candidates[cursor];
          cursor += 1;
          await this.processItem(job, item);
        }
      },
    );
    await Promise.all(workers);

    this.recalculate(job);
    if (job.cancelRequested) {
      for (const item of job.items) {
        if (ACTIVE_ITEM_STATUSES.has(item.status)) {
          item.status = 'cancelled';
          item.updatedAt = nowIso();
          item.completedAt = item.updatedAt;
        }
      }
      this.recalculate(job);
      job.status = 'cancelled';
    } else if (job.processedCount < job.uploadedCount) {
      job.status = 'queued';
    } else if (job.failedCount === 0) {
      job.status = 'complete';
    } else if (job.succeededCount > 0) {
      job.status = 'partial';
    } else {
      job.status = 'failed';
    }
    if (TERMINAL_JOB_STATUSES.has(job.status)) job.completedAt = nowIso();
    job.updatedAt = nowIso();
    await this.store.persist();
    if (job.status === 'queued') this.enqueue(job.id);
  }

  async processItem(job, item) {
    const controller = new AbortController();
    const controllerKey = `${job.id}:${item.id}`;
    this.itemControllers.set(controllerKey, controller);
    try {
      for (;;) {
        if (job.cancelRequested) {
          item.status = 'cancelled';
          item.updatedAt = nowIso();
          item.completedAt = item.updatedAt;
          return;
        }
        item.status = 'processing';
        item.attempts += 1;
        item.error = null;
        item.updatedAt = nowIso();
        await this.store.persist();
        try {
          const sourceBytes = await fs.readFile(item.sourcePath);
          if (crypto.createHash('sha256').update(sourceBytes).digest('hex') !== item.sha256) {
            throw new ScanJobError('Stored upload failed its integrity check.', {
              code: 'SCAN_ITEM_INTEGRITY_FAILURE',
              status: 422,
              retryable: false,
            });
          }
          const dataUrl = `data:${item.mimeType};base64,${sourceBytes.toString('base64')}`;
          const result = await this.processor({
            job: publicJob(job),
            item: publicItem(item),
            dataUrl,
            fileName: item.fileName,
            signal: controller.signal,
          });
          item.result = compactScanResult(result);
          item.status = 'complete';
          item.updatedAt = nowIso();
          item.completedAt = item.updatedAt;
          item.error = null;
          if (typeof this.store.recordScan === 'function') {
            await this.store.recordScan(job.userId, {
              mode: item.result.mode || 'durable_scan_job',
              query: item.result.query,
              matchIds: item.result.matches.map((match) => match.id).filter(Boolean),
              imageProcessedRemotely: item.result.imageProcessedRemotely,
              frontBack: false,
              warnings: [
                ...(item.result.scanConfidence?.warnings || []),
                ...(item.result.workerError ? [item.result.workerError] : []),
              ],
            });
          }
          if (!this.retainUploads) {
            await removeFileQuietly(item.sourcePath);
            item.sourcePath = null;
          }
          this.recalculate(job);
          await this.store.persist();
          return;
        } catch (error) {
          const summary = errorSummary(error);
          item.error = summary;
          const canRetry = !job.cancelRequested
            && isRetryableError(error)
            && item.attempts <= this.maximumRetries;
          if (!canRetry) {
            item.status = job.cancelRequested ? 'cancelled' : 'failed';
            item.updatedAt = nowIso();
            item.completedAt = item.updatedAt;
            if (!this.retainUploads) {
              await removeFileQuietly(item.sourcePath);
              item.sourcePath = null;
            }
            this.recalculate(job);
            job.lastError = summary;
            await this.store.persist();
            return;
          }
          item.status = 'retry_wait';
          item.updatedAt = nowIso();
          this.recalculate(job);
          await this.store.persist();
          const delay = this.retryBaseDelayMs * (2 ** Math.max(0, item.attempts - 1));
          await sleep(delay);
        }
      }
    } finally {
      this.itemControllers.delete(controllerKey);
    }
  }

  recalculate(job) {
    job.uploadedCount = job.items.length;
    job.succeededCount = job.items.filter((item) => item.status === 'complete').length;
    job.failedCount = job.items.filter((item) => item.status === 'failed').length;
    job.cancelledCount = job.items.filter((item) => item.status === 'cancelled').length;
    job.processedCount = job.succeededCount + job.failedCount + job.cancelledCount;
  }

  async failJob(job, error) {
    job.lastError = errorSummary(error);
    job.status = 'failed';
    job.completedAt = nowIso();
    job.updatedAt = job.completedAt;
    for (const item of job.items) {
      if (ACTIVE_ITEM_STATUSES.has(item.status)) {
        item.status = 'failed';
        item.error ||= job.lastError;
        item.updatedAt = job.completedAt;
        item.completedAt = job.completedAt;
        if (!this.retainUploads) {
          await removeFileQuietly(item.sourcePath);
          item.sourcePath = null;
        }
      }
    }
    this.recalculate(job);
    await this.store.persist();
  }
}

export const scanJobInternals = {
  compactScanResult,
  isRetryableError,
  parseImageDataUrl,
  publicItem,
  publicJob,
};
