import { clamp, normalizeText } from './utils.js';

function has(value) {
  const text = normalizeText(value);
  return text.length > 0 && !['uncertain', 'unknown', 'null', 'none', 'na', 'n a'].includes(text);
}
function scoreField(value, weight, warnings, message) { if (has(value)) return weight; warnings.push(message); return 0; }

export function assessImageQuality({ frontDataUrl = '', backDataUrl = '', certDataUrl = '', imageName = '', vision = null } = {}) {
  const warnings = [];
  const frontBytes = String(frontDataUrl).length;
  const backBytes = String(backDataUrl).length;
  const visionQuality = vision?.imageQuality || {};
  let score = 50;
  if (frontBytes > 4000) score += 25; else warnings.push('Front image appears small or missing; use a clearer full-card photo.');
  if (backBytes > 4000) score += 12; else warnings.push('Back image recommended before relying on exact set/parallel details.');
  if (String(certDataUrl).length > 2000 || /cert|psa|bgs|sgc|cgc|slab/i.test(imageName)) score += 8; else warnings.push('Cert or slab label not confirmed.');
  if (/blur|dark|glare|cropped/i.test(imageName)) { score -= 18; warnings.push('Image filename suggests blur, glare, darkness, or crop risk.'); }
  if (visionQuality.blur === 'heavy') { score -= 22; warnings.push('Vision detected heavy blur; capture a sharper photo.'); }
  if (visionQuality.blur === 'mild') { score -= 8; warnings.push('Vision detected mild blur.'); }
  if (visionQuality.glare === 'heavy') { score -= 18; warnings.push('Vision detected heavy glare or reflection.'); }
  if (visionQuality.glare === 'mild') { score -= 7; warnings.push('Vision detected mild glare.'); }
  if (visionQuality.lighting === 'dim') { score -= 8; warnings.push('Lighting is dim; use brighter, even light.'); }
  if (visionQuality.lighting === 'overexposed') { score -= 8; warnings.push('Image is overexposed; reduce direct light.'); }
  if (visionQuality.crop === 'partial') { score -= 14; warnings.push('Card appears partially cropped.'); }
  if (visionQuality.crop === 'label_only') { score -= backBytes || certDataUrl ? 4 : 18; warnings.push('Image appears label-only; capture the full card before final valuation.'); }
  if (visionQuality.angle === 'severe') { score -= 12; warnings.push('Card angle is severe; flatten the photo for better matching.'); }
  for (const warning of visionQuality.warnings || []) warnings.push(String(warning));
  return { imageQualityScore: Math.round(clamp(score, 0, 100)), warnings, frontStatus: frontBytes ? 'present' : 'missing', backStatus: backBytes ? 'present' : 'missing', certStatus: certDataUrl ? 'present' : 'optional_missing' };
}

