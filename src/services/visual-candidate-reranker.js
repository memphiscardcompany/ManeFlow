import { clamp, normalizeText } from './utils.js';

const DEFAULT_THRESHOLDS = Object.freeze({
  exactScore: 0.88,
  exactMargin: 0.07,
  likelyScore: 0.72,
  likelyMargin: 0.035,
});

const FIELD_WEIGHTS = Object.freeze({
  subjectName: 0.08,
  releaseYear: 0.08,
  sportOrGame: 0.04,
  manufacturerOrBrand: 0.06,
  setCode: 0.12,
  setName: 0.10,
  cardNumber: 0.18,
  parallelName: 0.08,
  languageCode: 0.03,
});

const HARD_CONFLICT_FIELDS = new Set(['cardNumber', 'setCode', 'releaseYear', 'languageCode']);

function finiteScore(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? clamp(number, 0, 1) : fallback;
}

function optionalString(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function normalizeExact(value) {
  return normalizeText(value).replaceAll(' ', '');
}

export function normalizeCardNumber(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/^CARD\s*(?:NO\.?|NUMBER)?\s*/i, '')
    .replace(/^#/, '')
    .replace(/[^A-Z0-9]/g, '');
}

function tokenSet(value) {
  return new Set(normalizeText(value).split(' ').filter(Boolean));
}

function tokenSimilarity(left, right) {
  const a = tokenSet(left);
  const b = tokenSet(right);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 0;
}

function scalarSimilarity(expected, actual, { exact = false, numeric = false } = {}) {
  if (expected === null || expected === undefined || expected === '') return null;
  if (actual === null || actual === undefined || actual === '') return 0;
  if (numeric) return Number(expected) === Number(actual) ? 1 : 0;
  if (exact) return normalizeExact(expected) === normalizeExact(actual) ? 1 : 0;
  const left = normalizeText(expected);
  const right = normalizeText(actual);
  if (!left || !right) return 0;
  if (left === right) return 1;
  return tokenSimilarity(left, right);
}

function evidenceFieldConfidence(evidence, key, fallback = 0.65) {
  const direct = evidence?.fieldConfidence?.[key];
  if (direct !== undefined && Number.isFinite(Number(direct))) return finiteScore(direct, fallback);
  const alternate = evidence?.confidence?.[key];
  if (alternate !== undefined && Number.isFinite(Number(alternate))) return finiteScore(alternate, fallback);
  return fallback;
}

function canonicalEvidence(input = {}) {
  const facts = input.facts && typeof input.facts === 'object' ? input.facts : input;
  return {
    subjectName: optionalString(facts.subjectName ?? facts.subject_name ?? facts.playerName ?? facts.player_name ?? facts.player),
    releaseYear: Number.isInteger(Number(facts.releaseYear ?? facts.release_year ?? facts.year))
      ? Number(facts.releaseYear ?? facts.release_year ?? facts.year)
      : null,
    sportOrGame: optionalString(facts.sportOrGame ?? facts.sport_or_game ?? facts.sport ?? facts.game),
    manufacturerOrBrand: optionalString(
      facts.manufacturer ?? facts.brand ?? facts.publisher ?? facts.company,
    ),
    setCode: optionalString(facts.setCode ?? facts.set_code),
    setName: optionalString(facts.setName ?? facts.set_name ?? facts.set),
    cardNumber: optionalString(facts.cardNumber ?? facts.card_number),
    parallelName: optionalString(facts.parallelName ?? facts.parallel_name ?? facts.parallel ?? facts.variant),
    languageCode: optionalString(facts.languageCode ?? facts.language_code ?? facts.language),
    fieldConfidence: input.fieldConfidence ?? input.field_confidence ?? {},
  };
}

function candidateValue(candidate, key) {
  if (key === 'manufacturerOrBrand') return candidate.brand || candidate.manufacturer;
  return candidate[key];
}

function compareField(key, evidence, candidate) {
  const expected = evidence[key];
  if (expected === null || expected === undefined || expected === '') return null;
  const actual = candidateValue(candidate, key);
  const confidence = evidenceFieldConfidence(evidence, key, key === 'cardNumber' ? 0.78 : 0.65);
  let similarity;
  if (key === 'cardNumber') {
    const expectedNumber = normalizeCardNumber(expected);
    const actualNumber = normalizeCardNumber(actual);
    similarity = expectedNumber && actualNumber && expectedNumber === actualNumber ? 1 : 0;
  } else if (key === 'releaseYear') {
    similarity = scalarSimilarity(expected, actual, { numeric: true });
  } else if (key === 'setCode' || key === 'languageCode') {
    similarity = scalarSimilarity(expected, actual, { exact: true });
  } else {
    similarity = scalarSimilarity(expected, actual);
  }
  const matched = similarity >= (key === 'setName' || key === 'manufacturerOrBrand' ? 0.72 : 0.999);
  const hardConflict = HARD_CONFLICT_FIELDS.has(key) && confidence >= 0.75 && !matched;
  return {
    field: key,
    expected,
    actual: actual ?? null,
    confidence: round(confidence),
    similarity: round(similarity),
    matched,
    hardConflict,
  };
}

function fieldAdjustment(comparison) {
  const weight = FIELD_WEIGHTS[comparison.field] ?? 0;
  if (comparison.matched) return weight * comparison.confidence;
  const mismatchMultiplier = comparison.hardConflict ? 1.65 : 0.75;
  return -weight * comparison.confidence * mismatchMultiplier;
}

function normalizedCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object') throw new TypeError('Each visual candidate must be an object.');
  const vectorScore = finiteScore(
    candidate.combinedCosineSimilarity ?? candidate.cosineSimilarity ?? candidate.cosine_similarity,
  );
  return {
    ...candidate,
    cosineSimilarity: vectorScore,
    combinedCosineSimilarity: vectorScore,
    frontCosineSimilarity: candidate.frontCosineSimilarity == null
      ? null
      : finiteScore(candidate.frontCosineSimilarity),
    backCosineSimilarity: candidate.backCosineSimilarity == null
      ? null
      : finiteScore(candidate.backCosineSimilarity),
    viewAgreement: finiteScore(candidate.viewAgreement, 0),
  };
}

