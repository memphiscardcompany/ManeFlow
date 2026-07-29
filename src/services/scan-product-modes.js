import { normalizeText } from './utils.js';

export const SCAN_PRODUCT_MODES = Object.freeze({
  CATALOG_IDENTIFICATION: 'catalog_identification',
  MARKETPLACE_VISUAL_SEARCH: 'marketplace_visual_search',
  INVENTORY_BATCH: 'inventory_batch',
  GRADED_CERT_LOOKUP: 'graded_cert_lookup',
});

const MODE_ALIASES = Object.freeze({
  scan: SCAN_PRODUCT_MODES.CATALOG_IDENTIFICATION,
  identify: SCAN_PRODUCT_MODES.CATALOG_IDENTIFICATION,
  catalog: SCAN_PRODUCT_MODES.CATALOG_IDENTIFICATION,
  catalog_identification: SCAN_PRODUCT_MODES.CATALOG_IDENTIFICATION,
  image_search: SCAN_PRODUCT_MODES.MARKETPLACE_VISUAL_SEARCH,
  visual_search: SCAN_PRODUCT_MODES.MARKETPLACE_VISUAL_SEARCH,
  marketplace_visual_search: SCAN_PRODUCT_MODES.MARKETPLACE_VISUAL_SEARCH,
  batch: SCAN_PRODUCT_MODES.INVENTORY_BATCH,
  inventory_batch: SCAN_PRODUCT_MODES.INVENTORY_BATCH,
  cert: SCAN_PRODUCT_MODES.GRADED_CERT_LOOKUP,
  graded_cert_lookup: SCAN_PRODUCT_MODES.GRADED_CERT_LOOKUP,
});

function clean(value) {
  return normalizeText(value || '').replace(/\s+/g, '_');
}

export function resolveScanProductMode(value) {
  const normalized = clean(value);
  if (!normalized) return SCAN_PRODUCT_MODES.CATALOG_IDENTIFICATION;
  const resolved = MODE_ALIASES[normalized];
  if (!resolved) {
    throw new TypeError(`Unsupported scanMode '${String(value)}'.`);
  }
  return resolved;
}

function isBaseLikeParallel(value) {
  const normalized = normalizeText(value || '');
  return !normalized || ['base', 'base card', 'standard', 'regular'].includes(normalized);
}