export function buildFieldConfidence({ vision = null, manualText = '', ocrText = '', bestMatch = null, gradedCert = null } = {}) {
  const text = normalizeText(`${manualText} ${ocrText} ${vision?.visibleText || ''}`);
  const warnings = [];
  const facts = vision?.facts || vision || {};
  const fieldConfidence = {
    player: has(facts.player || bestMatch?.player) ? 0.86 : text ? 0.45 : 0.1,
    subject: has(facts.subject || facts.player || bestMatch?.player) ? 0.84 : text ? 0.42 : 0.1,
    team: has(facts.team || bestMatch?.team) ? 0.72 : 0.25,
    year: has(facts.year || bestMatch?.year) ? 0.82 : /\b(19|20)\d{2}\b/.test(text) ? 0.62 : 0.15,
    brand: has(facts.brand || bestMatch?.brand) ? 0.78 : 0.22,
    set: has(facts.set || bestMatch?.set || bestMatch?.brand) ? 0.74 : 0.25,
    cardNumber: has(facts.cardNumber || bestMatch?.cardNumber) ? 0.8 : /#?[a-z]{0,3}\d{1,4}\b/i.test(`${manualText} ${ocrText}`) ? 0.56 : 0.12,
    parallel: has(facts.parallel || bestMatch?.parallel) ? 0.68 : 0.28,
    productName: has(facts.productName || bestMatch?.productName) ? 0.82 : text ? 0.42 : 0.12,
    productType: has(facts.productType || facts.sealedType || bestMatch?.productType) ? 0.84 : /\b(pack|box|sealed|booster|blaster|hobby|retail|tin|etb|elite trainer)\b/i.test(`${manualText} ${ocrText}`) ? 0.68 : 0.18,
    configuration: has(facts.configuration || bestMatch?.configuration) ? 0.78 : /\b(\d+\s*(pack|card|box|ct|count)|hobby|retail|blaster|mega|booster|elite trainer)\b/i.test(`${manualText} ${ocrText}`) ? 0.58 : 0.18,
    upc: has(facts.upc || facts.barcode || bestMatch?.upc) ? 0.9 : /\b\d{10,14}\b/.test(`${manualText} ${ocrText}`) ? 0.64 : 0.12,
    variation: has(facts.variation || facts.parallel || bestMatch?.parallel) ? 0.66 : 0.26,
    serialNumber: has(facts.serialNumber) ? 0.88 : /\d+\s*\/\s*\d+/.test(`${manualText} ${ocrText}`) ? 0.7 : 0.2,
    rookie: facts.rookie === true || facts.rookieFlag === true || /\b(rc|rookie)\b/i.test(`${manualText} ${ocrText}`) ? 0.82 : has(bestMatch?.aliases?.join?.(' ')) && /rookie| rc\b/i.test(bestMatch.aliases.join(' ')) ? 0.68 : 0.35,
    autograph: facts.autograph === true || facts.autographFlag === true || /\b(auto|autograph|signed)\b/i.test(`${manualText} ${ocrText}`) ? 0.82 : 0.35,
    relic: facts.relic === true || facts.patch === true || facts.memorabilia === true || /\b(relic|patch|jersey|memorabilia)\b/i.test(`${manualText} ${ocrText}`) ? 0.8 : 0.34,
    gradeCompany: has(facts.gradeCompany || facts.grader || bestMatch?.grade?.company) ? 0.9 : /\b(psa|bgs|sgc|cgc)\b/i.test(text) ? 0.75 : 0.2,
    grade: has(facts.grade || bestMatch?.grade?.grade) ? 0.9 : /\b(10|9\.5|9|8\.5|8)\b/.test(text) ? 0.62 : 0.2,
    certNumber: has(facts.certNumber) ? 0.88 : /\b\d{7,10}\b/.test(text) ? 0.52 : 0.15,
  };
  if (gradedCert?.certNumber) fieldConfidence.certNumber = Math.max(fieldConfidence.certNumber, gradedCert.barcodePayload || gradedCert.qrPayload ? 0.96 : 0.82);
  if (gradedCert?.grader) fieldConfidence.gradeCompany = Math.max(fieldConfidence.gradeCompany, 0.92);
  if (gradedCert?.grade) fieldConfidence.grade = Math.max(fieldConfidence.grade, 0.9);
  if (gradedCert?.cardNumber) fieldConfidence.cardNumber = Math.max(fieldConfidence.cardNumber, 0.86);
  if (gradedCert?.parallel) fieldConfidence.parallel = Math.max(fieldConfidence.parallel, 0.76);
  if (gradedCert?.extractionTier === 'cert_locked') fieldConfidence.certNumber = Math.max(fieldConfidence.certNumber, 0.98);
  if (fieldConfidence.brand < 0.5) warnings.push('Brand/manufacturer uncertain; capture the logo or back text more clearly.');
  if (fieldConfidence.productType >= 0.65 && fieldConfidence.configuration < 0.55) warnings.push('Sealed product detected; confirm box/pack configuration before inventory or pricing.');
  if (fieldConfidence.parallel < 0.55) warnings.push('Parallel uncertain; confirm before using final value.');
  if (fieldConfidence.autograph >= 0.7) warnings.push('Autograph indicator detected; confirm whether the auto is pack-certified, in-person, or aftermarket before pricing.');
  if (fieldConfidence.relic >= 0.7) warnings.push('Relic/patch indicator detected; confirm exact memorabilia variation before pricing.');
  if (fieldConfidence.grade < 0.6 && fieldConfidence.gradeCompany > 0.6) warnings.push('Grading company detected but grade is not fully confirmed.');
  if (fieldConfidence.certNumber < 0.5 && fieldConfidence.gradeCompany > 0.6) warnings.push('Cert number not confirmed from the scan.');
  if (gradedCert?.verificationStatus === 'mismatch_detected') warnings.push('Cert/slab details do not fully match the visual scan; manual review required.');
  if (gradedCert?.verificationStatus === 'manual_verify_recommended') warnings.push('Open the official cert page before relying on this graded-card value.');
  if (gradedCert?.extractionTier === 'insufficient') warnings.push('Cert extraction is weak; capture the slab label closer or enter the cert manually.');
  if ((gradedCert?.certEvidence?.conflicts || []).length) warnings.push('Conflicting cert evidence was detected; use the official cert page before relying on value.');
  const sealedSignal = Math.max(fieldConfidence.productName || 0, fieldConfidence.productType || 0);
  const identityConfidence = sealedSignal >= 0.65
    ? Math.round(clamp((fieldConfidence.productName * 0.22 + fieldConfidence.productType * 0.2 + fieldConfidence.brand * 0.14 + fieldConfidence.set * 0.16 + fieldConfidence.year * 0.1 + fieldConfidence.configuration * 0.12 + fieldConfidence.upc * 0.06) * 100, 0, 100))
    : Math.round(clamp((fieldConfidence.player * 0.22 + fieldConfidence.year * 0.16 + fieldConfidence.set * 0.16 + fieldConfidence.cardNumber * 0.2 + fieldConfidence.parallel * 0.14 + fieldConfidence.grade * 0.12) * 100, 0, 100));
  return { fieldConfidence, identityConfidence, warnings };
}

