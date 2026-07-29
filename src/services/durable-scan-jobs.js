import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const JOB_STATUSES = new Set(['accepting', 'queued', 'processing', 'complete', 'partial', 'failed', 'canceled']);
const ITEM_STATUSES = new Set(['uploaded', 'queued', 'processing', 'retry_wait', 'complete', 'failed', 'canceled']);
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function integer(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(parsed)));
}

function text(value, maximum = 500) {
  return String(value ?? '').trim().slice(0, maximum);
}

function safeKey(value) {
  const normalized = text(value, 300);
  if (!normalized || !/^[a-zA-Z0-9._:-]+$/.test(normalized)) {
    throw new TypeError('itemKey must contain only letters, numbers, period, underscore, colon, or dash.');
  }
  return normalized;
}

function dataUrlPayload(value) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([a-zA-Z0-9+/=\r\n]+)$/.exec(String(value || ''));
  if (!match) throw new TypeError('A base64 JPEG, PNG, or WebP data URL is required.');
  const mimeType = match[1].toLowerCase();
  if (!ALLOWED_MIME_TYPES.has(mimeType)) throw new TypeError('Unsupported image type.');
  const buffer = Buffer.from(match[2].replace(/[\r\n]/g, ''), 'base64');
  if (!buffer.length) throw new TypeError('The uploaded image is empty.');
  return { mimeType, buffer, dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}` };
}

function transientError(error) {
  const status = Number(error?.status || error?.response?.status || 0);
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || error || '').toLowerCase();
  if ([408, 409, 425, 429].includes(status) || status >= 500) return true;
  if (/TIMEOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ETIMEDOUT/.test(code)) return true;
  return /temporar|timeout|timed out|rate limit|connection reset|service unavailable|vision worker unavailable/.test(message);
}

function publicError(error) {
  return {
    code: text(error?.code || 'SCAN_PROCESSING_FAILED', 100),
    message: text(error?.message || error || 'Scan processing failed.', 600),
    transient: transientError(error),
  };
}

function progress(job) {
  const counts = {
    total: job.items.length,
    uploaded: 0,
    queued: 0,
    processing: 0,
    retryWait: 0,
    complete: 0,
    failed: 0,
    canceled: 0,
  };
  for (const item of job.items) {
    if (item.status === 'retry_wait') counts.retryWait += 1;
    else if (Object.hasOwn(counts, item.status)) counts[item.status] += 1;
  }
  counts.terminal = counts.complete + counts.failed + counts.canceled;
  counts.percent = counts.total ? Math.round((counts.terminal / counts.total) * 100) : 0;
  return counts;
}

function publicItem(item) {
  return {
    id: item.id,
    itemKey: item.itemKey,
    fileName: item.fileName,
    mimeType: item.mimeType,
    size: item.size,
    sha256: item.sha256,
    status: item.status,
    attempts: item.attempts,
    maxAttempts: item.maxAttempts,
    result: item.result || null,
    error: item.error || null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    completedAt: item.completedAt || null,
  };
}

function publicJob(job, { includeItems = true, offset = 0, limit = 100 } = {}) {
  const safeOffset = integer(offset, 0, 0, Math.max(0, job.items.length));
  const safeLimit = integer(limit, 100, 1, 250);
  return {
    id: job.id,
    ownerUserId: job.ownerUserId,
    idempotencyKey: job.idempotencyKey,
    status: job.status,
    expectedItems: job.expectedItems,
    trainingConsent: job.trainingConsent === true,
    progress: progress(job),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    committedAt: job.committedAt || null,
    completedAt: job.completedAt || null,
    canceledAt: job.canceledAt || null,
    items: includeItems ? job.items.slice(safeOffset, safeOffset + safeLimit).map(publicItem) : undefined,
    pagination: includeItems ? {
      offset: safeOffset,
      limit: safeLimit,
      total: job.items.length,
      nextOffset: safeOffset + safeLimit < job.items.length ? safeOffset + safeLimit : null,
    } : undefined,
  };
}

async function delay(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class DurableScanJobSpool {
  constructor({
    rootDir,
    processor,
    maxItems = 1_000,
    maxItemBytes = 20_000_000,
    concurrency = 2,
    maxAttempts = 2,
    retentionHours = 24,
    retryBackoffMs = 1_000,
  } = {}) {
    if (!rootDir) throw new TypeError('DurableScanJobSpool requires rootDir.');
    if (typeof processor !== 'function') throw new TypeError('DurableScanJobSpool requires processor.');
    this.rootDir = path.resolve(rootDir);
    this.processor = processor;
    this.maxItems = integer(maxItems, 1_000, 1, 10_000);
    this.maxItemBytes = integer(maxItemBytes, 20_000_000, 1_024, 100_000_000);
    this.concurrency = integer(concurrency, 2, 1, 16);
    this.maxAttempts = integer(maxAttempts, 2, 1, 5);
    this.retentionMs = integer(retentionHours, 24, 1, 720) * 60 * 60_000;
    this.retryBackoffMs = integer(retryBackoffMs, 1_000, 100, 60_000);
    this.jobs = new Map();
    this.activeJobs = new Set();
    this.initialized = false;
  }

  jobDir(jobId) {
    return path.join(this.rootDir, jobId);
  }

  jobFile(jobId) {
    return path.join(this.jobDir(jobId), 'job.json');
  }

  payloadFile(jobId, itemId) {
    return path.join(this.jobDir(jobId), 'payloads', `${itemId}.json`);
  }

  async atomicJson(filePath, value) {
    await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
    await fs.rename(temporary, filePath);
  }

  async persist(job) {
    job.updatedAt = new Date().toISOString();
    await this.atomicJson(this.jobFile(job.id), job);
  }

  async initialize() {
    if (this.initialized) return this;
    await fs.mkdir(this.rootDir, { recursive: true, mode: 0o700 });
    const entries = await fs.readdir(this.rootDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const raw = await fs.readFile(this.jobFile(entry.name), 'utf8');
        const job = JSON.parse(raw);
        if (!job?.id || !JOB_STATUSES.has(job.status) || !Array.isArray(job.items)) continue;
        for (const item of job.items) {
          if (!ITEM_STATUSES.has(item.status)) item.status = 'failed';
          if (['processing', 'retry_wait'].includes(item.status)) item.status = 'queued';
        }
        if (job.status === 'processing') job.status = 'queued';
        this.jobs.set(job.id, job);
      } catch {
        // Ignore incomplete directories; no guessed recovery is attempted.
      }
    }
    this.initialized = true;
    await this.pruneExpired();
    for (const job of this.jobs.values()) {
      if (job.status === 'queued') this.schedule(job.id);
    }
    return this;
  }

  assertInitialized() {
    if (!this.initialized) throw new Error('Durable scan job spool is not initialized.');
  }

  findOwned(ownerUserId, jobId) {
    const job = this.jobs.get(String(jobId));
    if (!job || job.ownerUserId !== String(ownerUserId)) return null;
    return job;
  }

  async createJob({ ownerUserId, idempotencyKey, expectedItems = 0, trainingConsent = false } = {}) {
    this.assertInitialized();
    const owner = text(ownerUserId, 200);
    if (!owner) throw new TypeError('ownerUserId is required.');
    const key = safeKey(idempotencyKey || crypto.randomUUID());
    const existing = [...this.jobs.values()].find((job) => job.ownerUserId === owner && job.idempotencyKey === key && job.status !== 'canceled');
    if (existing) return { job: publicJob(existing), reused: true };
    const expected = integer(expectedItems, 0, 0, this.maxItems);
    const now = new Date().toISOString();
    const job = {
      schemaVersion: 1,
      id: crypto.randomUUID(),
      ownerUserId: owner,
      idempotencyKey: key,
      status: 'accepting',
      expectedItems: expected,
      trainingConsent: trainingConsent === true,
      items: [],
      createdAt: now,
      updatedAt: now,
      committedAt: null,
      completedAt: null,
      canceledAt: null,
    };
    this.jobs.set(job.id, job);
    await this.persist(job);
    return { job: publicJob(job), reused: false };
  }

  async addItem(ownerUserId, jobId, input = {}) {
    this.assertInitialized();
    const job = this.findOwned(ownerUserId, jobId);
    if (!job) return null;
    if (job.status !== 'accepting') throw new Error('This scan job is no longer accepting uploads.');
    if (job.items.length >= this.maxItems) throw new Error(`A scan job can contain at most ${this.maxItems} images.`);
    const itemKey = safeKey(input.itemKey);
    const duplicate = job.items.find((item) => item.itemKey === itemKey);
    if (duplicate) return { item: publicItem(duplicate), reused: true };
    const payload = dataUrlPayload(input.dataUrl);
    if (payload.buffer.length > this.maxItemBytes) throw new Error(`Image exceeds the ${this.maxItemBytes}-byte limit.`);
    if (input.size && Number(input.size) !== payload.buffer.length) throw new Error('Image byte count does not match the declared size.');
    const now = new Date().toISOString();
    const item = {
      id: crypto.randomUUID(),
      itemKey,
      fileName: text(input.fileName || 'card-image', 300),
      mimeType: payload.mimeType,
      size: payload.buffer.length,
      sha256: crypto.createHash('sha256').update(payload.buffer).digest('hex'),
      status: 'uploaded',
      attempts: 0,
      maxAttempts: this.maxAttempts,
      result: null,
      error: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };
    await this.atomicJson(this.payloadFile(job.id, item.id), {
      dataUrl: payload.dataUrl,
      fileName: item.fileName,
      mimeType: item.mimeType,
      sha256: item.sha256,
    });
    job.items.push(item);
    await this.persist(job);
    return { item: publicItem(item), reused: false };
  }

  async commit(ownerUserId, jobId) {
    this.assertInitialized();
    const job = this.findOwned(ownerUserId, jobId);
    if (!job) return null;
    if (['queued', 'processing', 'complete', 'partial', 'failed'].includes(job.status)) return publicJob(job);
    if (job.status === 'canceled') throw new Error('Canceled scan jobs cannot be committed.');
    if (!job.items.length) throw new Error('Upload at least one image before committing the scan job.');
    for (const item of job.items) if (item.status === 'uploaded') item.status = 'queued';
    job.status = 'queued';
    job.committedAt = job.committedAt || new Date().toISOString();
    await this.persist(job);
    this.schedule(job.id);
    return publicJob(job);
  }

  schedule(jobId) {
    if (this.activeJobs.has(jobId)) return;
    setImmediate(() => this.processJob(jobId).catch(() => {}));
  }

  async loadPayload(job, item) {
    const payload = JSON.parse(await fs.readFile(this.payloadFile(job.id, item.id), 'utf8'));
    if (!payload?.dataUrl || payload.sha256 !== item.sha256) throw new Error('Durable scan payload is missing or failed integrity validation.');
    return payload;
  }

  async processItem(job, item) {
    while (item.attempts < item.maxAttempts && !['complete', 'canceled'].includes(item.status)) {
      item.attempts += 1;
      item.status = 'processing';
      item.error = null;
      item.updatedAt = new Date().toISOString();
      await this.persist(job);
      try {
        const payload = await this.loadPayload(job, item);
        item.result = await this.processor({
          ownerUserId: job.ownerUserId,
          jobId: job.id,
          itemId: item.id,
          itemKey: item.itemKey,
          fileName: item.fileName,
          mimeType: item.mimeType,
          dataUrl: payload.dataUrl,
          trainingConsent: job.trainingConsent,
        });
        item.status = 'complete';
        item.completedAt = new Date().toISOString();
        item.updatedAt = item.completedAt;
        await fs.rm(this.payloadFile(job.id, item.id), { force: true });
        await this.persist(job);
        return;
      } catch (error) {
        item.error = publicError(error);
        item.updatedAt = new Date().toISOString();
        const retry = item.error.transient && item.attempts < item.maxAttempts;
        item.status = retry ? 'retry_wait' : 'failed';
        await this.persist(job);
        if (!retry) return;
        await delay(this.retryBackoffMs * item.attempts);
        item.status = 'queued';
        await this.persist(job);
      }
    }
  }

  async processJob(jobId) {
    this.assertInitialized();
    if (this.activeJobs.has(jobId)) return;
    const job = this.jobs.get(jobId);
    if (!job || !['queued', 'processing'].includes(job.status)) return;
    this.activeJobs.add(jobId);
    try {
      job.status = 'processing';
      await this.persist(job);
      let cursor = 0;
      const workers = Array.from({ length: Math.min(this.concurrency, job.items.length) }, async () => {
        while (true) {
          const index = cursor;
          cursor += 1;
          if (index >= job.items.length) return;
          const item = job.items[index];
          if (item.status === 'uploaded') item.status = 'queued';
          if (item.status !== 'queued') continue;
          if (job.status === 'canceled') {
            item.status = 'canceled';
            item.updatedAt = new Date().toISOString();
            continue;
          }
          await this.processItem(job, item);
        }
      });
      await Promise.all(workers);
      const counts = progress(job);
      if (job.status !== 'canceled') {
        job.status = counts.complete === counts.total ? 'complete' : counts.complete > 0 ? 'partial' : 'failed';
        job.completedAt = new Date().toISOString();
      }
      await this.persist(job);
    } finally {
      this.activeJobs.delete(jobId);
    }
  }

  getJob(ownerUserId, jobId, options = {}) {
    this.assertInitialized();
    const job = this.findOwned(ownerUserId, jobId);
    return job ? publicJob(job, options) : null;
  }

  listJobs(ownerUserId, { limit = 50 } = {}) {
    this.assertInitialized();
    const safeLimit = integer(limit, 50, 1, 100);
    return [...this.jobs.values()]
      .filter((job) => job.ownerUserId === String(ownerUserId))
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
      .slice(0, safeLimit)
      .map((job) => publicJob(job, { includeItems: false }));
  }

  async retryFailed(ownerUserId, jobId) {
    this.assertInitialized();
    const job = this.findOwned(ownerUserId, jobId);
    if (!job) return null;
    if (job.status === 'canceled') throw new Error('Canceled scan jobs cannot be retried.');
    let retryCount = 0;
    for (const item of job.items) {
      if (item.status !== 'failed') continue;
      try {
        await fs.access(this.payloadFile(job.id, item.id));
      } catch {
        continue;
      }
      item.status = 'queued';
      item.attempts = 0;
      item.error = null;
      item.completedAt = null;
      retryCount += 1;
    }
    if (!retryCount) throw new Error('No failed items with retained payloads are available to retry.');
    job.status = 'queued';
    job.completedAt = null;
    await this.persist(job);
    this.schedule(job.id);
    return publicJob(job);
  }

  async cancel(ownerUserId, jobId) {
    this.assertInitialized();
    const job = this.findOwned(ownerUserId, jobId);
    if (!job) return null;
    if (['complete', 'partial', 'failed', 'canceled'].includes(job.status)) return publicJob(job);
    job.status = 'canceled';
    job.canceledAt = new Date().toISOString();
    for (const item of job.items) {
      if (!['complete', 'failed'].includes(item.status)) item.status = 'canceled';
    }
    await this.persist(job);
    return publicJob(job);
  }

  async pruneExpired(now = Date.now()) {
    if (!this.initialized) return 0;
    let removed = 0;
    for (const [jobId, job] of this.jobs.entries()) {
      if (!['complete', 'partial', 'failed', 'canceled'].includes(job.status)) continue;
      const terminalAt = Date.parse(job.completedAt || job.canceledAt || job.updatedAt || job.createdAt);
      if (!Number.isFinite(terminalAt) || now - terminalAt < this.retentionMs) continue;
      await fs.rm(this.jobDir(jobId), { recursive: true, force: true });
      this.jobs.delete(jobId);
      removed += 1;
    }
    return removed;
  }

  async close() {
    await Promise.allSettled([...this.activeJobs].map(async (jobId) => {
      const job = this.jobs.get(jobId);
      if (job?.status === 'processing') {
        job.status = 'queued';
        await this.persist(job);
      }
    }));
  }
}

export { publicJob as publicDurableScanJob, transientError as isTransientScanError };
