import { identifyCard } from './identification.js';
import {
  applyRecognitionCandidateScope,
  buildRecognitionEvidenceLedger,
  evaluateRecognitionDecision,
} from './recognition-decision.js';
import { evaluateScanConfidence } from './scan-confidence.js';
import { clamp, normalizeText } from './utils.js';

export const RECOGNITION_ENGINE_VERSION = 'recognition-engine-v1.1';

const SCENE_TYPES = new Set([
  'single_card',
  'multi_card_table',
  'binder_page',
  'mixed_raw_slab',
  'sealed_product',
  'cert_label',
  'manual_text',
  'no_card',
  'unknown',
]);

function clean(value, max = 1000) {
  return String(value ?? '').trim().slice(0, max);
}

function has(value) {
  return clean(value).length > 0;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeSceneType(value = '') {
  const text = normalizeText(value).replace(/\s+/g, '_');
  if (SCENE_TYPES.has(text)) return text;
  if (text.includes('no_card') || text.includes('non_card') || text.includes('empty_scene')) return 'no_card';
  if (text.includes('binder')) return 'binder_page';
  if (text.includes('mixed')) return 'mixed_raw_slab';
  if (text.includes('table') || text.includes('layout') || text.includes('group') || text.includes('multi')) return 'multi_card_table';
  if (text.includes('pack') || text.includes('box') || text.includes('sealed') || text.includes('booster') || text.includes('blaster') || text.includes('hobby') || text.includes('retail') || text.includes('tin') || text.includes('etb')) return 'sealed_product';
  if (text.includes('cert') || text.includes('label')) return 'cert_label';
  if (text.includes('manual')) return 'manual_text';
  if (text.includes('single')) return 'single_card';
  return 'unknown';
}

function normalizeBox(box = {}) {
  const source = Array.isArray(box) ? { x: box[0], y: box[1], width: box[2], height: box[3] } : box || {};
  const number = (value, fallback) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return clamp(parsed > 1 ? parsed / 100 : parsed, 0, 1);
  };
  return {
    x: number(source.x ?? source.left, 0),
    y: number(source.y ?? source.top, 0),
    width: number(source.width ?? source.w, 1),
    height: number(source.height ?? source.h, 1),
  };
}

function factsFromRegion(region = {}) {
  const facts = region.facts && typeof region.facts === 'object' ? region.facts : region;
  return {
    player: clean(facts.player || facts.subject, 160) || null,
    subject: clean(facts.subject || facts.player, 160) || null,
    team: clean(facts.team, 120) || null,
    sport: clean(facts.sport, 80) || null,
    year: has(facts.year) ? facts.year : null,
    brand: clean(facts.brand, 120) || null,
    set: clean(facts.set, 180) || null,
    subset: clean(facts.subset, 160) || null,
    cardNumber: clean(facts.cardNumber || facts.number, 80) || null,
    parallel: clean(facts.parallel || facts.variation, 180) || null,
    variation: clean(facts.variation, 180) || null,
    productName: clean(facts.productName || facts.product || facts.name, 220) || null,
    productType: clean(facts.productType || facts.sealedType || facts.itemType, 120) || null,
    sealedType: clean(facts.sealedType, 120) || null,
    configuration: clean(facts.configuration || facts.boxType || facts.packType, 180) || null,
    sku: clean(facts.sku || facts.productId, 100) || null,
    upc: clean(facts.upc || facts.barcode, 100) || null,
    serialNumber: clean(facts.serialNumber, 80) || null,
    rookie: facts.rookie ?? facts.rookieFlag ?? null,
    autograph: facts.autograph ?? facts.autographFlag ?? null,
    relic: facts.relic ?? facts.patch ?? facts.memorabilia ?? null,
    grader: clean(facts.grader || facts.gradeCompany || facts.grade?.company, 40) || null,
    grade: clean(facts.grade?.grade || facts.grade || facts.numericGrade, 40) || null,
    certNumber: clean(facts.certNumber || facts.cert, 80) || null,
    barcodePayload: clean(facts.barcodePayload, 500) || null,
    qrPayload: clean(facts.qrPayload, 500) || null,
    visibleText: safeArray(facts.visibleText).map((item) => clean(item, 300)).filter(Boolean),
  };
}

