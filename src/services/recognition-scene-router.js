import { clamp, normalizeText } from './utils.js';

export const RECOGNITION_SCENE_ROUTER_VERSION = 'recognition-scene-router-v1.0';

export const RECOGNITION_SCENE_ROUTES = Object.freeze({
  SINGLE_RAW: 'single_raw',
  SINGLE_SLAB: 'single_slab',
  MULTI_CARD: 'multi_card',
  BINDER_PAGE: 'binder_page',
  MIXED_RAW_SLAB: 'mixed_raw_slab',
  PARTIAL_CARD: 'partial_card',
  STACK: 'stack',
  SEALED_PRODUCT: 'sealed_product',
  COLLECTION_OVERVIEW: 'collection_overview',
  NO_CARD: 'no_card',
  UNCERTAIN: 'uncertain',
});

const ROUTE_PRIORITY = Object.freeze([
  RECOGNITION_SCENE_ROUTES.NO_CARD,
  RECOGNITION_SCENE_ROUTES.SINGLE_SLAB,
  RECOGNITION_SCENE_ROUTES.BINDER_PAGE,
  RECOGNITION_SCENE_ROUTES.MIXED_RAW_SLAB,
  RECOGNITION_SCENE_ROUTES.MULTI_CARD,
  RECOGNITION_SCENE_ROUTES.PARTIAL_CARD,
  RECOGNITION_SCENE_ROUTES.STACK,
  RECOGNITION_SCENE_ROUTES.SEALED_PRODUCT,
  RECOGNITION_SCENE_ROUTES.SINGLE_RAW,
  RECOGNITION_SCENE_ROUTES.COLLECTION_OVERVIEW,
  RECOGNITION_SCENE_ROUTES.UNCERTAIN,
]);

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function confidence(value) {
  const parsed = number(value, 0);
  return clamp(parsed > 1 ? parsed / 100 : parsed, 0, 1);
}

function bool(value) {
  return value === true;
}

function normalized(value) {
  return normalizeText(value || '').replace(/\s+/g, '_');
}

function sourceEvidence(input = {}) {
  const detections = Array.isArray(input.detections) ? input.detections : [];
  const classes = detections.map((item) => normalized(item.class || item.type));
  const detectedCardCount = Math.max(0, Math.round(number(
    input.detectedCardCount
      ?? input.physicalCardCount
      ?? detections.filter((item) => ['card', 'raw_card', 'card_back', 'partial_card', 'slab'].includes(normalized(item.class || item.type))).length,
    0,
  )));
  const slabCount = Math.max(0, Math.round(number(
    input.slabCount ?? detections.filter((item) => normalized(item.class || item.type) === 'slab').length,
    0,
  )));
  const binderPocketCount = Math.max(0, Math.round(number(
    input.binderPocketCount ?? detections.filter((item) => normalized(item.class || item.type).includes('binder_pocket')).length,
    0,
  )));
  const occupiedPocketCount = Math.max(0, Math.round(number(
    input.occupiedPocketCount ?? detections.filter((item) => normalized(item.class || item.type) === 'occupied_binder_pocket').length,
    0,
  )));
  const detectorConfidence = confidence(input.detectorConfidence ?? Math.max(0, ...detections.map((item) => confidence(item.confidence))));
  const explicitNoCard = bool(input.noCard)
    || input.isCard === false
    || classes.includes('no_card')
    || normalized(input.sceneType).includes('no_card')
    || normalized(input.sceneType).includes('empty_scene');
  return {
    classes,
    detectedCardCount,
    slabCount,
    binderPocketCount,
    occupiedPocketCount,
    detectorConfidence,
    explicitNoCard,
  };
}

function scoreRoutes(input = {}, evidence = sourceEvidence(input)) {
  const sceneHint = normalized(input.sceneType || input.sceneHint);
  const cropQuality = normalized(input.cropQuality);
  const cardType = normalized(input.cardType);
  const fullFrameRatio = clamp(number(input.largestRegionAreaRatio, 0), 0, 1);
  const edgeCompleteness = confidence(input.edgeCompleteness);
  const overviewLikelihood = confidence(input.collectionOverviewConfidence);
  const sealedLikelihood = confidence(input.sealedProductConfidence);
  const stackLikelihood = confidence(input.stackConfidence);
  const scores = Object.fromEntries(ROUTE_PRIORITY.map((route) => [route, 0]));

  if (evidence.explicitNoCard) scores.no_card = 1;
  if (sceneHint.includes('collection') || sceneHint.includes('room') || sceneHint.includes('overview')) scores.collection_overview += 0.8;
  scores.collection_overview += overviewLikelihood * 0.9;

  if (evidence.binderPocketCount > 0 || sceneHint.includes('binder')) scores.binder_page += 0.78;
  if (evidence.occupiedPocketCount > 0) scores.binder_page += 0.2;

  if (evidence.detectedCardCount > 1) scores.multi_card += 0.78;
  if (sceneHint.includes('multi') || sceneHint.includes('spread') || sceneHint.includes('table')) scores.multi_card += 0.18;

  if (evidence.slabCount === 1 && evidence.detectedCardCount <= 1) scores.single_slab += 0.88;
  if (evidence.slabCount > 0 && evidence.detectedCardCount > 1) scores.mixed_raw_slab += 0.84;
  if (cardType === 'slabbed' || sceneHint.includes('slab')) scores.single_slab += 0.16;

  if (evidence.detectedCardCount === 1 && evidence.slabCount === 0) scores.single_raw += 0.72;
  if (cropQuality === 'single_card' || cardType === 'raw') scores.single_raw += 0.18;

  if (cropQuality.includes('partial') || edgeCompleteness > 0 && edgeCompleteness < 0.72) scores.partial_card += 0.82;
  if (sceneHint.includes('stack')) scores.stack += 0.72;
  scores.stack += stackLikelihood * 0.7;

  if (sceneHint.includes('sealed') || sceneHint.includes('pack') || sceneHint.includes('box')) scores.sealed_product += 0.74;
  scores.sealed_product += sealedLikelihood * 0.8;

  if (fullFrameRatio >= 0.9 && evidence.detectedCardCount <= 1 && evidence.detectorConfidence < 0.65) {
    scores.collection_overview += 0.45;
    scores.single_raw = Math.max(0, scores.single_raw - 0.35);
  }

  for (const route of Object.keys(scores)) scores[route] = clamp(scores[route], 0, 1);
  return scores;
}

