import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RECOGNITION_DECISION_REASONS,
  applyRecognitionCandidateScope,
  buildRecognitionEvidenceLedger,
  evaluateRecognitionDecision,
} from '../src/services/recognition-decision.js';
import { recognizeCardScene } from '../src/services/recognition-engine.js';

const cards = [
  {
    id: 'card_prizm_136',
    year: 2023,
    brand: 'Panini',
    set: 'Prizm Basketball',
    player: 'Victor Wembanyama',
    cardNumber: '136',
    parallel: 'Base',
    catalogSource: 'authorized_panini_checklist',
    confidence: 0.94,
    matchScore: 42,
  },
  {
    id: 'card_prizm_137',
    year: 2023,
    brand: 'Panini',
    set: 'Prizm Basketball',
    player: 'Scoot Henderson',
    cardNumber: '137',
    parallel: 'Base',
    catalogSource: 'authorized_panini_checklist',
    confidence: 0.72,
    matchScore: 28,
  },
];

const validCalibration = {
  valid: true,
  version: 'recognition-calibration-test-v1',
  method: 'held_out_selective_risk_bound',
  stratum: 'single_card_scoped',
  sampleSize: 250,
  minimumSamples: 30,
  correctnessLowerBound: 0.995,
  targetCorrectness: 0.98,
  minimumObservedFields: 2,
  minimumTopGap: 0.08,
};

test('selective matcher abstains when a candidate has no observed identity evidence', () => {
  const decision = evaluateRecognitionDecision({
    matches: [cards[0]],
    evidence: buildRecognitionEvidenceLedger(),
    calibration: validCalibration,
  });

  assert.equal(decision.status, 'abstained');
  assert.equal(decision.autoAccepted, false);
  assert.ok(decision.reasonCodes.includes(RECOGNITION_DECISION_REASONS.NO_OBSERVED_IDENTITY_EVIDENCE));
  assert.equal(decision.evidence.summary.observedIdentityFields, 0);
});

test('selective matcher abstains on a critical conflict and preserves both sources', () => {
  const evidence = buildRecognitionEvidenceLedger({
    region: {
      regionId: 'region_1',
      provider: 'vision_model',
      facts: { player: 'Victor Wembanyama', cardNumber: '136' },
      fieldConfidence: { player: 0.96, cardNumber: 0.94 },
    },
    gradedCert: {
      slabbed: true,
      player: 'Victor Wembanyama',
      cardNumber: '137',
      certConfidence: 95,
      verificationStatus: 'cert_number_extracted',
    },
  });
  const decision = evaluateRecognitionDecision({
    matches: [cards[0]],
    evidence,
    calibration: validCalibration,
  });

  assert.equal(decision.status, 'abstained');
  assert.ok(decision.reasonCodes.includes(RECOGNITION_DECISION_REASONS.CRITICAL_EVIDENCE_CONFLICT));
  const conflict = decision.evidence.conflicts.find((item) => item.field === 'cardNumber');
  assert.equal(conflict.critical, true);
  assert.deepEqual(new Set(conflict.values.flatMap((item) => item.sources)), new Set(['vision_model', 'cert_extraction']));
});

test('selective matcher abstains when an explicit candidate scope is empty', () => {
  const scopeResult = applyRecognitionCandidateScope(cards, {
    allowedCardIds: ['card_not_in_loaded_checklist'],
    catalogSources: ['authorized_panini_checklist'],
  });
  const decision = evaluateRecognitionDecision({
    matches: cards,
    body: {
      identityFacts: { player: 'Victor Wembanyama', cardNumber: '136' },
    },
    candidateScope: {
      allowedCardIds: ['card_not_in_loaded_checklist'],
      catalogSources: ['authorized_panini_checklist'],
    },
    scopeResult,
    calibration: validCalibration,
  });

  assert.equal(scopeResult.scope.requested, true);
  assert.equal(scopeResult.scope.eligibleCount, 0);
  assert.equal(decision.status, 'abstained');
  assert.ok(decision.reasonCodes.includes(RECOGNITION_DECISION_REASONS.SCOPE_EMPTY));
  assert.ok(decision.reasonCodes.includes(RECOGNITION_DECISION_REASONS.NO_CANDIDATE));
});

