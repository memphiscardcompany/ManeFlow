import { extractCertFromText, parseBarcodePayload } from './barcode-parser.js';
import { normalizeText } from './utils.js';

export const CERT_ACCURACY_VERSION = 'cert-accuracy-v2.0';

const KNOWN_GRADERS = ['PSA', 'BGS', 'SGC', 'CGC'];
const OCR_DIGIT_FIXES = Object.freeze({
  O: '0',
  o: '0',
  Q: '0',
  D: '0',
  I: '1',
  l: '1',
  L: '1',
  '|': '1',
  Z: '2',
  S: '5',
  s: '5',
  B: '8',
  G: '6',
});

function clean(value, max = 1000) {
  return String(value ?? '').trim().slice(0, max);
}

function first(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '') || '';
}

export function normalizeGrader(value = '') {
  const text = normalizeText(value);
  if (text.includes('psa')) return 'PSA';
  if (text.includes('bgs') || text.includes('beckett')) return 'BGS';
  if (text.includes('sgc')) return 'SGC';
  if (text.includes('cgc') || text.includes('csg')) return 'CGC';
  const upper = clean(value, 20).toUpperCase();
  return KNOWN_GRADERS.includes(upper) ? upper : upper;
}

function detectGrader(text = '') {
  const normalized = normalizeText(text);
  if (/\bpsa\b|psacard/.test(normalized)) return 'PSA';
  if (/\bbgs\b|beckett/.test(normalized)) return 'BGS';
  if (/\bsgc\b|gosgc/.test(normalized)) return 'SGC';
  if (/\bcgc\b|\bcsg\b|cgcgrading/.test(normalized)) return 'CGC';
  return '';
}

