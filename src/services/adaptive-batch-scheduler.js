import { randomUUID } from 'node:crypto';

export const BATCH_TERMINAL_STATES = Object.freeze([
  'detected',
  'review_required',
  'insufficient_evidence',
  'rejected_no_card',
  'failed_retryable',
  'failed_permanent',
  'canceled',
]);

const TERMINAL_STATE_SET = new Set(BATCH_TERMINAL_STATES);
const TRANSIENT_STATUSES = new Set([408, 425, 429, 502, 503, 504]);

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function safeError(error) {
  return {
    message: String(error?.message || 'Vision batch item failed.'),
    status: Number.isFinite(Number(error?.status)) ? Number(error.status) : null,
    retry_after: error?.retryAfter ? String(error.retryAfter) : null,
  };
}

function isTransientError(error) {
  const status = Number(error?.status);
  return TRANSIENT_STATUSES.has(status)
    || error?.name === 'AbortError'
    || error?.name === 'TimeoutError'
    || error?.code === 'ETIMEDOUT'
    || error?.code === 'ECONNRESET';
}

function emit(onProgress, summary) {
  if (typeof onProgress !== 'function') return;
  try {
    onProgress(summary);
  } catch {
    // UI or telemetry listeners must not be able to break batch completion.
  }
}

export class AdaptiveConcurrencyController {
  constructor({
    initialConcurrency = 4,
    minimumConcurrency = 1,
    maximumConcurrency = 8,
    healthyWindow = 20,
  } = {}) {
    this.minimumConcurrency = boundedInteger(minimumConcurrency, 1, 1, 64);
    this.maximumConcurrency = boundedInteger(
      maximumConcurrency,
      8,
      this.minimumConcurrency,
      64,
    );
    this.currentConcurrency = boundedInteger(
      initialConcurrency,
      4,
      this.minimumConcurrency,
      this.maximumConcurrency,
    );
    this.healthyWindow = boundedInteger(healthyWindow, 20, 1, 10_000);
    this.healthyCompletions = 0;
    this.backoffEvents = 0;
    this.scaleUpEvents = 0;
  }

  recordSuccess() {
    this.healthyCompletions += 1;
    if (
      this.healthyCompletions >= this.healthyWindow
      && this.currentConcurrency < this.maximumConcurrency
    ) {
      this.currentConcurrency += 1;
      this.healthyCompletions = 0;
      this.scaleUpEvents += 1;
    }
    return this.currentConcurrency;
  }

  recordFault(error) {
    if (!isTransientError(error)) {
      this.healthyCompletions = 0;
      return this.currentConcurrency;
    }
    this.currentConcurrency = Math.max(
      this.minimumConcurrency,
      Math.floor(this.currentConcurrency / 2),
    );
    this.healthyCompletions = 0;
    this.backoffEvents += 1;
    return this.currentConcurrency;
  }

  recordMemoryPressure() {
    this.currentConcurrency = Math.max(
      this.minimumConcurrency,
      Math.floor(this.currentConcurrency / 2),
    );
    this.healthyCompletions = 0;
    this.backoffEvents += 1;
    return this.currentConcurrency;
  }

  snapshot() {
    return {
      current_concurrency: this.currentConcurrency,
      minimum_concurrency: this.minimumConcurrency,
      maximum_concurrency: this.maximumConcurrency,
      healthy_window: this.healthyWindow,
      healthy_completions: this.healthyCompletions,
      scale_up_events: this.scaleUpEvents,
      backoff_events: this.backoffEvents,
    };
  }
}

function sourceSummary(source) {
  return {
    source_id: source.source_id,
    source_index: source.source_index,
    filename: source.filename,
    state: source.state,
    terminal_state: TERMINAL_STATE_SET.has(source.state) ? source.state : null,
    started_at: source.started_at,
    completed_at: source.completed_at,
    duration_ms: source.duration_ms,
    result: source.result,
    error: source.error,
  };
}

