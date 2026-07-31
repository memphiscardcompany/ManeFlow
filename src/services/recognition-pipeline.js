import { recognizeCardScene } from './recognition-engine.js';
import { evaluateRecognitionQuality } from './recognition-quality-gate.js';
import { routeRecognitionScene } from './recognition-scene-router.js';

export const RECOGNITION_PIPELINE_VERSION = 'recognition-pipeline-v1.0';

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizedFlag(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(String(value).trim().toLowerCase());
}

function detectorInput({ body = {}, sceneAnalysis = null, vision = null } = {}) {
  const detections = safeArray(sceneAnalysis?.detectedCards);
  const primary = vision || sceneAnalysis?.primaryCard || {};
  const scene = sceneAnalysis?.scene || {};
  const detectedCardCount = Number(
    scene.cardCount
      ?? sceneAnalysis?.detectedCardCount
      ?? detections.length
      ?? primary.detectedCardCount
      ?? primary.physicalCardCount
      ?? 0,
  );
  return {
    detections,
    detectedCardCount: Number.isFinite(detectedCardCount) ? Math.max(0, detectedCardCount) : 0,
    physicalCardCount: primary.physicalCardCount,
    slabCount: scene.slabCount ?? primary.slabCount,
    binderPocketCount: scene.binderPocketCount ?? primary.binderPocketCount,
    occupiedPocketCount: scene.occupiedPocketCount ?? primary.occupiedPocketCount,
    detectorConfidence: scene.detectorConfidence ?? primary.detectorConfidence ?? primary.confidence,
    sceneType: scene.type ?? body.sceneType,
    sceneHint: body.sceneHint,
    cropQuality: primary.cropQuality,
    cardType: primary.cardType,
    largestRegionAreaRatio: primary.largestRegionAreaRatio,
    edgeCompleteness: primary.edgeCompleteness ?? primary.imageQuality?.edgeCompleteness,
    collectionOverviewConfidence: scene.collectionOverviewConfidence ?? primary.collectionOverviewConfidence,
    sealedProductConfidence: scene.sealedProductConfidence ?? primary.sealedProductConfidence,
    stackConfidence: scene.stackConfidence ?? primary.stackConfidence,
    noCard: scene.noCard ?? primary.noCard,
    isCard: primary.isCard,
  };
}

function qualityInput(region = {}) {
  const quality = region.imageQuality || region.quality || {};
  return {
    sharpness: quality.sharpness ?? region.sharpness,
    glare: quality.glare ?? region.glare,
    exposure: quality.exposure ?? region.exposure,
    resolution: quality.resolution ?? region.resolution,
    edgeCompleteness: quality.edgeCompleteness ?? region.edgeCompleteness,
    textReadability: quality.textReadability ?? region.textReadability,
    perspectiveDistortion: quality.perspectiveDistortion ?? region.perspectiveDistortion,
    occlusion: quality.occlusion ?? region.occlusion,
    compressionArtifacts: quality.compressionArtifacts ?? region.compressionArtifacts,
  };
}

function qualityForRegions(sceneAnalysis = null, vision = null) {
  const regions = safeArray(sceneAnalysis?.detectedCards);
  const sources = regions.length ? regions : vision || sceneAnalysis?.primaryCard ? [vision || sceneAnalysis?.primaryCard] : [];
  return sources.map((region, index) => ({
    regionId: region.regionId || region.id || `region_${index + 1}`,
    ...evaluateRecognitionQuality(qualityInput(region)),
  }));
}

function applyQualityBoundary(result, qualityResults) {
  if (!result || !qualityResults.length) return result;
  const byRegion = new Map(qualityResults.map((item) => [item.regionId, item]));
  const items = safeArray(result.items).map((item) => {
    const quality = byRegion.get(item.regionId) || qualityResults[item.index] || null;
    if (!quality) return item;
    const exact = Boolean(item.exact && quality.allowExactIdentity);
    const qualityRequiresReview = !quality.allowExactIdentity;
    return {
      ...item,
      exact,
      qualityGate: quality,
      requiresManualConfirmation: Boolean(item.requiresManualConfirmation || qualityRequiresReview),
      warnings: [...new Set([
        ...safeArray(item.warnings),
        ...quality.criticalFailures.map((failure) => `Image quality: ${failure.replaceAll('_', ' ')}`),
      ])],
    };
  });
  const primary = items[0] || null;
  return {
    ...result,
    items,
    primary,
    summary: {
      ...result.summary,
      needsConfirmation: items.filter((item) => item.requiresManualConfirmation).length,
      qualityTierCounts: qualityResults.reduce((counts, item) => {
        counts[item.tier] = (counts[item.tier] || 0) + 1;
        return counts;
      }, {}),
    },
  };
}

export function runRecognitionPipeline(input = {}) {
  const enabled = normalizedFlag(
    input.enableDedicatedRouting
      ?? input.featureFlags?.dedicatedRecognitionRouting
      ?? process.env.MANEFLOW_DEDICATED_RECOGNITION_ROUTING,
    false,
  );
  if (!enabled) {
    return {
      version: RECOGNITION_PIPELINE_VERSION,
      mode: 'legacy_safe_fallback',
      dedicatedRoutingEnabled: false,
      recognition: recognizeCardScene(input),
      routing: null,
      quality: [],
    };
  }

  const routing = routeRecognitionScene(detectorInput(input));
  const quality = qualityForRegions(input.sceneAnalysis, input.vision);
  if (!routing.plan.allowCardRecord) {
    return {
      version: RECOGNITION_PIPELINE_VERSION,
      mode: 'dedicated_routing',
      dedicatedRoutingEnabled: true,
      routing,
      quality,
      recognition: {
        version: RECOGNITION_PIPELINE_VERSION,
        generatedAt: new Date().toISOString(),
        scene: {
          type: routing.route,
          cardCount: 0,
          processingStrategy: routing.plan.strategy,
          warnings: routing.warnings,
        },
        items: [],
        primary: null,
        summary: {
          detectedCards: 0,
          matchedCards: 0,
          needsConfirmation: 0,
          pathCounts: {},
          selectiveCounts: {},
          sceneWarnings: routing.warnings,
          qualityTierCounts: {},
        },
        trustPolicy: {
          preferUncertainOverWrong: true,
          dedicatedRoutingEnabled: true,
          unconfirmedImagesCreateNoRegion: true,
        },
        message: routing.route === 'no_card'
          ? 'No physical card was detected. No card record was created.'
          : 'The scene does not contain a sufficiently supported individual card region. No card record was created.',
      },
    };
  }

  const recognition = applyQualityBoundary(recognizeCardScene(input), quality);
  return {
    version: RECOGNITION_PIPELINE_VERSION,
    mode: 'dedicated_routing',
    dedicatedRoutingEnabled: true,
    routing,
    quality,
    recognition: {
      ...recognition,
      trustPolicy: {
        ...recognition.trustPolicy,
        dedicatedRoutingEnabled: true,
        qualityGateEnforced: true,
      },
    },
  };
}