export function normalizeCertNumberForGrader(grader = '', value = '') {
  let raw = clean(value, 100).replace(/^cert(?:ification)?\s*(?:no\.?|#|number)?\s*:?\s*/i, '');
  raw = raw.replace(/[\s._]/g, '').replace(/[\u2013\u2014]/g, '-').replace(/[^A-Za-z0-9-]/g, '');
  const normalizedGrader = normalizeGrader(grader);
  if (['PSA', 'BGS', 'CGC'].includes(normalizedGrader)) {
    raw = raw.replace(/[A-Za-z|]/g, (char) => OCR_DIGIT_FIXES[char] ?? char).replace(/[^0-9]/g, '');
  } else if (normalizedGrader === 'SGC') {
    raw = raw.replace(/[^A-Za-z0-9-]/g, '').toUpperCase();
  }
  return raw;
}

function certLooksValid(grader = '', certNumber = '') {
  const cert = normalizeCertNumberForGrader(grader, certNumber);
  const normalizedGrader = normalizeGrader(grader);
  if (!cert) return false;
  if (normalizedGrader === 'PSA') return /^[0-9]{7,12}$/.test(cert);
  if (normalizedGrader === 'BGS') return /^[0-9]{5,12}$/.test(cert);
  if (normalizedGrader === 'CGC') return /^[0-9]{7,12}$/.test(cert);
  if (normalizedGrader === 'SGC') return /^[A-Z0-9-]{5,18}$/.test(cert);
  return /^[A-Z0-9-]{5,18}$/i.test(cert);
}

export function parseCertByGrader(grader = '', text = '') {
  const normalizedGrader = normalizeGrader(grader || detectGrader(text));
  const rawText = clean(text, 8000);
  const generic = extractCertFromText(rawText);
  const patterns = {
    PSA: [
      /psa(?:card)?\.com\/cert\/([0-9A-Z|OISBGS.-]{5,18})/i,
      /\b(?:PSA\s*)?(?:CERT(?:IFICATION)?\s*(?:NO\.?|#|NUMBER)?|CERT)\s*:?\s*([0-9A-Z|OISBGS.-]{7,14})\b/i,
      /\b([0-9A-Z|OISBGS.-]{7,12})\b/i,
    ],
    BGS: [
      /\b(?:BGS|BECKETT).*?(?:CERT(?:IFICATION)?\s*(?:NO\.?|#|NUMBER)?|ITEM_ID)\s*:?\s*([0-9A-Z|OISBGS.-]{5,14})\b/i,
      /beckett\.com\/grading\/card-lookup.*?item_id=([0-9A-Z|OISBGS.-]{5,14})/i,
    ],
    SGC: [
      /certificateNumber=([A-Z0-9-]{5,18})/i,
      /\b(?:SGC).*?(?:CERT(?:IFICATE)?\s*(?:NO\.?|#|NUMBER)?|CERT)\s*:?\s*([A-Z0-9-]{5,18})\b/i,
    ],
    CGC: [
      /cgcgrading\.com\/verify\/([0-9A-Z|OISBGS.-]{7,14})/i,
      /\b(?:CGC|CSG).*?(?:CERT(?:IFICATION)?\s*(?:NO\.?|#|NUMBER)?|CERT)\s*:?\s*([0-9A-Z|OISBGS.-]{7,14})\b/i,
    ],
  };
  let certNumber = generic.certNumber;
  for (const pattern of patterns[normalizedGrader] || []) {
    const match = pattern.exec(rawText);
    if (match?.[1]) {
      certNumber = match[1];
      break;
    }
  }
  const normalizedCert = normalizeCertNumberForGrader(normalizedGrader, certNumber);
  return {
    grader: normalizedGrader || generic.grader || null,
    certNumber: normalizedCert || null,
    rawCertNumber: certNumber || null,
    validShape: certLooksValid(normalizedGrader, normalizedCert),
    source: `${normalizedGrader || 'UNKNOWN'}_parser`,
    confidence: normalizedCert && certLooksValid(normalizedGrader, normalizedCert) ? 0.9 : normalizedCert ? 0.68 : 0.15,
  };
}

export function certStatusLabel(verificationStatus = '') {
  const status = normalizeText(verificationStatus).replace(/\s+/g, '_');
  if (status.includes('official_verified')) return 'officially_verified';
  if (status.includes('mismatch')) return 'conflict_needs_review';
  if (status.includes('cert_number_extracted') || status.includes('manual_verify')) return 'parsed_not_officially_verified';
  if (status.includes('blocked')) return 'parsed_lookup_blocked_by_policy';
  if (status.includes('not_graded')) return 'not_graded_detected';
  return 'parsed_needs_review';
}

function parseGrade(text = '') {
  const value = clean(text, 5000);
  const patterns = [
    /\b(?:PSA|BGS|BECKETT|SGC|CGC|CSG)\s*(?:GEM\s*MT|GEM\s*MINT|MINT|NM-MT|NM|EX-MT|EX)?\s*([0-9](?:\.[0-9])?|10)\b/i,
    /\b(?:GEM\s*MT|GEM\s*MINT|MINT|NM-MT|NM|EX-MT|EX)\s*([0-9](?:\.[0-9])?|10)\b/i,
    /\bgrade\s*:?\s*([0-9](?:\.[0-9])?|10)\b/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(value);
    if (match?.[1]) return clean(match[1], 20);
  }
  return '';
}

function parseYear(text = '') {
  const match = /\b((?:19|20)\d{2})\b/.exec(text);
  return match ? Number(match[1]) : null;
}

function parseCardNumber(text = '') {
  const withoutCertNumber = clean(text, 8000).replace(/\bcert(?:ification)?\s*(?:no\.?|#|number)?\s*:?\s*[A-Z0-9-]{5,18}\b/ig, ' ');
  const patterns = [
    /(?:card\s*(?:no\.?|#|number)|#)\s*([A-Z]{0,5}[0-9]{1,5}[A-Z]?(?:\/[0-9]{1,5})?)\b/i,
    /\b([A-Z]{1,5}[0-9]{1,5}[A-Z]?)\b/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(withoutCertNumber);
    if (match?.[1] && !/^(PSA|BGS|SGC|CGC|CSG)$/i.test(match[1])) return clean(match[1], 40);
  }
  return '';
}

function parseSerialNumber(text = '') {
  return clean(/\b([0-9]{1,6}\s*\/\s*[0-9]{1,6})\b/.exec(text)?.[1] || '', 40);
}

function lineCandidates(text = '') {
  return clean(text, 8000)
    .split(/\r?\n|[|\u2022]+/)
    .map((line) => clean(line, 180))
    .filter(Boolean);
}

function removeKnownLabelNoise(line = '') {
  return clean(line)
    .replace(/\b(PSA|BGS|BECKETT|SGC|CGC|CSG)\b/ig, '')
    .replace(/\b(GEM\s*MT|GEM\s*MINT|MINT|NM-MT|NM|EX-MT|EX|AUTHENTIC|CERT(?:IFICATION)?|NUMBER|NO\.?|GRADE)\b/ig, '')
    .replace(/\b[0-9]{5,14}\b/g, '')
    .replace(/#\s*[A-Z]{0,5}[0-9]{1,5}[A-Z]?(?:\/[0-9]{1,5})?/ig, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseSlabLabelText(input = {}, hints = {}) {
  const text = clean(typeof input === 'string' ? input : [input.certText, input.ocrText, input.manualText, input.visibleText, input.title].filter(Boolean).join('\n'), 12000);
  const textCert = extractCertFromText(text);
  const grader = normalizeGrader(first(input.grader, textCert.grader, detectGrader(text), hints.grader)) || null;
  const graderParsed = parseCertByGrader(grader, text);
  const certNumber = normalizeCertNumberForGrader(grader, first(input.certNumber, textCert.certNumber, graderParsed.certNumber, hints.certNumber));
  const grade = clean(first(input.grade, parseGrade(text), hints.grade), 20) || null;
  const year = Number(first(input.year, parseYear(text), hints.year)) || null;
  const cardNumber = clean(first(input.cardNumber, parseCardNumber(text), hints.cardNumber), 80) || null;
  const serialNumber = clean(first(input.serialNumber, parseSerialNumber(text), hints.serialNumber), 80) || null;
  const lines = lineCandidates(text);
  const usefulLines = lines
    .map(removeKnownLabelNoise)
    .filter((line) => line.length >= 3 && !/^[0-9.\-/ ]+$/.test(line))
    .slice(0, 6);
  const normalizedText = normalizeText(text);
  const warnings = [];
  if (text && !certNumber) warnings.push('Visible cert text did not produce a confident cert number.');
  if (text && !grader) warnings.push('Visible cert text did not identify the grading company.');
  if (text && grader && certNumber && !certLooksValid(grader, certNumber)) warnings.push('Cert number shape is unusual for the detected grading company.');
  return {
    version: CERT_ACCURACY_VERSION,
    grader,
    certNumber: certNumber || null,
    grade,
    year,
    cardNumber,
    serialNumber,
    labelLines: lines.slice(0, 12),
    usefulLabelLines: usefulLines,
    playerHint: usefulLines.find((line) => !String(year || '').includes(line) && !normalizeText(line).includes('topps')) || null,
    sportHint: normalizedText.includes('pokemon') ? 'Pokemon' : normalizedText.includes('basketball') ? 'Basketball' : normalizedText.includes('football') ? 'Football' : normalizedText.includes('baseball') ? 'Baseball' : null,
    warnings,
  };
}

function candidate(source, grader, certNumber, confidence, raw = '') {
  const normalizedGrader = normalizeGrader(grader);
  const normalizedCert = normalizeCertNumberForGrader(normalizedGrader, certNumber);
  if (!normalizedGrader && !normalizedCert) return null;
  return {
    source,
    grader: normalizedGrader || null,
    certNumber: normalizedCert || null,
    rawCertNumber: clean(certNumber, 100) || null,
    confidence,
    validShape: certLooksValid(normalizedGrader, normalizedCert),
    raw: clean(raw, 500),
  };
}

export function collectCertEvidence(input = {}, visionFacts = {}) {
  const body = input.body || input;
  const text = [body.certText, body.ocrText, body.manualText, body.visibleText, visionFacts.visibleText].filter(Boolean).join('\n');
  const label = parseSlabLabelText({ ...body, visibleText: text }, visionFacts);
  const barcode = parseBarcodePayload(first(body.qrPayload, body.qrText, body.barcodePayload, body.barcodeText), {
    grader: first(body.grader, visionFacts.grader, label.grader),
    certNumber: first(body.certNumber, visionFacts.certNumber, label.certNumber),
  });
  const candidates = [
    candidate('barcode_or_qr', barcode.grader, barcode.certNumber, barcode.decoded ? 0.94 : 0.2, barcode.barcodePayload || barcode.qrPayload),
    candidate('visible_label', label.grader, label.certNumber, label.certNumber ? 0.84 : 0.2, text),
    candidate('vision', visionFacts.grader, visionFacts.certNumber, visionFacts.certNumber ? 0.72 : 0.15, visionFacts.visibleText || ''),
    candidate('direct_input', body.grader, body.certNumber, body.certNumber ? 0.88 : 0.15, body.certNumber || ''),
  ].filter(Boolean);
  const uniqueCerts = [...new Set(candidates.map((item) => item.certNumber).filter(Boolean))];
  const uniqueGraders = [...new Set(candidates.map((item) => item.grader).filter(Boolean))];
  const conflicts = [];
  if (uniqueCerts.length > 1) conflicts.push({ field: 'certNumber', values: uniqueCerts });
  if (uniqueGraders.length > 1) conflicts.push({ field: 'grader', values: uniqueGraders });
  const best = [...candidates].sort((a, b) => (b.confidence + (b.validShape ? 0.08 : 0)) - (a.confidence + (a.validShape ? 0.08 : 0)))[0] || null;
  const completeness = Math.round(Math.min(100,
    (best?.grader ? 18 : 0) + (best?.certNumber ? 28 : 0) + (label.grade ? 16 : 0) + (label.year ? 9 : 0)
    + (label.cardNumber ? 9 : 0) + (barcode.decoded ? 12 : 0) + (label.usefulLabelLines.length ? 8 : 0) - conflicts.length * 14,
  ));
  return {
    version: CERT_ACCURACY_VERSION,
    best,
    barcode,
    label,
    candidates,
    conflicts,
    extractionCompletenessScore: Math.max(0, completeness),
    extractionTier: completeness >= 82 && !conflicts.length ? 'cert_locked' : completeness >= 60 ? 'strong_review' : completeness >= 35 ? 'needs_review' : 'insufficient',
    warnings: [
      ...(barcode.warnings || []),
      ...(label.warnings || []),
      ...conflicts.map((conflict) => `${conflict.field} conflict across cert evidence: ${conflict.values.join(', ')}`),
    ],
  };
}