function buildSummary({
  generationId,
  sources,
  controller,
  startedAt,
  completedAt = null,
}) {
  const terminalSources = sources.filter((source) => TERMINAL_STATE_SET.has(source.state));
  const count = (state) => sources.filter((source) => source.state === state).length;
  const activeCount = count('processing');
  const queuedCount = count('queued');
  const processedCount = terminalSources.length;
  return {
    queue_generation_id: generationId,
    source_image_count: sources.length,
    processed_count: processedCount,
    active_count: activeCount,
    queued_count: queuedCount,
    detected_count: count('detected'),
    review_required_count: count('review_required'),
    insufficient_evidence_count: count('insufficient_evidence'),
    rejected_count: count('rejected_no_card'),
    failed_count: count('failed_retryable') + count('failed_permanent'),
    retryable_failed_count: count('failed_retryable'),
    permanent_failed_count: count('failed_permanent'),
    canceled_count: count('canceled'),
    unresolved_count: count('review_required') + count('insufficient_evidence'),
    silently_dropped_sources: Math.max(
      0,
      sources.length - processedCount - activeCount - queuedCount,
    ),
    scene_complete: processedCount === sources.length,
    started_at: startedAt,
    completed_at: completedAt,
    duration_ms: completedAt == null ? null : Math.max(0, completedAt - startedAt),
    scheduler: controller.snapshot(),
    sources: sources.map(sourceSummary),
  };
}

function normalizeItem(item, index) {
  const source = typeof item === 'string' ? { dataUrl: item } : { ...(item || {}) };
  return {
    item: source,
    source_id: String(source.sourceId || source.source_id || `source-${index + 1}`),
    source_index: index,
    filename: String(source.filename || `card-${index + 1}.jpg`),
    state: 'queued',
    started_at: null,
    completed_at: null,
    duration_ms: null,
    result: null,
    error: null,
  };
}

export async function runAdaptiveBatch({
  items,
  worker,
  classifyResult,
  controller = new AdaptiveConcurrencyController(),
  queueGenerationId = randomUUID(),
  onProgress = null,
  shouldStop = null,
  nowFn = Date.now,
} = {}) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('At least one batch item is required.');
  }
  if (typeof worker !== 'function') throw new Error('A batch worker function is required.');
  if (typeof classifyResult !== 'function') {
    throw new Error('A batch result classifier is required.');
  }

  const startedAt = nowFn();
  const sources = items.map(normalizeItem);
  let nextIndex = 0;
  let activeCount = 0;
  let stopLaunching = false;
  let settled = false;

  const currentSummary = (completedAt = null) => buildSummary({
    generationId: queueGenerationId,
    sources,
    controller,
    startedAt,
    completedAt,
  });

  emit(onProgress, currentSummary());

  return new Promise((resolve) => {
    const finishIfPossible = () => {
      if (settled || activeCount > 0) return false;
      if (stopLaunching && nextIndex < sources.length) {
        while (nextIndex < sources.length) {
          const source = sources[nextIndex];
          source.state = 'canceled';
          source.completed_at = nowFn();
          source.duration_ms = 0;
          nextIndex += 1;
        }
      }
      if (nextIndex < sources.length) return false;
      settled = true;
      const completedAt = nowFn();
      const summary = currentSummary(completedAt);
      emit(onProgress, summary);
      resolve(summary);
      return true;
    };

    const pump = () => {
      if (settled) return;
      if (!stopLaunching && typeof shouldStop === 'function' && shouldStop()) {
        stopLaunching = true;
      }

      while (
        !stopLaunching
        && activeCount < controller.currentConcurrency
        && nextIndex < sources.length
      ) {
        const source = sources[nextIndex];
        nextIndex += 1;
        activeCount += 1;
        source.state = 'processing';
        source.started_at = nowFn();
        emit(onProgress, currentSummary());

        Promise.resolve()
          .then(() => worker(source.item, {
            sourceId: source.source_id,
            sourceIndex: source.source_index,
            filename: source.filename,
            queueGenerationId,
          }))
          .then((result) => {
            const classified = classifyResult(result, source.item) || {};
            const terminalState = classified.terminalState || classified.terminal_state;
            if (!TERMINAL_STATE_SET.has(terminalState)) {
              throw new Error(`Invalid terminal batch state: ${terminalState}`);
            }
            source.state = terminalState;
            source.result = classified.result ?? result ?? null;
            controller.recordSuccess();
          })
          .catch((error) => {
            source.state = isTransientError(error) ? 'failed_retryable' : 'failed_permanent';
            source.error = safeError(error);
            controller.recordFault(error);
          })
          .finally(() => {
            source.completed_at = nowFn();
            source.duration_ms = Math.max(0, source.completed_at - source.started_at);
            activeCount -= 1;
            emit(onProgress, currentSummary());
            if (!finishIfPossible()) pump();
          });
      }

      finishIfPossible();
    };

    pump();
  });
}
