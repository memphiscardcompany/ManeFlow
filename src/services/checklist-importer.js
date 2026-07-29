import path from 'node:path';
import { parseCsv } from './csv.js';
import { normalizeCatalogCard } from './catalog.js';
import { normalizeText } from './utils.js';

export const CHECKLIST_IMPORTER_VERSION = 'owned-checklist-importer-v1.0';

const TITLE_FIELDS = ['Item Title', 'Title'];
const COLLECTION_FIELDS = ['Player', 'Set/Year', 'Card #'];
const BRAND_HINTS = [
  'Topps Heritage High Number',
  'Topps Heritage',
  'Topps Chrome',
  'Topps Update',
  'Topps Finest',
  'Topps Stadium Club',
  'Topps',
  'Bowman Chrome',
  'Bowman',
  'Panini Prizm',
  'Panini Donruss Optic',
  'Panini Donruss',
  'Panini Select',
  'Panini Mosaic',
  'Panini',
  'Donruss Optic',
  'Donruss',
  'Prizm',
  'Select',
  'Mosaic',
  'Fleer',
  'Upper Deck',
  'Score',
  'Hoops',
  'Finest',
  'Leaf',
  'SAGE',
  'Wizards of the Coast',
  'Pokemon',
];

const SUBJECT_STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'in', 'is', 'here', 'low', 'pop', 'rookie',
  'rc', 'card', 'cards', 'psa', 'bgs', 'sgc', 'cgc', 'gem', 'mt', 'mint', 'auto',
  'autograph', 'refractor', 'silver', 'base', 'holo', 'graded', 'raw', 'parallel',
  'prospect', 'variation', 'sp', 'ssp', 'case', 'hit', 'rare',
]);
const SUBJECT_PREFIX_WORDS = new Set([
  'stars', 'star', 'mlb', 'topps', 'profiles', 'profile', 'all', 'game', 'new',
  'applicants', 'applicant', 'autographs', 'autograph', 'baseball', 'best',
  'cartoon', 'manga', 'significant', 'statistics', 'ops', 'spotlight',
]);
const SUBJECT_SUFFIX_WORDS = new Set([
  'pirates', 'angels', 'dodgers', 'yankees', 'mets', 'cubs', 'reds', 'orioles',
  'mariners', 'braves', 'phillies', 'padres', 'giants', 'rangers', 'royals',
  'tigers', 'astros', 'brewers', 'cardinals', 'athletics', 'twins', 'guardians',
  'ravens', 'chiefs', 'cowboys', 'lakers', 'bulls', 'grizzlies',
]);
const SUBJECT_PREFIX_PATTERNS = [
  /^stars of mlb\s+/i,
  /^topps profiles?\s+/i,
  /^all[- ]star game\s+/i,
  /^new applicants? autographs?\s+/i,
  /^1990 topps baseball all[- ]stars?\s+/i,
  /^ops best\s+/i,
  /^alternate cartoon variation\s+/i,
  /^significant statistics\s+/i,
  /^league leaders\s+/i,
  /^veteran combos\s+/i,
  /^finest blue chips\s+/i,
  /^bomb squad\s+/i,
  /^night terrors\s+/i,
  /^rookie debut\s+/i,
  /^debut\s+/i,
  /^inspirational\s+/i,
  /^hog heaven\s+/i,
  /^heaven\s+/i,
  /^stand[- ]ups\s+/i,
];

