import crypto from 'node:crypto';
import { cardSearchText, normalizeGrade } from './normalizer.js';
import { normalizeText } from './utils.js';

function tokens(value) {
  return normalizeText(value).split(' ').filter((token) => token.length >= 2);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function slug(value) {
  return normalizeText(value).replace(/\s+/g, '_').slice(0, 90);
}

function abbreviation(value = '') {
  return normalizeText(value)
    .split(' ')
    .filter((token) => token.length > 1 && !['and', 'the', 'of', 'for'].includes(token))
    .map((token) => token[0])
    .join('');
}

function searchAliases(card = {}) {
  const values = [
    abbreviation(card.brand),
    abbreviation(card.set),
    abbreviation(card.parallel),
    abbreviation(card.productName),
    abbreviation(card.productType),
  ];
  const normalizedSet = normalizeText(card.set);
  if (normalizedSet.includes('scarlet') && normalizedSet.includes('violet')) values.push('sv');
  if (normalizedSet.includes('magic the gathering')) values.push('mtg');
  if (normalizeText(card.sport).includes('magic')) values.push('mtg');
  if (normalizeText(card.sport).includes('pokemon')) values.push('pkmn', 'pokemon tcg');
  if (card.isSealedProduct || normalizeText(card.productType || card.sealedType).match(/pack|box|sealed|booster|blaster|hobby|retail|tin|etb/)) {
    values.push('sealed', 'wax', 'pack', 'box');
  }
  return unique(values);
}

export function makeCardId(card) {
  const core = [card.year, card.brand, card.set, card.player || card.productName, card.cardNumber, card.parallel, card.productType, card.configuration, card.grade?.company, card.grade?.grade]
    .filter(Boolean).join('|');
  const digest = crypto.createHash('sha1').update(core).digest('hex').slice(0, 10);
  return `card_${slug(card.player || card.productName || card.name || 'custom')}_${digest}`;
}

export function normalizeCatalogCard(raw) {
  const grade = normalizeGrade(raw.grade || { company: raw.grader || raw.gradeCompany, grade: raw.numericGrade || raw.gradeValue });
  const card = {
    id: String(raw.id || raw.cardId || '').trim(),
    year: raw.year === '' || raw.year === undefined || raw.year === null ? null : Number(raw.year),
    brand: String(raw.brand || raw.manufacturer || '').trim() || null,
    set: String(raw.set || raw.product || '').trim() || null,
    player: String(raw.player || raw.subject || raw.name || '').trim() || null,
    productName: String(raw.productName || raw.product || raw.name || '').trim() || null,
    productType: String(raw.productType || raw.sealedType || raw.itemType || '').trim() || null,
    sealedType: String(raw.sealedType || '').trim() || null,
    configuration: String(raw.configuration || raw.boxType || raw.packType || '').trim() || null,
    sku: String(raw.sku || raw.productId || '').trim() || null,
    upc: String(raw.upc || raw.barcode || raw.ean || '').trim() || null,
    isSealedProduct: Boolean(raw.isSealedProduct || raw.sealed || /pack|box|sealed|booster|blaster|hobby|retail|tin|elite trainer/i.test(`${raw.productType || ''} ${raw.sealedType || ''} ${raw.configuration || ''} ${raw.productName || ''} ${raw.name || ''}`)),
    team: String(raw.team || '').trim() || null,
    cardNumber: String(raw.cardNumber || raw.number || '').trim() || null,
    parallel: String(raw.parallel || raw.variant || 'Base').trim() || 'Base',
    serialNumber: String(raw.serialNumber || raw.numbered || '').trim() || null,
    grade,
    sport: String(raw.sport || raw.category || 'Other').trim() || 'Other',
    aliases: unique(String(raw.aliases || '').split(/[|;]/).map((item) => item.trim())),
    image: String(raw.image || raw.imageUrl || '/assets/card-placeholder.svg').trim(),
    externalId: String(raw.externalId || '').trim() || null,
    catalogSource: String(raw.catalogSource || raw.source || 'user_import').trim(),
  };
  if (!Number.isFinite(card.year)) card.year = null;
  if (!card.player && !card.set && !card.productName) throw new Error('Catalog row needs at least a player/name, product name, or set');
  if (!card.id) card.id = makeCardId(card);
  return card;
}

function exactFieldScore(query, card) {
  let score = 0;
  const normalized = normalizeText(query);
  if (card.player && normalized.includes(normalizeText(card.player))) score += 12;
  if (card.year && normalized.includes(String(card.year))) score += 5;
  if (card.cardNumber && normalized.includes(normalizeText(card.cardNumber))) score += 5;
  if (card.set && normalized.includes(normalizeText(card.set))) score += 5;
  if (card.brand && normalized.includes(normalizeText(card.brand))) score += 3;
  if (card.parallel && normalized.includes(normalizeText(card.parallel))) score += 4;
  if (card.productName && normalized.includes(normalizeText(card.productName))) score += 8;
  if (card.productType && normalized.includes(normalizeText(card.productType))) score += 4;
  if (card.configuration && normalized.includes(normalizeText(card.configuration))) score += 4;
  if (card.upc && normalized.includes(normalizeText(card.upc))) score += 6;
  if (card.sku && normalized.includes(normalizeText(card.sku))) score += 4;
  if (card.grade?.company && normalized.includes(normalizeText(card.grade.company))) score += 3;
  if (card.grade?.grade && normalized.includes(normalizeText(card.grade.grade))) score += 3;
  if (card.serialNumber && normalized.includes(normalizeText(card.serialNumber))) score += 4;
  for (const alias of searchAliases(card)) if (alias && normalized.includes(alias)) score += 2;
  return score;
}

function editDistanceWithin(left = '', right = '', maxDistance = 1) {
  if (!left || !right) return false;
  if (Math.abs(left.length - right.length) > maxDistance) return false;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let before = previous[0];
    previous[0] = i;
    let rowMin = previous[0];
    for (let j = 1; j <= right.length; j += 1) {
      const temp = previous[j];
      previous[j] = left[i - 1] === right[j - 1]
        ? before
        : Math.min(previous[j - 1], previous[j], before) + 1;
      before = temp;
      rowMin = Math.min(rowMin, previous[j]);
    }
    if (rowMin > maxDistance) return false;
  }
  return previous[right.length] <= maxDistance;
}

