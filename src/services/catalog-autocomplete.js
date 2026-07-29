import { rankCards, smartMatchCard } from './catalog.js';
import { normalizeText } from './utils.js';

export const CATALOG_AUTOCOMPLETE_VERSION = 'catalog-autocomplete-v1.0';

const DEFAULT_LIMIT = 12;

function clean(value, max = 240) {
  return String(value ?? '').trim().slice(0, max);
}

function key(value) {
  return normalizeText(value);
}

function uniqueSorted(values, limit = 50) {
  return [...new Set(values.filter((value) => value !== undefined && value !== null && String(value).trim() !== '').map((value) => String(value).trim()))]
    .sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' }))
    .slice(0, limit);
}

function matchesFilter(card, field, value) {
  if (value === undefined || value === null || value === '') return true;
  if (field === 'year') return String(card.year || '') === String(value);
  if (field === 'gradeCompany') return key(card.grade?.company) === key(value);
  if (field === 'grade') return key(card.grade?.grade) === key(value);
  return key(card[field]) === key(value);
}

function filterCards(cards = [], input = {}) {
  const q = key(input.q || input.query || '');
  return cards.filter((card) => {
    if (!matchesFilter(card, 'sport', input.sport)) return false;
    if (!matchesFilter(card, 'year', input.year)) return false;
    if (!matchesFilter(card, 'brand', input.brand)) return false;
    if (!matchesFilter(card, 'set', input.set)) return false;
    if (!matchesFilter(card, 'cardNumber', input.cardNumber)) return false;
    if (input.player && !key(card.player).includes(key(input.player))) return false;
    if (input.parallel && !key(card.parallel).includes(key(input.parallel))) return false;
    if (!q) return true;
    const haystack = key([
      card.year, card.brand, card.set, card.player, card.team, card.cardNumber,
      card.parallel, card.serialNumber, card.grade?.company, card.grade?.grade,
      card.sport, ...(card.aliases || []),
    ].filter(Boolean).join(' '));
    return haystack.includes(q) || q.split(' ').filter(Boolean).every((token) => haystack.includes(token));
  });
}

function explicitFilters(input = {}) {
  return {
    sport: input.sport,
    year: input.year,
    brand: input.brand,
    set: input.set,
    cardNumber: input.cardNumber,
    player: input.player,
    parallel: input.parallel,
  };
}

function suggestion(label, value, extra = {}) {
  return { label: clean(label), value: clean(value), ...extra };
}

function cardTitle(card) {
  return [card.year, card.brand, card.set, card.player, card.cardNumber ? `#${card.cardNumber}` : '', card.parallel, card.grade?.company, card.grade?.grade]
    .filter(Boolean).join(' ');
}

function lookupTitle(card) {
  return [card.year, card.brand, card.set, card.cardNumber ? `#${card.cardNumber}` : '', card.player].filter(Boolean).join(' ');
}

function publicCard(card) {
  return {
    id: card.id,
    title: cardTitle(card),
    year: card.year,
    brand: card.brand,
    set: card.set,
    player: card.player,
    team: card.team,
    cardNumber: card.cardNumber,
    parallel: card.parallel,
    serialNumber: card.serialNumber,
    sport: card.sport,
    grade: card.grade,
    image: card.image,
    catalogSource: card.catalogSource || 'bundled_catalog',
    confidence: card.confidence ?? null,
  };
}

function setKey(card) {
  return [card.sport || 'Other', card.year || 'Unknown', card.brand || 'Unknown', card.set || 'Unknown'].join('|');
}

export function buildCatalogIndex(cards = []) {
  const sets = new Map();
  for (const card of cards) {
    const id = setKey(card);
    if (!sets.has(id)) {
      sets.set(id, {
        id,
        sport: card.sport || 'Other',
        year: card.year || null,
        brand: card.brand || 'Unknown',
        set: card.set || 'Unknown',
        cardCount: 0,
        players: new Set(),
        cardNumbers: new Set(),
        parallels: new Set(),
        gradeCompanies: new Set(),
        sources: new Set(),
      });
    }
    const item = sets.get(id);
    item.cardCount += 1;
    if (card.player) item.players.add(card.player);
    if (card.cardNumber) item.cardNumbers.add(card.cardNumber);
    if (card.parallel) item.parallels.add(card.parallel);
    if (card.grade?.company) item.gradeCompanies.add(card.grade.company);
    item.sources.add(card.catalogSource || 'bundled_catalog');
  }
  return [...sets.values()].map((item) => ({
    ...item,
    players: uniqueSorted([...item.players], 10),
    cardNumbers: uniqueSorted([...item.cardNumbers], 30),
    parallels: uniqueSorted([...item.parallels], 20),
    gradeCompanies: uniqueSorted([...item.gradeCompanies], 10),
    sources: uniqueSorted([...item.sources], 10),
  })).sort((a, b) => (b.year || 0) - (a.year || 0) || a.brand.localeCompare(b.brand) || a.set.localeCompare(b.set));
}