function rankCandidate(candidate, evidence) {
  const normalized = normalizedCandidate(candidate);
  const comparisons = Object.keys(FIELD_WEIGHTS)
    .map((key) => compareField(key, evidence, normalized))
    .filter(Boolean);
  const metadataAdjustment = comparisons.reduce((sum, comparison) => sum + fieldAdjustment(comparison), 0);
  const frontBackBonus = normalized.frontCosineSimilarity !== null && normalized.backCosineSimilarity !== null
    ? (0.035 * normalized.viewAgreement)
    : 0;
  const score = clamp(normalized.cosineSimilarity + metadataAdjustment + frontBackBonus, 0, 1);
  const hardConflicts = comparisons.filter((item) => item.hardConflict).map((item) => item.field);
  const matchedFields = comparisons.filter((item) => item.matched).map((item) => item.field);
  const contradictedFields = comparisons.filter((item) => !item.matched).map((item) => item.field);
  return {
    ...normalized,
    rerankScore: round(score),
    vectorScore: round(normalized.cosineSimilarity),
    metadataAdjustment: round(metadataAdjustment),
    frontBackBonus: round(frontBackBonus),
    matchedFields,
    contradictedFields,
    hardConflicts,
    evidenceTrace: comparisons,
  };
}

function matchesHardConstraints(candidate, constraints = {}) {
  if (!constraints || typeof constraints !== 'object') return true;
  if (constraints.releaseYear != null && Number(candidate.releaseYear) !== Number(constraints.releaseYear)) return false;
  if (constraints.sportOrGame && normalizeText(candidate.sportOrGame) !== normalizeText(constraints.sportOrGame)) return false;
  if (constraints.setCode && normalizeExact(candidate.setCode) !== normalizeExact(constraints.setCode)) return false;
  if (constraints.setName && normalizeExact(candidate.setName) !== normalizeExact(constraints.setName)) return false;
  if (constraints.cardNumber && normalizeCardNumber(candidate.cardNumber) !== normalizeCardNumber(constraints.cardNumber)) return false;
  if (constraints.languageCode && normalizeExact(candidate.languageCode) !== normalizeExact(constraints.languageCode)) return false;
  return true;
}