function cardLabel(card = {}) {
  return [card.year, card.brand, card.set, card.player || card.subject, card.cardNumber ? `#${card.cardNumber}` : '', card.parallel, card.grade?.company, card.grade?.grade]
    .filter(Boolean).join(' ');
}

function evidenceForMatch(bestMatch = {}, fields = {}, vision = null) {
  bestMatch = bestMatch || {};
  const facts = vision?.facts || vision || {};
  const reasons = [];
  const uncertain = [];
  const add = (field, label, value) => {
    if (Number(fields[field] || 0) >= 0.7) reasons.push(`${label}: ${value || 'matched'}`);
    else uncertain.push(label);
  };
  add('player', 'subject', bestMatch.player || facts.player || facts.subject);
  add('year', 'year', bestMatch.year || facts.year);
  add('brand', 'brand', bestMatch.brand || facts.brand);
  add('set', 'set', bestMatch.set || facts.set);
  add('cardNumber', 'card number', bestMatch.cardNumber || facts.cardNumber);
  add('parallel', 'parallel', bestMatch.parallel || facts.parallel || facts.variation);
  add('productName', 'product', bestMatch.productName || facts.productName);
  add('productType', 'sealed type', bestMatch.productType || facts.productType || facts.sealedType);
  add('configuration', 'configuration', bestMatch.configuration || facts.configuration);
  if (Number(fields.grade || 0) >= 0.7) reasons.push(`grade: ${bestMatch.grade?.company || facts.grader || facts.gradeCompany || ''} ${bestMatch.grade?.grade || facts.grade || ''}`.trim());
  else uncertain.push('grade');
  if (Number(fields.certNumber || 0) >= 0.75) reasons.push(`cert: ${facts.certNumber || 'parsed from slab evidence'}`);
  return { reasons: [...new Set(reasons)].slice(0, 8), uncertain: [...new Set(uncertain)].slice(0, 8) };
}

function photoGuidance({ imageQuality = {}, fields = {}, gradedCert = null, needsBackImage = false } = {}) {
  const guidance = [];
  if (needsBackImage) guidance.push('Add the card back to confirm set, card number, and parallel.');
  if ((fields.parallel || 0) < 0.55) guidance.push('Capture foil/refractor pattern and any serial number at a slight angle.');
  if ((fields.certNumber || 0) < 0.6 && (fields.gradeCompany || 0) > 0.6) guidance.push('Take a closer photo of the slab label or barcode/QR.');
  if ((fields.productType || 0) > 0.65 && (fields.configuration || 0) < 0.6) guidance.push('Capture the front and side panel so the sealed product configuration is readable.');
  if (imageQuality.blur === 'heavy' || imageQuality.blur === 'mild') guidance.push('Retake with sharper focus before final pricing.');
  if (imageQuality.glare === 'heavy' || imageQuality.glare === 'mild') guidance.push('Move away from direct light to reduce glare.');
  if (imageQuality.crop === 'partial') guidance.push('Retake with the full card inside the frame.');
  if (imageQuality.angle === 'severe') guidance.push('Flatten the card in frame to improve text recognition.');
  if (gradedCert?.verificationStatus === 'mismatch_detected') guidance.push('Resolve cert/label conflict before saving or pricing.');
  return [...new Set(guidance)];
}