function fieldConfidence(region = {}) {
  const input = region.fieldConfidence || region.confidenceByField || {};
  const normalized = {};
  for (const [key, value] of Object.entries(input)) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) normalized[key] = clamp(parsed > 1 ? parsed / 100 : parsed, 0, 1);
  }
  return normalized;
}

function regionQueryText(region = {}, body = {}, useGlobalText = false) {
  const facts = factsFromRegion(region);
  return [
    facts.year,
    facts.brand,
    facts.set,
    facts.subset,
    facts.player || facts.subject,
    facts.cardNumber,
    facts.parallel,
    facts.variation,
    facts.serialNumber,
    facts.grader,
    facts.grade,
    facts.certNumber,
    ...facts.visibleText,
    ...(safeArray(region.candidateDescriptions).map((candidate) => candidate.description || candidate.why)),
    useGlobalText ? body.manualText : '',
    useGlobalText ? body.certText : '',
    useGlobalText ? body.ocrText : '',
    useGlobalText ? body.barcodeText : '',
    useGlobalText ? body.qrText : '',
  ].filter(Boolean).join(' ');
}

export function classifyRecognitionScene({ body = {}, sceneAnalysis = null } = {}) {
  if (sceneAnalysis?.scene) {
    const type = normalizeSceneType(sceneAnalysis.scene.type);
    const cardCount = Math.max(0, Number(sceneAnalysis.scene.cardCount || sceneAnalysis.detectedCards?.length || 0));
    return {
      type,
      cardCount: type === 'no_card' ? 0 : cardCount,
      processingStrategy: sceneAnalysis.scene.processingStrategy || 'vision_scene',
      layoutRows: sceneAnalysis.scene.layoutRows ?? null,
      layoutColumns: sceneAnalysis.scene.layoutColumns ?? null,
      difficulty: sceneAnalysis.scene.difficulty || 'unknown',
      warnings: safeArray(sceneAnalysis.scene.warnings),
    };
  }
  const name = normalizeText([body.imageName, body.frontName, body.certName].filter(Boolean).join(' '));
  if (has(body.certDataUrl) && !has(body.frontDataUrl) && !has(body.dataUrl)) {
    return { type: 'cert_label', cardCount: 1, processingStrategy: 'cert_only', layoutRows: null, layoutColumns: null, difficulty: 'medium', warnings: [] };
  }
  if (name.includes('binder')) return { type: 'binder_page', cardCount: 0, processingStrategy: 'filename_hint', layoutRows: null, layoutColumns: null, difficulty: 'hard', warnings: ['Binder layout inferred from filename; detector evidence is required before creating card regions.'] };
  if (name.includes('table') || name.includes('group') || name.includes('lot')) return { type: 'multi_card_table', cardCount: 0, processingStrategy: 'filename_hint', layoutRows: null, layoutColumns: null, difficulty: 'hard', warnings: ['Multi-card layout inferred from filename; detector evidence is required before creating card regions.'] };
  if (name.includes('pack') || name.includes('box') || name.includes('sealed') || name.includes('booster') || name.includes('blaster') || name.includes('hobby') || name.includes('retail') || name.includes('tin') || name.includes('etb')) {
    return { type: 'sealed_product', cardCount: 0, processingStrategy: 'filename_hint', layoutRows: null, layoutColumns: null, difficulty: 'medium', warnings: ['Sealed product inferred from filename; detector or product evidence is required before creating a region.'] };
  }
  if (!has(body.frontDataUrl) && !has(body.dataUrl) && !has(body.certDataUrl) && has(body.manualText)) {
    return { type: 'manual_text', cardCount: 1, processingStrategy: 'text_only', layoutRows: null, layoutColumns: null, difficulty: 'medium', warnings: [] };
  }
  if (has(body.frontDataUrl) || has(body.dataUrl)) {
    return {
      type: 'unknown',
      cardCount: 0,
      processingStrategy: 'unverified_image',
      layoutRows: null,
      layoutColumns: null,
      difficulty: 'unknown',
      warnings: ['No physical-card region has been confirmed for this image.'],
    };
  }
  return { type: 'unknown', cardCount: 0, processingStrategy: 'no_input', layoutRows: null, layoutColumns: null, difficulty: 'unknown', warnings: [] };
}

