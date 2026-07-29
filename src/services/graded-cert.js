import { normalizeText } from './utils.js';
import { certStatusLabel, collectCertEvidence, normalizeCertNumberForGrader, normalizeGrader, parseSlabLabelText } from './cert-accuracy.js';
import { officialCertUrl, verifyCertIfAllowed } from './cert-verification.js';

export const GRADED_CERT_VERSION = 'graded-cert-v2.0';

function clean(value, max = 1000) {
  return String(value ?? '').trim().slice(0, max);
}

function first(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '') || '';
}

function gradeOf(facts = {}) {
  return clean(facts.grade?.grade || facts.grade || facts.numericGrade || facts.gradeValue || '', 20);
}

function factsFromVision(vision = null) {
  if (!vision) return {};
  const facts = vision.facts || vision;
  return {
    grader: first(facts.grader, facts.gradeCompany, facts.grade?.company),
    certNumber: first(facts.certNumber, facts.cert, facts.certNo),
    grade: gradeOf(facts),
    player: first(facts.player, facts.subject),
    year: first(facts.year),
    brand: first(facts.brand),
    set: first(facts.set),
    cardNumber: first(facts.cardNumber, facts.number),
    parallel: first(facts.parallel, facts.variation),
    serialNumber: first(facts.serialNumber),
    autographFlag: facts.autographFlag ?? facts.autograph ?? null,
    visibleText: first(facts.visibleText),
  };
}

function labelGradeFromText(text = '') {
  return /\b(?:PSA|BGS|BECKETT|SGC|CGC|CSG)\s*(?:GEM\s*MINT|MINT|NM-MT)?\s*([0-9](?:\.[0-9])?|10)\b/i.exec(text)?.[1] || '';
}

function agreementScore(cert = {}, visual = {}) {
  let possible = 0;
  let earned = 0;
  const compare = (a, b, weight) => {
    if (!a || !b) return;
    possible += weight;
    if (normalizeText(a) === normalizeText(b)) earned += weight;
  };
  compare(cert.grader, visual.grader, 22);
  compare(cert.grade, visual.grade, 18);
  compare(cert.player, visual.player, 16);
  compare(cert.year, visual.year, 12);
  compare(cert.set, visual.set, 10);
  compare(cert.cardNumber, visual.cardNumber, 12);
  compare(cert.parallel, visual.parallel, 10);
  return possible ? Math.round((earned / possible) * 100) : 0;
}

function mismatchWarnings(cert = {}, visual = {}) {
  const warnings = [];
  const check = (field, label) => {
    if (cert[field] && visual[field] && normalizeText(cert[field]) !== normalizeText(visual[field])) warnings.push(`${label} mismatch between cert/barcode and visual scan.`);
  };
  check('grader', 'Grader');
  check('grade', 'Grade');
  check('player', 'Player');
  check('year', 'Year');
  check('cardNumber', 'Card number');
  check('parallel', 'Parallel');
  return warnings;
}

