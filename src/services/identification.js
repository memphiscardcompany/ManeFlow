import { rankCards } from './catalog.js';
import { normalizeText } from './utils.js';

function field(value, repeat = 1) {
  const text = String(value ?? '').trim();
  return text ? Array.from({ length: repeat }, () => text) : [];
}

function confidenceRepeat(vision, key, fallback = 1) {
  const score = Number(vision?.fieldConfidence?.[key]);
  if (!Number.isFinite(score)) return fallback;
  if (score >= 0.85) return 4;
  if (score >= 0.7) return 3;
  if (score >= 0.5) return 2;
  return 1;
}

function visionQueryTerms(vision = null) {
  if (!vision) return [];
  const facts = vision.facts || vision;
  return [
    ...field(facts.player || facts.subject || vision.player, confidenceRepeat(vision, 'player')),
    ...field(facts.year || vision.year, confidenceRepeat(vision, 'year')),
    ...field(facts.brand || vision.brand, confidenceRepeat(vision, 'brand')),
    ...field(facts.set || vision.set, confidenceRepeat(vision, 'set')),
    ...field(facts.subset || vision.subset, 1),
    ...field(facts.cardNumber || vision.cardNumber, confidenceRepeat(vision, 'cardNumber')),
    ...field(facts.parallel || vision.parallel, confidenceRepeat(vision, 'parallel')),
    ...field(facts.productName || vision.productName, confidenceRepeat(vision, 'productName')),
    ...field(facts.productType || facts.sealedType || vision.productType || vision.sealedType, confidenceRepeat(vision, 'productType')),
    ...field(facts.configuration || vision.configuration, confidenceRepeat(vision, 'configuration')),
    ...field(facts.sku || vision.sku, 2),
    ...field(facts.upc || facts.barcode || vision.upc || vision.barcode, 2),
    ...field(facts.variation || vision.variation, 1),
    ...field(facts.serialNumber || vision.serialNumber, confidenceRepeat(vision, 'serialNumber')),
    ...field(facts.grader || vision.grader, confidenceRepeat(vision, 'grader')),
    ...field(facts.grade || vision.grade, confidenceRepeat(vision, 'grade')),
    ...field(facts.sport || vision.sport, 1),
    ...field(facts.team || vision.team, 1),
    ...field((facts.visibleText || vision.visibleText || []).toString(), 1),
    ...((vision.candidateDescriptions || []).slice(0, 3).flatMap((candidate) => field(candidate.description, Number(candidate.confidence) >= 0.7 ? 2 : 1))),
  ];
}

function normalize(value) {
  return normalizeText(String(value ?? ''));
}

function factsFrom({ vision = null, gradedCert = null } = {}) {
  const raw = vision?.facts || vision || {};
  return {
    player: raw.player || raw.subject || gradedCert?.player || null,
    year: raw.year || gradedCert?.year || null,
    brand: raw.brand || gradedCert?.brand || null,
    set: raw.set || gradedCert?.set || null,
    cardNumber: raw.cardNumber || gradedCert?.cardNumber || null,
    parallel: raw.parallel || raw.variation || gradedCert?.parallel || null,
    serialNumber: raw.serialNumber || gradedCert?.serialNumber || null,
    grader: raw.grader || gradedCert?.grader || null,
    grade: raw.grade || gradedCert?.grade || null,
    certNumber: raw.certNumber || gradedCert?.certNumber || null,
  };
}

function fieldMatches(expected, actual) {
  if (expected == null || expected === '') return false;
  const left = normalize(expected);
  const right = normalize(actual);
  return Boolean(left && right && (left === right || right.includes(left) || left.includes(right)));
}