function fuzzyTokenHit(token, haystackTokens = []) {
  if (token.length < 4) return false;
  const maxDistance = token.length >= 8 ? 2 : 1;
  return haystackTokens.some((candidate) => candidate.startsWith(token) || token.startsWith(candidate) || editDistanceWithin(token, candidate, maxDistance));
}

export function rankCards(cards, query, { limit = 20, sport = '', gradeCompany = '', year = '' } = {}) {
  const normalizedQuery = normalizeText(query);
  const queryTokens = tokens(query);
  const filtered = cards.filter((card) => {
    if (sport && normalizeText(card.sport) !== normalizeText(sport)) return false;
    if (gradeCompany && normalizeText(card.grade?.company) !== normalizeText(gradeCompany)) return false;
    if (year && String(card.year) !== String(year)) return false;
    return true;
  });

  if (!normalizedQuery) return filtered.slice(0, limit).map((card) => ({ ...card, matchScore: 0, confidence: null }));

  return filtered.map((card) => {
    const haystack = normalizeText([cardSearchText(card), ...searchAliases(card)].join(' '));
    const haystackTokens = tokens(haystack);
    let score = exactFieldScore(normalizedQuery, card);
    let matchedTokenWeight = 0;
    let totalTokenWeight = 0;
    for (const token of queryTokens) {
      const weight = token.length >= 8 ? 3 : token.length >= 5 ? 2 : 1;
      totalTokenWeight += weight;
      if (haystack.includes(token)) {
        score += weight;
        matchedTokenWeight += weight;
      } else if (fuzzyTokenHit(token, haystackTokens)) {
        score += weight * 0.65;
        matchedTokenWeight += weight * 0.65;
      }
    }
    const coverage = totalTokenWeight ? matchedTokenWeight / totalTokenWeight : 0;
    score += coverage * 8;
    return { card, score, coverage };
  }).filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.coverage - a.coverage)
    .slice(0, limit)
    .map(({ card, score, coverage }, index) => ({
      ...card,
      matchScore: Math.round(score * 100) / 100,
      confidence: Math.max(0.2, Math.min(0.99, 0.28 + score * 0.025 + coverage * 0.32 - index * 0.025)),
    }));
}

export function smartMatchCard(cards, rowOrText) {
  const query = typeof rowOrText === 'string'
    ? rowOrText
    : [rowOrText.year, rowOrText.brand, rowOrText.set, rowOrText.player || rowOrText.name, rowOrText.cardNumber, rowOrText.parallel, rowOrText.grader, rowOrText.grade]
      .filter(Boolean).join(' ');
  const matches = rankCards(cards, query, { limit: 3 });
  const best = matches[0] || null;
  const second = matches[1] || null;
  const ambiguous = Boolean(best && second && (best.confidence - second.confidence) < 0.08);
  return {
    query,
    best,
    matches,
    ambiguous,
    accepted: Boolean(best && best.confidence >= 0.72 && !ambiguous),
  };
}