function evidenceStrength(evidence) {
  const strongKeys = ['cardNumber', 'setCode', 'setName', 'releaseYear', 'subjectName'];
  let total = 0;
  for (const key of strongKeys) {
    if (evidence[key] === null || evidence[key] === undefined || evidence[key] === '') continue;
    total += evidenceFieldConfidence(evidence, key, 0.65);
  }
  return clamp(total / 2.5, 0, 1);
}

function round(value) {
  return Math.round(Number(value) * 1_000_000) / 1_000_000;
}

function normalizedFamilyPart(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, ' ').trim();
}

function cardFamilyKey(candidate = {}) {
  const parts = [
    candidate.releaseYear,
    candidate.brand || candidate.manufacturer,
    candidate.setCode || candidate.setName,
    normalizeCardNumber(candidate.cardNumber),
    candidate.subjectName,
    candidate.languageCode,
  ].map(normalizedFamilyPart);
  return parts.join('|');
}

function normalizedVariantName(candidate = {}) {
  return normalizedFamilyPart(candidate.parallelName || candidate.parallel || candidate.variant || 'base') || 'base';
}

function classifyIdentityDecision({ ranked, top, runnerUp, status, margin, thresholds }) {
  if (!top || top.rerankScore < thresholds.likelyScore) {
    return {
      identityLevel: 'unknown',
      variantAmbiguous: false,
      outOfCatalog: true,
      decisionReason: top ? 'top_candidate_below_likely_threshold' : 'no_catalog_candidates',
    };
  }

  const sameFamily = Boolean(
    runnerUp
    && cardFamilyKey(top)
    && cardFamilyKey(top) === cardFamilyKey(runnerUp),
  );
  const differentVariant = Boolean(
    sameFamily
    && normalizedVariantName(top) !== normalizedVariantName(runnerUp),
  );
  const variantAmbiguous = Boolean(
    differentVariant
    && margin < thresholds.exactMargin
  );

  if (status === 'exact' && !variantAmbiguous) {
    return {
      identityLevel: 'exact_variant',
      variantAmbiguous: false,
      outOfCatalog: false,
      decisionReason: 'exact_thresholds_and_corroboration_satisfied',
    };
  }
  if (variantAmbiguous) {
    return {
      identityLevel: 'card_family',
      variantAmbiguous: true,
      outOfCatalog: false,
      decisionReason: 'same_card_family_but_parallel_or_variant_is_ambiguous',
    };
  }
  return {
    identityLevel: 'candidate',
    variantAmbiguous: false,
    outOfCatalog: false,
    decisionReason: status === 'likely'
      ? 'likely_candidate_requires_confirmation'
      : 'candidate_evidence_is_insufficient_or_conflicted',
  };
}

