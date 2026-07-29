import { normalizeCatalogCard } from './catalog.js';
import { parseCsv } from './csv.js';
import { normalizeText } from './utils.js';

export const TCG_CATALOG_IMPORTER_VERSION = 'tcg-catalog-importer-v1.0';

function clean(value, max = 500) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function yearFromDate(value) {
  return Number(/\b(19\d{2}|20\d{2})\b/.exec(String(value || ''))?.[1] || 0) || null;
}

function arrayText(value) {
  return Array.isArray(value) ? value.filter(Boolean).join(' ') : clean(value);
}

function rarityToParallel(...values) {
  const text = clean(values.filter(Boolean).join(' '), 240);
  return text || 'Base';
}

function firstImageUri(...values) {
  for (const value of values) {
    if (!value) continue;
    if (typeof value === 'string') return value;
    if (value.image_url_small || value.image_url || value.image_url_cropped) return value.image_url_small || value.image_url || value.image_url_cropped;
    if (value.small || value.normal || value.large) return value.small || value.normal || value.large;
    if (value.digital || value.physical) {
      const face = value.digital || value.physical;
      if (face.small || face.normal || face.large) return face.small || face.normal || face.large;
    }
  }
  return '';
}

function catalogSource(sourceName, fallback) {
  return clean(sourceName || fallback, 140).replace(/[^A-Za-z0-9_. -]/g, '').trim() || fallback;
}

function dedupe(cards = [], errors = [], sourceName = 'tcg_catalog_import') {
  const byId = new Map();
  for (const card of cards) if (!byId.has(card.id)) byId.set(card.id, card);
  return {
    version: TCG_CATALOG_IMPORTER_VERSION,
    cards: [...byId.values()].sort((a, b) => (b.year || 0) - (a.year || 0) || String(a.set).localeCompare(String(b.set), undefined, { numeric: true }) || String(a.cardNumber).localeCompare(String(b.cardNumber), undefined, { numeric: true })),
    summary: { sourceName, parsed: cards.length, unique: byId.size, errors: errors.length },
    errors,
  };
}

function pokemonCard(raw = {}, sourceName = 'Pokemon TCG API') {
  const set = raw.set || {};
  const series = clean(set.series || raw.series);
  const setName = clean(set.name || raw.setName || raw.set);
  return normalizeCatalogCard({
    externalId: raw.id,
    year: yearFromDate(set.releaseDate || raw.releaseDate),
    brand: 'Pokemon',
    set: [series, setName].filter(Boolean).join(' - ') || setName || 'Pokemon TCG',
    player: raw.name || raw.cardName,
    cardNumber: raw.number || raw.cardNumber || raw.collectorNumber,
    parallel: rarityToParallel(raw.rarity, arrayText(raw.subtypes), raw.supertype),
    sport: 'Pokemon',
    image: raw.images?.small || raw.image || raw.imageUrl,
    catalogSource: catalogSource(sourceName, 'Pokemon TCG API'),
    aliases: [
      raw.name,
      set.id,
      set.ptcgoCode,
      setName,
      series,
      raw.rarity,
      arrayText(raw.subtypes),
      arrayText(raw.types),
      raw.number,
    ].filter(Boolean).join('; '),
  });
}

function scryfallCard(raw = {}, sourceName = 'Scryfall Bulk Data') {
  const finishes = Array.isArray(raw.finishes) ? raw.finishes.join('/') : '';
  const frameEffects = Array.isArray(raw.frame_effects) ? raw.frame_effects.join(' ') : '';
  return normalizeCatalogCard({
    externalId: raw.id,
    year: yearFromDate(raw.released_at),
    brand: 'Magic: The Gathering',
    set: raw.set_name || raw.set || 'Magic: The Gathering',
    player: raw.name,
    cardNumber: raw.collector_number,
    parallel: rarityToParallel(raw.rarity, finishes, frameEffects),
    sport: 'Magic: The Gathering',
    image: firstImageUri(raw.image_uris, raw.card_faces?.[0]?.image_uris, raw.image),
    catalogSource: catalogSource(sourceName, 'Scryfall Bulk Data'),
    aliases: [
      raw.name,
      raw.set,
      raw.set_name,
      raw.lang,
      raw.collector_number,
      raw.rarity,
      finishes,
      frameEffects,
      raw.type_line,
    ].filter(Boolean).join('; '),
  });
}

