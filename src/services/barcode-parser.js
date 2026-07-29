import { normalizeText } from './utils.js';

export const BARCODE_PARSER_VERSION = 'barcode-parser-v2.0';

const GRADER_HOSTS = [
  { grader: 'PSA', patterns: [/psacard\.com/i, /\bpsa\b/i], certPatterns: [/cert\/(?:verify\/)?([0-9OQDISBGl|]{5,14})/i, /cert(?:number|no|=|\/|\?)\s*([0-9OQDISBGl|]{5,14})/i, /certNumber=([0-9OQDISBGl|]{5,14})/i, /\b([0-9OQDISBGl|]{7,12})\b/] },
  { grader: 'BGS', patterns: [/beckett\.com/i, /\bbgs\b/i, /beckett/i], certPatterns: [/card-lookup.*?(?:item_id|cert(?:_?number)?)=([0-9OQDISBGl|]{5,14})/i, /cert(?:number|no|=|\/|\?)\s*([0-9OQDISBGl|]{5,14})/i, /\b([0-9OQDISBGl|]{5,12})\b/] },
  { grader: 'SGC', patterns: [/gosgc\.com/i, /\bsgc\b/i], certPatterns: [/auth-code\/?([0-9A-Z-]{5,18})/i, /certificateNumber=([0-9A-Z-]{5,18})/i, /cert(?:number|no|=|\/|\?)\s*([0-9A-Z-]{5,18})/i, /\b([0-9]{5,12})\b/] },
  { grader: 'CGC', patterns: [/cgcgrading\.com/i, /cgccards\.com/i, /\bcgc\b/i, /\bcsg\b/i], certPatterns: [/verify\/?([0-9OQDISBGl|]{5,14})/i, /certlookup\/?([0-9OQDISBGl|]{5,14})/i, /cert(?:number|no|=|\/|\?)\s*([0-9OQDISBGl|]{5,14})/i, /\b([0-9OQDISBGl|]{7,12})\b/] },
];

const OCR_DIGIT_FIXES = Object.freeze({ O: '0', o: '0', Q: '0', D: '0', I: '1', l: '1', L: '1', '|': '1', Z: '2', S: '5', s: '5', B: '8', G: '6' });

function clean(value, max = 1000) {
  return String(value ?? '').trim().slice(0, max);
}

function detectPayloadType(value = '') {
  if (/^https?:\/\//i.test(value)) return 'url';
  if (/^QR:/i.test(value)) return 'qr_text';
  if (/^[0-9]{5,14}$/.test(value)) return 'numeric_cert';
  return 'text';
}

function matchCert(patterns = [], value = '') {
  for (const pattern of patterns) {
    const match = pattern.exec(value);
    if (match?.[1]) return clean(match[1], 80);
  }
  return '';
}

function normalizeCertNumber(grader = '', value = '') {
  let cert = clean(value, 100).replace(/[\s._]/g, '').replace(/[\u2013\u2014]/g, '-').replace(/[^A-Za-z0-9-]/g, '');
  const company = normalizeText(grader);
  if (company.includes('psa') || company.includes('bgs') || company.includes('beckett') || company.includes('cgc') || company.includes('csg')) {
    cert = cert.replace(/[A-Za-z|]/g, (char) => OCR_DIGIT_FIXES[char] ?? char).replace(/[^0-9]/g, '');
  } else if (company.includes('sgc')) {
    cert = cert.toUpperCase();
  }
  return cert;
}

export function parseBarcodePayload(payload = '', hints = {}) {
  const value = clean(payload, 1500);
  if (!value) {
    return { parserVersion: BARCODE_PARSER_VERSION, decoded: false, warnings: ['No barcode or QR payload supplied.'] };
  }
  const normalized = normalizeText(`${hints.grader || ''} ${value}`);
  const directGrader = GRADER_HOSTS.find((entry) => entry.patterns.some((pattern) => pattern.test(value) || pattern.test(normalized)));
  const grader = clean(hints.grader || directGrader?.grader || '', 20);
  const rawCertNumber = clean((directGrader ? matchCert(directGrader.certPatterns, value) : '') || (/^[0-9OQDISBGl|]{5,14}$/.test(value) ? value : ''), 80);
  const certNumber = normalizeCertNumber(grader, rawCertNumber);
  const payloadType = detectPayloadType(value);
  const warnings = [];
  if (!grader) warnings.push('Grader was not identified from barcode/QR payload.');
  if (!certNumber) warnings.push('Cert number was not identified from barcode/QR payload.');
  return {
    parserVersion: BARCODE_PARSER_VERSION,
    decoded: Boolean(grader || certNumber || payloadType === 'url'),
    barcodeType: payloadType === 'numeric_cert' ? 'barcode' : payloadType,
    barcodePayload: payloadType === 'url' ? '' : value,
    qrPayload: payloadType === 'url' || payloadType === 'qr_text' ? value : '',
    payloadType,
    grader: grader || null,
    certNumber: certNumber || null,
    rawCertNumber: rawCertNumber || null,
    verificationUrl: payloadType === 'url' ? value : null,
    warnings,
  };
}

export function extractCertFromText(text = '') {
  const value = clean(text, 5000);
  const detected = GRADER_HOSTS.find((entry) => entry.patterns.some((pattern) => pattern.test(value)));
  const genericCert = /\bcert(?:ification)?\s*(?:no\.?|#|number)?\s*:?\s*([A-Z0-9-]{5,18})\b/i.exec(value)?.[1]
    || /\b(?:PSA|BGS|BECKETT|SGC|CGC|CSG)\s*(?:cert)?\s*#?\s*([0-9OQDISBGl|]{5,14})\b/i.exec(value)?.[1]
    || '';
  const rawCertNumber = clean(detected ? matchCert(detected.certPatterns, value) || genericCert : genericCert, 80);
  const certNumber = normalizeCertNumber(detected?.grader, rawCertNumber);
  return {
    grader: detected?.grader || null,
    certNumber: certNumber || null,
    rawCertNumber: rawCertNumber || null,
    warnings: certNumber ? [] : ['No cert number was found in visible text.'],
  };
}