function fallbackRegion({ body = {}, vision = null, scene = null } = {}) {
  const source = vision || {};
  return {
    regionId: 'region_1',
    boundingBox: normalizeBox(source.boundingBox),
    orientation: source.orientation || source.visualMarkers?.orientation || 'unknown',
    cardType: scene?.type === 'cert_label' ? 'slabbed' : scene?.type === 'sealed_product' ? 'sealed' : 'raw_or_unknown',
    slabbed: scene?.type === 'cert_label' || Boolean(source.slabbed),
    facts: factsFromRegion(source),
    fieldConfidence: fieldConfidence(source),
    visualMarkers: source.visualMarkers || {},
    imageQuality: source.imageQuality || {},
    candidateDescriptions: safeArray(source.candidateDescriptions),
    warnings: safeArray(source.warnings),
    uncertaintyReasons: safeArray(source.uncertaintyReasons),
    needsBackImage: source.needsBackImage ?? !has(body.backDataUrl),
    needsCertCloseup: source.needsCertCloseup ?? null,
    overallConfidence: source.confidence ?? source.overallConfidence ?? null,
    provider: clean(source.provider || source.evidenceProvider, 160) || null,
    evidenceSource: clean(source.evidenceSource, 160) || null,
    evidenceRole: clean(source.evidenceRole, 80) || null,
  };
}

function supportsOneCardRegion(source = {}, scene = {}) {
  const facts = factsFromRegion(source);
  const cropQuality = normalizeText(source.cropQuality || source.crop_quality || '');
  const cardType = normalizeText(source.cardType || source.card_type || '');
  const explicitCount = Number(
    source.physicalCardCount
    ?? source.detectedCardCount
    ?? source.detected_object_count
    ?? source.cardCount
    ?? scene.cardCount
    ?? 0,
  );
  const rejected = source.noCard === true
    || source.isCard === false
    || cropQuality.includes('no card')
    || cropQuality.includes('multiple')
    || cardType === 'non card'
    || cardType === 'no card'
    || scene.type === 'no_card';
  if (rejected) return false;

  const subject = facts.player || facts.subject;
  const identityAnchors = [facts.year, facts.brand, facts.set, facts.cardNumber, facts.parallel, facts.grader]
    .filter(Boolean).length;
  const identitySupported = Boolean(
    facts.certNumber
    || (subject && identityAnchors >= 1)
    || (facts.cardNumber && (facts.brand || facts.set)),
  );
  const productSupported = Boolean(
    (facts.productName || facts.productType || facts.sealedType)
    && (facts.brand || facts.configuration || facts.upc),
  );
  const boundarySupported = Boolean(
    source.boundingBox
    || source.box
    || source.cardBoundary
    || source.physicalCardDetected === true
    || source.completeCardVisible === true
    || cropQuality === 'single card'
    || cardType === 'raw'
    || cardType === 'slabbed',
  );

  return Boolean(
    facts.certNumber
    || productSupported
    || (explicitCount === 1 && (boundarySupported || identitySupported))
    || (boundarySupported && identitySupported),
  );
}