function lorcastCard(raw = {}, sourceName = 'Lorcast API') {
  const set = raw.set || raw.card_set || {};
  const classifications = Array.isArray(raw.classifications) ? raw.classifications.join(' ') : '';
  const colors = Array.isArray(raw.colors) ? raw.colors.join('/') : '';
  return normalizeCatalogCard({
    externalId: raw.id,
    year: raw.year || yearFromDate(set.released_at || set.release_date || raw.released_at || raw.release_date),
    brand: 'Disney Lorcana',
    set: raw.set_name || set.name || raw.set || 'Disney Lorcana',
    player: raw.name || raw.full_name,
    cardNumber: raw.collector_number || raw.number || raw.cardNumber,
    parallel: rarityToParallel(raw.rarity, raw.finish, classifications, colors),
    sport: 'Disney Lorcana',
    image: firstImageUri(raw.image_uris, raw.images, raw.image),
    catalogSource: catalogSource(sourceName, 'Lorcast API'),
    aliases: [
      raw.name,
      raw.full_name,
      raw.version,
      raw.rarity,
      raw.collector_number,
      raw.number,
      set.code,
      set.name,
      classifications,
      colors,
    ].filter(Boolean).join('; '),
  });
}

function tcgdexCard(raw = {}, sourceName = 'TCGdex API') {
  const set = raw.set || raw.setObj || {};
  const variants = raw.variants && typeof raw.variants === 'object'
    ? Object.entries(raw.variants).filter(([, enabled]) => Boolean(enabled)).map(([name]) => name).join(' ')
    : '';
  return normalizeCatalogCard({
    externalId: raw.id,
    year: raw.year || yearFromDate(set.releaseDate || set.release_date || raw.releaseDate),
    brand: 'Pokemon',
    set: clean(raw.setName || set.name || raw.set || 'Pokemon TCG'),
    player: raw.name || raw.cardName,
    cardNumber: raw.localId || raw.number || raw.cardNumber || raw.collectorNumber,
    parallel: rarityToParallel(raw.rarity, raw.category, variants),
    sport: 'Pokemon',
    image: firstImageUri(raw.image, raw.images),
    catalogSource: catalogSource(sourceName, 'TCGdex API'),
    aliases: [
      raw.name,
      raw.id,
      raw.localId,
      set.id,
      set.name,
      raw.category,
      raw.rarity,
      raw.illustrator,
      variants,
      arrayText(raw.types),
    ].filter(Boolean).join('; '),
  });
}

function ygoPrintRows(raw = {}, sourceName = 'YGOPRODeck API') {
  const prints = Array.isArray(raw.card_sets) && raw.card_sets.length ? raw.card_sets : [null];
  return prints.map((cardSet, index) => normalizeCatalogCard({
    id: `card_ygo_${clean(raw.id || raw.name, 90).replace(/[^A-Za-z0-9_-]/g, '_')}_${clean(cardSet?.set_code || cardSet?.set_name || index, 90).replace(/[^A-Za-z0-9_-]/g, '_')}`,
    externalId: raw.id,
    brand: 'Yu-Gi-Oh!',
    set: cardSet?.set_name || raw.set_name || raw.archetype || 'Yu-Gi-Oh!',
    player: raw.name,
    cardNumber: cardSet?.set_code || raw.cardNumber || raw.id,
    parallel: rarityToParallel(cardSet?.set_rarity, cardSet?.set_rarity_code, raw.race, raw.attribute),
    sport: 'Yu-Gi-Oh!',
    image: firstImageUri(raw.card_images?.[0], raw.image),
    catalogSource: catalogSource(sourceName, 'YGOPRODeck API'),
    aliases: [
      raw.name,
      raw.type,
      raw.frameType,
      raw.race,
      raw.attribute,
      raw.archetype,
      raw.desc,
      cardSet?.set_name,
      cardSet?.set_code,
      cardSet?.set_rarity,
    ].filter(Boolean).join('; '),
  }));
}

function genericTcgCard(row = {}, sourceName = 'tcg_catalog_import') {
  return normalizeCatalogCard({
    externalId: row.id || row.externalId || row.uuid,
    year: row.year || yearFromDate(row.releaseDate || row.released_at),
    brand: row.brand || row.game || row.manufacturer || row.tcg,
    set: row.set || row.setName || row.expansion || row.product,
    player: row.name || row.cardName || row.player || row.subject,
    cardNumber: row.cardNumber || row.number || row.collectorNumber || row['Card Number'] || row['Card #'],
    parallel: row.parallel || row.variant || row.rarity || row.finish || 'Base',
    serialNumber: row.serialNumber || row.numbered,
    sport: row.sport || row.category || row.game || row.tcg || 'Trading Card Game',
    image: firstImageUri(row.image || row.imageUrl || row.smallImage, row.image_uris, row.images),
    catalogSource: catalogSource(sourceName, 'tcg_catalog_import'),
    aliases: Object.values(row).filter(Boolean).join('; '),
  });
}