function clean(value, max = 240) {
  return String(value ?? '')
    .replace(/[^\p{L}\p{N}#&'./: -]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function readField(row, fields) {
  for (const field of fields) {
    if (row[field] !== undefined && clean(row[field])) return clean(row[field]);
  }
  return '';
}

function normalizedHeaderScore(headers) {
  const names = headers.map((header) => normalizeText(header));
  let score = 0;
  for (const expected of ['item title', 'title', 'player', 'set year', 'card', 'professional grader', 'grade']) {
    if (names.some((name) => name.includes(expected))) score += 1;
  }
  return score;
}

export function parseOwnedCsv(text) {
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/);
  let best = { score: -1, rows: [] };
  for (let index = 0; index < Math.min(lines.length, 20); index += 1) {
    const candidate = lines.slice(index).join('\n');
    const rows = parseCsv(candidate);
    const headers = rows.length ? Object.keys(rows[0]).filter((key) => key !== '__row') : [];
    const score = normalizedHeaderScore(headers);
    if (score > best.score) best = { score, rows };
    if (score >= 3) break;
  }
  return best.score > 0 ? best.rows : [];
}

function parseSetYear(value) {
  const text = clean(value);
  const yearMatch = /\b(19\d{2}|20\d{2})(?:[-/](\d{2}))?\b/.exec(text);
  const year = yearMatch ? Number(yearMatch[1]) : null;
  const withoutYear = yearMatch ? clean(text.replace(yearMatch[0], '')) : text;
  const brand = inferBrand(withoutYear) || inferBrand(text) || '';
  const set = clean(withoutYear.replace(new RegExp(`^${escapeRegExp(brand)}\\b`, 'i'), '')) || brand || withoutYear;
  return { year, brand, set };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function inferBrand(text) {
  const normalized = normalizeText(text);
  const hint = BRAND_HINTS.find((brand) => normalized.includes(normalizeText(brand)));
  if (!hint) return '';
  const first = hint.split(' ')[0];
  if (['Prizm', 'Select', 'Mosaic', 'Donruss', 'Finest'].includes(first)) return first;
  return first === 'Wizards' ? 'Wizards of the Coast' : first;
}

function inferSet(title, year, brand) {
  let text = clean(title)
    .replace(/\b(19\d{2}|20\d{2})(?:[-/]\d{2})?\b/, '')
    .replace(/\s+-\s+/g, ' ')
    .replace(/#\s*[A-Za-z0-9/-]+.*/, '')
    .replace(/\b(pop|low pop|gem mint|mint|psa|bgs|sgc|cgc|graded|raw|rookie|prospect|card)\b.*$/i, '')
    .replace(/\([^)]*\)/g, '')
    .trim();
  if (brand) text = clean(text.replace(new RegExp(`^${escapeRegExp(brand)}\\b`, 'i'), ''));
  const tokens = text.split(' ').filter(Boolean);
  const subject = inferSubject(title);
  const subjectTokens = normalizeText(subject).split(' ').filter(Boolean);
  const trimmed = [];
  for (const token of tokens) {
    if (subjectTokens.includes(normalizeText(token))) break;
    trimmed.push(token);
  }
  const set = clean(trimmed.join(' '));
  return set || clean(text) || brand || `Unknown ${year || ''}`.trim();
}

function inferSubject(title) {
  const beforeNumber = clean(String(title).split(/#\s*[A-Za-z0-9/-]+/)[0] || title);
  let afterDash = beforeNumber.includes(' - ') ? beforeNumber.split(' - ').pop() : beforeNumber;
  for (const pattern of SUBJECT_PREFIX_PATTERNS) afterDash = clean(afterDash.replace(pattern, ''));
  const words = afterDash.replace(/[^\p{L}\p{N}' -]/gu, ' ').split(/\s+/).filter(Boolean);
  while (words.length && (SUBJECT_STOP_WORDS.has(normalizeText(words.at(-1))) || /^\d+$/.test(normalizeText(words.at(-1))))) words.pop();
  while (words.length && (/^\d{4}$/.test(words[0]) || BRAND_HINTS.some((brand) => normalizeText(brand).split(' ')[0] === normalizeText(words[0])))) words.shift();
  while (words.length && SUBJECT_PREFIX_WORDS.has(normalizeText(words[0]))) words.shift();
  while (words.length > 2 && SUBJECT_SUFFIX_WORDS.has(normalizeText(words.at(-1)))) words.pop();
  const candidates = words.slice(-4).filter((word) => {
    const normalized = normalizeText(word);
    return normalized && !SUBJECT_STOP_WORDS.has(normalized) && !/^\d+$/.test(normalized);
  });
  return clean(candidates.join(' '));
}

function isUsefulSubject(value = '') {
  const normalized = normalizeText(value);
  if (!normalized || normalized.length < 3) return false;
  if (/^\d+$/.test(normalized)) return false;
  const tokens = normalized.split(' ').filter(Boolean);
  if (!tokens.length) return false;
  if (tokens.every((token) => SUBJECT_STOP_WORDS.has(token))) return false;
  return true;
}

function postprocessCard(card) {
  if (!card || !isUsefulSubject(card.player)) return null;
  if (!card.cardNumber) return null;
  const suspiciousSet = normalizeText(card.set || '');
  if (!suspiciousSet || suspiciousSet.length < 2) return null;
  if (/^\d+$/.test(suspiciousSet)) return null;
  return card;
}

function normalizeOwnedCatalogCard(input) {
  const card = normalizeCatalogCard(input);
  const cleaned = {
    ...card,
    player: clean(card.player),
    set: clean(card.set),
    parallel: clean(card.parallel || 'Base'),
    aliases: (card.aliases || []).map((alias) => clean(alias, 500)).filter(Boolean),
  };
  if (!cleaned.grade?.company || cleaned.grade.company === 'OTHER') {
    cleaned.grade = { company: 'RAW', grade: 'Raw' };
  }
  return postprocessCard(cleaned);
}

function inferCardNumber(row, title) {
  const explicit = readField(row, ['Card #', 'Card Number', 'cardNumber']);
  if (explicit) return explicit;
  const match = /#\s*([A-Za-z0-9/-]+)/.exec(title);
  return match ? clean(match[1], 40) : '';
}

function inferGrade(row, title) {
  const gradeText = readField(row, ['Grade', 'CD:Grade - (ID: 27502)']);
  const graderText = readField(row, ['Grader', 'Grade Company', 'CD:Professional Grader - (ID: 27501)']);
  const raw = clean(`${graderText} ${gradeText}`) || clean(title);
  if (/raw|wishlist/i.test(raw)) return {};
  const company = /PSA|Professional Sports Authenticator/i.test(raw) ? 'PSA'
    : /BGS|Beckett/i.test(raw) ? 'BGS'
    : /SGC/i.test(raw) ? 'SGC'
    : /CGC|CSG/i.test(raw) ? 'CGC'
    : '';
  const gradePattern = '(10|9\\.5|9|8\\.5|8|7\\.5|7|6\\.5|6|5\\.5|5|4\\.5|4|3\\.5|3|2\\.5|2|1\\.5|1)';
  const afterCompany = company ? new RegExp(`\\b${company}\\b\\D{0,12}${gradePattern}\\b`, 'i').exec(raw)?.[1] || '' : '';
  const numericGrade = afterCompany || (gradeText ? new RegExp(`\\b${gradePattern}\\b`, 'i').exec(gradeText)?.[1] || '' : '');
  const grade = numericGrade || gradeText;
  return company || grade ? { company, grade } : {};
}

function inferParallel(row, title) {
  const explicit = readField(row, ['Parallel', 'Variant']);
  if (explicit) return explicit;
  const text = normalizeText(title);
  if (text.includes('refractor')) return 'Refractor';
  if (text.includes('silver')) return 'Silver';
  if (text.includes('holo')) return 'Holo';
  if (text.includes('rookie') || /\brc\b/i.test(title)) return 'Rookie';
  return 'Base';
}

function inferSport(row, title) {
  const explicit = readField(row, ['Sport', 'Category']);
  if (explicit) return explicit;
  const text = normalizeText(title);
  if (text.includes('pokemon') || text.includes('charizard')) return 'Pokemon';
  if (text.includes('wwe')) return 'Wrestling';
  if (text.includes('ufc')) return 'MMA';
  return 'Sports Cards';
}

function ownedSourceName(sourceName, fallback = 'owned_export') {
  return String(sourceName || fallback).trim().slice(0, 120).replace(/[^A-Za-z0-9_.-]/g, '_');
}

function rowToCatalogCard(row, { sourceName = 'owned_export' } = {}) {
  const collectionPlayer = readField(row, COLLECTION_FIELDS.slice(0, 1));
  if (collectionPlayer) {
    const setYear = parseSetYear(readField(row, ['Set/Year', 'Set Year', 'Set']));
    return normalizeOwnedCatalogCard({
      year: setYear.year,
      brand: setYear.brand,
      set: setYear.set,
      player: collectionPlayer,
      cardNumber: inferCardNumber(row, ''),
      parallel: inferParallel(row, readField(row, ['Parallel'])),
      grade: inferGrade(row, readField(row, ['Grade'])),
      sport: inferSport(row, ''),
      catalogSource: ownedSourceName(sourceName),
      aliases: clean(`${collectionPlayer}; ${readField(row, ['Set/Year'])}; ${readField(row, ['Card #'])}`),
    });
  }

  const title = readField(row, TITLE_FIELDS);
  if (!title || !/\b(19\d{2}|20\d{2})\b/.test(title)) return null;
  const year = Number(/\b(19\d{2}|20\d{2})\b/.exec(title)?.[1] || 0) || null;
  const brand = inferBrand(title);
  const set = inferSet(title, year, brand);
  const player = inferSubject(title) || title;
  return normalizeOwnedCatalogCard({
    year,
    brand,
    set,
    player,
    cardNumber: inferCardNumber(row, title),
    parallel: inferParallel(row, title),
    grade: inferGrade(row, title),
    sport: inferSport(row, title),
    externalId: readField(row, ['eBay Product ID(ePID)', 'Item number', 'Item Number']),
    catalogSource: ownedSourceName(sourceName),
    aliases: clean(title),
  });
}

export function extractOwnedChecklistCards(text, { sourceName = 'owned_export' } = {}) {
  const rows = parseOwnedCsv(text);
  const cards = [];
  const errors = [];
  for (const row of rows) {
    try {
      const card = rowToCatalogCard(row, { sourceName });
      if (card) cards.push(card);
    } catch (error) {
      errors.push({ row: row.__row || null, error: error.message });
    }
  }
  return dedupeCatalogCards(cards, { errors, sourceName });
}

export function dedupeCatalogCards(cards = [], extra = {}) {
  const byId = new Map();
  for (const card of cards) {
    if (!byId.has(card.id)) byId.set(card.id, card);
  }
  return {
    version: CHECKLIST_IMPORTER_VERSION,
    cards: [...byId.values()].sort((a, b) => (b.year || 0) - (a.year || 0) || String(a.player).localeCompare(String(b.player))),
    summary: {
      sourceName: extra.sourceName || 'owned_export',
      parsed: cards.length,
      unique: byId.size,
      errors: extra.errors?.length || 0,
    },
    errors: extra.errors || [],
  };
}

export function sourceNameFromFile(filePath) {
  return `owned_${path.basename(filePath).replace(/\.[^.]+$/, '')}`;
}