export function catalogCoverage(cards = []) {
  const sets = buildCatalogIndex(cards);
  const sources = new Map();
  const sports = new Map();
  const games = new Map();
  const years = new Map();
  const imageReadyBySource = new Map();
  for (const card of cards) {
    const source = card.catalogSource || 'bundled_catalog';
    sources.set(source, (sources.get(source) || 0) + 1);
    sports.set(card.sport || 'Other', (sports.get(card.sport || 'Other') || 0) + 1);
    games.set(card.brand || card.sport || 'Other', (games.get(card.brand || card.sport || 'Other') || 0) + 1);
    years.set(String(card.year || 'Unknown'), (years.get(String(card.year || 'Unknown')) || 0) + 1);
    if (card.image && !String(card.image).includes('card-placeholder')) imageReadyBySource.set(source, (imageReadyBySource.get(source) || 0) + 1);
  }
  const countRows = (map) => [...map.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || String(a.label).localeCompare(String(b.label)));
  return {
    version: CATALOG_AUTOCOMPLETE_VERSION,
    cardCount: cards.length,
    setCount: sets.length,
    sportCount: uniqueSorted(cards.map((card) => card.sport)).length,
    sourceCounts: [...sources.entries()].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count),
    bySport: countRows(sports),
    byGame: countRows(games),
    byYear: countRows(years),
    largestSets: sets.slice().sort((a, b) => b.cardCount - a.cardCount).slice(0, 25).map((set) => ({
      sport: set.sport,
      year: set.year,
      brand: set.brand,
      set: set.set,
      cardCount: set.cardCount,
      parallelCount: set.parallels.length,
      samplePlayers: set.players.slice(0, 5),
    })),
    imageReadyBySource: countRows(imageReadyBySource),
    checklistDepth: {
      completeUniversalCatalog: false,
      loadedCatalogRows: cards.length,
      loadedSetRows: sets.length,
      message: 'Coverage reflects the catalog rows loaded into this ManeFlow instance. Import authorized sports, TCG, owner, or partner catalog data to expand autocomplete.',
    },
    limitation: 'Autocomplete uses the bundled starter catalog plus owner-imported or authorized catalog data. It is not a complete manufacturer checklist until those rows are loaded.',
  };
}

export function catalogAutocomplete(cards = [], input = {}) {
  const limit = Math.max(1, Math.min(50, Number(input.limit || DEFAULT_LIMIT)));
  const scoped = filterCards(cards, input);
  const ranked = key(input.q || input.query || '') ? rankCards(scoped, input.q || input.query, { limit }) : scoped.slice(0, limit).map((card) => ({ ...card, confidence: null }));
  const exactCard = completeManualEntry(cards, input).card;
  return {
    version: CATALOG_AUTOCOMPLETE_VERSION,
    query: clean(input.q || input.query || ''),
    filters: {
      sport: clean(input.sport),
      year: clean(input.year),
      brand: clean(input.brand),
      set: clean(input.set),
      cardNumber: clean(input.cardNumber),
      player: clean(input.player),
      parallel: clean(input.parallel),
    },
    coverage: catalogCoverage(cards),
    counts: {
      scopedCards: scoped.length,
      totalCards: cards.length,
    },
    suggestions: {
      sports: uniqueSorted(scoped.map((card) => card.sport), limit).map((value) => suggestion(value, value)),
      years: uniqueSorted(scoped.map((card) => card.year), limit).map((value) => suggestion(value, value)),
      brands: uniqueSorted(scoped.map((card) => card.brand), limit).map((value) => suggestion(value, value)),
      sets: buildCatalogIndex(scoped).slice(0, limit).map((set) => suggestion(`${set.year || ''} ${set.brand} ${set.set}`.trim(), set.set, set)),
      cardNumbers: uniqueSorted(scoped.map((card) => card.cardNumber), limit).map((value) => suggestion(`#${value}`, value)),
      players: uniqueSorted(scoped.map((card) => card.player), limit).map((value) => suggestion(value, value)),
      parallels: uniqueSorted(scoped.map((card) => card.parallel), limit).map((value) => suggestion(value, value)),
      gradeCompanies: uniqueSorted(scoped.map((card) => card.grade?.company), limit).map((value) => suggestion(value, value)),
    },
    likelyCards: ranked.slice(0, limit).map(publicCard),
    exactCard: exactCard ? publicCard(exactCard) : null,
    disclaimer: 'Set autocomplete depends on the catalog rows currently loaded into ManeFlow. Import authorized checklist/catalog CSVs to expand coverage.',
  };
}

