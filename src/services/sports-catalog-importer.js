import { normalizeCatalogCard } from './catalog.js';
import { parseCsv } from './csv.js';

export const SPORTS_CATALOG_IMPORTER_VERSION = 'sports-catalog-importer-v1.0';

function clean(value, max = 500) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function parseYear(...values) {
  for (const value of values) {
    const year = /\b(19\d{2}|20\d{2})\b/.exec(String(value || ''))?.[1];
    if (year) return Number(year);
  }
  return null;
}

function first(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '') || '';
}

function sourceName(value) {
  return clean(value || 'sports_checklist_import', 140).replace(/[^A-Za-z0-9_. -]/g, '').trim() || 'sports_checklist_import';
}

function sportsCard(row = {}, source = 'sports_checklist_import') {
  const brand = first(row.brand, row.manufacturer, row.company, row['Brand']);
  const set = first(row.set, row.setName, row.product, row.release, row['Set']);
  const player = first(row.player, row.subject, row.name, row.athlete, row['Player'], row['Name']);
  const cardNumber = first(row.cardNumber, row.number, row.cardNo, row['Card Number'], row['Card #'], row['No.']);
  const parallel = first(row.parallel, row.variant, row.insert, row.subset, row.rarity, row['Parallel'], row['Insert']) || 'Base';
  return normalizeCatalogCard({
    id: row.id || row.cardId,
    externalId: row.externalId || row.uuid || row.checklistId,
    year: first(row.year, parseYear(row.releaseDate, row.date, set)),
    brand,
    set,
    player,
    team: first(row.team, row.club, row.franchise),
    cardNumber,
    parallel,
    serialNumber: first(row.serialNumber, row.numbered, row.printRun, row['Serial Number']),
    grade: { company: row.grader || row.gradeCompany || 'RAW', grade: row.grade || row.gradeValue || 'Raw' },
    sport: first(row.sport, row.category, row.league, row.game) || 'Sports Cards',
    image: first(row.image, row.imageUrl, row.imageURL, row.thumbnailUrl),
    aliases: [
      row.aliases,
      row.team,
      row.league,
      row.rookie ? 'rookie' : '',
      row.auto || row.autograph ? 'autograph' : '',
      row.relic || row.patch ? 'relic patch' : '',
      row.shortPrint || row.sp ? 'short print' : '',
    ].filter(Boolean).join('; '),
    catalogSource: sourceName(source),
  });
}

function dedupe(cards = [], errors = [], source = 'sports_checklist_import') {
  const byId = new Map();
  for (const card of cards) if (!byId.has(card.id)) byId.set(card.id, card);
  return {
    version: SPORTS_CATALOG_IMPORTER_VERSION,
    cards: [...byId.values()].sort((a, b) => (b.year || 0) - (a.year || 0) || String(a.set).localeCompare(String(b.set), undefined, { numeric: true }) || String(a.cardNumber).localeCompare(String(b.cardNumber), undefined, { numeric: true })),
    summary: { sourceName: sourceName(source), parsed: cards.length, unique: byId.size, errors: errors.length },
    errors,
  };
}

function parseJsonRecords(input) {
  const parsed = typeof input === 'string' ? JSON.parse(input) : input;
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.data)) return parsed.data;
  if (Array.isArray(parsed?.cards)) return parsed.cards;
  if (Array.isArray(parsed?.checklist)) return parsed.checklist;
  throw new Error('Sports checklist JSON must be an array or an object with data/cards/checklist array.');
}

export function importSportsChecklistRows(rows = [], { sourceName = 'sports_checklist_import' } = {}) {
  const cards = [];
  const errors = [];
  rows.forEach((row, index) => {
    try {
      const card = sportsCard(row, sourceName);
      if (card.player && card.cardNumber) cards.push(card);
    } catch (error) { errors.push({ row: row.__row || index + 1, error: error.message }); }
  });
  return dedupe(cards, errors, sourceName);
}

export function importSportsChecklistCsv(text, { sourceName = 'sports_checklist_import' } = {}) {
  return importSportsChecklistRows(parseCsv(text), { sourceName });
}

export function importSportsChecklistJson(input, { sourceName = 'sports_checklist_import' } = {}) {
  return importSportsChecklistRows(parseJsonRecords(input), { sourceName });
}
