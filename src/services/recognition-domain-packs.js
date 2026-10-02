import { normalizeText } from './utils.js';

export const RECOGNITION_DOMAIN_PACK_VERSION = 'recognition-domain-pack-v1.0';

export const RECOGNITION_DOMAIN_PACKS = Object.freeze({
  sports: Object.freeze({
    id: 'sports',
    label: 'Sports cards',
    ocrHints: ['player', 'team', 'year', 'set', 'card number', 'parallel', 'serial number'],
    catalogFamilies: ['sports_checklist_import', 'Topps', 'Panini', 'Upper Deck', 'Bowman', 'Leaf'],
  }),
  pokemon: Object.freeze({
    id: 'pokemon',
    label: 'Pokemon TCG',
    ocrHints: ['card name', 'set', 'collector number', 'rarity', 'finish', 'language'],
    catalogFamilies: ['Pokemon TCG API', 'TCGdex API'],
  }),
  magic: Object.freeze({
    id: 'magic',
    label: 'Magic: The Gathering',
    ocrHints: ['card name', 'set', 'collector number', 'rarity', 'finish', 'language'],
    catalogFamilies: ['Scryfall Bulk Data'],
  }),
  yugioh: Object.freeze({
    id: 'yugioh',
    label: 'Yu-Gi-Oh!',
    ocrHints: ['card name', 'set code', 'rarity', 'edition', 'language'],
    catalogFamilies: ['YGOPRODeck API'],
  }),
  lorcana: Object.freeze({
    id: 'lorcana',
    label: 'Disney Lorcana',
    ocrHints: ['card name', 'set', 'collector number', 'rarity', 'classification'],
    catalogFamilies: ['Lorcast API'],
  }),
});

const DOMAIN_PATTERNS = Object.freeze({
  pokemon: /\b(pokemon|pokémon|tcgdex|pikachu|charizard|trainer gallery)\b/i,
  magic: /\b(magic(?:\s*:\s*|\s+)the gathering|mtg|scryfall)\b/i,
  yugioh: /\b(yu[ -]?gi[ -]?oh|yugioh|ygoprodeck)\b/i,
  lorcana: /\b(lorcana|disney lorcana|lorcast)\b/i,
  sports: /\b(baseball|basketball|football|hockey|soccer|mlb|nba|nfl|nhl|wnba|panini prizm|bowman chrome|topps chrome|upper deck)\b/i,
});

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function valuesFromFacts(facts = {}) {
  if (!facts || typeof facts !== 'object') return [];
  const grade = facts.grade && typeof facts.grade === 'object' ? facts.grade : {};
  return [
    facts.sport,
    facts.category,
    facts.game,
    facts.brand,
    facts.manufacturer,
    facts.set,
    facts.setName,
    facts.player,
    facts.subject,
    facts.productName,
    facts.productType,
    facts.configuration,
    facts.catalogSource,
    facts.provider,
    grade.company,
  ].filter(Boolean);
}

function observedEvidenceText({ body = {}, sceneAnalysis = null, vision = null } = {}) {
  const values = [];
  values.push(...valuesFromFacts(body.identityFacts || body.structuredFacts || {}));
  values.push(body.manualText, body.ocrText, body.certText, body.sceneHint, body.sceneType);
  const regions = safeArray(sceneAnalysis?.detectedCards);
  for (const region of regions) {
    values.push(...valuesFromFacts(region.facts || region));
    values.push(...safeArray(region.facts?.visibleText));
  }
  const primary = vision || sceneAnalysis?.primaryCard;
  if (primary) {
    values.push(...valuesFromFacts(primary.facts || primary));
    values.push(...safeArray(primary.facts?.visibleText));
  }
  return values.filter(Boolean).join(' ');
}

function cardDomain(card = {}) {
  const text = [
    card.sport,
    card.brand,
    card.set,
    card.player,
    card.productName,
    card.catalogSource,
    ...(Array.isArray(card.aliases) ? card.aliases : []),
  ].filter(Boolean).join(' ');
  if (DOMAIN_PATTERNS.pokemon.test(text)) return 'pokemon';
  if (DOMAIN_PATTERNS.magic.test(text)) return 'magic';
  if (DOMAIN_PATTERNS.yugioh.test(text)) return 'yugioh';
  if (DOMAIN_PATTERNS.lorcana.test(text)) return 'lorcana';

  const normalizedSport = normalizeText(card.sport || '');
  if (
    DOMAIN_PATTERNS.sports.test(text)
    || ['sports cards', 'baseball', 'basketball', 'football', 'hockey', 'soccer'].includes(normalizedSport)
  ) return 'sports';
  return 'unknown';
}

export function inferRecognitionDomain(input = {}) {
  const text = observedEvidenceText(input);
  const matches = Object.entries(DOMAIN_PATTERNS)
    .filter(([, pattern]) => pattern.test(text))
    .map(([domain]) => domain);

  if (matches.length !== 1) {
    return {
      domain: 'unknown',
      confidence: matches.length ? 0 : null,
      reason: matches.length ? 'conflicting_observed_domain_evidence' : 'insufficient_observed_domain_evidence',
      observedDomains: matches,
    };
  }
  return {
    domain: matches[0],
    confidence: 1,
    reason: 'observed_domain_evidence',
    observedDomains: matches,
  };
}

function intersectAllowedIds(existingScope = {}, eligibleIds = []) {
  const eligible = new Set(eligibleIds.map(String));
  const current = Array.isArray(existingScope.allowedCardIds)
    ? existingScope.allowedCardIds.map(String)
    : Array.isArray(existingScope.cardIds)
      ? existingScope.cardIds.map(String)
      : null;
  const allowedCardIds = current ? current.filter((id) => eligible.has(id)) : [...eligible];
  const result = { ...existingScope, allowedCardIds };
  delete result.cardIds;
  return result;
}

export function resolveRecognitionDomainPack({
  cards = [],
  body = {},
  sceneAnalysis = null,
  vision = null,
  candidateScope = null,
} = {}) {
  const inferred = inferRecognitionDomain({ body, sceneAnalysis, vision });
  if (inferred.domain === 'unknown') {
    return {
      version: RECOGNITION_DOMAIN_PACK_VERSION,
      ...inferred,
      pack: null,
      eligibleCardCount: null,
      candidateScope: candidateScope || null,
      scoped: false,
    };
  }

  const eligibleIds = safeArray(cards)
    .filter((card) => cardDomain(card) === inferred.domain)
    .map((card) => String(card.id || ''))
    .filter(Boolean);
  const scope = intersectAllowedIds(candidateScope || {}, eligibleIds);
  return {
    version: RECOGNITION_DOMAIN_PACK_VERSION,
    ...inferred,
    pack: RECOGNITION_DOMAIN_PACKS[inferred.domain],
    eligibleCardCount: eligibleIds.length,
    candidateScope: scope,
    scoped: true,
  };
}
