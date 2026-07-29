function extractOutputText(response) {
  if (typeof response.output_text === 'string') return response.output_text;
  const chunks = [];
  for (const item of response.output || []) {
    for (const part of item.content || []) {
      if (part.type === 'output_text' && part.text) chunks.push(part.text);
    }
  }
  return chunks.join('\n');
}

function parseJsonText(text) {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(cleaned); } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error('Vision response did not contain valid JSON');
  }
}

function validateImage(dataUrl) {
  if (!/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(String(dataUrl || ''))) {
    throw new Error('Supported image data URL required (JPEG, PNG, or WebP)');
  }
}

function confidence(value) {
  if (!Number.isFinite(Number(value))) return null;
  const numeric = Number(value);
  return Math.max(0, Math.min(1, numeric > 1 ? numeric / 100 : numeric));
}

function array(value) {
  return Array.isArray(value) ? value.filter(Boolean).map(String) : value ? [String(value)] : [];
}

function normalizeVisionPayload(parsed = {}) {
  const facts = parsed.facts && typeof parsed.facts === 'object' ? parsed.facts : parsed;
  const fieldConfidence = Object.fromEntries(Object.entries(parsed.fieldConfidence || parsed.confidenceByField || {}).map(([key, value]) => [key, confidence(value)]));
  const warnings = [
    ...array(parsed.warnings),
    ...array(parsed.uncertaintyReasons),
    ...array(parsed.imageQuality?.warnings),
  ];
  const normalized = {
    ...parsed,
    ...facts,
    facts,
    fieldConfidence,
    visualMarkers: parsed.visualMarkers || {},
    imageQuality: parsed.imageQuality || {},
    candidateDescriptions: Array.isArray(parsed.candidateDescriptions) ? parsed.candidateDescriptions : [],
    warnings: [...new Set(warnings)],
    confidence: confidence(parsed.confidence ?? parsed.overallConfidence),
  };
  return normalized;
}

function normalizeSceneType(value = '') {
  const text = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_');
  if (text.includes('binder')) return 'binder_page';
  if (text.includes('mixed')) return 'mixed_raw_slab';
  if (text.includes('table') || text.includes('layout') || text.includes('group') || text.includes('multi')) return 'multi_card_table';
  if (text.includes('pack') || text.includes('box') || text.includes('sealed') || text.includes('booster') || text.includes('blaster') || text.includes('hobby') || text.includes('retail') || text.includes('tin') || text.includes('etb')) return 'sealed_product';
  if (text.includes('cert') || text.includes('label')) return 'cert_label';
  if (text.includes('single')) return 'single_card';
  return 'unknown';
}

function normalizeBox(box = {}) {
  const source = Array.isArray(box) ? { x: box[0], y: box[1], width: box[2], height: box[3] } : box || {};
  const number = (value, fallback) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.min(1, parsed > 1 ? parsed / 100 : parsed));
  };
  return {
    x: number(source.x ?? source.left, 0),
    y: number(source.y ?? source.top, 0),
    width: number(source.width ?? source.w, 1),
    height: number(source.height ?? source.h, 1),
  };
}

function normalizeDetectedCard(card = {}, index = 0) {
  const facts = card.facts && typeof card.facts === 'object' ? card.facts : card;
  return normalizeVisionPayload({
    ...card,
    facts,
    regionId: String(card.regionId || card.id || `region_${index + 1}`),
    boundingBox: normalizeBox(card.boundingBox || card.box),
    orientation: card.orientation || card.visualMarkers?.orientation || 'unknown',
    cardType: card.cardType || card.type || (card.slabbed ? 'slabbed' : 'raw_or_unknown'),
    slabbed: Boolean(card.slabbed || facts.grader || facts.certNumber),
  });
}

export function normalizeSceneAnalysis(parsed = {}) {
  const scene = parsed.scene && typeof parsed.scene === 'object' ? parsed.scene : {};
  const detected = parsed.detectedCards || parsed.cards || parsed.cardRegions || [];
  const detectedCards = Array.isArray(detected)
    ? detected.map(normalizeDetectedCard)
    : [];
  const fallbackCards = detectedCards.length ? detectedCards : [normalizeDetectedCard(parsed.primaryCard || parsed, 0)];
  const sceneType = normalizeSceneType(scene.type || parsed.sceneType || (fallbackCards.length > 1 ? 'multi_card_table' : 'single_card'));
  return {
    provider: parsed.provider || null,
    model: parsed.model || null,
    scene: {
      type: sceneType,
      cardCount: Number.isFinite(Number(scene.cardCount)) ? Number(scene.cardCount) : fallbackCards.length,
      processingStrategy: scene.processingStrategy || (fallbackCards.length > 1 ? 'multi_region' : 'single_region'),
      layoutRows: Number.isFinite(Number(scene.layoutRows)) ? Number(scene.layoutRows) : null,
      layoutColumns: Number.isFinite(Number(scene.layoutColumns)) ? Number(scene.layoutColumns) : null,
      difficulty: scene.difficulty || parsed.difficulty || 'unknown',
      warnings: [...new Set(array(scene.warnings).concat(array(parsed.globalWarnings)))],
    },
    detectedCards: fallbackCards,
    primaryCard: fallbackCards[0] || null,
    overallConfidence: confidence(parsed.overallConfidence ?? parsed.confidence),
    raw: parsed,
  };
}