function outcomeFor(matches, evidence) {
  const top = matches[0];
  const second = matches[1];
  if (!top) return { outcome: 'unknown', identityStatus: 'Unresolved', exact: false };
  const confidenceGap = second ? Number(top.confidence || 0) - Number(second.confidence || 0) : 1;
  const matchScoreGap = second ? Math.max(0, Math.min(1, (Number(top.matchScore || 0) - Number(second.matchScore || 0)) / 40)) : 1;
  const gap = Math.max(confidenceGap, matchScoreGap);
  const coreMatches = [
    fieldMatches(evidence.player, top.player),
    fieldMatches(evidence.year, top.year),
    fieldMatches(evidence.brand, top.brand),
    fieldMatches(evidence.set, top.set),
    fieldMatches(evidence.cardNumber, top.cardNumber),
  ].filter(Boolean).length;
  const variantMatches = [
    fieldMatches(evidence.parallel, top.parallel),
    fieldMatches(evidence.serialNumber, top.serialNumber),
    fieldMatches(evidence.grader, top.grade?.company),
    fieldMatches(evidence.grade, top.grade?.grade),
    Boolean(evidence.certNumber),
  ].filter(Boolean).length;
  const exactCard = Number(top.confidence || 0) >= 0.9 && gap >= 0.08 && coreMatches >= 3;
  const exactVariant = exactCard && Number(top.confidence || 0) >= 0.92 && gap >= 0.1 && variantMatches >= 1;
  if (exactVariant) return { outcome: 'exact_variant', identityStatus: 'Exact', exact: true, coreMatches, variantMatches, gap };
  if (exactCard) return { outcome: 'exact_card', identityStatus: 'Exact', exact: true, coreMatches, variantMatches, gap };

  const family = matches.slice(0, 3);
  const familyKey = (card) => [card.player, card.year, card.brand, card.set].map(normalize).join('|');
  const sameFamily = family.length >= 2 && family.every((card) => familyKey(card) === familyKey(top));
  if (Number(top.confidence || 0) >= 0.72 && sameFamily) {
    return { outcome: 'card_family', identityStatus: 'Likely', exact: false, coreMatches, variantMatches, gap };
  }
  if (Number(top.confidence || 0) >= 0.5) {
    return { outcome: 'candidate', identityStatus: 'Likely', exact: false, coreMatches, variantMatches, gap };
  }
  return { outcome: 'unknown', identityStatus: 'Unresolved', exact: false, coreMatches, variantMatches, gap };
}

export function identifyCard({ cards, imageName = '', manualText = '', ocrText = '', vision = null, gradedCert = null }) {
  // imageName is intentionally ignored. Camera filenames, UUIDs, screenshots, and
  // upload order are transport metadata and must never become card identity evidence.
  void imageName;
  const visionText = visionQueryTerms(vision).join(' ');
  const certText = gradedCert ? [
    gradedCert.player, gradedCert.year, gradedCert.brand, gradedCert.set, gradedCert.cardNumber,
    gradedCert.parallel, gradedCert.serialNumber, gradedCert.grader, gradedCert.grade,
    gradedCert.certNumber,
  ].filter(Boolean).join(' ') : '';
  const query = normalizeText([manualText, ocrText, visionText, certText].join(' '));
  if (!query) {
    return {
      matches: [],
      mode: 'needs_input',
      outcome: 'unknown',
      identityStatus: 'Unresolved',
      exact: false,
      needsConfirmation: true,
      message: 'No visible card evidence was available. Capture the card front and back or improve image quality.',
      query: '',
    };
  }

  const top = rankCards(cards, query, { limit: 7 });
  const decision = outcomeFor(top, factsFrom({ vision, gradedCert }));
  const mode = gradedCert?.slabbed
    ? 'graded_cert_catalog_match'
    : vision
      ? 'vision_catalog_match'
      : manualText || ocrText
        ? 'text_evidence_match'
        : 'evidence_match';
  const messages = {
    exact_variant: 'Exact card and variant are supported by independent evidence.',
    exact_card: 'Exact card identity is supported; reflective surface or parallel details may still need another angle.',
    card_family: 'The card family is likely, but the exact card number or parallel remains ambiguous.',
    candidate: 'A likely candidate was found. ManeFlow will not promote it to exact without stronger evidence.',
    unknown: 'ManeFlow could not support a reliable identity from this image.',
  };
  return {
    matches: top,
    mode,
    ...decision,
    needsConfirmation: !decision.exact,
    query,
    message: messages[decision.outcome],
  };
}
