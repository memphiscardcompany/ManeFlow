import { normalizeText } from './utils.js';

const INVALID_KEYWORDS = [
  'reprint',
  'rp',
  'facsimile',
  'digital',
  'lot',
  'pack',
  'box',
  'break',
  'custom',
  'read description',
  'proxy',
  'art card',
];

const INVALID_PATTERNS = INVALID_KEYWORDS.map((keyword) => {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, 'i');
});

const SPECULATIVE_GRADE_PATTERN = /(?:\?|candidate|potential|possible|ready|worthy|looks?\s+like|should\s+grade|gem\s+mint\s+candidate)/i;
const GRADE_PATTERNS = [
  { company: 'PSA', regex: /\bPSA\s*(?:GEM\s*MT\s*)?(10|[1-9](?:\.0)?)\b/i, halfGrades: false },
  { company: 'BGS', regex: /\bBGS\s*(10|[1-9](?:\.5)?)\b/i, halfGrades: true },
  { company: 'CGC', regex: /\bCGC\s*(10|[1-9](?:\.5)?)\b/i, halfGrades: true },
  { company: 'SGC', regex: /\bSGC\s*(10|[1-9](?:\.5)?)\b/i, halfGrades: true },
];

function normalizeCardNumber(value) {
  return String(value ?? '')
    .trim()
    .replace(/^#/, '')
    .replace(/^0+(?=\d)/, '')
    .toUpperCase();
}

function cardNumberCandidates(title) {
  const candidates = [];
  const patterns = [
    /(?:^|\s)#\s*([A-Z]{0,5}\d{1,5}[A-Z]{0,3})(?=$|[\s,.;:()\[\]\/|-])/gi,
    /\b(?:card|no\.?|number)\s*#?\s*([A-Z]{0,5}\d{1,5}[A-Z]{0,3})\b/gi,
    /\b([A-Z]{1,5}\d{1,5}[A-Z]{0,3})\b/gi,
  ];
  for (const pattern of patterns) {
    for (const match of String(title || '').matchAll(pattern)) {
      const normalized = normalizeCardNumber(match[1]);
      if (!normalized) continue;
      if (/^(?:PSA|BGS|CGC|SGC)\d+(?:\.5)?$/i.test(normalized)) continue;
      candidates.push(normalized);
    }
  }
  return [...new Set(candidates)];
}

export function extractListingGrade(title) {
  const rawTitle = String(title ?? '').trim();
  const normalized = normalizeText(rawTitle);
  if (!rawTitle) return { company: 'RAW', grade: null, slabbed: false, confidence: 1, reason: 'No grading language present.' };

  for (const pattern of GRADE_PATTERNS) {
    const match = rawTitle.match(pattern.regex);
    if (!match) continue;
    const matchedText = match[0];
    const tail = rawTitle.slice(Math.max(0, match.index || 0), Math.min(rawTitle.length, (match.index || 0) + matchedText.length + 24));
    if (SPECULATIVE_GRADE_PATTERN.test(tail) || SPECULATIVE_GRADE_PATTERN.test(normalized)) {
      return {
        company: 'RAW',
        grade: null,
        slabbed: false,
        confidence: 0.96,
        reason: 'Speculative grading language was detected without reliable slab evidence.',
      };
    }

    const grade = Number(match[1]);
    if (!Number.isFinite(grade) || grade < 1 || grade > 10) continue;
    if (!pattern.halfGrades && !Number.isInteger(grade)) continue;
    if (pattern.halfGrades && Math.abs(grade * 2 - Math.round(grade * 2)) > 1e-9) continue;
    return {
      company: pattern.company,
      grade,
      slabbed: true,
      confidence: 0.98,
      reason: `${pattern.company} numeric grade found in listing title.`,
    };
  }

  return { company: 'RAW', grade: null, slabbed: false, confidence: 1, reason: 'No supported third-party slab grade found.' };
}

export function evaluateListingTitle(title, { cardNumber = null, requireCardNumber = true } = {}) {
  const rawTitle = String(title ?? '').trim();
  if (!rawTitle) return { valid: false, reason: 'missing_title', title: rawTitle, grade: extractListingGrade(rawTitle), cardNumbers: [] };

  for (let index = 0; index < INVALID_PATTERNS.length; index += 1) {
    if (INVALID_PATTERNS[index].test(rawTitle)) {
      return {
        valid: false,
        reason: `negative_keyword:${INVALID_KEYWORDS[index]}`,
        title: rawTitle,
        grade: extractListingGrade(rawTitle),
        cardNumbers: cardNumberCandidates(rawTitle),
      };
    }
  }

  const target = normalizeCardNumber(cardNumber);
  const numbers = cardNumberCandidates(rawTitle);
  if (target) {
    const escapedTarget = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const exactTargetPattern = new RegExp(`(?:^|[^A-Z0-9])#?\\s*${escapedTarget}(?=$|[^A-Z0-9])`, 'i');
    const exactTargetPresent = exactTargetPattern.test(rawTitle);
    if (exactTargetPresent && !numbers.includes(target)) numbers.push(target);
    if (!exactTargetPresent && numbers.length === 0 && requireCardNumber) {
      return { valid: false, reason: 'card_number_missing', title: rawTitle, grade: extractListingGrade(rawTitle), cardNumbers: numbers };
    }
    if (!exactTargetPresent && numbers.length > 0 && !numbers.includes(target)) {
      return { valid: false, reason: 'card_number_mismatch', title: rawTitle, grade: extractListingGrade(rawTitle), cardNumbers: numbers };
    }
  }

  return { valid: true, reason: null, title: rawTitle, grade: extractListingGrade(rawTitle), cardNumbers: numbers };
}

export function scrubInvalidListings(listings, { cardNumber = null, requireCardNumber = true } = {}) {
  if (!Array.isArray(listings)) throw new TypeError('listings must be an array');
  const cleaned = [];
  const rejected = [];

  for (const listing of listings) {
    if (!listing || typeof listing !== 'object') {
      rejected.push({ listing, reason: 'invalid_listing_record' });
      continue;
    }
    const evaluation = evaluateListingTitle(listing.title, { cardNumber, requireCardNumber });
    if (!evaluation.valid) {
      rejected.push({ listing, reason: evaluation.reason, evaluation });
      continue;
    }
    cleaned.push({
      ...listing,
      normalizedGrade: evaluation.grade,
      normalizedCardNumbers: evaluation.cardNumbers,
    });
  }

  return { cleaned, rejected };
}
