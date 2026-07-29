import { authorizeAcquisition, recordAcquisitionRun } from './acquisition-gate.js';
import { MANEFLOW_DATA_BOT, robotsDecision } from './source-policy.js';
import { parseEvidenceText } from './evidence-parser.js';

function originOf(value) {
  try { return new URL(value).origin; } catch { return ''; }
}

async function fetchText(fetchImpl, url, options = {}) {
  const response = await fetchImpl(url, options);
  const text = await response.text();
  return { ok: response.ok, status: response.status, text, headers: response.headers };
}

export function extractSaleEvidenceFromHtml(html = '', context = {}) {
  const text = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return parseEvidenceText({ ...context, text });
}

export async function collectApprovedPublicPage({ store, source, url, actor = null, purpose = 'approved_public_web_collection', fetchImpl = globalThis.fetch, dryRun = false, robotsText = null } = {}) {
  if (!store) throw new Error('store is required');
  if (!url) throw new Error('url is required');
  if (!fetchImpl) throw new Error('fetch is not available');
  let robotsBody = robotsText;
  if (robotsBody === null) {
    const origin = originOf(url);
    if (origin) {
      try {
        const robots = await fetchText(fetchImpl, `${origin}/robots.txt`, { headers: { 'user-agent': MANEFLOW_DATA_BOT }, signal: AbortSignal.timeout?.(8000) });
        robotsBody = robots.ok ? robots.text : '';
      } catch {
        robotsBody = '';
      }
    }
  }
  const robots = robotsDecision(robotsBody || '', url, MANEFLOW_DATA_BOT);
  const decision = authorizeAcquisition(store.state, source, {
    url,
    purpose,
    userAgent: MANEFLOW_DATA_BOT,
    robotsText: robotsBody || '',
    actor,
  });
  if (!decision.allowed) {
    const run = await recordAcquisitionRun(store, decision, { actor, targetUrl: url, purpose, dryRun, rowsSeen: 0, rowsQuarantined: 0 });
    return { decision, run, records: [], robots };
  }
  const page = await fetchText(fetchImpl, url, { headers: { 'user-agent': MANEFLOW_DATA_BOT }, signal: AbortSignal.timeout?.(12_000) });
  if (!page.ok) throw new Error(`Approved public collection failed with HTTP ${page.status}`);
  const extracted = extractSaleEvidenceFromHtml(page.text, { provider: decision.provider, url });
  const record = {
    provider: decision.provider,
    sourceType: 'approved_public_web',
    acquisitionStatus: 'quarantined',
    valuationUse: false,
    extracted,
    warnings: ['Approved public web records are quarantined until admin review and comp-quality scoring.'],
  };
  const run = await recordAcquisitionRun(store, decision, { actor, targetUrl: url, purpose, dryRun, rowsSeen: 1, rowsQuarantined: 1 });
  if (!dryRun) {
    if (!store.state.evidenceRecords) store.state.evidenceRecords = [];
    store.state.evidenceRecords.unshift({ id: `evidence_${run.id}`, runId: run.id, reviewStatus: 'needs_review', ...record, createdAt: new Date().toISOString() });
    store.state.evidenceRecords = store.state.evidenceRecords.slice(0, 5000);
    await store.persist();
  }
  return { decision, run, records: [record], robots };
}