test('vector retrieval is retained as candidate-prior provenance but never counts as observed evidence', () => {
  const evidence = buildRecognitionEvidenceLedger({
    region: {
      regionId: 'region_1',
      provider: 'maneflow_pgvector',
      facts: {
        player: 'Victor Wembanyama',
        year: 2023,
        brand: 'Panini',
        set: 'Prizm Basketball',
        cardNumber: '136',
      },
      fieldConfidence: {
        player: 0.95,
        year: 0.95,
        brand: 0.95,
        set: 0.95,
        cardNumber: 0.95,
      },
    },
  });
  const decision = evaluateRecognitionDecision({
    matches: [cards[0]],
    evidence,
    calibration: validCalibration,
  });

  assert.equal(evidence.summary.observedIdentityFields, 0);
  assert.ok(evidence.summary.candidatePriorObservations >= 5);
  assert.ok(evidence.observations.every((item) => item.role === 'candidate_prior'));
  assert.equal(decision.status, 'abstained');
  assert.ok(decision.reasonCodes.includes(RECOGNITION_DECISION_REASONS.NO_OBSERVED_IDENTITY_EVIDENCE));
});

test('missing calibration never auto-accepts an otherwise strong singleton match', () => {
  const input = {
    matches: [cards[0]],
    body: {
      identityFacts: { player: 'Victor Wembanyama', cardNumber: '136' },
    },
  };
  const uncalibrated = evaluateRecognitionDecision(input);

  assert.equal(uncalibrated.status, 'review');
  assert.equal(uncalibrated.autoAccepted, false);
  assert.equal(uncalibrated.calibratedCorrectness, null);
  assert.ok(uncalibrated.reasonCodes.includes(RECOGNITION_DECISION_REASONS.CALIBRATION_UNAVAILABLE));

  const calibrated = evaluateRecognitionDecision({ ...input, calibration: validCalibration });
  assert.equal(calibrated.status, 'accepted');
  assert.equal(calibrated.autoAccepted, true);
  assert.equal(calibrated.calibratedCorrectness, 0.995);
});

test('a valid calibration cannot turn weak observations into an automatic acceptance', () => {
  const decision = evaluateRecognitionDecision({
    matches: [cards[0]],
    region: {
      provider: 'vision_model',
      facts: { player: 'Victor Wembanyama', cardNumber: '136' },
      fieldConfidence: { player: 0.42, cardNumber: 0.37 },
    },
    calibration: validCalibration,
  });

  assert.equal(decision.status, 'review');
  assert.equal(decision.autoAccepted, false);
  assert.equal(decision.evidence.summary.observedIdentityFields, 2);
  assert.equal(decision.evidence.summary.supportedObservedIdentityFields, 0);
  assert.ok(decision.reasonCodes.includes(RECOGNITION_DECISION_REASONS.INSUFFICIENT_OBSERVED_FIELDS));
});

test('recognition engine exposes the additive selector and treats pgvector facts as priors', () => {
  const recognition = recognizeCardScene({
    cards,
    body: {
      frontDataUrl: `data:image/jpeg;base64,${'a'.repeat(7000)}`,
      backDataUrl: `data:image/jpeg;base64,${'b'.repeat(7000)}`,
    },
    vision: {
      provider: 'maneflow_pgvector',
      physicalCardCount: 1,
      physicalCardDetected: true,
      cropQuality: 'single-card',
      facts: {
        player: 'Victor Wembanyama',
        year: 2023,
        brand: 'Panini',
        set: 'Prizm Basketball',
        cardNumber: '136',
      },
      fieldConfidence: {
        player: 0.95,
        year: 0.95,
        brand: 0.95,
        set: 0.95,
        cardNumber: 0.95,
      },
    },
    calibration: validCalibration,
  });

  assert.equal(recognition.primary.matches[0].id, 'card_prizm_136');
  assert.equal(recognition.primary.evidence.summary.observedIdentityFields, 0);
  assert.ok(recognition.primary.evidence.summary.candidatePriorObservations >= 5);
  assert.equal(recognition.primary.selectiveDecision.status, 'abstained');
  assert.equal(recognition.summary.selectiveCounts.abstained, 1);
  assert.equal(recognition.trustPolicy.automaticAcceptanceRequiresCalibration, true);
});

test('recognition engine applies an explicit scope without falling back globally', () => {
  const recognition = recognizeCardScene({
    cards,
    body: {
      identityFacts: { player: 'Victor Wembanyama', cardNumber: '136' },
      manualText: 'Victor Wembanyama 136',
    },
    candidateScope: { allowedCardIds: ['missing_card_id'] },
    calibration: validCalibration,
  });

  assert.equal(recognition.primary.matches.length, 0);
  assert.equal(recognition.primary.candidateScope.empty, true);
  assert.equal(recognition.primary.selectiveDecision.status, 'abstained');
  assert.ok(recognition.primary.selectiveDecision.reasonCodes.includes(RECOGNITION_DECISION_REASONS.SCOPE_EMPTY));
});