export function smartCatalogAutocomplete(cards = [], input = {}) {
  const limit = Math.max(1, Math.min(25, Number(input.limit || 10)));
  const query = clean(input.q || input.query || input.text || '');
  const filters = explicitFilters(input);
  const scoped = filterCards(cards, filters);
  const hasUsefulInput = query.length >= 2 || Object.values(filters).some((value) => clean(value));
  const rawRanked = hasUsefulInput
    ? rankCards(scoped, query || [input.year, input.brand, input.set, input.cardNumber, input.player, input.parallel].filter(Boolean).join(' '), { limit })
    : [];
  const ranked = rawRanked.filter((card) => card.confidence === null || card.confidence >= 0.45);
  const top = ranked[0] || null;
  const second = ranked[1] || null;
  const ambiguous = Boolean(top && second && top.confidence !== null && second.confidence !== null && Math.abs(top.confidence - second.confidence) < 0.08);
  return {
    version: CATALOG_AUTOCOMPLETE_VERSION,
    mode: 'smart_catalog_autocomplete',
    query,
    status: !hasUsefulInput ? 'needs_input' : ranked.length ? (ambiguous ? 'ambiguous' : 'matched') : 'no_match',
    nextStep: !input.year ? 'year'
      : !input.set ? 'set'
        : !input.cardNumber ? 'card_number'
          : !input.parallel ? 'parallel_or_variant'
            : 'confirm_card',
    ambiguity: ambiguous ? {
      message: 'Multiple catalog rows are close. Confirm the exact set, card number, parallel, and grade before saving.',
      candidateIds: ranked.slice(0, 3).map((card) => card.id),
    } : null,
    candidates: ranked.slice(0, limit).map((card) => ({
      ...publicCard(card),
      lookupTitle: lookupTitle(card),
      autofill: {
        cardId: card.id,
        year: card.year || '',
        brand: card.brand || '',
        set: card.set || '',
        cardNumber: card.cardNumber || '',
        player: card.player || '',
        team: card.team || '',
        parallel: card.parallel || '',
        serialNumber: card.serialNumber || '',
        sport: card.sport || '',
      },
      matchReason: [
        card.year && query.includes(String(card.year)) ? 'year' : '',
        card.cardNumber && key(query).includes(key(card.cardNumber)) ? 'card number' : '',
        card.player && key(query).includes(key(card.player)) ? 'player' : '',
        card.set && key(query).includes(key(card.set)) ? 'set' : '',
        card.parallel && key(query).includes(key(card.parallel)) ? 'parallel' : '',
        card.serialNumber && key(query).includes(key(card.serialNumber)) ? 'serial number' : '',
      ].filter(Boolean),
    })),
    coverage: catalogCoverage(cards),
    disclaimer: 'Smart catalog lookup uses loaded catalog/checklist rows for inventory and collection logging. Import authorized manufacturer, shop-owned, or licensed checklist data for broader coverage.',
  };
}

export function submissionAutocomplete(cards = [], input = {}) {
  return {
    ...smartCatalogAutocomplete(cards, input),
    compatibilityAlias: 'submission-autocomplete',
  };
}

export function completeManualEntry(cards = [], input = {}) {
  const strict = filterCards(cards, {
    sport: input.sport,
    year: input.year,
    brand: input.brand,
    set: input.set,
    cardNumber: input.cardNumber,
    player: input.player,
    parallel: input.parallel,
  });
  const exact = strict.length === 1 ? strict[0] : null;
  const smart = exact ? { accepted: true, best: exact, matches: [exact], ambiguous: false, query: cardTitle(exact) } : smartMatchCard(cards, input);
  const best = exact || (smart.accepted ? smart.best : null);
  return {
    version: CATALOG_AUTOCOMPLETE_VERSION,
    accepted: Boolean(best),
    ambiguous: !best && Boolean(smart.ambiguous),
    card: best || null,
    publicCard: best ? publicCard(best) : null,
    matches: (smart.matches || strict).slice(0, 7).map(publicCard),
    autopopulate: best ? {
      cardId: best.id,
      name: cardTitle(best),
      sport: best.sport || '',
      year: best.year || '',
      brand: best.brand || '',
      set: best.set || '',
      player: best.player || '',
      team: best.team || '',
      cardNumber: best.cardNumber || '',
      parallel: best.parallel || '',
      serialNumber: best.serialNumber || '',
      gradeCompany: best.grade?.company || '',
      grade: best.grade?.grade || '',
      image: best.image || '',
    } : {
      cardId: '',
      name: [input.year, input.brand, input.set, input.player || input.name, input.cardNumber ? `#${input.cardNumber}` : '', input.parallel].filter(Boolean).join(' '),
      sport: clean(input.sport),
      year: clean(input.year),
      brand: clean(input.brand),
      set: clean(input.set),
      player: clean(input.player || input.name),
      cardNumber: clean(input.cardNumber),
      parallel: clean(input.parallel),
      serialNumber: clean(input.serialNumber),
      gradeCompany: clean(input.gradeCompany || input.grader),
      grade: clean(input.grade),
    },
    message: best
      ? 'Catalog row found. ManeFlow can auto-fill this card for Vault or shop inventory.'
      : 'No exact catalog row found. Save as unmatched or import authorized checklist data to enable full auto-fill.',
  };
}
