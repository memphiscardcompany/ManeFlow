import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try { process.loadEnvFile?.(path.join(root, '.env')); } catch {}
const config = loadConfig();
const checks = [];
const add = (name, ok, detail, critical = true) => checks.push({ name, ok, detail, critical });
add('HTTPS public URL', config.publicBaseUrl.startsWith('https://'), config.publicBaseUrl);
add('Guest writes disabled', !config.allowGuestWrites, `MANEFLOW_ALLOW_GUEST_WRITES=${config.allowGuestWrites}`);
add('Demonstration data disabled', !config.demoMode, `MANEFLOW_DEMO_MODE=${config.demoMode}`);
add('Administrator token', config.adminToken.length >= 32, config.adminToken ? `${config.adminToken.length} characters` : 'missing');
add('Provider webhook secret', config.providerWebhookSecret.length >= 32, config.providerWebhookSecret ? `${config.providerWebhookSecret.length} characters` : 'missing');
add('Allowed origins', config.allowedOrigins.length > 0, config.allowedOrigins.join(', ') || 'empty');
add('Email verification required', config.requireEmailVerification, `MANEFLOW_REQUIRE_EMAIL_VERIFICATION=${config.requireEmailVerification}`);
add('Development tokens hidden', !config.exposeDevTokens, `MANEFLOW_EXPOSE_DEV_TOKENS=${config.exposeDevTokens}`);
add('Transactional email webhook', Boolean(config.emailWebhookUrl), config.emailWebhookUrl || 'not configured');
add('Vision provider', Boolean(config.openaiApiKey && config.openaiVisionModel), config.openaiVisionModel || 'optional / not configured', false);
add('eBay Browse credentials', Boolean(config.ebayClientId && config.ebayClientSecret), config.ebayClientId ? 'configured' : 'optional / not configured', false);
add('eBay Marketplace Insights gate', !config.ebayMarketplaceInsightsEnabled || Boolean(config.ebayClientId && config.ebayClientSecret), config.ebayMarketplaceInsightsEnabled ? 'enabled with credentials check' : 'disabled until approved access', false);
add('eBay seller-order token', Boolean(config.ebayUserAccessToken), config.ebayUserAccessToken ? 'configured' : 'optional / not configured', false);
try { await fs.access(path.join(root, 'public', 'index.html')); add('PWA assets', true, 'present'); } catch { add('PWA assets', false, 'missing'); }
try { await fs.access(path.join(root, 'apps', 'mobile-expo', 'app.json')); add('Native project', true, 'present'); } catch { add('Native project', false, 'missing'); }

console.log('\nManeFlow production readiness\n');
for (const check of checks) console.log(`${check.ok ? 'PASS' : check.critical ? 'BLOCK' : 'INFO'}  ${check.name}: ${check.detail}`);
const blockers = checks.filter((check) => check.critical && !check.ok);
console.log(`\n${blockers.length ? `${blockers.length} production blocker(s) remain.` : 'All local production configuration checks passed.'}`);
if (process.argv.includes('--strict') && blockers.length) process.exitCode = 1;
