import { clamp, normalizeText } from './utils.js';

export const RECOGNITION_DECISION_VERSION = 'recognition-decision-v1.0';

export const RECOGNITION_DECISION_REASONS = Object.freeze({
  NO_OBSERVED_IDENTITY_EVIDENCE: 'NO_OBSERVED_IDENTITY_EVIDENCE',
  CRITICAL_EVIDENCE_CONFLICT: 'CRITICAL_EVIDENCE_CONFLICT',
  SCOPE_EMPTY: 'SCOPE_EMPTY',
  NO_CANDIDATE: 'NO_CANDIDATE',
  CALIBRATION_UNAVAILABLE: 'CALIBRATION_UNAVAILABLE',
  CALIBRATION_INVALID: 'CALIBRATION_INVALID',
  CALIBRATION_INSUFFICIENT_SUPPORT: 'CALIBRATION_INSUFFICIENT_SUPPORT',
  CALIBRATION_RISK_BOUND_NOT_MET: 'CALIBRATION_RISK_BOUND_NOT_MET',
  INSUFFICIENT_OBSERVED_FIELDS: 'INSUFFICIENT_OBSERVED_FIELDS',
  AMBIGUOUS_PREDICTION_SET: 'AMBIGUOUS_PREDICTION_SET',
});

const IDENTITY_FIELDS = Object.freeze([
  'player',
  'year',
  'brand',
  'set',
  'cardNumber',
  'parallel',
  'serialNumber',
  'productName',
  'productType',
  'configuration',
  'sku',
  'upc',
  'grader',
  'grade',
  'certNumber',
]);

const CRITICAL_FIELDS = new Set(IDENTITY_FIELDS);
const RETRIEVAL_SOURCE = /vector|pgvector|retrieval|embedding|similarity|candidate[_ -]?prior/i;

function clean(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function hasValue(value) {
  const normalized = normalizeText(value);
  return Boolean(normalized && !['uncertain', 'unknown', 'null', 'none', 'na', 'n a'].includes(normalized));
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizedConfidence(value, fallback = 0.5) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return clamp(parsed > 1 ? parsed / 100 : parsed, 0, 1);
}

function normalizedValue(field, value) {
  if (field === 'year') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return String(Math.trunc(parsed));
  }
  return normalizeText(value);
}

function evidenceRole({ role = '', source = '', provider = '' } = {}) {
  const requested = normalizeText(role).replaceAll(' ', '_');
  if (requested === 'candidate_prior' || requested === 'retrieval_prior') return 'candidate_prior';
  if (requested === 'observed') return 'observed';
  return RETRIEVAL_SOURCE.test(`${source} ${provider}`) ? 'candidate_prior' : 'observed';
}

function fieldValue(facts = {}, field) {
  const grade = facts.grade && typeof facts.grade === 'object' ? facts.grade : null;
  const aliases = {
    player: [facts.player, facts.subject, facts.playerName],
    year: [facts.year, facts.releaseYear],
    brand: [facts.brand, facts.manufacturer],
    set: [facts.set, facts.setName, facts.set_name],
    cardNumber: [facts.cardNumber, facts.card_number, facts.number],
    parallel: [facts.parallel, facts.variation],
    serialNumber: [facts.serialNumber, facts.serial_number],
    productName: [facts.productName, facts.product],
    productType: [facts.productType, facts.sealedType, facts.itemType],
    configuration: [facts.configuration, facts.boxType, facts.packType],
    sku: [facts.sku, facts.productId],
    upc: [facts.upc, facts.barcode],
    grader: [facts.grader, facts.gradeCompany, grade?.company],
    grade: [grade?.grade, typeof facts.grade === 'object' ? null : facts.grade, facts.numericGrade],
    certNumber: [facts.certNumber, facts.cert_number, facts.cert],
  };
  return safeArray(aliases[field]).find(hasValue) ?? null;
}

function addFacts(observations, facts, {
  source,
  provider = '',
  role = '',
  confidenceByField = {},
  fallbackConfidence = 0.5,
  regionId = null,
} = {}) {
  if (!facts || typeof facts !== 'object') return;
  const resolvedRole = evidenceRole({ role, source, provider });
  for (const field of IDENTITY_FIELDS) {
    const value = fieldValue(facts, field);
    if (!hasValue(value)) continue;
    observations.push({
      field,
      value,
      normalizedValue: normalizedValue(field, value),
      source: clean(source || provider || 'unknown', 120),
      provider: clean(provider, 160) || null,
      role: resolvedRole,
      confidence: normalizedConfidence(confidenceByField?.[field], fallbackConfidence),
      regionId: clean(regionId, 100) || null,
    });
  }
}

