import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sectionPath = path.join(root, 'integrations', 'shopify', 'sections', 'maneflow-beta.liquid');
const templatePath = path.join(root, 'integrations', 'shopify', 'templates', 'page.maneflow.json');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

test('Shopify ManeFlow launch remains account-gated and first-party', () => {
  const section = read(sectionPath);

  assert.match(section, /\{% if customer %\}/);
  assert.match(section, /routes\.storefront_login_url/);
  assert.match(section, /routes\.account_login_url/);
  assert.match(section, /Sign in or create account/);
  assert.match(section, /https:\/\/app\.memphiscardcompany\.com/);
  assert.match(section, /Pricing by ManeFlow/);
  assert.match(section, /completed-sale evidence/i);
  assert.match(section, /Results remain drafts until verified/);

  assert.doesNotMatch(section, /<iframe\b/i);
  assert.doesNotMatch(section, /\.v2\.appdeploy\.ai/i);
  assert.doesNotMatch(section, /\/account\/register/);
  assert.doesNotMatch(section, /marketValue|compHigh/);
});

test('Shopify ManeFlow page template targets the reviewed launch section', () => {
  const template = JSON.parse(read(templatePath));
  assert.deepEqual(template.order, ['main']);
  assert.equal(template.sections.main.type, 'maneflow-beta');
  assert.equal(template.sections.main.settings.app_url, 'https://app.memphiscardcompany.com');
  assert.equal(template.sections.main.settings.headline, 'Scan. Identify. Price. Collect.');
});
