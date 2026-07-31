import { clamp } from './utils.js';

export const RECOGNITION_QUALITY_GATE_VERSION = 'recognition-quality-gate-v1.0';

export const RECOGNITION_QUALITY_TIERS = Object.freeze({
  FAST: 'fast_path',
  ENHANCE: 'enhance_then_retry',
  REVIEW: 'review_required',
  INSUFFICIENT: 'insufficient_evidence',
});

function score(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return clamp(parsed > 1 ? parsed / 100 : parsed, 0, 1);
}

function metric(value, fallback = 0.5) {
  return score(value, fallback);
}

function weightedMean(entries) {
  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (!totalWeight) return 0;
  return entries.reduce((sum, entry) => sum + entry.value * entry.weight, 0) / totalWeight;
}

export function evaluateRecognitionQuality(input = {}) {
  const startedAt = performance.now();
  const metrics = {
    sharpness: metric(input.sharpness),
    glareControl: 1 - metric(input.glare, 0),
    exposure: metric(input.exposure),
    resolution: metric(input.resolution),
    edgeCompleteness: metric(input.edgeCompleteness),
    textReadability: metric(input.textReadability),
    perspective: 1 - metric(input.perspectiveDistortion, 0),
    occlusionControl: 1 - metric(input.occlusion, 0),
    compressionQuality: 1 - metric(input.compressionArtifacts, 0),
  };

  const qualityScore = weightedMean([
    { value: metrics.sharpness, weight: 1.25 },
    { value: metrics.glareControl, weight: 1.0 },
    { value: metrics.exposure, weight: 0.8 },
    { value: metrics.resolution, weight: 1.15 },
    { value: metrics.edgeCompleteness, weight: 1.35 },
    { value: metrics.textReadability, weight: 1.2 },
    { value: metrics.perspective, weight: 0.75 },
    { value: metrics.occlusionControl, weight: 1.0 },
    { value: metrics.compressionQuality, weight: 0.5 },
  ]);

  const criticalFailures = [];
  if (metrics.resolution < 0.3) criticalFailures.push('resolution_too_low');
  if (metrics.edgeCompleteness < 0.35) criticalFailures.push('card_edges_incomplete');
  if (metrics.sharpness < 0.25) criticalFailures.push('image_too_blurry');
  if (metrics.glareControl < 0.2) criticalFailures.push('severe_glare');
  if (metrics.occlusionControl < 0.25) criticalFailures.push('severe_occlusion');

  let tier = RECOGNITION_QUALITY_TIERS.REVIEW;
  if (criticalFailures.length || qualityScore < 0.38) tier = RECOGNITION_QUALITY_TIERS.INSUFFICIENT;
  else if (qualityScore >= 0.78 && metrics.edgeCompleteness >= 0.75 && metrics.textReadability >= 0.65) tier = RECOGNITION_QUALITY_TIERS.FAST;
  else if (qualityScore >= 0.52) tier = RECOGNITION_QUALITY_TIERS.ENHANCE;

  const actions = [];
  if (tier === RECOGNITION_QUALITY_TIERS.FAST) actions.push('continue_fast_path');
  if (tier === RECOGNITION_QUALITY_TIERS.ENHANCE) actions.push('generate_controlled_variants', 'rerun_targeted_regions');
  if (tier === RECOGNITION_QUALITY_TIERS.REVIEW) actions.push('request_additional_view', 'preserve_supported_evidence_only');
  if (tier === RECOGNITION_QUALITY_TIERS.INSUFFICIENT) actions.push('stop_exact_identification', 'request_better_image');
  if (metrics.glareControl < 0.55) actions.push('request_glare_free_angle');
  if (metrics.edgeCompleteness < 0.7) actions.push('request_full_card_edges');
  if (metrics.textReadability < 0.55) actions.push('request_back_or_label_closeup');

  return {
    version: RECOGNITION_QUALITY_GATE_VERSION,
    tier,
    qualityScore,
    metrics,
    criticalFailures,
    actions: [...new Set(actions)],
    allowExactIdentity: tier === RECOGNITION_QUALITY_TIERS.FAST,
    allowCandidateRetrieval: tier !== RECOGNITION_QUALITY_TIERS.INSUFFICIENT,
    allowPricing: false,
    timingMs: Math.max(0, performance.now() - startedAt),
  };
}