function addExplicitObservations(observations, values = []) {
  for (const item of safeArray(values)) {
    const field = clean(item?.field, 80);
    if (!IDENTITY_FIELDS.includes(field) || !hasValue(item?.value)) continue;
    observations.push({
      field,
      value: item.value,
      normalizedValue: normalizedValue(field, item.value),
      source: clean(item.source || item.provider || 'explicit_observation', 120),
      provider: clean(item.provider, 160) || null,
      role: evidenceRole(item),
      confidence: normalizedConfidence(item.confidence, 0.5),
      regionId: clean(item.regionId, 100) || null,
    });
  }
}

function addCandidatePriors(observations, priors = []) {
  for (const prior of safeArray(priors)) {
    const source = clean(prior.source || prior.provider || 'candidate_prior', 120);
    const provider = clean(prior.provider, 160);
    const facts = prior.facts || prior.card || prior;
    addFacts(observations, facts, {
      source,
      provider,
      role: 'candidate_prior',
      confidenceByField: prior.fieldConfidence || {},
      fallbackConfidence: normalizedConfidence(prior.confidence ?? prior.cosineSimilarity, 0.5),
      regionId: prior.regionId,
    });
    const cardId = clean(prior.cardId || prior.catalogCardId || prior.id, 200);
    if (cardId) {
      observations.push({
        field: 'candidateId',
        value: cardId,
        normalizedValue: normalizeText(cardId),
        source,
        provider: provider || null,
        role: 'candidate_prior',
        confidence: normalizedConfidence(prior.confidence ?? prior.cosineSimilarity, 0.5),
        regionId: clean(prior.regionId, 100) || null,
      });
    }
  }
}

function resolveEvidence(observations = []) {
  const fields = {};
  const conflicts = [];
  for (const field of IDENTITY_FIELDS) {
    const fieldObservations = observations.filter((item) => item.field === field && item.role === 'observed');
    const groups = new Map();
    for (const observation of fieldObservations) {
      const key = observation.normalizedValue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(observation);
    }
    const rankedGroups = [...groups.entries()]
      .map(([key, values]) => ({
        key,
        values,
        confidence: Math.max(...values.map((item) => item.confidence)),
      }))
      .sort((left, right) => right.confidence - left.confidence || right.values.length - left.values.length);
    const confidentGroups = rankedGroups.filter((group) => group.confidence >= 0.6);
    const conflicted = confidentGroups.length >= 2;
    const best = rankedGroups[0]?.values.sort((left, right) => right.confidence - left.confidence)[0] || null;
    fields[field] = {
      status: conflicted ? 'conflicted' : best ? 'supported' : 'absent',
      value: conflicted ? null : best?.value ?? null,
      confidence: conflicted ? null : best?.confidence ?? null,
      sources: [...new Set(fieldObservations.map((item) => item.source))],
      observations: fieldObservations,
    };
    if (conflicted) {
      conflicts.push({
        field,
        critical: CRITICAL_FIELDS.has(field),
        values: confidentGroups.map((group) => ({
          value: group.values[0].value,
          confidence: group.confidence,
          sources: [...new Set(group.values.map((item) => item.source))],
        })),
      });
    }
  }
  return { fields, conflicts };
}

export function buildRecognitionEvidenceLedger({
  region = null,
  body = {},
  gradedCert = null,
  candidatePriors = [],
  observations: explicitObservations = [],
} = {}) {
  const observations = [];
  const regionFacts = region?.facts || region || {};
  const regionProvider = clean(region?.provider || region?.evidenceProvider, 160);
  addFacts(observations, regionFacts, {
    source: region?.evidenceSource || regionProvider || 'vision',
    provider: regionProvider,
    role: region?.evidenceRole,
    confidenceByField: region?.fieldConfidence || region?.confidenceByField || {},
    fallbackConfidence: normalizedConfidence(region?.overallConfidence ?? region?.confidence, 0.5),
    regionId: region?.regionId || region?.id,
  });

  const manualFacts = body?.identityFacts || body?.structuredFacts || null;
  addFacts(observations, manualFacts, {
    source: body?.identityEvidenceSource || 'manual_structured_input',
    role: 'observed',
    confidenceByField: body?.identityFieldConfidence || {},
    fallbackConfidence: 1,
    regionId: region?.regionId || region?.id,
  });

  if (gradedCert?.slabbed || IDENTITY_FIELDS.some((field) => hasValue(fieldValue(gradedCert || {}, field)))) {
    const official = gradedCert?.verificationStatus === 'official_verified';
    addFacts(observations, gradedCert, {
      source: official ? 'official_cert_verification' : 'cert_extraction',
      provider: gradedCert?.grader || '',
      role: 'observed',
      confidenceByField: {},
      fallbackConfidence: official ? 0.995 : normalizedConfidence(gradedCert?.certConfidence, 0.75),
      regionId: region?.regionId || region?.id,
    });
  }

  addExplicitObservations(observations, [...safeArray(body?.evidenceObservations), ...safeArray(explicitObservations)]);
  addCandidatePriors(observations, candidatePriors);

  const deduplicated = [...new Map(observations.map((item) => [
    [item.field, item.normalizedValue, item.source, item.role, item.regionId || ''].join('|'),
    item,
  ])).values()];
  const resolved = resolveEvidence(deduplicated);
  const observedIdentity = deduplicated.filter((item) => item.role === 'observed' && IDENTITY_FIELDS.includes(item.field));
  const supportedObservedIdentity = observedIdentity.filter((item) => item.confidence >= 0.6);
  const candidatePrior = deduplicated.filter((item) => item.role === 'candidate_prior');
  return {
    version: RECOGNITION_DECISION_VERSION,
    observations: deduplicated,
    fields: resolved.fields,
    conflicts: resolved.conflicts,
    summary: {
      observedIdentityFields: new Set(observedIdentity.map((item) => item.field)).size,
      observedIdentityObservations: observedIdentity.length,
      supportedObservedIdentityFields: new Set(supportedObservedIdentity.map((item) => item.field)).size,
      supportedObservedIdentityObservations: supportedObservedIdentity.length,
      candidatePriorObservations: candidatePrior.length,
      criticalConflicts: resolved.conflicts.filter((item) => item.critical).length,
    },
  };
}

