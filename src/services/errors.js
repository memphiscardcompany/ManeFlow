const SECRET_KEY_PATTERN = /(secret|token|password|credential|api[_-]?key|client[_-]?secret|access[_-]?token)/i;
const SECRET_VALUE_PATTERNS = [
  /sk-[A-Za-z0-9_-]{12,}/g,
  /(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi,
  /(Basic\s+)[A-Za-z0-9+/=-]{12,}/gi,
];

export class AppError extends Error {
  constructor(message, { status = 500, code = 'app_error', details = {} } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class ConfigurationError extends AppError {
  constructor(message, details = {}) {
    super(message, { status: 500, code: 'configuration_error', details });
  }
}

export class PermissionError extends AppError {
  constructor(message = 'This action is not allowed.', details = {}) {
    super(message, { status: 403, code: 'permission_denied', details });
  }
}

export class ValidationError extends AppError {
  constructor(message, details = {}) {
    super(message, { status: 400, code: 'validation_error', details });
  }
}

export function redactSecrets(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return SECRET_VALUE_PATTERNS.reduce((text, pattern) => text.replace(pattern, (...args) => `${args[1] || ''}[REDACTED]`), value);
  }
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      SECRET_KEY_PATTERN.test(key) ? '[REDACTED]' : redactSecrets(entry),
    ]));
  }
  return value;
}

export function publicError(error) {
  if (error instanceof AppError) {
    return {
      error: error.code,
      message: error.message,
      details: redactSecrets(error.details),
    };
  }
  return { error: 'internal_error', message: 'Unexpected server error' };
}