export function evaluateScanConfidence({ body = {}, vision = null, result = null, matches = [] } = {}) {
  const bestMatch = matches[0] || null;
  const imageQuality = assessImageQuality({ ...body, vision });
  const gradedCert = body.gradedCert || result?.gradedCert || null;
  const fields = buildFieldConfidence({ vision, manualText: body.manualText, ocrText: body.ocrText, bestMatch, gradedCert });
  const warnings = [...imageQuality.warnings, ...fields.warnings];
  const candidateCount = matches.length;
  const candidatePenalty = candidateCount > 3 ? 10 : candidateCount > 1 ? 5 : 0;
  const certBonus = gradedCert?.certConfidence ? Math.min(12, Math.round(gradedCert.certConfidence / 10)) : 0;
  const certPenalty = gradedCert?.verificationStatus === 'mismatch_detected' ? 28 : 0;
  const weakCertPenalty = gradedCert?.slabbed && ['insufficient', 'needs_review'].includes(gradedCert.extractionTier) ? 12 : 0;
  const conflictPenalty = (gradedCert?.certEvidence?.conflicts || []).length ? 22 : 0;
  const score = Math.round(clamp(fields.identityConfidence * 0.72 + imageQuality.imageQualityScore * 0.28 - candidatePenalty + certBonus - certPenalty - weakCertPenalty - conflictPenalty, 0, 100));
  const needsBackImage = imageQuality.backStatus === 'missing' && (fields.fieldConfidence.parallel < 0.6 || fields.fieldConfidence.cardNumber < 0.7);
  const highValueLowConfidence = Number(bestMatch?.market?.value || 0) >= 250 && score < 90;
  if (highValueLowConfidence) warnings.push('High-value card with less than elite scan confidence; require manual confirmation before pricing, listing, or buying.');
  const needsManualConfirmation = score < 78 || highValueLowConfidence || needsBackImage || fields.fieldConfidence.parallel < 0.5 || gradedCert?.verificationStatus === 'mismatch_detected' || weakCertPenalty > 0 || conflictPenalty > 0;
  const matchEvidence = evidenceForMatch(bestMatch, fields.fieldConfidence, vision);
  const topCandidates = matches.slice(0, 3).map((card, index) => ({
    id: card.id,
    title: cardLabel(card),
    confidence: card.confidence ?? card.matchScore ?? null,
    rank: index + 1,
    image: card.image || null,
  }));
  const manualReasons = [
    score < 78 ? 'scan confidence below release threshold' : '',
    highValueLowConfidence ? 'high-value card requires elite confidence' : '',
    needsBackImage ? 'back image recommended for exact identity' : '',
    fields.fieldConfidence.parallel < 0.5 ? 'parallel is uncertain' : '',
    gradedCert?.verificationStatus === 'mismatch_detected' ? 'cert conflict detected' : '',
  ].filter(Boolean);
  return {
    scanConfidenceScore: score,
    imageQualityScore: imageQuality.imageQualityScore,
    fieldConfidence: fields.fieldConfidence,
    needsBackImage,
    needsManualConfirmation,
    manualConfirmationReasons: manualReasons,
    topCandidates,
    explanation: {
      matchedCard: bestMatch ? cardLabel(bestMatch) : null,
      whyMatched: matchEvidence.reasons,
      uncertainFields: matchEvidence.uncertain,
      photoGuidance: photoGuidance({ imageQuality: vision?.imageQuality || {}, fields: fields.fieldConfidence, gradedCert, needsBackImage }),
      publicMessage: needsManualConfirmation
        ? 'ManeFlow found a likely match, but one or more identity fields need confirmation before final pricing or inventory action.'
        : 'ManeFlow found a high-confidence catalog match. Confirm physical condition before transacting.',
    },
    recommendedNextStep: needsManualConfirmation ? 'Confirm card number, parallel, grade, and cert before adding to Vault or using value.' : 'High confidence match; still confirm condition before transacting.',
    warnings,
    candidateCount,
    bestMatchId: bestMatch?.id || result?.best?.id || null,
    gradedCert: gradedCert ? {
      slabbed: gradedCert.slabbed,
      grader: gradedCert.grader,
      certNumber: gradedCert.certNumber,
      verificationStatus: gradedCert.verificationStatus,
      certConfidence: gradedCert.certConfidence,
      matchAgreementScore: gradedCert.matchAgreementScore,
      extractionTier: gradedCert.extractionTier,
      extractionCompletenessScore: gradedCert.extractionCompletenessScore,
    } : null,
  };
}
