import crypto from 'node:crypto';

export function json(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(body);
}

export function text(res, status, body, contentType = 'text/plain; charset=utf-8', headers = {}) {
  const value = String(body);
  res.writeHead(status, {
    'content-type': contentType,
    'content-length': Buffer.byteLength(value),
    ...headers,
  });
  res.end(value);
}

export function badRequest(res, message, details) {
  json(res, 400, { error: 'bad_request', message, details });
}

export function forbidden(res, message = 'This action is not allowed.') {
  json(res, 403, { error: 'forbidden', message });
}

export function notFound(res, message = 'Resource not found') {
  json(res, 404, { error: 'not_found', message });
}

export function unauthorized(res) {
  json(res, 401, { error: 'unauthorized', message: 'A valid ManeFlow API token is required.' });
}

export function methodNotAllowed(res, methods = []) {
  json(res, 405, { error: 'method_not_allowed', message: 'Method not allowed' }, methods.length ? { allow: methods.join(', ') } : {});
}

export async function readBody(req, maxBytes = 2_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('Request body exceeds size limit');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function readJson(req, maxBytes = 2_000_000) {
  const body = await readBody(req, maxBytes);
  if (!body.length) return {};
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    throw new Error('Request body must be valid JSON');
  }
}

export function makeId(prefix = 'id') {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function normalizeText(value = '') {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function safeDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function daysAgo(value, now = new Date()) {
  const date = safeDate(value);
  if (!date) return Infinity;
  return Math.max(0, (now.getTime() - date.getTime()) / 86_400_000);
}

export function parseWindow(value = '90d') {
  const match = /^([0-9]{1,4})d$/i.exec(String(value));
  if (!match) return 90;
  return clamp(Number(match[1]), 1, 3650);
}

export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

export function timingSafeEqualString(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function verifyHmac(body, signature, secret) {
  if (!secret || !signature) return false;
  const supplied = String(signature).replace(/^sha256=/i, '');
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return timingSafeEqualString(supplied, expected);
}

export function csvEscape(value) {
  const textValue = String(value ?? '');
  return /[",\r\n]/.test(textValue) ? `"${textValue.replaceAll('"', '""')}"` : textValue;
}

export function toCsv(headers, rows) {
  return [headers.map(csvEscape).join(','), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(','))].join('\r\n');
}
