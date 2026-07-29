import { authorizeAcquisition, recordAcquisitionRun } from './acquisition-gate.js';
import { normalizeCatalogCard } from './catalog.js';
import { parseCsv } from './csv.js';
import { MANEFLOW_DATA_BOT, robotsDecision } from './source-policy.js';
import { normalizeText } from './utils.js';

export const PUBLIC_CHECKLIST_COLLECTOR_VERSION = 'public-checklist-collector-v1.0';

function clean(value, max = 240) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function stripHtml(html = '') {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#8217;|&rsquo;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\n\s+/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function inferYear(value) {
  return Number(/\b(19\d{2}|20\d{2})\b/.exec(value)?.[1] || 0) || null;
}

function inferBrand(value, provider = '') {
  const text = normalizeText(`${provider} ${value}`);
  if (text.includes('upper deck')) return 'Upper Deck';
  if (text.includes('topps')) return 'Topps';
  if (text.includes('bowman')) return 'Bowman';
  if (text.includes('panini')) return 'Panini';
  if (text.includes('donruss')) return 'Donruss';
  if (text.includes('prizm')) return 'Prizm';
  if (text.includes('fleer')) return 'Fleer';
  return '';
}

function parseLineCard(line, context = {}) {
  const raw = clean(line, 500);
  if (!raw || raw.length < 4) return null;
  const match = /^(?:#\s*)?([A-Za-z0-9/-]{1,12})[\s\-\u2013\u2014.:]+(.{2,})$/.exec(raw);
  if (!match) return null;
  const cardNumber = clean(match[1], 40);
  let subject = clean(match[2].replace(/\([^)]*\)/g, ' '), 160);
  if (!subject || /checklist|parallel|insert|autograph|odds|box|pack|hobby/i.test(subject)) return null;
  subject = subject.replace(/\s+-\s+.*$/, '').trim();
  if (!subject) return null;
  return normalizeCatalogCard({
    year: context.year || inferYear(context.title || context.url || ''),
    brand: context.brand || inferBrand(context.title || context.url || '', context.provider),
    set: context.set || context.title || 'Public Checklist',
    player: subject,
    cardNumber,
    parallel: context.parallel || 'Base',
    sport: context.sport || 'Sports Cards',
    catalogSource: context.provider || 'approved_public_checklist',
    aliases: raw,
  });
}

export function extractChecklistCardsFromText(text = '', context = {}) {
  const lines = String(text).split(/\r?\n/).map((line) => clean(line, 500)).filter(Boolean);
  const cards = [];
  const errors = [];
  for (const line of lines) {
    try {
      const card = parseLineCard(line, context);
      if (card) cards.push(card);
    } catch (error) {
      errors.push({ line, error: error.message });
    }
  }
  return dedupeCards(cards, errors);
}

export function extractChecklistCardsFromCsv(text = '', context = {}) {
  const rows = parseCsv(text);
  const cards = [];
  const errors = [];
  for (const row of rows) {
    try {
      const cardNumber = clean(row.cardNumber || row['Card #'] || row['Card Number'] || row.number || row.No || row['No.']);
      const subject = clean(row.player || row.Player || row.subject || row.Name || row.name || row.Card || row.card);
      if (!cardNumber || !subject) continue;
      cards.push(normalizeCatalogCard({
        year: row.year || row.Year || context.year,
        brand: row.brand || row.Brand || context.brand,
        set: row.set || row.Set || context.set || context.title,
        player: subject,
        cardNumber,
        parallel: row.parallel || row.Parallel || context.parallel || 'Base',
        sport: row.sport || row.Sport || context.sport || 'Sports Cards',
        catalogSource: context.provider || 'approved_public_checklist',
        aliases: clean(Object.values(row).filter(Boolean).join('; '), 500),
      }));
    } catch (error) {
      errors.push({ row: row.__row || null, error: error.message });
    }
  }
  return dedupeCards(cards, errors);
}

export function extractChecklistCardsFromHtml(html = '', context = {}) {
  return extractChecklistCardsFromText(stripHtml(html), context);
}

function dedupeCards(cards = [], errors = []) {
  const byId = new Map();
  for (const card of cards) if (!byId.has(card.id)) byId.set(card.id, card);
  return {
    version: PUBLIC_CHECKLIST_COLLECTOR_VERSION,
    cards: [...byId.values()],
    summary: { parsed: cards.length, unique: byId.size, errors: errors.length },
    errors,
  };
}

function originOf(value) {
  try { return new URL(value).origin; } catch { return ''; }
}

async function fetchText(fetchImpl, url, options = {}) {
  const response = await fetchImpl(url, options);
  const text = await response.text();
  return { ok: response.ok, status: response.status, text, headers: response.headers };
}

export async function collectApprovedChecklistPage({ store, source, url, actor = null, context = {}, fetchImpl = globalThis.fetch, dryRun = false, robotsText = null } = {}) {
  if (!store) throw new Error('store is required');
  if (!url) throw new Error('url is required');
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
    purpose: 'approved_public_checklist_identity_collection',
    userAgent: MANEFLOW_DATA_BOT,
    robotsText: robotsBody || '',
    actor,
  });
  if (!decision.allowed) {
    const run = await recordAcquisitionRun(store, decision, { actor, targetUrl: url, purpose: 'approved_public_checklist_identity_collection', dryRun, rowsSeen: 0 });
    return { decision, run, cards: [], robots };
  }
  const page = await fetchText(fetchImpl, url, { headers: { 'user-agent': MANEFLOW_DATA_BOT }, signal: AbortSignal.timeout?.(12_000) });
  if (!page.ok) throw new Error(`Approved checklist collection failed with HTTP ${page.status}`);
  const extraction = extractChecklistCardsFromHtml(page.text, { ...context, provider: decision.provider, url });
  const run = await recordAcquisitionRun(store, decision, { actor, targetUrl: url, purpose: 'approved_public_checklist_identity_collection', dryRun, rowsSeen: extraction.summary.parsed, rowsAccepted: extraction.summary.unique, rowsQuarantined: 0 });
  if (!dryRun && extraction.cards.length) await store.addCustomCards(extraction.cards);
  return { decision, run, cards: extraction.cards, summary: extraction.summary, errors: extraction.errors, robots };
}
