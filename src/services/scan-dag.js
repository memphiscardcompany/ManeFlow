import crypto from 'node:crypto';

export const SCAN_TASK_TYPES = Object.freeze({
  DETECT: 'detect',
  NORMALIZE_CROP: 'normalize_crop',
  OCR: 'ocr',
  EMBED: 'embed',
  RETRIEVE: 'retrieve',
  RERANK: 'rerank',
  ADJUDICATE: 'adjudicate',
  PRICE: 'price',
});

export const SCAN_TASK_STATUSES = Object.freeze({
  PENDING: 'pending',
  LEASED: 'leased',
  RETRY_WAIT: 'retry_wait',
  COMPLETE: 'complete',
  FAILED: 'failed',
  DEAD_LETTER: 'dead_letter',
  SKIPPED: 'skipped',
  CANCELLED: 'cancelled',
});

const TERMINAL_SUCCESS = new Set([SCAN_TASK_STATUSES.COMPLETE, SCAN_TASK_STATUSES.SKIPPED]);
const TERMINAL_FAILURE = new Set([SCAN_TASK_STATUSES.FAILED, SCAN_TASK_STATUSES.DEAD_LETTER]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function required(value, name, max = 500) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new TypeError(`${name} is required.`);
  if (normalized.length > max) throw new TypeError(`${name} exceeds ${max} characters.`);
  return normalized;
}

function optionalSha(value, name) {
  if (value == null || value === '') return null;
  const normalized = String(value).trim().toLowerCase();
  if (!SHA256_PATTERN.test(normalized)) throw new TypeError(`${name} must be lowercase SHA-256 hex.`);
  return normalized;
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

export function scanTaskIdempotencyKey({
  jobId,
  taskType,
  scopeType,
  scopeId,
  inputSha256 = null,
  modelName = null,
  modelVersion = null,
  policyVersion,
  parameters = {},
}) {
  const payload = {
    jobId: required(jobId, 'jobId', 100),
    taskType: required(taskType, 'taskType', 60),
    scopeType: required(scopeType, 'scopeType', 30),
    scopeId: required(scopeId, 'scopeId', 200),
    inputSha256: optionalSha(inputSha256, 'inputSha256'),
    modelName: modelName == null ? null : required(modelName, 'modelName', 128),
    modelVersion: modelVersion == null ? null : required(modelVersion, 'modelVersion', 128),
    policyVersion: required(policyVersion, 'policyVersion', 128),
    parameters,
  };
  return crypto.createHash('sha256').update(stableJson(payload)).digest('hex');
}

function task({ id, type, scopeType, scopeId, dependsOn = [], maxAttempts = 3, priority = 100, ...metadata }) {
  return {
    id: required(id, 'task.id', 200),
    type: required(type, 'task.type', 60),
    scopeType: required(scopeType, 'task.scopeType', 30),
    scopeId: required(scopeId, 'task.scopeId', 200),
    dependsOn: [...new Set(dependsOn.map((value) => required(value, 'task.dependsOn[]', 200)))],
    maxAttempts,
    priority,
    status: SCAN_TASK_STATUSES.PENDING,
    attemptCount: 0,
    ...metadata,
  };
}

export function buildCropDag({ jobId, assetId, cropId, inputSha256, modelName, modelVersion, policyVersion }) {
  const prefix = `${required(jobId, 'jobId', 100)}:${required(cropId, 'cropId', 100)}`;
  const common = { jobId, scopeType: 'crop', scopeId: cropId, inputSha256, modelName, modelVersion, policyVersion };
  const normalizeId = `${prefix}:normalize`;
  const ocrId = `${prefix}:ocr`;
  const embedId = `${prefix}:embed`;
  const retrieveId = `${prefix}:retrieve`;
  const rerankId = `${prefix}:rerank`;
  const adjudicateId = `${prefix}:adjudicate`;
  const priceId = `${prefix}:price`;

  const rows = [
    task({ id: normalizeId, type: SCAN_TASK_TYPES.NORMALIZE_CROP, scopeType: 'crop', scopeId: cropId, assetId, cropId }),
    task({ id: ocrId, type: SCAN_TASK_TYPES.OCR, scopeType: 'crop', scopeId: cropId, dependsOn: [normalizeId], assetId, cropId }),
    task({ id: embedId, type: SCAN_TASK_TYPES.EMBED, scopeType: 'crop', scopeId: cropId, dependsOn: [normalizeId], assetId, cropId }),
    task({ id: retrieveId, type: SCAN_TASK_TYPES.RETRIEVE, scopeType: 'crop', scopeId: cropId, dependsOn: [embedId], assetId, cropId }),
    task({ id: rerankId, type: SCAN_TASK_TYPES.RERANK, scopeType: 'crop', scopeId: cropId, dependsOn: [ocrId, retrieveId], assetId, cropId }),
    task({ id: adjudicateId, type: SCAN_TASK_TYPES.ADJUDICATE, scopeType: 'crop', scopeId: cropId, dependsOn: [rerankId], assetId, cropId, optional: true }),
    task({ id: priceId, type: SCAN_TASK_TYPES.PRICE, scopeType: 'crop', scopeId: cropId, dependsOn: [adjudicateId], assetId, cropId, optional: true }),
  ];

  return rows.map((row) => ({
    ...row,
    idempotencyKey: scanTaskIdempotencyKey({ ...common, taskType: row.type, scopeType: row.scopeType, scopeId: row.scopeId, parameters: { taskId: row.id } }),
  }));
}

export function readyScanTasks(tasks, { now = Date.now() } = {}) {
  const byId = new Map(tasks.map((entry) => [entry.id, entry]));
  return tasks
    .filter((entry) => {
      if (![SCAN_TASK_STATUSES.PENDING, SCAN_TASK_STATUSES.RETRY_WAIT].includes(entry.status)) return false;
      if (entry.availableAt && new Date(entry.availableAt).getTime() > now) return false;
      return entry.dependsOn.every((dependencyId) => TERMINAL_SUCCESS.has(byId.get(dependencyId)?.status));
    })
    .sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0) || left.id.localeCompare(right.id));
}

