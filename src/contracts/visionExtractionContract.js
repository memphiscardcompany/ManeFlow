const CONTRACT_VERSION = 'vision-extraction.v1';
const SURFACE_TYPES = new Set([
  null,
  'BASE',
  'SILVER_HOLOFRACTOR',
  'GOLD_REFRACTOR',
  'CRACKED_ICE',
  'MOJO',
  'WAVE',
]);
const PRICING_STATUSES = new Set(['verified', 'price_unverifiable', 'insufficient_comps']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class VisionContractError extends TypeError {
  constructor(issues) {
    const normalized = Array.isArray(issues) ? issues : [String(issues)];
    super(`Vision extraction contract rejected: ${normalized.join('; ')}`);
    this.name = 'VisionContractError';
    this.code = 'VISION_CONTRACT_INVALID';
    this.issues = normalized;
  }
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function confidence(value) {
  return finiteNumber(value) && value >= 0 && value <= 1;
}

function stringArray(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function addIf(issues, condition, message) {
  if (!condition) issues.push(message);
}

export function validateVisionExtractionResult(payload, { requireEmbedding = false } = {}) {
  const issues = [];
  addIf(issues, payload && typeof payload === 'object' && !Array.isArray(payload), 'payload must be an object');
  if (issues.length) throw new VisionContractError(issues);

  addIf(issues, payload.contract_version === CONTRACT_VERSION, `contract_version must equal ${CONTRACT_VERSION}`);
  addIf(issues, typeof payload.scan_id === 'string' && UUID_PATTERN.test(payload.scan_id), 'scan_id must be a UUID');
  addIf(issues, payload.predicted_card && typeof payload.predicted_card === 'object' && !Array.isArray(payload.predicted_card), 'predicted_card must be an object');
  addIf(issues, confidence(payload.identity_confidence), 'identity_confidence must be between 0 and 1');
  addIf(issues, confidence(payload.variant_confidence), 'variant_confidence must be between 0 and 1');
  addIf(issues, Number.isInteger(payload.detected_object_count) && payload.detected_object_count >= 0, 'detected_object_count must be a non-negative integer');
  addIf(issues, PRICING_STATUSES.has(payload.pricing_status), 'pricing_status is invalid');
  addIf(issues, confidence(payload.confidence_score), 'confidence_score must be between 0 and 1');
  addIf(issues, Number.isInteger(payload.comps_used) && payload.comps_used >= 0, 'comps_used must be a non-negative integer');
  addIf(issues, Number.isInteger(payload.outliers_removed) && payload.outliers_removed >= 0, 'outliers_removed must be a non-negative integer');
  addIf(issues, typeof payload.explanation === 'string' && payload.explanation.trim().length > 0, 'explanation must be a non-empty string');
  addIf(issues, stringArray(payload.warnings), 'warnings must be an array of strings');
  addIf(issues, typeof payload.created_at === 'string' && Number.isFinite(Date.parse(payload.created_at)), 'created_at must be an ISO date-time');

  if ('detected_surface_type' in payload) {
    addIf(issues, SURFACE_TYPES.has(payload.detected_surface_type), 'detected_surface_type is invalid');
  }
  if ('refractor_confidence' in payload) {
    addIf(issues, confidence(payload.refractor_confidence), 'refractor_confidence must be between 0 and 1');
  }
  if ('visible_text' in payload) addIf(issues, stringArray(payload.visible_text), 'visible_text must be an array of strings');
  if ('barcode_values' in payload) addIf(issues, stringArray(payload.barcode_values), 'barcode_values must be an array of strings');

  const embedding = payload.visual_embedding;
  if (requireEmbedding || embedding != null) {
    addIf(issues, embedding && typeof embedding === 'object' && !Array.isArray(embedding), 'visual_embedding must be an object');
    if (embedding && typeof embedding === 'object') {
      addIf(issues, Array.isArray(embedding.vector) && embedding.vector.length === 1152, 'visual_embedding.vector must contain exactly 1152 values');
      if (Array.isArray(embedding.vector)) {
        addIf(issues, embedding.vector.every(finiteNumber), 'visual_embedding.vector values must be finite numbers');
      }
      addIf(issues, embedding.dimensions === 1152, 'visual_embedding.dimensions must equal 1152');
      addIf(issues, embedding.normalized === true, 'visual_embedding.normalized must be true');
      addIf(issues, typeof embedding.model_name === 'string' && embedding.model_name.trim().length > 0, 'visual_embedding.model_name is required');
      addIf(issues, typeof embedding.provider === 'string' && embedding.provider.trim().length > 0, 'visual_embedding.provider is required');
    }
  }

  if (issues.length) throw new VisionContractError(issues);
  return payload;
}

export { CONTRACT_VERSION as VISION_EXTRACTION_CONTRACT_VERSION };