function visionInstruction({ hasBack, hasCert }) {
  return `You are ManeFlow's trading-card vision specialist. Analyze exactly one card from the supplied image set and return only strict JSON.

Primary goal: extract visual facts for catalog matching. Do not estimate monetary value.

Return this JSON shape:
{
  "facts": {
    "player": null,
    "subject": null,
    "team": null,
    "sport": null,
    "year": null,
    "brand": null,
    "set": null,
    "subset": null,
    "cardNumber": null,
    "parallel": null,
    "variation": null,
    "productName": null,
    "productType": null,
    "sealedType": null,
    "configuration": null,
    "sku": null,
    "upc": null,
    "serialNumber": null,
    "rookie": null,
    "autograph": null,
    "relic": null,
    "grader": null,
    "grade": null,
    "certNumber": null,
    "barcodePayload": null,
    "qrPayload": null,
    "visibleText": []
  },
  "fieldConfidence": {
    "player": 0,
    "year": 0,
    "brand": 0,
    "set": 0,
    "cardNumber": 0,
    "parallel": 0,
    "productName": 0,
    "productType": 0,
    "configuration": 0,
    "upc": 0,
    "serialNumber": 0,
    "grader": 0,
    "grade": 0,
    "certNumber": 0
  },
  "visualMarkers": {
    "logos": [],
    "setSymbols": [],
    "borderStyle": null,
    "foilPattern": null,
    "refractorPattern": null,
    "fontStyle": null,
    "orientation": null,
    "slabLabelType": null
  },
  "imageQuality": {
    "blur": "none|mild|heavy",
    "glare": "none|mild|heavy",
    "crop": "full_card|partial|label_only",
    "lighting": "good|dim|overexposed",
    "angle": "flat|tilted|severe",
    "warnings": []
  },
  "candidateDescriptions": [
    { "description": "short human-readable candidate", "why": "visual evidence", "confidence": 0 }
  ],
  "needsBackImage": ${hasBack ? 'false' : 'true'},
  "needsCertCloseup": ${hasCert ? 'false' : 'null'},
  "overallConfidence": 0,
  "uncertaintyReasons": []
}

Rules:
- Say null or "uncertain" rather than guessing when the image is not clear.
- Pay special attention to card number, set name, parallel/variant, serial numbering, rookie marks, autograph/relic indicators, team logos, foil/refractor patterns, border design, font style, manufacturer logo, and set symbols.
- For slabbed cards, read the label first: grader, grade, cert number, barcode or QR text if visible, year, set, player/subject, card number, and label conflicts.
- For sealed packs, boxes, tins, ETBs, blasters, boosters, and hobby/retail products, set productType/sealedType/configuration and extract set name, brand, year/release era, sport/game, SKU/UPC/barcode, pack count, box type, and visible configuration text when readable.
- If front-only evidence cannot distinguish similar parallels or variations, lower parallel confidence and set needsBackImage=true.
- If the image is a close-up slab/cert label only, extract cert facts and visible text; do not invent the card front.
- Keep every field confidence calibrated: 0.95+ only for exact readable text or unmistakable visual proof; below 0.6 when inferred or ambiguous.`;
}

