import { recognizeCardScene } from './recognition-engine.js';
import { parseCsv } from './csv.js';
import { normalizeText } from './utils.js';

export const RECOGNITION_BENCHMARK_VERSION = 'recognition-benchmark-v1.0';

export const RECOGNITION_FIELD_KEYS = Object.freeze(['player', 'year', 'brand', 'set', 'cardNumber', 'parallel', 'productName', 'productType', 'configuration', 'upc', 'grader', 'grade', 'certNumber']);

function clean(value, max = 1000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function maybeJson(value) {
  if (!value || typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

function inferSceneType(row = {}) {
  const text = normalizeText([row.sceneType, row.layout, row.imageName, row.imagePath, row.imageUrl, row.sourceType].filter(Boolean).join(' '));
  if (text.includes('binder')) return 'binder_page';
  if (text.includes('table') || text.includes('grid') || text.includes('group') || text.includes('lot')) return 'multi_card_table';
  if (text.includes('mixed') || text.includes('slab')) return 'mixed_raw_slab';
  if (text.includes('cert') || text.includes('label')) return 'cert_label';
  return 'single_card';
}

function expectedFromObject(input = {}) {
  return {
    cardId: clean(input.cardId || input.expectedCardId || input.id, 200) || null,
    player: clean(input.player || input.subject || input.name, 180) || null,
    year: input.year || input.releaseYear || null,
    brand: clean(input.brand || input.manufacturer || input.tcg, 120) || null,
    set: clean(input.set || input.setName || input.set_name, 220) || null,
    cardNumber: clean(input.cardNumber || input.number || input.collectorNumber || input.localId, 80) || null,
    parallel: clean(input.parallel || input.variant || input.rarity || input.finish, 180) || null,
    productName: clean(input.productName || input.product || input.sealedProduct || input.name, 220) || null,
    productType: clean(input.productType || input.sealedType || input.itemType, 120) || null,
    configuration: clean(input.configuration || input.boxType || input.packType, 180) || null,
    upc: clean(input.upc || input.barcode || input.ean, 100) || null,
    grader: clean(input.grader || input.gradeCompany, 40) || null,
    grade: clean(input.grade || input.numericGrade, 40) || null,
    certNumber: clean(input.certNumber || input.cert, 80) || null,
  };
}

function compactExpected(expected = {}) {
  return Object.fromEntries(Object.entries(expected).filter(([, value]) => value !== null && value !== undefined && value !== ''));
}

function expectedText(expected = {}) {
  return [
    expected.year,
    expected.brand,
    expected.set,
    expected.player,
    expected.cardNumber,
    expected.parallel,
    expected.productName,
    expected.productType,
    expected.configuration,
    expected.upc,
    expected.grader,
    expected.grade,
    expected.certNumber,
  ].filter(Boolean).join(' ');
}

function detectedFromExpected(expectedCards = []) {
  return expectedCards.map((expected, index) => ({
    regionId: `expected_${index + 1}`,
    boundingBox: { x: 0, y: 0, width: 1, height: 1 },
    facts: compactExpected(expected),
    fieldConfidence: Object.fromEntries(RECOGNITION_FIELD_KEYS.filter((key) => expected[key]).map((key) => [key, 0.9])),
    uncertaintyReasons: [],
    imageQuality: { source: 'benchmark_label_projection' },
  }));
}

export function normalizeBenchmarkCase(input = {}, { sourceName = 'Recognition Benchmark Dataset' } = {}) {
  const row = { ...input };
  const metadata = maybeJson(row.metadata || row.text || row.labelJson);
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) Object.assign(row, { ...metadata, ...row });
  const expectedCards = safeArray(row.expectedCards || row.cards || row.labels)
    .map((item) => compactExpected(expectedFromObject(item)))
    .filter((item) => Object.keys(item).length);
  const singleExpected = compactExpected(expectedFromObject(row));
  if (!expectedCards.length && Object.keys(singleExpected).some((key) => key !== 'cardId')) expectedCards.push(singleExpected);
  const observed = maybeJson(row.sceneAnalysis || row.observedScene || row.prediction);
  const detectedCards = safeArray(row.detectedCards || observed?.detectedCards);
  const sceneType = clean(row.sceneType || observed?.scene?.type || inferSceneType(row), 80);
  const sceneAnalysis = observed && typeof observed === 'object' && observed.scene
    ? observed
    : {
      scene: {
        type: sceneType,
        cardCount: detectedCards.length || expectedCards.length || 1,
        processingStrategy: detectedCards.length ? 'benchmark_observed_vision' : 'benchmark_catalog_from_labels',
        difficulty: row.difficulty || 'unknown',
      },
      detectedCards: detectedCards.length ? detectedCards : detectedFromExpected(expectedCards),
    };
  return {
    id: clean(row.id || row.imageId || row.fileName || row.imageName || `benchmark_${Math.random().toString(16).slice(2)}`, 160),
    sourceName: clean(row.sourceName || sourceName, 200),
    split: clean(row.split || 'evaluation', 80),
    imageRef: clean(row.imageRef || row.imageUrl || row.imagePath || row.fileName || row.imageName, 1000),
    sceneType,
    expectedCards,
    body: {
      manualText: clean(row.manualText || row.ocrText || expectedCards.map(expectedText).join(' | '), 2500),
      imageName: clean(row.imageName || row.fileName || row.imagePath || row.imageUrl, 300),
      frontDataUrl: row.frontDataUrl || row.dataUrl || '',
      backDataUrl: row.backDataUrl || '',
      certText: row.certText || '',
    },
    sceneAnalysis,
    rights: {
      sourceMode: clean(row.sourceMode || 'benchmark_only', 80),
      authorizationBasis: clean(row.authorizationBasis || 'dataset_terms_or_owner_file', 120),
      dataRightsStatus: clean(row.dataRightsStatus || 'internal_testing_only', 160),
      notes: clean(row.rightsNotes || row.notes, 1000),
    },
  };
}

export function parseRecognitionBenchmarkInput(input, options = {}) {
  if (Array.isArray(input)) return input.map((row) => normalizeBenchmarkCase(row, options));
  if (input && typeof input === 'object') {
    const rows = input.cases || input.rows || input.data || input.examples;
    if (Array.isArray(rows)) return rows.map((row) => normalizeBenchmarkCase(row, { ...options, sourceName: input.sourceName || options.sourceName }));
    return [normalizeBenchmarkCase(input, options)];
  }
  const text = String(input || '').trim();
  if (!text) return [];
  if (text.startsWith('{') || text.startsWith('[')) return parseRecognitionBenchmarkInput(JSON.parse(text), options);
  return parseCsv(text).map((row) => normalizeBenchmarkCase(row, options));
}

function fieldEqual(expected, actual) {
  if (expected === null || expected === undefined || expected === '') return null;
  if (actual === null || actual === undefined || actual === '') return false;
  if (String(expected) === String(actual)) return true;
  const left = normalizeText(expected);
  const right = normalizeText(actual);
  return Boolean(left && right && (left === right || right.includes(left) || left.includes(right)));
}

function cardMatchesExpected(expected = {}, card = {}) {
  if (!card) return false;
  if (expected.cardId && expected.cardId === card.id) return true;
  const checks = [
    fieldEqual(expected.player, card.player),
    fieldEqual(expected.year, card.year),
    fieldEqual(expected.brand, card.brand),
    fieldEqual(expected.set, card.set),
    fieldEqual(expected.cardNumber, card.cardNumber),
    expected.parallel ? fieldEqual(expected.parallel, card.parallel) : null,
    expected.productName ? fieldEqual(expected.productName, card.productName) : null,
    expected.productType ? fieldEqual(expected.productType, card.productType) : null,
    expected.configuration ? fieldEqual(expected.configuration, card.configuration) : null,
    expected.upc ? fieldEqual(expected.upc, card.upc) : null,
  ].filter((value) => value !== null);
  if (!checks.length) return false;
  const matched = checks.filter(Boolean).length;
  return matched / checks.length >= 0.72 && matched >= Math.min(3, checks.length);
}

function fieldScore(expected = {}, facts = {}, best = {}) {
  let total = 0;
  let correct = 0;
  const details = {};
  for (const key of RECOGNITION_FIELD_KEYS) {
    const actual = facts[key] ?? (key === 'player' ? facts.subject : undefined) ?? best[key] ?? (key === 'grader' ? best.grade?.company : undefined) ?? (key === 'grade' ? best.grade?.grade : undefined);
    const value = fieldEqual(expected[key], actual);
    if (value === null) continue;
    total += 1;
    if (value) correct += 1;
    details[key] = Boolean(value);
  }
  return { total, correct, details };
}

function recommendation(metrics = {}) {
  const notes = [];
  if (!metrics.totalExpectedCards) return ['Add expected card labels before using this set for top-1/top-3 or field-level accuracy.'];
  if (metrics.top1Accuracy < 80) notes.push('Improve catalog ranking and vision prompt before broad consumer launch.');
  if (metrics.top3Accuracy - metrics.top1Accuracy > 12) notes.push('Add stronger confirmation UI because the correct card is often present but not first.');
  if (metrics.falseConfidentRate > 3) notes.push('Tighten confidence calibration; false confident matches are more dangerous than review prompts.');
  if (metrics.needsConfirmationRate > 35) notes.push('Improve image quality guidance and back/cert capture to reduce manual review load.');
  if (metrics.fieldAccuracy < 82) notes.push('Add targeted extraction rules for the weakest fields in this dataset.');
  return notes.length ? notes : ['Benchmark looks healthy. Expand the dataset across more sets, slabs, binder pages, and low-light conditions.'];
}

function emptyAggregate(sceneType = 'all') {
  return {
    sceneType,
    cases: 0,
    expectedCards: 0,
    sceneCorrect: 0,
    top1: 0,
    top3: 0,
    falseConfident: 0,
    needsConfirmation: 0,
    fieldCorrect: 0,
    fieldTotal: 0,
  };
}

function pct(numerator, denominator) {
  return denominator ? Math.round((numerator / denominator) * 1000) / 10 : 0;
}

function finalizeAggregate(aggregate = emptyAggregate()) {
  return {
    sceneType: aggregate.sceneType,
    cases: aggregate.cases,
    expectedCards: aggregate.expectedCards,
    sceneAccuracy: pct(aggregate.sceneCorrect, aggregate.cases),
    top1Accuracy: pct(aggregate.top1, aggregate.expectedCards),
    top3Accuracy: pct(aggregate.top3, aggregate.expectedCards),
    fieldAccuracy: pct(aggregate.fieldCorrect, aggregate.fieldTotal),
    falseConfidentRate: pct(aggregate.falseConfident, aggregate.expectedCards),
    needsConfirmationRate: pct(aggregate.needsConfirmation, aggregate.expectedCards),
  };
}

function incrementAggregate(aggregate, { expectedCards, sceneCorrect, top1, top3, falseConfident, needsConfirmation, fieldCorrect, fieldTotal }) {
  aggregate.cases += 1;
  aggregate.expectedCards += expectedCards;
  aggregate.sceneCorrect += sceneCorrect ? 1 : 0;
  aggregate.top1 += top1;
  aggregate.top3 += top3;
  aggregate.falseConfident += falseConfident;
  aggregate.needsConfirmation += needsConfirmation;
  aggregate.fieldCorrect += fieldCorrect;
  aggregate.fieldTotal += fieldTotal;
}

function failureSummary(rows = [], fieldBreakdown = {}) {
  const sceneMisses = rows.filter((row) => !row.sceneCorrect);
  const perCard = rows.flatMap((row) => row.perCard.map((card) => ({ ...card, caseId: row.caseId, sceneExpected: row.sceneExpected, imageRef: row.imageRef })));
  const missedTop1 = perCard.filter((card) => !card.top1);
  const correctInTop3 = perCard.filter((card) => !card.top1 && card.top3);
  const falseConfident = perCard.filter((card) => !card.top1 && Number(card.bestConfidence || 0) >= 0.86 && !card.needsConfirmation);
  const needsConfirmation = perCard.filter((card) => card.needsConfirmation);
  const weakFields = Object.entries(fieldBreakdown)
    .filter(([, value]) => value.total > 0 && value.accuracy < 85)
    .sort((a, b) => a[1].accuracy - b[1].accuracy)
    .map(([field, value]) => ({ field, ...value }));
  const hardScenes = rows.filter((row) => ['binder_page', 'multi_card_table', 'mixed_raw_slab'].includes(row.sceneExpected) || row.expectedCount > 1);
  const hardSceneCards = hardScenes.flatMap((row) => row.perCard);
  return {
    sceneMisses: sceneMisses.length,
    missedTop1: missedTop1.length,
    correctInTop3: correctInTop3.length,
    falseConfident: falseConfident.length,
    needsConfirmation: needsConfirmation.length,
    weakFields,
    multiCardOrBinderCases: hardScenes.length,
    multiCardOrBinderTop1Accuracy: pct(hardSceneCards.filter((card) => card.top1).length, hardSceneCards.length),
    examples: {
      missedTop1: missedTop1.slice(0, 8).map(({ caseId, sceneExpected, imageRef, expected, bestMatchId, bestConfidence }) => ({ caseId, sceneExpected, imageRef, expected, bestMatchId, bestConfidence })),
      falseConfident: falseConfident.slice(0, 8).map(({ caseId, sceneExpected, imageRef, expected, bestMatchId, bestConfidence }) => ({ caseId, sceneExpected, imageRef, expected, bestMatchId, bestConfidence })),
      sceneMisses: sceneMisses.slice(0, 8).map(({ caseId, imageRef, sceneExpected, sceneActual, expectedCount, detectedCount }) => ({ caseId, imageRef, sceneExpected, sceneActual, expectedCount, detectedCount })),
    },
  };
}

export function runRecognitionBenchmark(cases = [], {
  cards = [],
  corrections = [],
  enrichCard = (card) => card,
  now = new Date(),
} = {}) {
  const normalizedCases = cases.map((item) => normalizeBenchmarkCase(item));
  const rows = [];
  const fieldTotals = { correct: 0, total: 0 };
  const fieldBreakdown = Object.fromEntries(RECOGNITION_FIELD_KEYS.map((key) => [key, { correct: 0, total: 0, accuracy: 0 }]));
  const sceneAggregates = new Map();
  const multiCardAggregate = emptyAggregate('multi_card_binder_focus');
  let expectedTotal = 0;
  let top1 = 0;
  let top3 = 0;
  let sceneCorrect = 0;
  let falseConfident = 0;
  let needsConfirmation = 0;

  for (const testCase of normalizedCases) {
    const recognition = recognizeCardScene({
      cards,
      body: testCase.body,
      sceneAnalysis: testCase.sceneAnalysis,
      corrections,
      enrichCard,
    });
    const isSceneCorrect = normalizeText(recognition.scene.type) === normalizeText(testCase.sceneType);
    if (isSceneCorrect) sceneCorrect += 1;
    const expectedCards = testCase.expectedCards;
    expectedTotal += expectedCards.length;
    let caseTop1 = 0;
    let caseTop3 = 0;
    let caseFalseConfident = 0;
    let caseNeedsConfirmation = 0;
    let caseFieldCorrect = 0;
    let caseFieldTotal = 0;
    const perCard = expectedCards.map((expected, index) => {
      const item = recognition.items[index] || recognition.items[0] || {};
      const matches = safeArray(item.matches);
      const best = matches[0] || null;
      const inTop1 = cardMatchesExpected(expected, best);
      const inTop3 = matches.slice(0, 3).some((card) => cardMatchesExpected(expected, card));
      const fields = fieldScore(expected, item.facts || {}, best || {});
      fieldTotals.correct += fields.correct;
      fieldTotals.total += fields.total;
      caseFieldCorrect += fields.correct;
      caseFieldTotal += fields.total;
      for (const [field, correct] of Object.entries(fields.details)) {
        fieldBreakdown[field].total += 1;
        if (correct) fieldBreakdown[field].correct += 1;
      }
      if (inTop1) { top1 += 1; caseTop1 += 1; }
      if (inTop3) { top3 += 1; caseTop3 += 1; }
      if (!inTop1 && Number(best?.confidence || 0) >= 0.86 && !item.requiresManualConfirmation) { falseConfident += 1; caseFalseConfident += 1; }
      if (item.requiresManualConfirmation) { needsConfirmation += 1; caseNeedsConfirmation += 1; }
      return {
        expected,
        bestMatchId: best?.id || null,
        bestConfidence: best?.confidence ?? null,
        top1: inTop1,
        top3: inTop3,
        fieldAccuracy: fields.total ? Math.round((fields.correct / fields.total) * 1000) / 10 : null,
        fieldDetails: fields.details,
        fieldMisses: Object.entries(fields.details).filter(([, correct]) => !correct).map(([field]) => field),
        needsConfirmation: Boolean(item.requiresManualConfirmation),
        path: item.path || null,
        explanation: item.explanation || null,
      };
    });
    rows.push({
      caseId: testCase.id,
      sourceName: testCase.sourceName,
      imageRef: testCase.imageRef,
      expectedCount: expectedCards.length,
      detectedCount: recognition.summary.detectedCards,
      sceneExpected: testCase.sceneType,
      sceneActual: recognition.scene.type,
      sceneCorrect: isSceneCorrect,
      averageScanConfidence: recognition.summary.averageScanConfidence,
      perCard,
    });
    const sceneKey = testCase.sceneType || 'unknown';
    if (!sceneAggregates.has(sceneKey)) sceneAggregates.set(sceneKey, emptyAggregate(sceneKey));
    const aggregatePayload = {
      expectedCards: expectedCards.length,
      sceneCorrect: isSceneCorrect,
      top1: caseTop1,
      top3: caseTop3,
      falseConfident: caseFalseConfident,
      needsConfirmation: caseNeedsConfirmation,
      fieldCorrect: caseFieldCorrect,
      fieldTotal: caseFieldTotal,
    };
    incrementAggregate(sceneAggregates.get(sceneKey), aggregatePayload);
    if (['binder_page', 'multi_card_table', 'mixed_raw_slab'].includes(sceneKey) || expectedCards.length > 1) {
      incrementAggregate(multiCardAggregate, aggregatePayload);
    }
  }

  const metrics = {
    totalCases: normalizedCases.length,
    totalExpectedCards: expectedTotal,
    sceneAccuracy: pct(sceneCorrect, normalizedCases.length),
    top1Accuracy: pct(top1, expectedTotal),
    top3Accuracy: pct(top3, expectedTotal),
    fieldAccuracy: pct(fieldTotals.correct, fieldTotals.total),
    falseConfidentRate: pct(falseConfident, expectedTotal),
    needsConfirmationRate: pct(needsConfirmation, expectedTotal),
  };
  for (const value of Object.values(fieldBreakdown)) value.accuracy = pct(value.correct, value.total);
  const sceneBreakdown = [...sceneAggregates.values()].map(finalizeAggregate);
  const multiCardFocus = finalizeAggregate(multiCardAggregate);
  return {
    version: RECOGNITION_BENCHMARK_VERSION,
    generatedAt: now.toISOString(),
    metrics,
    fieldBreakdown,
    sceneBreakdown,
    multiCardFocus,
    failurePatterns: failureSummary(rows, fieldBreakdown),
    recommendations: recommendation(metrics),
    rows,
    policy: {
      benchmarkOnly: true,
      doesNotCreateMarketValues: true,
      doesNotPublishDatasetImages: true,
      useOnlyAuthorizedDatasets: true,
    },
  };
}