function parseJsonRecords(input) {
  const parsed = typeof input === 'string' ? JSON.parse(input) : input;
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.data)) return parsed.data;
  if (Array.isArray(parsed?.cards)) return parsed.cards;
  throw new Error('TCG catalog JSON must be an array or an object with data/cards array.');
}

export function importPokemonTcgApiCatalog(input, { sourceName = 'Pokemon TCG API' } = {}) {
  const records = parseJsonRecords(input);
  const cards = [];
  const errors = [];
  records.forEach((record, index) => {
    try { cards.push(pokemonCard(record, sourceName)); }
    catch (error) { errors.push({ row: index + 1, error: error.message }); }
  });
  return dedupe(cards, errors, sourceName);
}

export function importScryfallCatalog(input, { sourceName = 'Scryfall Bulk Data' } = {}) {
  const records = parseJsonRecords(input);
  const cards = [];
  const errors = [];
  records.forEach((record, index) => {
    try { cards.push(scryfallCard(record, sourceName)); }
    catch (error) { errors.push({ row: index + 1, error: error.message }); }
  });
  return dedupe(cards, errors, sourceName);
}

export function importLorcastCatalog(input, { sourceName = 'Lorcast API' } = {}) {
  const records = parseJsonRecords(input);
  const cards = [];
  const errors = [];
  records.forEach((record, index) => {
    try { cards.push(lorcastCard(record, sourceName)); }
    catch (error) { errors.push({ row: index + 1, error: error.message }); }
  });
  return dedupe(cards, errors, sourceName);
}

export function importTcgDexCatalog(input, { sourceName = 'TCGdex API' } = {}) {
  const records = parseJsonRecords(input);
  const cards = [];
  const errors = [];
  records.forEach((record, index) => {
    try { cards.push(tcgdexCard(record, sourceName)); }
    catch (error) { errors.push({ row: index + 1, error: error.message }); }
  });
  return dedupe(cards, errors, sourceName);
}

export function importYgoProDeckCatalog(input, { sourceName = 'YGOPRODeck API' } = {}) {
  const records = parseJsonRecords(input);
  const cards = [];
  const errors = [];
  records.forEach((record, index) => {
    try { cards.push(...ygoPrintRows(record, sourceName)); }
    catch (error) { errors.push({ row: index + 1, error: error.message }); }
  });
  return dedupe(cards, errors, sourceName);
}

export function importGenericTcgCatalogCsv(text, { sourceName = 'tcg_catalog_import' } = {}) {
  const rows = parseCsv(text);
  const cards = [];
  const errors = [];
  rows.forEach((row, index) => {
    try {
      const card = genericTcgCard(row, sourceName);
      if (card.player && card.cardNumber) cards.push(card);
    } catch (error) { errors.push({ row: row.__row || index + 1, error: error.message }); }
  });
  return dedupe(cards, errors, sourceName);
}

export function importTcgCatalog(input, { format = 'generic-csv', sourceName = '' } = {}) {
  const key = normalizeText(format).replace(/\s+/g, '-');
  if (key === 'pokemon-tcg-api' || key === 'pokemon') return importPokemonTcgApiCatalog(input, { sourceName: sourceName || 'Pokemon TCG API' });
  if (key === 'tcgdex' || key === 'tcgdex-api' || key === 'pokemon-tcgdex') return importTcgDexCatalog(input, { sourceName: sourceName || 'TCGdex API' });
  if (key === 'scryfall-bulk' || key === 'scryfall' || key === 'magic') return importScryfallCatalog(input, { sourceName: sourceName || 'Scryfall Bulk Data' });
  if (key === 'ygoprodeck' || key === 'ygoprodeck-api' || key === 'yugioh' || key === 'yu-gi-oh') return importYgoProDeckCatalog(input, { sourceName: sourceName || 'YGOPRODeck API' });
  if (key === 'lorcast' || key === 'lorcana' || key === 'lorcast-api') return importLorcastCatalog(input, { sourceName: sourceName || 'Lorcast API' });
  if (key === 'generic-csv' || key === 'tcg-csv') return importGenericTcgCatalogCsv(input, { sourceName: sourceName || 'tcg_catalog_import' });
  throw new Error(`Unsupported TCG catalog format: ${format}`);
}
