import { calculateValuation } from './valuation.js';
import { attachCardImage, imageConfig } from './card-images.js';
import { evaluateScanConfidence } from './scan-confidence.js';
import { createScanSession } from './scan-session.js';
import { recognizeCardScene } from './recognition-engine.js';
import { analyzeCardScene } from './vision.js';
import { VisionWorkerClient, workerCardToLegacyVision, workerScanToSceneAnalysis } from './vision-worker-client.js';
import { analyzeGradedCert } from './graded-cert.js';
import { canAccessOrganization } from './shop-permissions.js';
import { recordUsage } from './usage-metering.js';

function marketMode(config, customSalesCount) {
  if (config.demoMode && customSalesCount === 0) return 'demo';
  if (config.demoMode && customSalesCount > 0) return 'mixed';
  return 'production';
}

export function createScanPipeline({
  config,
  cards: bundledCards,
  sales: bundledSales,
  store,
  cache,
  ocrService = null,
  databaseRuntime = null,
} = {}) {
  if (!config || !Array.isArray(bundledCards) || !Array.isArray(bundledSales) || !store) {
    throw new TypeError('createScanPipeline requires config, cards, sales, and store.');
  }
  const visionWorker = new VisionWorkerClient({
    baseUrl: config.visionWorkerUrl,
    timeoutMs: config.visionWorkerTimeoutMs,
    serviceToken: config.serviceToken,
  });
  const cardImageOptions = imageConfig(config);

  function catalog() {
    return [...bundledCards, ...(store.state.customCards || [])];
  }

  function allSales() {
    const demoSales = config.demoMode
      ? bundledSales.map((sale) => ({
        ...sale,
        sourceMode: 'demo',
        authorizationBasis: 'demo',
        rightsNotes: 'Synthetic demonstration comp. Not a public market value.',
      }))
      : [];
    const corrections = store.compCorrections?.() || {};
    return [...demoSales, ...(store.state.customSales || [])].map((sale) => (
      corrections[sale.id]?.correction
        ? { ...sale, ...corrections[sale.id].correction, corrected: true }
        : sale
    ));
  }

  function withCardImage(card, cardSales = null) {
    if (!card) return card;
    const sales = cardSales || allSales().filter((sale) => sale.cardId === card.id);
    return attachCardImage(card, cardImageOptions, {
      sales,
      imageOverrides: store.state.cardImageOverrides || {},
    });
  }

  function enrichCard(card) {
    const cardSales = allSales().filter((sale) => sale.cardId === card.id);
    return {
      ...withCardImage(card, cardSales),
      market: calculateValuation(cardSales, {
        card,
        demoMode: config.demoMode,
        overrides: store.compOverrides?.() || {},
      }),
      saleCount: cardSales.length,
    };
  }

  return async function processScan({ body: inputBody = {}, ownerUserId = null } = {}) {
    const user = ownerUserId ? store.findUserById(ownerUserId) : null;
    if (ownerUserId && (!user || user.disabledAt)) {
      const error = new Error('The scan-job owner account is unavailable.');
      error.code = 'SCAN_JOB_OWNER_UNAVAILABLE';
      throw error;
    }
    const actor = user ? {
      userId: user.id,
      role: user.role,
      user,
      service: false,
      readOnly: false,
    } : null;
    let body = { ...inputBody };
    const frontDataUrl = body.frontDataUrl || body.dataUrl || '';
    const backDataUrl = body.backDataUrl || '';
    const certDataUrl = body.certDataUrl || '';
    if (!frontDataUrl && !certDataUrl && !String(body.manualText || body.ocrText || body.certText || '').trim()) {
      const error = new Error('A card image or visible card evidence is required.');
      error.code = 'SCAN_INPUT_REQUIRED';
      throw error;
    }

    let localOcr = null;
    if (ocrService?.enabled && (frontDataUrl || certDataUrl)) {
      try {
        localOcr = await ocrService.recognizeDataUrl(frontDataUrl || certDataUrl);
        body = {
          ...body,
          ocrText: [body.ocrText, localOcr.text].filter(Boolean).join(' '),
          localOcrFields: localOcr.fields,
          localOcrFieldConfidence: localOcr.fieldConfidence,
        };
      } catch (error) {
        localOcr = {
          error: error instanceof Error ? error.message : String(error),
          code: error?.code || 'OCR_FAILED',
          processedRemotely: false,
        };
      }
    }

    let sceneAnalysis = null;
    let vision = null;
    let workerScan = null;
    let workerError = null;
    let vectorMatches = [];
    let vectorSearchError = null;

    if (frontDataUrl || certDataUrl) {
      try {
        workerScan = await visionWorker.scanDataUrl(frontDataUrl || certDataUrl, {
          filename: body.imageName || body.filename || 'card-scan.jpg',
        });
      } catch (error) {
        workerError = error instanceof Error ? error.message : String(error);
      }
    }

    const workerEmbedding = workerScan?.visual_embedding?.vector;
    const requestedShopId = String(body.shopId || body.organizationId || '').trim();
    if (
      Array.isArray(workerEmbedding)
      && workerEmbedding.length === 1152
      && requestedShopId
      && databaseRuntime?.findVisualMatches
    ) {
      const access = actor
        ? canAccessOrganization(store.state, actor, requestedShopId, 'viewer')
        : { allowed: false };
      if (access.allowed) {
        try {
          vectorMatches = await databaseRuntime.findVisualMatches({
            embedding: workerEmbedding,
            shopId: requestedShopId,
            limit: Math.max(3, Math.min(25, Number(body.vectorCandidateLimit || 10))),
          });
        } catch (error) {
          vectorSearchError = error instanceof Error ? error.message : String(error);
        }
      } else {
        vectorSearchError = 'Vector search was skipped because this account cannot access the requested shop.';
      }
    }

    if (vectorMatches[0] && Number(vectorMatches[0].cosineSimilarity || 0) >= 0.70) {
      const top = vectorMatches[0];
      vision = {
        facts: {
          player: top.subjectName,
          year: top.releaseYear,
          brand: top.brand || top.manufacturer,
          set: top.setName,
          cardNumber: top.cardNumber,
          parallel: top.parallelName,
        },
        player: top.subjectName,
        year: top.releaseYear,
        brand: top.brand || top.manufacturer,
        set: top.setName,
        cardNumber: top.cardNumber,
        parallel: top.parallelName,
        fieldConfidence: {
          player: top.cosineSimilarity,
          year: top.cosineSimilarity,
          brand: top.cosineSimilarity,
          set: top.cosineSimilarity,
          cardNumber: top.cosineSimilarity,
          parallel: top.cosineSimilarity,
        },
        confidence: top.cosineSimilarity,
        provider: 'maneflow_pgvector',
        imageProcessedRemotely: false,
        warnings: top.cosineSimilarity < 0.86
          ? ['Visual vector match requires OCR or checklist confirmation.']
          : [],
      };
    }

    if (workerScan) {
      sceneAnalysis = workerScanToSceneAnalysis(workerScan);
      vision = sceneAnalysis?.primaryCard || vision;
    }

    if (!sceneAnalysis && (frontDataUrl || certDataUrl) && config.openaiApiKey && config.openaiVisionModel) {
      sceneAnalysis = await analyzeCardScene({
        frontDataUrl: frontDataUrl || certDataUrl,
        backDataUrl,
        certDataUrl,
        apiKey: config.openaiApiKey,
        model: config.openaiVisionModel,
      });
      vision = sceneAnalysis?.primaryCard || vision;
    }

    if (!vision && workerScan && Number(workerScan.identity_confidence || 0) > 0) {
      vision = workerCardToLegacyVision(workerScan);
    }
    const remoteVisionUsed = Boolean(
      (sceneAnalysis && sceneAnalysis.scene?.processingStrategy !== 'local_vision_worker_per_card')
      || workerScan?.image_processed_remotely,
    );

    const gradedCert = await analyzeGradedCert({ body, vision }, { state: store.state, actor });
    const scanBody = { ...body, gradedCert };
    const recognition = recognizeCardScene({
      cards: catalog(),
      body: scanBody,
      sceneAnalysis,
      vision,
      gradedCert,
      corrections: store.state.scanCorrections || [],
      enrichCard,
    });
    const primary = recognition.primary || {};
    const matches = primary.matches || [];
    const scanConfidence = primary.scanConfidence || evaluateScanConfidence({
      body: scanBody,
      vision,
      result: { gradedCert },
      matches,
    });
    const needsConfirmation = primary.requiresManualConfirmation ?? scanConfidence.needsManualConfirmation;
    const result = {
      mode: primary.mode || (sceneAnalysis ? 'vision_scene_catalog_match' : 'manual_text_match'),
      query: primary.query || '',
      exact: Boolean(primary.exact && !needsConfirmation),
      needsConfirmation,
      message: recognition.message,
      matches,
    };

    let scan = null;
    let scanSession = null;
    if (actor) {
      scan = await store.recordScan(actor.userId, {
        mode: result.mode,
        query: result.query,
        matchIds: matches.map((card) => card.id),
        imageProcessedRemotely: remoteVisionUsed,
        frontBack: Boolean(backDataUrl),
        warnings: [...(vision?.warnings || []), ...scanConfidence.warnings],
      });
      await recordUsage(store, actor, 'scan', 1, {
        mode: result.mode,
        remoteVision: remoteVisionUsed,
        confidence: scanConfidence.scanConfidenceScore,
        detectedCards: recognition.summary.detectedCards,
      });
      scanSession = await createScanSession(
        store,
        actor,
        { body: scanBody, vision, result: { ...result, gradedCert }, matches, recognition },
        { cards: catalog() },
      );
      await recordUsage(store, actor, 'scan_session', 1, {
        scanSessionId: scanSession.id,
        needsManualConfirmation: needsConfirmation,
      });
    }

    return {
      ...result,
      recognition,
      vision,
      sceneAnalysis,
      workerScan,
      workerError,
      vectorMatches,
      vectorSearchError,
      localOcr,
      gradedCert,
      scanConfidence,
      scanId: scan?.id || null,
      scanSessionId: scanSession?.id || null,
      imageProcessedRemotely: remoteVisionUsed,
      visionWorkerUsed: Boolean(workerScan),
      marketMode: marketMode(config, (store.state.customSales || []).length),
      message: scanConfidence.needsManualConfirmation
        ? scanConfidence.recommendedNextStep
        : sceneAnalysis
          ? 'Scene imagery was analyzed and matched against the ManeFlow catalog. Confirm exact details before saving.'
          : result.message,
    };
  };
}