export function blockedScanTasks(tasks) {
  const byId = new Map(tasks.map((entry) => [entry.id, entry]));
  return tasks.filter((entry) => entry.status === SCAN_TASK_STATUSES.PENDING && entry.dependsOn.some((dependencyId) => TERMINAL_FAILURE.has(byId.get(dependencyId)?.status)));
}

export function deriveScanJobStatus(tasks) {
  if (!tasks.length) return 'received';
  if (tasks.every((entry) => [SCAN_TASK_STATUSES.COMPLETE, SCAN_TASK_STATUSES.SKIPPED, SCAN_TASK_STATUSES.CANCELLED].includes(entry.status))) return 'complete';
  if (tasks.some((entry) => entry.status === SCAN_TASK_STATUSES.DEAD_LETTER)) return 'review';
  if (tasks.some((entry) => entry.status === SCAN_TASK_STATUSES.FAILED) && readyScanTasks(tasks).length === 0) return 'review';
  const active = tasks.find((entry) => [SCAN_TASK_STATUSES.LEASED, SCAN_TASK_STATUSES.PENDING, SCAN_TASK_STATUSES.RETRY_WAIT].includes(entry.status));
  if (!active) return 'review';
  const stage = active.type;
  if (stage === SCAN_TASK_TYPES.DETECT) return 'detecting';
  if (stage === SCAN_TASK_TYPES.NORMALIZE_CROP) return 'normalizing';
  if ([SCAN_TASK_TYPES.OCR, SCAN_TASK_TYPES.EMBED].includes(stage)) return 'parallel_evidence';
  if (stage === SCAN_TASK_TYPES.RETRIEVE) return 'retrieving';
  if (stage === SCAN_TASK_TYPES.RERANK) return 'reranking';
  if (stage === SCAN_TASK_TYPES.ADJUDICATE) return 'adjudicating';
  if (stage === SCAN_TASK_TYPES.PRICE) return 'pricing';
  return 'queued';
}

export function classifyScanTaskFailure(error) {
  const code = String(error?.code || error?.name || '').toUpperCase();
  const status = Number(error?.statusCode || error?.status || 0);
  const text = String(error?.message || '').toLowerCase();
  if (status === 429 || /rate.?limit|too many requests|quota/.test(text)) return { code: 'RATE_LIMITED', retryable: true, backoffClass: 'provider' };
  if ([408, 502, 503, 504].includes(status) || /timeout|temporar|unavailable|overload|busy/.test(text)) return { code: code || 'TRANSIENT_PROVIDER_FAILURE', retryable: true, backoffClass: 'transient' };
  if (status === 413 || /payload too large/.test(text)) return { code: 'PAYLOAD_TOO_LARGE', retryable: false, backoffClass: null };
  if (/invalid image|decode|unsupported image|corrupt/.test(text)) return { code: 'INVALID_IMAGE', retryable: false, backoffClass: null };
  if (/out of memory|cuda.*memory|oom/.test(text)) return { code: 'GPU_OOM', retryable: true, backoffClass: 'smaller_batch' };
  if (/model.*missing|configuration|credential|unauthorized|forbidden/.test(text)) return { code: 'CONFIGURATION_ERROR', retryable: false, backoffClass: null };
  return { code: code || 'UNKNOWN_TASK_FAILURE', retryable: false, backoffClass: null };
}