function listConstraint(scope, ...keys) {
  const key = keys.find((candidate) => Object.hasOwn(scope, candidate));
  if (!key) return { present: false, values: [] };
  const raw = Array.isArray(scope[key]) ? scope[key] : [scope[key]];
  return {
    present: true,
    values: raw.map((value) => clean(value, 200)).filter(Boolean),
  };
}

function scalarConstraint(scope, key) {
  if (!Object.hasOwn(scope, key)) return { present: false, value: '' };
  return { present: true, value: clean(scope[key], 200) };
}

export function applyRecognitionCandidateScope(cards = [], candidateScope = null) {
  const sourceCards = safeArray(cards);
  const scope = candidateScope && typeof candidateScope === 'object' ? candidateScope : {};
  const allowedCardIds = listConstraint(scope, 'allowedCardIds', 'cardIds');
  const catalogSources = listConstraint(scope, 'catalogSources', 'allowedCatalogSources');
  const sport = scalarConstraint(scope, 'sport');
  const year = scalarConstraint(scope, 'year');
  const brand = scalarConstraint(scope, 'brand');
  const set = scalarConstraint(scope, 'set');
  const requested = [allowedCardIds, catalogSources, sport, year, brand, set].some((item) => item.present);
  const allowedIds = new Set(allowedCardIds.values);
  const allowedSources = new Set(catalogSources.values.map(normalizeText));
  const scopedCards = requested ? sourceCards.filter((card) => {
    if (allowedCardIds.present && !allowedIds.has(String(card.id || ''))) return false;
    if (catalogSources.present && !allowedSources.has(normalizeText(card.catalogSource || ''))) return false;
    if (sport.present && normalizeText(card.sport) !== normalizeText(sport.value)) return false;
    if (year.present && String(card.year ?? '') !== String(year.value)) return false;
    if (brand.present && normalizeText(card.brand) !== normalizeText(brand.value)) return false;
    if (set.present && normalizeText(card.set) !== normalizeText(set.value)) return false;
    return true;
  }) : [...sourceCards];
  return {
    cards: scopedCards,
    scope: {
      requested,
      applied: requested,
      universeSize: sourceCards.length,
      eligibleCount: scopedCards.length,
      empty: requested && scopedCards.length === 0,
      constraints: {
        ...(allowedCardIds.present ? { allowedCardIds: allowedCardIds.values } : {}),
        ...(catalogSources.present ? { catalogSources: catalogSources.values } : {}),
        ...(sport.present ? { sport: sport.value } : {}),
        ...(year.present ? { year: year.value } : {}),
        ...(brand.present ? { brand: brand.value } : {}),
        ...(set.present ? { set: set.value } : {}),
      },
    },
  };
}