function detectedCount(recognition = {}) {
  const count = Number(recognition?.summary?.detectedCards ?? recognition?.regions?.length ?? 0);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

function corroboration({ vectorDecision, gradedCert, body, result }) {
  const top = vectorDecision?.topCandidate || null;
  const matched = new Set(top?.matchedFields || []);
  const officialCert = gradedCert?.verificationStatus === 'official_verified';
  const certExtracted = Boolean(gradedCert?.certNumber && gradedCert?.grader);
  const vectorExact = vectorDecision?.status === 'exact';
  const cardNumberAndSet = matched.has('cardNumber') && (matched.has('setCode') || matched.has('setName'));
  const frontBackAgreement = Number(top?.viewAgreement || 0) >= 0.8
    && top?.frontCosineSimilarity != null
    && top?.backCosineSimilarity != null;
  const manualOnly = !body?.frontDataUrl && !body?.dataUrl && !body?.certDataUrl
    && Boolean(String(body?.manualText || '').trim());
  const identityCorroborated = officialCert || (vectorExact && (cardNumberAndSet || frontBackAgreement)) || manualOnly;

  const topParallel = top?.parallelName || result?.matches?.[0]?.parallel || result?.matches?.[0]?.parallelName || '';
  const parallelMatched = matched.has('parallelName');
  const surfaceConfidence = Number(
    body?.surfaceConfidence
    ?? body?.refractorConfidence
    ?? body?.surfaceAnalysis?.refractorConfidence
    ?? 0,
  );
  const serialEvidence = Boolean(
    gradedCert?.serialNumber
    || body?.serialNumber
    || top?.serialNumberedTo,
  );
  const variantCorroborated = isBaseLikeParallel(topParallel)
    || officialCert
    || serialEvidence
    || (parallelMatched && surfaceConfidence >= 0.85 && frontBackAgreement);

  return {
    officialCert,
    certExtracted,
    vectorExact,
    cardNumberAndSet,
    frontBackAgreement,
    manualOnly,
    identityCorroborated,
    variantCorroborated,
    topParallel,
  };
}

/**
 * Enforces product semantics after recognition. Catalog identity, marketplace
 * similarity search, batch intake, and cert lookup deliberately have different
 * acceptance rules and must never share an "exact" flag by accident.
 */
export function applyScanProductModePolicy({
  requestedMode,
  result = {},
  recognition = {},
  vectorDecision = null,
  gradedCert = null,
  body = {},
} = {}) {
  const productMode = resolveScanProductMode(requestedMode || body.scanMode || body.mode);
  const evidence = corroboration({ vectorDecision, gradedCert, body, result });
  const count = detectedCount(recognition);
  const warnings = [];
  let exact = false;
  let needsConfirmation = true;
  let decisionType = 'candidate_set';
  let candidateSemantics = 'catalog_identity_candidates';
  let identityUseAllowed = true;
  let pricingUseAllowed = true;
  let listingAutofillAllowed = false;

  if (productMode === SCAN_PRODUCT_MODES.MARKETPLACE_VISUAL_SEARCH) {
    decisionType = 'similar_marketplace_items';
    candidateSemantics = 'visually_similar_marketplace_context';
    identityUseAllowed = false;
    pricingUseAllowed = false;
    warnings.push('Marketplace visual-search results are similarity results, not verified card identity or completed-sale comps.');
  } else if (productMode === SCAN_PRODUCT_MODES.GRADED_CERT_LOOKUP) {
    exact = Boolean(result.exact && evidence.officialCert);
    needsConfirmation = !exact;
    decisionType = exact ? 'official_cert_verified_card' : (evidence.certExtracted ? 'cert_candidate' : 'unknown');
    candidateSemantics = 'grader_cert_identity_candidates';
    listingAutofillAllowed = exact;
    if (!evidence.officialCert) warnings.push('A parsed cert number is not an official verification result.');
  } else if (productMode === SCAN_PRODUCT_MODES.INVENTORY_BATCH) {
    exact = Boolean(count === 1 && result.exact && evidence.identityCorroborated && evidence.variantCorroborated);
    needsConfirmation = !exact || count !== 1;
    decisionType = count > 1 ? 'multi_item_review_queue' : (exact ? 'exact_card' : 'candidate_set');
    candidateSemantics = 'per_physical_item_catalog_candidates';
    listingAutofillAllowed = exact;
    if (count > 1) warnings.push('Batch mode requires per-item review; the strongest region is not the identity of the whole image.');
  } else {
    const identityExact = Boolean(result.exact && evidence.identityCorroborated);
    exact = Boolean(identityExact && evidence.variantCorroborated);
    needsConfirmation = !exact || Boolean(result.needsConfirmation);
    decisionType = exact
      ? 'exact_card'
      : (identityExact ? 'card_family_variant_unresolved' : (result.matches?.length ? 'candidate_set' : 'unknown'));
    listingAutofillAllowed = exact;
    if (result.exact && !evidence.identityCorroborated) {
      warnings.push('A high catalog score alone is insufficient for exact image-based identity; corroborating cert, OCR, set/card number, or front/back evidence is required.');
    }
    if (identityExact && !evidence.variantCorroborated) {
      warnings.push('Card family matched, but the exact parallel/variation remains unresolved.');
    }
  }

  return {
    productMode,
    decisionType,
    candidateSemantics,
    exact,
    needsConfirmation,
    identityUseAllowed,
    pricingUseAllowed,
    listingAutofillAllowed,
    activeListingContextOnly: productMode === SCAN_PRODUCT_MODES.MARKETPLACE_VISUAL_SEARCH,
    evidence,
    warnings,
    result: {
      ...result,
      exact,
      needsConfirmation,
    },
  };
}