function detectedRegions({ body = {}, sceneAnalysis = null, vision = null, scene = null } = {}) {
  const regions = safeArray(sceneAnalysis?.detectedCards);
  if (regions.length) {
    return regions
      .filter((region) => supportsOneCardRegion(region, { ...scene, cardCount: 1 }))
      .map((region, index) => ({
        ...fallbackRegion({ body, vision: region, scene }),
        regionId: clean(region.regionId || region.id || `region_${index + 1}`, 80),
        boundingBox: normalizeBox(region.boundingBox || region.box),
        cardType: region.cardType || region.type || (scene?.type === 'sealed_product' ? 'sealed' : region.slabbed ? 'slabbed' : 'raw_or_unknown'),
        slabbed: Boolean(region.slabbed || region.facts?.grader || region.facts?.certNumber),
      }));
  }
  if (scene?.type === 'manual_text' || scene?.type === 'cert_label') {
    return [fallbackRegion({ body, vision, scene })];
  }
  if (supportsOneCardRegion(vision || {}, scene || {})) {
    return [fallbackRegion({ body, vision, scene })];
  }
  return [];
}

function overlapScore(left = '', right = '') {
  const leftTokens = normalizeText(left).split(' ').filter((token) => token.length >= 3);
  const rightTokens = new Set(normalizeText(right).split(' ').filter((token) => token.length >= 3));
  if (!leftTokens.length || !rightTokens.size) return 0;
  return leftTokens.filter((token) => rightTokens.has(token)).length / leftTokens.length;
}

function candidateLabel(card = {}) {
  return [
    card.year,
    card.brand,
    card.set,
    card.player || card.subject,
    card.cardNumber ? `#${card.cardNumber}` : '',
    card.parallel,
    card.productName,
    card.productType,
    card.configuration,
    card.grade?.company,
    card.grade?.grade,
  ].filter(Boolean).join(' ');
}

function correctionLearningBoost(card = {}, region = {}, corrections = []) {
  const regionText = regionQueryText(region);
  let boost = 0;
  for (const correction of safeArray(corrections).slice(0, 500)) {
    if (correction.selectedCardId !== card.id) continue;
    const correctedText = Object.values(correction.correctedFields || {}).join(' ');
    const reasonText = [correctedText, correction.reason].filter(Boolean).join(' ');
    const overlap = overlapScore(reasonText, regionText || candidateLabel(card));
    if (overlap > 0) boost = Math.max(boost, 0.03 + overlap * 0.05);
    else boost = Math.max(boost, 0.02);
  }
  return boost;
}

function applyCorrectionLearning(matches = [], cards = [], region = {}, corrections = [], enrichCard = (card) => card) {
  const learnedIds = new Set(safeArray(corrections).map((item) => item.selectedCardId).filter(Boolean));
  const expanded = [...matches];
  for (const id of learnedIds) {
    if (!expanded.some((card) => card.id === id)) {
      const card = cards.find((item) => item.id === id);
      if (card && overlapScore(regionQueryText(region), candidateLabel(card)) >= 0.25) expanded.push({ ...card, confidence: 0.52, matchScore: 0 });
    }
  }
  return expanded.map((card) => {
    const boost = correctionLearningBoost(card, region, corrections);
    const base = Number(card.confidence ?? 0.3);
    return { ...enrichCard(card), confidence: Math.min(0.995, base + boost), learnedCorrectionBoost: boost ? Math.round(boost * 1000) / 1000 : undefined };
  }).sort((a, b) => (b.confidence || 0) - (a.confidence || 0) || (b.matchScore || 0) - (a.matchScore || 0)).slice(0, 7);
}

function topGap(matches = []) {
  if (matches.length < 2) return 1;
  return Number(matches[0].confidence || 0) - Number(matches[1].confidence || 0);
}

function isHighValue(matches = []) {
  return Number(matches[0]?.market?.value || 0) >= 250;
}

function chooseRecognitionPath({ scene, region, matches, confidence }) {
  const field = confidence.fieldConfidence || {};
  const ambiguous = matches.length > 1 && topGap(matches) < 0.08;
  const hardScene = ['multi_card_table', 'binder_page', 'mixed_raw_slab', 'sealed_product'].includes(scene.type);
  const difficultCard = region.slabbed || isHighValue(matches) || ambiguous || confidence.needsManualConfirmation
    || Number(field.parallel || 0) < 0.58 || Number(field.cardNumber || 0) < 0.62;
  if (!difficultCard && !hardScene && Number(matches[0]?.confidence || 0) >= 0.86) return 'fast_path';
  if (hardScene && difficultCard) return 'dual_path';
  return difficultCard ? 'accurate_path' : 'fast_path_review';
}