function sceneVisionInstruction({ hasBack, hasCert }) {
  return `You are ManeFlow's state-of-the-art trading-card scene recognition system. Analyze the supplied image set and return only strict JSON.

Primary goal: detect every visible trading card region, extract visual facts for catalog matching, and explain uncertainty. Do not estimate monetary value.

Return this JSON shape:
{
  "scene": {
    "type": "single_card|multi_card_table|binder_page|mixed_raw_slab|sealed_product|cert_label|unknown",
    "cardCount": 0,
    "layoutRows": null,
    "layoutColumns": null,
    "processingStrategy": "single_region|multi_region|binder_grid|mixed_slab_raw|cert_only",
    "difficulty": "easy|medium|hard",
    "warnings": []
  },
  "detectedCards": [
    {
      "regionId": "region_1",
      "boundingBox": { "x": 0, "y": 0, "width": 1, "height": 1 },
      "orientation": "vertical|horizontal|rotated|unknown",
      "cardType": "raw|slabbed|sealed|partial|unknown",
      "slabbed": false,
      "facts": {
        "player": null,
        "subject": null,
        "team": null,
        "sport": null,
        "year": null,
        "brand": null,
        "set": null,
        "subset": null,
        "cardNumber": null,
        "parallel": null,
        "variation": null,
        "productName": null,
        "productType": null,
        "sealedType": null,
        "configuration": null,
        "sku": null,
        "upc": null,
        "serialNumber": null,
        "rookie": null,
        "autograph": null,
        "relic": null,
        "grader": null,
        "grade": null,
        "certNumber": null,
        "barcodePayload": null,
        "qrPayload": null,
        "visibleText": []
      },
      "fieldConfidence": {
        "player": 0,
        "subject": 0,
        "year": 0,
        "brand": 0,
        "set": 0,
        "cardNumber": 0,
        "parallel": 0,
        "productName": 0,
        "productType": 0,
        "configuration": 0,
        "upc": 0,
        "serialNumber": 0,
        "rookie": 0,
        "autograph": 0,
        "relic": 0,
        "grader": 0,
        "grade": 0,
        "certNumber": 0
      },
      "visualMarkers": {
        "logos": [],
        "setSymbols": [],
        "borderStyle": null,
        "foilPattern": null,
        "refractorPattern": null,
        "fontStyle": null,
        "orientation": null,
        "slabLabelType": null
      },
      "imageQuality": {
        "blur": "none|mild|heavy",
        "glare": "none|mild|heavy",
        "crop": "full_card|partial|label_only",
        "lighting": "good|dim|overexposed",
        "angle": "flat|tilted|severe",
        "warnings": []
      },
      "candidateDescriptions": [
        { "description": "short human-readable candidate", "why": "visual evidence", "confidence": 0 }
      ],
      "needsBackImage": ${hasBack ? 'false' : 'true'},
      "needsCertCloseup": ${hasCert ? 'false' : 'null'},
      "overallConfidence": 0,
      "uncertaintyReasons": []
    }
  ],
  "overallConfidence": 0,
  "globalWarnings": []
}

Rules:
- Detect every visible card-like region. For binder pages, count each pocket/card separately. For table layouts, return one detectedCards item per visible card.
- Use normalized bounding boxes from 0 to 1 relative to the supplied front image.
- Prefer null or "uncertain" over guessing. Wrong confident matches are worse than honest uncertainty.
- Pay special attention to card number, set name, parallel/variant, serial numbering, rookie marks, autograph/relic indicators, team logos, foil/refractor patterns, border design, font style, manufacturer logo, and set symbols.
- For slabbed cards, read the slab label first: grader, grade, cert number, barcode/QR text, year, set, subject, card number, and label conflicts.
- For sealed products, detect packs, boxes, blasters, hobby boxes, retail boxes, booster boxes, tins, ETBs, and sealed cases. Extract set/product name, brand, release year, sport/game, box or pack configuration, SKU/UPC/barcode, pack count, and visible configuration text. Do not invent the contents of sealed product.
- If a region is too cropped, glared, blurry, or partially hidden, still return the region with low field confidence and clear imageQuality warnings.
- If multiple close parallels or variations are possible, lower parallel confidence and include top candidate descriptions.
- Keep every field confidence calibrated: 0.95+ only for exact readable text or unmistakable visual proof; below 0.6 when inferred or ambiguous.`;
}

export async function analyzeCardImages({ frontDataUrl, backDataUrl = '', certDataUrl = '', apiKey, model }) {
  if (!apiKey || !model) return null;
  validateImage(frontDataUrl);
  if (backDataUrl) validateImage(backDataUrl);
  if (certDataUrl) validateImage(certDataUrl);

  const content = [{
    type: 'input_text',
    text: visionInstruction({ hasBack: Boolean(backDataUrl), hasCert: Boolean(certDataUrl) }),
  }, { type: 'input_image', image_url: frontDataUrl }];
  if (backDataUrl) content.push({ type: 'input_image', image_url: backDataUrl });
  if (certDataUrl) content.push({ type: 'input_image', image_url: certDataUrl });

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: [{ role: 'user', content }],
      max_output_tokens: 900,
    }),
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Vision provider failed (${response.status}): ${message.slice(0, 220)}`);
  }
  const payload = await response.json();
  const parsed = normalizeVisionPayload(parseJsonText(extractOutputText(payload)));
  return { ...parsed, provider: 'OpenAI Responses API', model };
}

export const analyzeCardImage = ({ dataUrl, ...rest }) => analyzeCardImages({ frontDataUrl: dataUrl, ...rest });

export async function analyzeCardScene({ frontDataUrl, backDataUrl = '', certDataUrl = '', apiKey, model }) {
  if (!apiKey || !model) return null;
  validateImage(frontDataUrl);
  if (backDataUrl) validateImage(backDataUrl);
  if (certDataUrl) validateImage(certDataUrl);

  const content = [{
    type: 'input_text',
    text: sceneVisionInstruction({ hasBack: Boolean(backDataUrl), hasCert: Boolean(certDataUrl) }),
  }, { type: 'input_image', image_url: frontDataUrl }];
  if (backDataUrl) content.push({ type: 'input_image', image_url: backDataUrl });
  if (certDataUrl) content.push({ type: 'input_image', image_url: certDataUrl });

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: [{ role: 'user', content }],
      max_output_tokens: 3000,
    }),
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Vision provider failed (${response.status}): ${message.slice(0, 220)}`);
  }
  const payload = await response.json();
  const parsed = normalizeSceneAnalysis(parseJsonText(extractOutputText(payload)));
  return { ...parsed, provider: 'OpenAI Responses API', model };
}