export async function analyzeGradedCert(input = {}, context = {}) {
  const body = input.body || input;
  const visionFacts = factsFromVision(input.vision || body.vision || null);
  const visibleText = [body.certText, body.ocrText, body.manualText, body.visibleText, visionFacts.visibleText].filter(Boolean).join('\n');
  const certEvidence = collectCertEvidence({ ...body, visibleText }, visionFacts);
  const label = certEvidence.label || parseSlabLabelText({ ...body, visibleText }, visionFacts);
  const bestEvidence = certEvidence.best || {};
  const barcode = certEvidence.barcode || {};
  const cert = {
    grader: normalizeGrader(first(bestEvidence.grader, barcode.grader, body.grader, visionFacts.grader, label.grader)),
    certNumber: normalizeCertNumberForGrader(first(bestEvidence.grader, barcode.grader, body.grader, visionFacts.grader, label.grader), first(bestEvidence.certNumber, barcode.certNumber, body.certNumber, visionFacts.certNumber, label.certNumber)) || null,
    grade: clean(first(body.grade, label.grade, labelGradeFromText(visibleText), visionFacts.grade), 20) || null,
    player: clean(first(body.player, visionFacts.player, label.playerHint), 160) || null,
    year: clean(first(body.year, visionFacts.year, label.year), 20) || null,
    brand: clean(first(body.brand, visionFacts.brand), 160) || null,
    set: clean(first(body.set, visionFacts.set), 160) || null,
    cardNumber: clean(first(body.cardNumber, visionFacts.cardNumber, label.cardNumber), 80) || null,
    parallel: clean(first(body.parallel, visionFacts.parallel), 160) || null,
    serialNumber: clean(first(body.serialNumber, visionFacts.serialNumber, label.serialNumber), 80) || null,
    autographFlag: body.autographFlag ?? visionFacts.autographFlag,
  };
  const slabbed = Boolean(cert.grader || cert.certNumber || body.certDataUrl || body.barcodeText || body.qrText || body.qrPayload || body.barcodePayload || /PSA|BGS|BECKETT|SGC|CGC|CSG|CERT/i.test(visibleText));
  const visual = {
    grader: normalizeGrader(visionFacts.grader),
    grade: visionFacts.grade,
    player: visionFacts.player,
    year: visionFacts.year,
    brand: visionFacts.brand,
    set: visionFacts.set,
    cardNumber: visionFacts.cardNumber,
    parallel: visionFacts.parallel,
    serialNumber: visionFacts.serialNumber,
  };
  const warnings = slabbed ? [...(certEvidence.warnings || [])] : [];
  if (slabbed && !cert.certNumber) warnings.push('Cert number not confirmed; capture the slab label or barcode/QR closer.');
  if (slabbed && !cert.grader) warnings.push('Grading company not confirmed from slab label.');
  if (certEvidence.extractionTier === 'insufficient') warnings.push('Cert extraction is insufficient; capture the slab label closer or enter the cert manually.');
  const mismatches = mismatchWarnings(cert, visual);
  warnings.push(...mismatches);
  const matchAgreementScore = agreementScore(cert, visual);
  const certUrl = barcode.verificationUrl || officialCertUrl(cert.grader, cert.certNumber);
  const verification = slabbed ? await verifyCertIfAllowed({
    state: context.state || {},
    grader: cert.grader,
    certNumber: cert.certNumber,
    fetchImpl: context.fetchImpl || null,
    actor: context.actor || null,
  }) : { verificationStatus: 'not_graded_detected', certUrl: null, warnings: [] };
  let verificationStatus = verification.verificationStatus;
  if (mismatches.length) verificationStatus = 'mismatch_detected';
  else if (barcode.decoded && cert.certNumber) verificationStatus = verificationStatus === 'lookup_blocked_by_policy' ? 'manual_verify_recommended' : verificationStatus;
  else if (cert.certNumber) verificationStatus = 'cert_number_extracted';
  else if (!slabbed) verificationStatus = 'not_graded_detected';
  const conflictPenalty = (certEvidence.conflicts || []).length * 18;
  const certConfidence = Math.max(0, Math.min(100,
    (cert.grader ? 18 : 0) + (cert.certNumber ? 26 : 0) + (cert.grade ? 16 : 0) + (barcode.decoded ? 16 : 0)
      + Math.round((certEvidence.extractionCompletenessScore || 0) * 0.16)
      + (matchAgreementScore ? Math.round(matchAgreementScore * 0.12) : 0) - (mismatches.length * 18) - conflictPenalty,
  ));
  return {
    version: GRADED_CERT_VERSION,
    certAccuracyVersion: certEvidence.version,
    slabbed,
    grader: cert.grader || null,
    certNumber: cert.certNumber,
    certUrl,
    barcodeType: barcode.barcodeType || null,
    barcodePayload: barcode.barcodePayload || '',
    qrPayload: barcode.qrPayload || '',
    grade: cert.grade,
    gradeLabel: [cert.grader, cert.grade].filter(Boolean).join(' ') || null,
    player: cert.player,
    year: cert.year,
    brand: cert.brand,
    set: cert.set,
    cardNumber: cert.cardNumber,
    parallel: cert.parallel,
    serialNumber: cert.serialNumber,
    autographFlag: cert.autographFlag,
    verificationStatus,
    verificationLabel: certStatusLabel(verificationStatus),
    officialVerificationConnected: verificationStatus === 'official_verified',
    parsedNotVerified: verificationStatus !== 'official_verified' && slabbed,
    matchAgreementScore,
    certConfidence: Math.round(certConfidence),
    extractionTier: certEvidence.extractionTier,
    extractionCompletenessScore: certEvidence.extractionCompletenessScore,
    certEvidence: {
      best: certEvidence.best,
      candidates: certEvidence.candidates,
      conflicts: certEvidence.conflicts,
      label: {
        labelLines: label.labelLines,
        usefulLabelLines: label.usefulLabelLines,
        playerHint: label.playerHint,
      },
    },
    warnings: [...new Set([...warnings, ...(slabbed ? verification.warnings || [] : [])])],
    verification,
  };
}