function confidenceLabel(score) {
  if (score >= 88) return 'elite';
  if (score >= 78) return 'strong';
  if (score >= 60) return 'review';
  return 'low';
}

function buildRegionExplanation({ scene, region, result, confidence, path }) {
  const facts = factsFromRegion(region);
  const visual = [];
  if (facts.cardNumber) visual.push(`card number ${facts.cardNumber}`);
  if (facts.parallel) visual.push(`parallel ${facts.parallel}`);
  if (facts.serialNumber) visual.push(`serial ${facts.serialNumber}`);
  if (facts.productType) visual.push(`sealed product type ${facts.productType}`);
  if (facts.configuration) visual.push(`configuration ${facts.configuration}`);
  if (facts.upc) visual.push(`UPC/barcode ${facts.upc}`);
  if (facts.grader || facts.grade) visual.push(`slab ${[facts.grader, facts.grade].filter(Boolean).join(' ')}`);
  if (facts.certNumber) visual.push(`cert ${facts.certNumber}`);
  const uncertainty = [
    ...safeArray(region.uncertaintyReasons),
    ...safeArray(confidence.explanation?.uncertainFields).map((field) => `${field} uncertain`),
  ];
  return {
    publicMessage: confidence.explanation?.publicMessage || result.message,
    whyMatched: [...new Set([...(confidence.explanation?.whyMatched || []), ...visual])].slice(0, 9),
    uncertain: [...new Set(uncertainty)].slice(0, 9),
    photoGuidance: confidence.explanation?.photoGuidance || [],
    strategy: path,
    sceneContext: `Recognized as ${scene.type.replaceAll('_', ' ')} using ${path.replaceAll('_', ' ')}.`,
  };
}

