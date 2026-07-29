import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

function loadEnvFileSafely(filePath) {
  try {
    process.loadEnvFile?.(filePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

export function normalizeToken(value) {
  return String(value || '').trim().replace(/^bearer\s+/i, '');
}

function text(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  return '';
}

function flattenObject(value, prefix = '', out = new Map(), depth = 0) {
  if (depth > 8 || value === null || value === undefined) return out;
  if (Array.isArray(value)) {
    value.forEach((item, index) => flattenObject(item, `${prefix}[${index}]`, out, depth + 1));
    return out;
  }
  if (typeof value !== 'object') {
    out.set(prefix.toLowerCase(), text(value));
    return out;
  }
  for (const [key, item] of Object.entries(value)) {
    const next = prefix ? `${prefix}.${key}` : key;
    if (item && typeof item === 'object') flattenObject(item, next, out, depth + 1);
    else out.set(next.toLowerCase(), text(item));
  }
  return out;
}

function pick(flat, patterns) {
  for (const pattern of patterns) {
    const exact = [...flat.entries()].find(([key, value]) => key.endsWith(pattern.toLowerCase()) && value);
    if (exact) return exact[1];
  }
  return '';
}

export function normalizePsaResponse(payload) {
  const flat = flattenObject(payload);
  const certNumber = pick(flat, ['certnumber', 'certificationnumber', 'certificatenumber', '.cert']);
  const year = pick(flat, ['cardyear', '.year']);
  const subject = pick(flat, ['subject', 'player', 'subjectname', '.name']);
  const description = pick(flat, ['carddescription', 'specdescription', 'description']);
  const brand = pick(flat, ['brand', 'manufacturer']);
  const cardNumber = pick(flat, ['cardnumber', 'specnumber', 'number']);
  const grade = pick(flat, ['cardgrade', 'gradedescription', '.grade']);
  return { certNumber, year, subject, description, brand, cardNumber, grade };
}

function includesAll(actual, expected = []) {
  const haystack = String(actual || '').toUpperCase();
  return expected.every((needle) => haystack.includes(String(needle).toUpperCase()));
}

export function validateFixture(record, fixture) {
  const errors = [];
  const expected = fixture.expected || {};
  if (record.certNumber && record.certNumber.replace(/\D/g, '') !== fixture.certNumber) {
    errors.push(`cert mismatch: expected ${fixture.certNumber}, received ${record.certNumber}`);
  }
  if (expected.year && !String(record.year).includes(String(expected.year))) errors.push(`year mismatch: expected ${expected.year}, received ${record.year || 'blank'}`);
  if (expected.grade && !String(record.grade).toUpperCase().includes(String(expected.grade).toUpperCase())) errors.push(`grade mismatch: expected ${expected.grade}, received ${record.grade || 'blank'}`);
  if (!includesAll(record.subject, expected.subjectIncludes)) errors.push(`subject mismatch: expected ${expected.subjectIncludes?.join(' + ')}, received ${record.subject || 'blank'}`);
  if (!includesAll(record.description, expected.descriptionIncludes)) errors.push(`description mismatch: expected ${expected.descriptionIncludes?.join(' + ')}, received ${record.description || 'blank'}`);
  if (!includesAll(record.cardNumber, expected.cardNumberIncludes)) errors.push(`card number mismatch: expected ${expected.cardNumberIncludes?.join(' + ')}, received ${record.cardNumber || 'blank'}`);
  return errors;
}

async function requestJson(url, options, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      const bodyText = await response.text();
      let body;
      try { body = bodyText ? JSON.parse(bodyText) : {}; } catch { body = { raw: bodyText.slice(0, 2000) }; }
      if (response.ok) return { response, body };
      const retryable = response.status === 429 || response.status >= 500;
      const error = new Error(`PSA request failed with HTTP ${response.status}`);
      error.status = response.status;
      error.body = body;
      if (!retryable || attempt === attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** (attempt - 1))));
    } catch (error) {
      lastError = error;
      if (attempt === attempts || (error?.status && error.status < 500 && error.status !== 429)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** (attempt - 1))));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

export async function runLivePsaValidation({ root = projectRoot, token = process.env.PSA_API_TOKEN } = {}) {
  const cleanToken = normalizeToken(token);
  if (!cleanToken || cleanToken.length < 12 || /PASTE|YOUR_|CHANGE_ME|EXAMPLE/i.test(cleanToken)) {
    const error = new Error('PSA_API_TOKEN is missing, too short, or still contains placeholder text.');
    error.code = 'PSA_TOKEN_MISSING';
    throw error;
  }

  const manifestPath = path.join(root, 'integrations', 'psa-live-validation-manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const results = [];

  for (const fixture of manifest.fixtures) {
    const url = manifest.endpointTemplate.replace('{certNumber}', encodeURIComponent(fixture.certNumber));
    try {
      const { response, body } = await requestJson(url, {
        method: 'GET',
        headers: {
          Authorization: `bearer ${cleanToken}`,
          Accept: 'application/json',
          'User-Agent': 'ManeFlow-Release-Gate/2.18'
        }
      });
      const record = normalizePsaResponse(body);
      const validationErrors = validateFixture(record, fixture);
      results.push({ certNumber: fixture.certNumber, ok: validationErrors.length === 0, httpStatus: response.status, record, validationErrors });
    } catch (error) {
      results.push({ certNumber: fixture.certNumber, ok: false, httpStatus: error?.status || 0, error: error?.message || String(error) });
    }
  }

  const logsDir = path.join(root, '.runtime', 'provider-validation');
  await fs.mkdir(logsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join(logsDir, `psa-live-validation-${stamp}.json`);
  const report = {
    generatedAt: new Date().toISOString(),
    provider: 'psa',
    tokenPresent: true,
    tokenLength: cleanToken.length,
    passed: results.every((item) => item.ok),
    results
  };
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return { ...report, reportPath };
}

async function main() {
  loadEnvFileSafely(path.join(projectRoot, '.env'));
  loadEnvFileSafely(path.join(projectRoot, '.env.local'));
  try {
    const report = await runLivePsaValidation({ root: projectRoot });
    for (const result of report.results) {
      const marker = result.ok ? 'PASS' : 'FAIL';
      console.log(`${marker} PSA cert ${result.certNumber}${result.httpStatus ? ` (HTTP ${result.httpStatus})` : ''}`);
      if (result.ok) console.log(`  ${[result.record.year, result.record.brand, result.record.subject, result.record.description, result.record.cardNumber, result.record.grade].filter(Boolean).join(' | ')}`);
      for (const message of result.validationErrors || []) console.log(`  - ${message}`);
      if (result.error) console.log(`  - ${result.error}`);
    }
    console.log(`Report: ${report.reportPath}`);
    if (!report.passed) process.exitCode = 1;
  } catch (error) {
    console.error(`PSA live validation failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