export function assessRecognitionCalibration(calibration = null) {
  const minimumSamples = Math.max(1, Number(calibration?.minimumSamples || 30));
  const targetCorrectness = normalizedConfidence(calibration?.targetCorrectness, 0.98);
  const sampleSize = Math.max(0, Number(calibration?.sampleSize || 0));
  const correctnessLowerBound = calibration
    ? normalizedConfidence(calibration.correctnessLowerBound ?? calibration.lowerBound, 0)
    : null;
  let reasonCode = null;
  if (!calibration) reasonCode = RECOGNITION_DECISION_REASONS.CALIBRATION_UNAVAILABLE;
  else if (calibration.valid !== true || !clean(calibration.version, 120)) reasonCode = RECOGNITION_DECISION_REASONS.CALIBRATION_INVALID;
  else if (sampleSize < minimumSamples) reasonCode = RECOGNITION_DECISION_REASONS.CALIBRATION_INSUFFICIENT_SUPPORT;
  else if (correctnessLowerBound < targetCorrectness) reasonCode = RECOGNITION_DECISION_REASONS.CALIBRATION_RISK_BOUND_NOT_MET;
  return {
    version: clean(calibration?.version, 120) || null,
    method: clean(calibration?.method || 'held_out_selective_risk_bound', 120),
    stratum: clean(calibration?.stratum || 'global', 120),
    sampleSize,
    minimumSamples,
    correctnessLowerBound,
    targetCorrectness,
    valid: reasonCode === null,
    reasonCode,
  };
}

function candidateScore(candidate = {}) {
  const value = Number(candidate.confidence);
  return Number.isFinite(value) ? clamp(value, 0, 1) : null;
}

function predictionSet(matches = [], calibration = {}) {
  const candidates = safeArray(matches).slice(0, 3);
  if (candidates.length < 2) return candidates;
  const first = candidateScore(candidates[0]);
  const second = candidateScore(candidates[1]);
  if (first === null || second === null) return candidates;
  const minimumTopGap = normalizedConfidence(calibration?.minimumTopGap, 0.08);
  return first - second >= minimumTopGap ? candidates.slice(0, 1) : candidates;
}

export function evaluateRecognitionDecision({
  matches = [],
  evidence = null,
  region = null,
  body = {},
  gradedCert = null,
  candidatePriors = [],
  candidateScope = null,
  scopeResult = null,
  calibration = null,
} = {}) {
  const ledger = evidence || buildRecognitionEvidenceLedger({ region, body, gradedCert, candidatePriors });
  const scopedMatches = applyRecognitionCandidateScope(matches, candidateScope);
  const effectiveMatches = scopedMatches.cards;
  const scope = scopeResult?.scope || scopedMatches.scope;
  const calibrationAssessment = assessRecognitionCalibration(calibration);
  const selectedPredictionSet = predictionSet(effectiveMatches, calibration || {});
  const reasons = [];
  const observedFieldCount = Number(ledger?.summary?.observedIdentityFields || 0);
  const supportedObservedFieldCount = Number(
    ledger?.summary?.supportedObservedIdentityFields ?? observedFieldCount,
  );
  const criticalConflicts = safeArray(ledger?.conflicts).filter((item) => item.critical);
  const minimumObservedFields = Math.max(1, Number(calibration?.minimumObservedFields || 2));

  if (observedFieldCount === 0) reasons.push(RECOGNITION_DECISION_REASONS.NO_OBSERVED_IDENTITY_EVIDENCE);
  if (criticalConflicts.length) reasons.push(RECOGNITION_DECISION_REASONS.CRITICAL_EVIDENCE_CONFLICT);
  if (scope.empty) reasons.push(RECOGNITION_DECISION_REASONS.SCOPE_EMPTY);
  if (!effectiveMatches.length) reasons.push(RECOGNITION_DECISION_REASONS.NO_CANDIDATE);
  if (calibrationAssessment.reasonCode) reasons.push(calibrationAssessment.reasonCode);
  if (observedFieldCount > 0 && supportedObservedFieldCount < minimumObservedFields) reasons.push(RECOGNITION_DECISION_REASONS.INSUFFICIENT_OBSERVED_FIELDS);
  if (selectedPredictionSet.length > 1) reasons.push(RECOGNITION_DECISION_REASONS.AMBIGUOUS_PREDICTION_SET);

  const hardAbstention = observedFieldCount === 0 || criticalConflicts.length > 0 || scope.empty || effectiveMatches.length === 0;
  const status = hardAbstention
    ? 'abstained'
    : reasons.length
      ? 'review'
      : 'accepted';
  return {
    version: RECOGNITION_DECISION_VERSION,
    status,
    reasonCodes: [...new Set(reasons)],
    predictionSet: selectedPredictionSet.map((candidate, index) => ({
      id: candidate.id || null,
      rank: index + 1,
      retrievalScore: candidate.matchScore ?? candidate.confidence ?? null,
      catalogSource: candidate.catalogSource || null,
    })),
    calibratedCorrectness: calibrationAssessment.valid ? calibrationAssessment.correctnessLowerBound : null,
    calibration: calibrationAssessment,
    evidence: ledger,
    candidateScope: scope,
    autoAccepted: status === 'accepted',
  };
}