function summarize(items = [], scene = {}) {
  const scores = items.map((item) => item.scanConfidence.scanConfidenceScore).filter(Number.isFinite);
  const pathCounts = items.reduce((acc, item) => {
    acc[item.path] = (acc[item.path] || 0) + 1;
    return acc;
  }, {});
  const selectiveCounts = items.reduce((acc, item) => {
    const status = item.selectiveDecision?.status || 'unavailable';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
  return {
    detectedCards: items.length,
    matchedCards: items.filter((item) => item.matches.length).length,
    needsConfirmation: items.filter((item) => item.scanConfidence.needsManualConfirmation).length,
    highValueConfirmation: items.filter((item) => item.scanConfidence.manualConfirmationReasons?.some((reason) => /high-value/i.test(reason))).length,
    averageScanConfidence: scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : 0,
    pathCounts,
    selectiveCounts,
    sceneWarnings: safeArray(scene.warnings),
  };
}

export function recognizeCardScene({
  cards = [],
  body = {},
  sceneAnalysis = null,
  vision = null,
  gradedCert = null,
  corrections = [],
  candidateScope = null,
  candidatePriors = [],
  calibration = null,
  enrichCard = (card) => card,
} = {}) {
  const scene = classifyRecognitionScene({ body, sceneAnalysis });
  const regions = detectedRegions({ body, sceneAnalysis, vision: vision || sceneAnalysis?.primaryCard, scene });
  const candidateUniverse = applyRecognitionCandidateScope(cards, candidateScope);
  const useGlobalText = regions.length === 1;
  const items = regions.map((region, index) => {
    const regionVision = {
      ...region,
      facts: factsFromRegion(region),
      fieldConfidence: fieldConfidence(region),
      confidence: region.overallConfidence,
    };
    const regionCert = index === 0 ? gradedCert : null;
    const result = identifyCard({
      cards: candidateUniverse.cards,
      imageName: body.imageName,
      manualText: regionQueryText(region, body, useGlobalText),
      ocrText: useGlobalText ? body.ocrText : safeArray(region.facts?.visibleText).join(' '),
      vision: regionVision,
      gradedCert: regionCert,
    });
    const learnedMatches = applyCorrectionLearning(result.matches, candidateUniverse.cards, region, corrections, enrichCard);
    const candidateExact = Boolean(learnedMatches[0] && Number(learnedMatches[0].confidence || 0) >= 0.9 && topGap(learnedMatches) >= 0.08);
    const scanConfidence = evaluateScanConfidence({
      body: { ...body, gradedCert: regionCert },
      vision: regionVision,
      result: { ...result, exact: candidateExact, matches: learnedMatches, gradedCert: regionCert },
      matches: learnedMatches,
    });
    const exact = Boolean(result.exact && candidateExact && !scanConfidence.needsManualConfirmation);
    const path = chooseRecognitionPath({ scene, region, matches: learnedMatches, confidence: scanConfidence });
    const regionPriors = safeArray(candidatePriors).filter((prior) => !prior?.regionId || prior.regionId === region.regionId);
    const evidence = buildRecognitionEvidenceLedger({
      region: regionVision,
      body,
      gradedCert: regionCert,
      candidatePriors: regionPriors,
    });
    const selectiveDecision = evaluateRecognitionDecision({
      matches: learnedMatches,
      evidence,
      candidateScope,
      scopeResult: candidateUniverse,
      calibration,
    });
    return {
      regionId: region.regionId || `region_${index + 1}`,
      index,
      boundingBox: normalizeBox(region.boundingBox),
      orientation: region.orientation || 'unknown',
      cardType: region.cardType || (region.slabbed ? 'slabbed' : 'raw_or_unknown'),
      slabbed: Boolean(region.slabbed || regionCert?.slabbed),
      facts: factsFromRegion(region),
      fieldConfidence: scanConfidence.fieldConfidence,
      visualMarkers: region.visualMarkers || {},
      imageQuality: region.imageQuality || {},
      path,
      confidenceLabel: confidenceLabel(scanConfidence.scanConfidenceScore),
      exact,
      mode: result.mode,
      query: result.query,
      matches: learnedMatches,
      topCandidates: learnedMatches.slice(0, 3).map((card, rank) => ({
        id: card.id,
        title: candidateLabel(card),
        confidence: card.confidence ?? null,
        image: card.image || null,
        catalogSource: card.catalogSource || null,
        rank: rank + 1,
      })),
      scanConfidence,
      evidence,
      selectiveDecision,
      candidateScope: selectiveDecision.candidateScope,
      explanation: buildRegionExplanation({ scene, region, result, confidence: scanConfidence, path }),
      requiresManualConfirmation: scanConfidence.needsManualConfirmation,
      warnings: [...new Set([...safeArray(region.warnings), ...safeArray(scanConfidence.warnings)])],
    };
  });
  const primary = items[0] || null;
  return {
    version: RECOGNITION_ENGINE_VERSION,
    generatedAt: new Date().toISOString(),
    scene,
    items,
    primary,
    summary: summarize(items, scene),
    trustPolicy: {
      preferUncertainOverWrong: true,
      lowConfidenceRequiresConfirmation: true,
      highValueRequiresEliteConfidence: true,
      correctionsImproveFutureRanking: true,
      evidenceBoundedDecisionAvailable: true,
      automaticAcceptanceRequiresCalibration: true,
      unconfirmedImagesCreateNoRegion: true,
      imagesProcessedRemotely: Boolean(sceneAnalysis),
    },
    message: !primary
      ? 'No individual physical card region was confirmed. No card record was created.'
      : primary.requiresManualConfirmation
        ? 'ManeFlow found likely card identities, but one or more regions need confirmation before pricing or inventory action.'
        : 'ManeFlow recognized the visible card region(s). Confirm condition before transacting.',
  };
}