export function rerankVisualCandidates({
  candidates,
  evidence = {},
  constraints = {},
  thresholds = {},
  limit = 10,
} = {}) {
  if (!Array.isArray(candidates)) throw new TypeError('candidates must be an array.');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError('limit must be an integer between 1 and 100.');
  }
  const normalizedEvidence = canonicalEvidence(evidence);
  const resolvedThresholds = {
    exactScore: finiteScore(thresholds.exactScore, DEFAULT_THRESHOLDS.exactScore),
    exactMargin: finiteScore(thresholds.exactMargin, DEFAULT_THRESHOLDS.exactMargin),
    likelyScore: finiteScore(thresholds.likelyScore, DEFAULT_THRESHOLDS.likelyScore),
    likelyMargin: finiteScore(thresholds.likelyMargin, DEFAULT_THRESHOLDS.likelyMargin),
  };
  const ranked = candidates
    .filter((candidate) => matchesHardConstraints(candidate, constraints))
    .map((candidate) => rankCandidate(candidate, normalizedEvidence))
    .sort((left, right) => {
      const scoreDifference = right.rerankScore - left.rerankScore;
      if (scoreDifference !== 0) return scoreDifference;
      const leftDistance = Number.isFinite(Number(left.cosineDistance)) ? Number(left.cosineDistance) : Number.POSITIVE_INFINITY;
      const rightDistance = Number.isFinite(Number(right.cosineDistance)) ? Number(right.cosineDistance) : Number.POSITIVE_INFINITY;
      return leftDistance - rightDistance;
    })
    .slice(0, limit);

  const viableCandidates = ranked.filter((candidate) => candidate.hardConflicts.length === 0);
  const top = viableCandidates[0] ?? ranked[0] ?? null;
  const runnerUp = viableCandidates[1] ?? null;
  const margin = top ? round(top.rerankScore - (runnerUp?.rerankScore ?? 0)) : 0;
  const strength = evidenceStrength(normalizedEvidence);
  const hasHardConflict = Boolean(top?.hardConflicts?.length);
  const hasStrongCorroboration = Boolean(
    top?.matchedFields?.includes('cardNumber')
    || top?.matchedFields?.includes('setCode')
    || (top?.matchedFields?.includes('setName') && top?.matchedFields?.includes('releaseYear'))
    || (top?.frontCosineSimilarity != null && top?.backCosineSimilarity != null && top.viewAgreement >= 0.8),
  );

  let status = 'unresolved';
  if (
    top
    && !hasHardConflict
    && top.rerankScore >= resolvedThresholds.exactScore
    && margin >= resolvedThresholds.exactMargin
    && (hasStrongCorroboration || (top.vectorScore >= 0.95 && strength >= 0.25))
  ) {
    status = 'exact';
  } else if (
    top
    && !hasHardConflict
    && top.rerankScore >= resolvedThresholds.likelyScore
    && margin >= resolvedThresholds.likelyMargin
  ) {
    status = 'likely';
  }

  const identityDecision = classifyIdentityDecision({
    ranked, top, runnerUp, status, margin, thresholds: resolvedThresholds,
  });
  if (identityDecision.variantAmbiguous && status === 'exact') status = 'unresolved';

  const warnings = [];
  if (!ranked.length) warnings.push('No catalog candidate satisfied the visual-search constraints.');
  if (top?.hardConflicts?.length) warnings.push(`High-confidence evidence conflicts on: ${top.hardConflicts.join(', ')}.`);
  if (top && margin < resolvedThresholds.likelyMargin) warnings.push('The top candidates are too close to accept automatically.');
  if (identityDecision.variantAmbiguous) warnings.push('The card family is likely, but the exact parallel or variant is unresolved.');
  if (identityDecision.outOfCatalog) warnings.push('The image may be outside the indexed catalog or below the recognition threshold.');
  if (top && status !== 'exact' && !hasStrongCorroboration) warnings.push('Exact identity requires card-number, set, front/back, cert, or other corroborating evidence.');

  return {
    contractVersion: 'visual-candidate-decision.v3',
    status,
    accepted: status === 'exact' && identityDecision.identityLevel === 'exact_variant',
    needsConfirmation: status !== 'exact' || identityDecision.identityLevel !== 'exact_variant',
    ...identityDecision,
    topCandidate: top,
    margin,
    evidenceStrength: round(strength),
    thresholds: resolvedThresholds,
    warnings,
    candidates: ranked,
  };
}

