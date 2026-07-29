import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);
const index = args.indexOf('--file');
const requestedFilePath = path.resolve(index >= 0 ? args[index + 1] : 'config/external-release-gates.json');
const exampleFilePath = path.resolve('config/external-release-gates.example.json');

function requireBoolean(value, label) {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be boolean.`);
  return value;
}

function requireHttps(value, label) {
  let url;
  try { url = new URL(value); } catch { throw new TypeError(`${label} must be a valid URL.`); }
  if (url.protocol !== 'https:') throw new TypeError(`${label} must use HTTPS.`);
  return url.toString();
}

function collectChecks(config) {
  if (config.schemaVersion !== 'maneflow-external-release-gates-v1.0') throw new TypeError('Unsupported release gate schema.');
  const checks = [];
  for (const [key, value] of Object.entries(config.productionInfrastructure || {})) {
    requireHttps(value, `productionInfrastructure.${key}`);
    checks.push({ gate: `productionInfrastructure.${key}`, passed: true, value });
  }
  for (const platform of ['windows', 'apple', 'googlePlay']) {
    const section = config[platform];
    if (!section || typeof section !== 'object') throw new TypeError(`${platform} section is required.`);
    for (const [key, value] of Object.entries(section)) {
      if (key === 'publisherSubject') {
        checks.push({ gate: `${platform}.${key}`, passed: Boolean(String(value || '').trim()), value: value || '' });
      } else {
        checks.push({ gate: `${platform}.${key}`, passed: requireBoolean(value, `${platform}.${key}`), value });
      }
    }
  }
  return checks;
}

async function resolveConfigPath() {
  try {
    await fs.access(requestedFilePath);
    return { filePath: requestedFilePath, usingExample: false };
  } catch (error) {
    if (error?.code !== 'ENOENT' || index >= 0) throw error;
    await fs.access(exampleFilePath);
    return { filePath: exampleFilePath, usingExample: true };
  }
}

try {
  const { filePath, usingExample } = await resolveConfigPath();
  const config = JSON.parse(await fs.readFile(filePath, 'utf8'));
  const checks = collectChecks(config);
  const failed = checks.filter((item) => !item.passed);
  const result = {
    schemaVersion: 'maneflow-external-release-gate-result-v1.0',
    file: filePath,
    passed: failed.length === 0,
    checks,
    failed,
    usingExample,
    note: usingExample
      ? 'No private completion-state file was found, so this report uses the shipped example and should remain incomplete. Copy it to config/external-release-gates.json and update only after each external gate is actually verified.'
      : 'This report verifies recorded completion state. It does not contact Apple, Google, Microsoft, or the production infrastructure.',
  };
  console.log(JSON.stringify(result, null, 2));
  if (failed.length) process.exitCode = 1;
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 2;
}
