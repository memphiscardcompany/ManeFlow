import { normalizeText, roundMoney, safeDate } from './utils.js';

export const EVIDENCE_PARSER_VERSION = 'evidence-parser-v1.0';

function clean(value, max = 2000) {
  return String(value ?? '').trim().slice(0, max);
}

function firstMatch(text, patterns = []) {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) return clean(match[1] || match[0]);
  }
  return '';
}

function parseMoney(value) {
  const parsed = Number(String(value || '').replace(/[^0-9. -]/g, ''));
  return Number.isFinite(parsed) ? roundMoney(parsed) : null;
}

function inferProvider(text = '') {
  const normalized = normalizeText(text);
  if (normalized.includes('ebay')) return 'eBay Manual Evidence';
  if (normalized.includes('whatnot')) return 'Whatnot Manual Evidence';
  if (normalized.includes('tcgplayer') || normalized.includes('tcg player')) return 'TCGplayer Manual Evidence';
  if (normalized.includes('comc')) return 'COMC Manual Evidence';
  if (normalized.includes('goldin')) return 'Goldin Manual Evidence';
  if (normalized.includes('heritage')) return 'Heritage Manual Evidence';
  if (normalized.includes('pwcc') || normalized.includes('fanatics collect')) return 'Fanatics Collect Manual Evidence';
  return 'Manual Comp Evidence';
}

function parseGrade(text = '') {
  const grader = firstMatch(text, [/\b(PSA|BGS|BECKETT|SGC|CGC|CSG)\b/i]);
  const grade = firstMatch(text, [
    /\b(?:PSA|BGS|BECKETT|SGC|CGC|CSG)\s*(?:GEM\s*MINT|MINT|NM-MT)?\s*([0-9](?:\.[0-9])?|10)\b/i,
    /\bGrade\s*:?\s*([0-9](?:\.[0-9])?|10)\b/i,
  ]);
  return { grader: grader ? grader.toUpperCase().replace('BECKETT', 'BGS') : '', grade };
}

export function parseEvidenceText(input = {}) {
  const text = clean([input.text, input.ocrText, input.visibleText, input.title, input.notes].filter(Boolean).join('\n'), 25_000);
  const warnings = [];
  if (!text) warnings.push('No readable text was supplied with this evidence.');
  const provider = clean(input.provider || inferProvider(text), 160);
  const price = parseMoney(input.price ?? firstMatch(text, [
    /(?:sold for|sale price|sold price|total|price)\s*:?\s*\$?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i,
    /\$\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/,
  ]));
  const shipping = parseMoney(input.shipping ?? firstMatch(text, [/shipping\s*:?\s*\$?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i])) || 0;
  const buyerPremium = parseMoney(input.buyerPremium ?? firstMatch(text, [/(?:buyer premium|bp)\s*:?\s*\$?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i])) || 0;
  const dateText = clean(input.soldAt || firstMatch(text, [
    /\b((?:19|20)\d{2}-[01]\d-[0-3]\d)\b/,
    /\b([01]?\d\/[0-3]?\d\/(?:19|20)\d{2})\b/,
    /(?:sold|ended|date)\s*:?\s*([A-Za-z]{3,9}\s+[0-3]?\d,\s+(?:19|20)\d{2})/i,
  ]));
  const soldAt = safeDate(dateText)?.toISOString() || null;
  const certNumber = clean(input.certNumber || firstMatch(text, [
    /\bcert(?:ification)?\s*(?:no\.?|#|number)?\s*:?\s*([A-Z0-9-]{5,18})\b/i,
    /\b(PSA|BGS|SGC|CGC)\s*(?:cert)?\s*#?\s*([0-9]{5,12})\b/i,
  ]).replace(/^(PSA|BGS|SGC|CGC)\s*/i, ''), 80);
  const url = clean(input.url || firstMatch(text, [/\b(https?:\/\/[^\s)]+)\b/i]), 800);
  const { grader, grade } = parseGrade(text);
  const cardNumber = clean(input.cardNumber || firstMatch(text, [/#\s*([A-Z]{0,4}\d{1,5}[A-Z]?)\b/i, /\bcard\s*(?:no\.?|#|number)\s*:?\s*([A-Z0-9-]{1,12})\b/i]), 80);
  const serialNumber = clean(input.serialNumber || firstMatch(text, [/\b([0-9]{1,6}\s*\/\s*[0-9]{1,6})\b/]), 80);
  const year = Number(input.year || firstMatch(text, [/\b((?:19|20)\d{2})\b/])) || null;
  const title = clean(input.title || text.split(/\r?\n/).find((line) => line.trim().length >= 12) || text, 240);
  if (!price) warnings.push('Sold price could not be confidently extracted.');
  if (!soldAt) warnings.push('Sale date could not be confidently extracted.');
  if (!url && input.requireUrl) warnings.push('No source URL was visible.');
  const confidenceParts = [price ? 0.22 : 0, soldAt ? 0.2 : 0, title ? 0.16 : 0, provider ? 0.12 : 0, grader ? 0.08 : 0, cardNumber ? 0.08 : 0, url ? 0.08 : 0, certNumber ? 0.06 : 0];
  const confidence = Math.round(confidenceParts.reduce((sum, value) => sum + value, 0) * 100) / 100;
  return {
    parserVersion: EVIDENCE_PARSER_VERSION,
    provider,
    title,
    soldAt,
    price,
    shipping,
    buyerPremium,
    currency: input.currency || 'USD',
    rawUrl: url || null,
    player: clean(input.player, 160) || null,
    year,
    brand: clean(input.brand, 160) || null,
    set: clean(input.set, 160) || null,
    cardNumber: cardNumber || null,
    parallel: clean(input.parallel, 160) || null,
    serialNumber: serialNumber || null,
    grader: clean(input.grader || grader, 20) || undefined,
    grade: clean(input.grade || grade, 20) || undefined,
    certNumber: certNumber || null,
    confidence,
    warnings,
    extractedTextPreview: text.slice(0, 1000),
  };
}