export function buildVisualSearchEvidence({ localOcr, backLocalOcr, vision, manual = {} } = {}) {
  const frontFields = localOcr?.fields && typeof localOcr.fields === 'object' ? localOcr.fields : {};
  const backFields = backLocalOcr?.fields && typeof backLocalOcr.fields === 'object' ? backLocalOcr.fields : {};
  const frontConfidence = localOcr?.fieldConfidence && typeof localOcr.fieldConfidence === 'object'
    ? localOcr.fieldConfidence
    : {};
  const backConfidence = backLocalOcr?.fieldConfidence && typeof backLocalOcr.fieldConfidence === 'object'
    ? backLocalOcr.fieldConfidence
    : {};
  const visionFacts = vision?.facts && typeof vision.facts === 'object' ? vision.facts : (vision || {});
  const manualFacts = manual && typeof manual === 'object' ? manual : {};
  const first = (...values) => values.find((value) => value !== null && value !== undefined && String(value).trim() !== '') ?? null;
  const warnings = [];

  function firstConfidence(...values) {
    for (const value of values) {
      const number = Number(value);
      if (Number.isFinite(number) && number > 0) return clamp(number, 0, 1);
    }
    return null;
  }

  function mergedOcrField(key, normalizer = (value) => String(value).trim().toLowerCase()) {
    const candidates = [
      { side: 'front', value: frontFields[key], confidence: finiteScore(frontConfidence[key], 0) },
      { side: 'back', value: backFields[key], confidence: finiteScore(backConfidence[key], 0) },
    ].filter((item) => item.value !== null && item.value !== undefined && String(item.value).trim() !== '');
    if (!candidates.length) return { value: null, confidence: 0 };
    candidates.sort((left, right) => right.confidence - left.confidence);
    const winner = candidates[0];
    const conflict = candidates.find((item) => normalizer(item.value) !== normalizer(winner.value));
    if (conflict && winner.confidence >= 0.75 && conflict.confidence >= 0.75) {
      warnings.push(`Front/back OCR conflicts on ${key}; automatic hard filtering was disabled for this field.`);
      return { value: winner.value, confidence: Math.min(0.49, winner.confidence) };
    }
    return { value: winner.value, confidence: winner.confidence };
  }

  const ocrYear = mergedOcrField('year', (value) => String(Number(value)));
  const ocrCardNumber = mergedOcrField('cardNumber', normalizeCardNumber);

  return {
    subjectName: first(manualFacts.subjectName, manualFacts.player, visionFacts.subjectName, visionFacts.player, visionFacts.player_name),
    releaseYear: first(manualFacts.releaseYear, manualFacts.year, ocrYear.value, visionFacts.releaseYear, visionFacts.year),
    sportOrGame: first(manualFacts.sportOrGame, manualFacts.sport, visionFacts.sportOrGame, visionFacts.sport),
    manufacturerOrBrand: first(manualFacts.manufacturer, manualFacts.brand, visionFacts.manufacturer, visionFacts.brand),
    setCode: first(manualFacts.setCode, visionFacts.setCode, visionFacts.set_code),
    setName: first(manualFacts.setName, manualFacts.set, visionFacts.setName, visionFacts.set_name, visionFacts.set),
    cardNumber: first(manualFacts.cardNumber, ocrCardNumber.value, visionFacts.cardNumber, visionFacts.card_number),
    parallelName: first(manualFacts.parallelName, manualFacts.parallel, visionFacts.parallelName, visionFacts.parallel_name, visionFacts.parallel),
    languageCode: first(manualFacts.languageCode, manualFacts.language, visionFacts.languageCode, visionFacts.language),
    fieldConfidence: {
      subjectName: finiteScore(manualFacts.fieldConfidence?.subjectName ?? vision?.fieldConfidence?.player ?? vision?.fieldConfidence?.subjectName, 0.65),
      releaseYear: finiteScore(firstConfidence(manualFacts.fieldConfidence?.releaseYear, ocrYear.confidence, vision?.fieldConfidence?.year), 0.65),
      sportOrGame: finiteScore(manualFacts.fieldConfidence?.sportOrGame ?? vision?.fieldConfidence?.sport, 0.55),
      manufacturerOrBrand: finiteScore(manualFacts.fieldConfidence?.manufacturerOrBrand ?? vision?.fieldConfidence?.brand, 0.60),
      setCode: finiteScore(manualFacts.fieldConfidence?.setCode ?? vision?.fieldConfidence?.setCode, 0.65),
      setName: finiteScore(manualFacts.fieldConfidence?.setName ?? vision?.fieldConfidence?.set, 0.65),
      cardNumber: finiteScore(firstConfidence(manualFacts.fieldConfidence?.cardNumber, ocrCardNumber.confidence, vision?.fieldConfidence?.cardNumber), 0.78),
      parallelName: finiteScore(manualFacts.fieldConfidence?.parallelName ?? vision?.fieldConfidence?.parallel, 0.55),
      languageCode: finiteScore(manualFacts.fieldConfidence?.languageCode ?? vision?.fieldConfidence?.language, 0.55),
    },
    warnings,
  };
}