function routePlan(route, evidence) {
  const common = {
    requiresDetectorEvidence: !['no_card', 'uncertain'].includes(route),
    allowCardRecord: !['no_card', 'collection_overview', 'uncertain'].includes(route),
    pricingEligible: false,
  };
  const plans = {
    single_raw: { ...common, strategy: 'single_card_fast_path', nextStages: ['geometry', 'quality_gate', 'targeted_ocr', 'hierarchical_retrieval'] },
    single_slab: { ...common, strategy: 'cert_first', nextStages: ['slab_label_crop', 'barcode_qr', 'cert_ocr', 'official_cert_verification'] },
    multi_card: { ...common, strategy: 'tiled_microbatch', nextStages: ['tiled_detection', 'deduplication', 'parallel_crop_batches'] },
    binder_page: { ...common, strategy: 'binder_grid', nextStages: ['pocket_detection', 'empty_pocket_rejection', 'parallel_crop_batches'] },
    mixed_raw_slab: { ...common, strategy: 'class_split_microbatch', nextStages: ['class_partition', 'cert_first_slabs', 'raw_card_batches'] },
    partial_card: { ...common, strategy: 'partial_evidence', nextStages: ['quality_gate', 'targeted_ocr', 'request_additional_view'] },
    stack: { ...common, strategy: 'visible_card_only', nextStages: ['visible_surface_detection', 'occlusion_accounting'] },
    sealed_product: { ...common, strategy: 'sealed_product', nextStages: ['product_ocr', 'barcode_qr', 'catalog_product_retrieval'] },
    collection_overview: { ...common, allowCardRecord: false, strategy: 'overview_reject_or_survey', nextStages: ['reject_card_creation', 'offer_collection_survey'] },
    no_card: { ...common, requiresDetectorEvidence: false, allowCardRecord: false, strategy: 'reject', nextStages: [] },
    uncertain: { ...common, requiresDetectorEvidence: false, allowCardRecord: false, strategy: 'request_better_input', nextStages: ['quality_gate', 'request_additional_view'] },
  };
  return {
    ...plans[route],
    expectedRegionCount: ['multi_card', 'binder_page', 'mixed_raw_slab'].includes(route) ? evidence.detectedCardCount : route === 'no_card' ? 0 : Math.min(1, evidence.detectedCardCount),
  };
}

export function routeRecognitionScene(input = {}) {
  const startedAt = performance.now();
  const evidence = sourceEvidence(input);
  const scores = scoreRoutes(input, evidence);
  const ranked = ROUTE_PRIORITY
    .map((route) => ({ route, score: scores[route] }))
    .sort((left, right) => right.score - left.score || ROUTE_PRIORITY.indexOf(left.route) - ROUTE_PRIORITY.indexOf(right.route));
  const primary = ranked[0];
  const runnerUp = ranked[1];
  const minimumConfidence = clamp(number(input.minimumRouteConfidence, 0.62), 0.5, 0.95);
  const minimumMargin = clamp(number(input.minimumRouteMargin, 0.08), 0, 0.5);
  const margin = primary.score - runnerUp.score;
  const route = primary.score >= minimumConfidence && margin >= minimumMargin
    ? primary.route
    : evidence.explicitNoCard
      ? RECOGNITION_SCENE_ROUTES.NO_CARD
      : RECOGNITION_SCENE_ROUTES.UNCERTAIN;
  const plan = routePlan(route, evidence);
  return {
    version: RECOGNITION_SCENE_ROUTER_VERSION,
    route,
    confidence: route === 'uncertain' ? primary.score : scores[route],
    margin,
    rankedRoutes: ranked.slice(0, 4),
    evidence,
    plan,
    warnings: route === 'uncertain'
      ? ['Scene route is not sufficiently supported; do not create a card record until detector or stronger evidence is available.']
      : route === 'collection_overview'
        ? ['Collection overview is not an individual card region.']
        : [],
    timingMs: Math.max(0, performance.now() - startedAt),
  };
}
