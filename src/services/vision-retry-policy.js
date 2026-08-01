const DEFAULT_MIN_RETRY_MS = 1_000;
const DEFAULT_MAX_RETRY_MS = 15_000;
const TRANSIENT_STATUSES = new Set([429, 502, 503, 504]);

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function isTransientVisionStatus(status) {
  return TRANSIENT_STATUSES.has(Number(status));
}

export function parseRetryAfterMs(
  value,
  {
    now = Date.now(),
    minimumMs = DEFAULT_MIN_RETRY_MS,
    maximumMs = DEFAULT_MAX_RETRY_MS,
  } = {},
) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  const seconds = Number(raw);
  if (Number.isFinite(seconds)) {
    return clamp(Math.round(seconds * 1_000), minimumMs, maximumMs);
  }

  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) return null;
  return clamp(Math.round(timestamp - now), minimumMs, maximumMs);
}

export function exponentialRetryDelayMs(
  attempt,
  {
    baseMs = 250,
    minimumMs = 250,
    maximumMs = DEFAULT_MAX_RETRY_MS,
  } = {},
) {
  const normalizedAttempt = Math.max(0, Math.floor(Number(attempt) || 0));
  return clamp(baseMs * (2 ** normalizedAttempt), minimumMs, maximumMs);
}
