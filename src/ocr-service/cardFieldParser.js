const GRADER_PATTERN = /\b(PSA|BGS|BECKETT|CGC|SGC)\s*(?:GEM\s*MINT|MINT|NM[+-]?|EX[+-]?|GOOD|AUTHENTIC)?\s*(10(?:\.0)?|[1-9](?:\.5|\.0)?)(?!\s*\?)/i;
const CERT_PATTERN = /\b(?:CERT(?:IFICATION)?(?:\s*(?:NO|NUMBER|#))?\s*[:#-]?\s*)?(\d{7,12})\b/i;
const CARD_NUMBER_PATTERN = /(?:^|\s)#?([A-Z]{0,5}\d{1,5}[A-Z]{0,4}(?:[-/]\d{1,5})?)(?=\s|$)/i;
const SERIAL_PATTERN = /\b(?:SN\s*)?(\d{1,6})\s*[/\\-]\s*(\d{1,6})\b/i;
const YEAR_PATTERN = /\b(18\d{2}|19\d{2}|20\d{2}|21\d{2})\b/;

function clamp(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function normalizeLine(line = {}) {
  const text = String(line.text || '').trim();
  const confidence = clamp(line.confidence);
  const box = Array.isArray(line.box)
    ? line.box.slice(0, 4).map((point) => ({ x: Number(point.x) || 0, y: Number(point.y) || 0 }))
    : [];
  return { text, confidence, box };
}

function bestConfidence(lines, predicate) {
  const matched = lines.filter((line) => predicate(line.text));
  if (!matched.length) return 0;
  return Math.max(...matched.map((line) => line.confidence));
}

export function extractTradingCardFields(inputLines = []) {
  const lines = inputLines.map(normalizeLine).filter((line) => line.text);
  const text = lines.map((line) => line.text).join(' ').replace(/\s+/g, ' ').trim();
  const gradeMatch = GRADER_PATTERN.exec(text);
  const certMatch = CERT_PATTERN.exec(text);
  const serialMatch = SERIAL_PATTERN.exec(text);
  const yearMatch = YEAR_PATTERN.exec(text);

  let cardNumber = null;
  for (const line of lines) {
    const explicit = /(?:CARD\s*(?:NO|NUMBER)|#)\s*[:#-]?\s*([A-Z0-9-]{1,16})/i.exec(line.text);
    if (explicit) {
      cardNumber = explicit[1].toUpperCase();
      break;
    }
  }
  if (!cardNumber) {
    const fallback = CARD_NUMBER_PATTERN.exec(text);
    if (fallback && !YEAR_PATTERN.test(fallback[1])) cardNumber = fallback[1].toUpperCase();
  }

  const grader = gradeMatch ? gradeMatch[1].toUpperCase().replace('BECKETT', 'BGS') : null;
  const grade = gradeMatch ? gradeMatch[2] : null;
  const certNumber = certMatch ? certMatch[1] : null;
  const serialNumber = serialMatch ? `${serialMatch[1]}/${serialMatch[2]}` : null;
  const rookie = /\b(?:ROOKIE|RC)\b/i.test(text) ? true : null;
  const autograph = /\b(?:AUTOGRAPH|AUTO|SIGNED)\b/i.test(text) ? true : null;

  return {
    text,
    visibleText: lines.map((line) => line.text),
    lines,
    fields: {
      year: yearMatch ? Number(yearMatch[1]) : null,
      cardNumber,
      serialNumber,
      rookie,
      autograph,
      grader,
      grade,
      certNumber,
    },
    fieldConfidence: {
      year: yearMatch ? bestConfidence(lines, (value) => value.includes(yearMatch[1])) : 0,
      cardNumber: cardNumber ? bestConfidence(lines, (value) => value.toUpperCase().includes(cardNumber)) : 0,
      serialNumber: serialNumber ? bestConfidence(lines, (value) => SERIAL_PATTERN.test(value)) : 0,
      rookie: rookie ? bestConfidence(lines, (value) => /\b(?:ROOKIE|RC)\b/i.test(value)) : 0,
      autograph: autograph ? bestConfidence(lines, (value) => /\b(?:AUTOGRAPH|AUTO|SIGNED)\b/i.test(value)) : 0,
      grader: grader ? bestConfidence(lines, (value) => new RegExp(`\\b${grader === 'BGS' ? '(?:BGS|BECKETT)' : grader}\\b`, 'i').test(value)) : 0,
      grade: grade ? bestConfidence(lines, (value) => GRADER_PATTERN.test(value)) : 0,
      certNumber: certNumber ? bestConfidence(lines, (value) => value.includes(certNumber)) : 0,
    },
  };
}
