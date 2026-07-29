import { makeId } from './utils.js';

export const COLLECTION_SURVEY_ONTOLOGY = Object.freeze({
  storage: ['one_row_box','two_row_box','three_row_box','four_row_box','five_row_box','shoe_box','graded_card_box','toploader_box','tcg_box','plastic_tote','card_drawer','drawer_tower','shelf','display_case','card_case','binder','binder_page','slab_case','unknown_card_container'],
  cardFormats: ['raw_card','penny_sleeved_card','toploaded_card','semi_rigid_card','one_touch','graded_slab','oversized_slab','loose_stack','protected_stack','binder_card_region'],
  sealed: ['pack','fat_pack','hanger','blaster','mega_box','hobby_box','retail_box','sealed_case','tin','unknown_sealed_product'],
  supplies: ['empty_penny_sleeves','empty_toploaders','semi_rigid_holders','one_touch_holders','team_bags','dividers','empty_storage_box','shipping_supply','unknown_card_supply'],
  nonInventory: ['furniture','electronics','books','paperwork','clothing','household_storage','people','animals','decorative_objects','unknown_non_card_object'],
});

const CAPACITY = Object.freeze({
  one_row_box: { raw: 800, penny: 650, toploader: 180, slab: 0 },
  two_row_box: { raw: 1600, penny: 1300, toploader: 360, slab: 0 },
  three_row_box: { raw: 2400, penny: 1950, toploader: 540, slab: 0 },
  four_row_box: { raw: 3200, penny: 2600, toploader: 720, slab: 0 },
  five_row_box: { raw: 4000, penny: 3250, toploader: 900, slab: 0 },
  shoe_box: { raw: 1000, penny: 800, toploader: 220, slab: 0 },
  graded_card_box: { raw: 0, penny: 0, toploader: 0, slab: 110 },
  toploader_box: { raw: 0, penny: 0, toploader: 240, slab: 0 },
  tcg_box: { raw: 1000, penny: 800, toploader: 180, slab: 0 },
  card_drawer: { raw: 1400, penny: 1100, toploader: 280, slab: 120 },
  binder: { raw: 360, penny: 360, toploader: 0, slab: 0 },
  binder_page: { raw: 9, penny: 9, toploader: 0, slab: 0 },
  slab_case: { raw: 0, penny: 0, toploader: 0, slab: 70 },
});

function text(value, max = 300) { return String(value ?? '').trim().slice(0, max); }
function clamp(value, min, max) { return Math.min(max, Math.max(min, Number(value) || 0)); }
function roundRange(value) {
  if (value < 100) return Math.round(value);
  if (value < 1000) return Math.round(value / 10) * 10;
  if (value < 10000) return Math.round(value / 100) * 100;
  return Math.round(value / 500) * 500;
}
function contentKey(value) {
  const key = text(value, 40).toLowerCase();
  if (key.includes('slab')) return 'slab';
  if (key.includes('top')) return 'toploader';
  if (key.includes('penny') || key.includes('sleeve')) return 'penny';
  return 'raw';
}
function confidenceLabel(score) { return score >= .8 ? 'High' : score >= .55 ? 'Moderate' : 'Low'; }

export function estimateSurveyObject(input = {}) {
  const kind = text(input.kind || input.objectClass, 80).toLowerCase();
  const category = text(input.category, 40).toLowerCase();
  const quantity = Math.max(1, Math.min(10000, Number(input.quantity || 1)));
  const fullness = clamp(input.fullness ?? .65, 0, 1);
  const confidence = clamp(input.confidence ?? .55, 0, 1);
  const directCount = Number(input.directCount || 0);
  const stackHeightCount = Number(input.stackHeightCount || 0);
  const isNonInventory = COLLECTION_SURVEY_ONTOLOGY.nonInventory.includes(kind) || category === 'non_inventory';
  if (isNonInventory) return { low: 0, expected: 0, high: 0, method: 'excluded_non_inventory', confidence, evidence: ['Object classified as non-inventory.'], assumptions: [] };
  if (directCount > 0) {
    const spread = confidence >= .85 ? .02 : confidence >= .6 ? .08 : .18;
    return { low: roundRange(directCount * quantity * (1 - spread)), expected: roundRange(directCount * quantity), high: roundRange(directCount * quantity * (1 + spread)), method: 'direct_instance_count', confidence, evidence: ['Visible instances supplied or confirmed.'], assumptions: ['Direct count may omit hidden or occluded items.'] };
  }
  if (stackHeightCount > 0) {
    const spread = confidence >= .75 ? .12 : .25;
    return { low: roundRange(stackHeightCount * quantity * (1 - spread)), expected: roundRange(stackHeightCount * quantity), high: roundRange(stackHeightCount * quantity * (1 + spread)), method: 'stack_height_estimation', confidence, evidence: ['Count estimated from visible stack height and protection format.'], assumptions: ['Card/holder thickness is assumed to be reasonably uniform.'] };
  }
  const profile = CAPACITY[kind];
  if (profile) {
    const type = contentKey(input.contentType);
    const capacity = Number(profile[type] || profile.raw || profile.toploader || profile.slab || 0);
    const adjustment = clamp(input.contentAdjustment ?? 1, .25, 1.25);
    const expected = capacity * fullness * adjustment * quantity;
    const uncertainty = confidence >= .8 ? .12 : confidence >= .55 ? .25 : .42;
    return { low: roundRange(expected * (1 - uncertainty)), expected: roundRange(expected), high: roundRange(expected * (1 + uncertainty)), method: kind === 'binder' || kind === 'binder_page' ? 'binder_capacity' : 'container_capacity', confidence, evidence: [`Known ${kind.replaceAll('_',' ')} capacity profile.`, `User/vision fullness estimate: ${Math.round(fullness * 100)}%.`], assumptions: [`Contents treated primarily as ${type}.`, 'Dividers, gaps, mixed protection, and hidden empty space may change capacity.'] };
  }
  return { low: 0, expected: 0, high: 0, method: 'indeterminate', confidence: Math.min(confidence, .35), evidence: ['No reliable capacity or direct-count evidence.'], assumptions: ['Additional photographs or user confirmation are required.'] };
}

export function buildCollectionSurvey(input = {}, existing = null) {
  const observations = Array.isArray(input.objects) ? input.objects.slice(0, 2000) : [];
  const seen = new Map();
  const possibleDuplicates = [];
  const objects = observations.map((raw, index) => {
    const stableKey = text(raw.stableKey || raw.visualKey || raw.label || `${raw.kind || 'object'}-${index}`, 160).toLowerCase();
    const duplicateOf = stableKey && seen.has(stableKey) ? seen.get(stableKey) : null;
    const id = text(raw.id, 100) || makeId('survey_object');
    if (!duplicateOf && stableKey) seen.set(stableKey, id);
    if (duplicateOf) possibleDuplicates.push({ objectId: id, duplicateOf, reason: 'Matching stable/visual key; human confirmation required.' });
    const estimate = estimateSurveyObject(raw);
    return { id, stableKey, duplicateOf, category: text(raw.category, 40), kind: text(raw.kind || raw.objectClass, 80), label: text(raw.label || raw.kind || 'Detected object', 160), areaId: text(raw.areaId || 'area-1', 80), quantity: Math.max(1, Number(raw.quantity || 1)), contentType: text(raw.contentType || 'unknown', 60), fullness: clamp(raw.fullness ?? .65, 0, 1), confidence: clamp(raw.confidence ?? .55, 0, 1), excluded: estimate.method === 'excluded_non_inventory', estimate, userConfirmed: Boolean(raw.userConfirmed), sourceImageIds: Array.isArray(raw.sourceImageIds) ? raw.sourceImageIds.slice(0, 30).map((v) => text(v, 120)) : [] };
  });
  const included = objects.filter((item) => !item.excluded && !item.duplicateOf);
  const totals = included.reduce((sum, item) => ({ low: sum.low + item.estimate.low, expected: sum.expected + item.estimate.expected, high: sum.high + item.estimate.high }), { low: 0, expected: 0, high: 0 });
  const unresolved = included.filter((item) => item.estimate.method === 'indeterminate' || item.confidence < .45);
  const hiddenAreas = Array.isArray(input.hiddenAreas) ? input.hiddenAreas.slice(0, 100).map((v) => text(v, 240)) : [];
  const confidenceScore = included.length ? included.reduce((sum, item) => sum + item.confidence, 0) / included.length : 0;
  const directValue = clamp(input.valuation?.directlyIdentifiedValue || 0, 0, 1e12);
  const visibleValueLow = clamp(input.valuation?.visibleValueLow || directValue, 0, 1e12);
  const visibleValueHigh = clamp(input.valuation?.visibleValueHigh || directValue, 0, 1e12);
  const sampleLow = clamp(input.valuation?.sampleBasedLow || 0, 0, 1e12);
  const sampleHigh = clamp(input.valuation?.sampleBasedHigh || 0, 0, 1e12);
  const bulkLow = clamp(input.valuation?.bulkFloorLow || 0, 0, 1e12);
  const bulkHigh = clamp(input.valuation?.bulkFloorHigh || 0, 0, 1e12);
  return {
    id: existing?.id || text(input.id, 100) || makeId('collection_survey'),
    userId: existing?.userId || text(input.userId, 100),
    organizationId: existing?.organizationId || text(input.organizationId, 100),
    title: text(input.title || existing?.title || 'Untitled collection survey', 180),
    surveyType: text(input.surveyType || existing?.surveyType || 'personal_collection', 80),
    locationLabel: text(input.locationLabel || existing?.locationLabel, 180),
    status: unresolved.length || possibleDuplicates.length ? 'needs_review' : 'draft_complete',
    images: Array.isArray(input.images) ? input.images.slice(0, 250).map((image, index) => ({ id: text(image.id, 120) || `image-${index + 1}`, name: text(image.name, 240), width: Number(image.width || 0), height: Number(image.height || 0), blurScore: clamp(image.blurScore ?? 1, 0, 1), brightnessScore: clamp(image.brightnessScore ?? .5, 0, 1), capturedAt: text(image.capturedAt, 80) })) : existing?.images || [],
    objects,
    scene: { uniqueObjects: included.length, possibleDuplicates, unmatchedObjects: unresolved.map((item) => item.id), hiddenAreas, unscannedAreas: Array.isArray(input.unscannedAreas) ? input.unscannedAreas.slice(0, 100).map((v) => text(v, 240)) : [] },
    countEstimate: { low: roundRange(totals.low), expected: roundRange(totals.expected), high: roundRange(totals.high), confidence: confidenceLabel(confidenceScore), confidenceScore: Number(confidenceScore.toFixed(3)), evidence: included.flatMap((item) => item.estimate.evidence).slice(0, 40), assumptions: [...new Set(included.flatMap((item) => item.estimate.assumptions))].slice(0, 30), hiddenAreaWarning: hiddenAreas.length > 0, duplicateViewRisk: possibleDuplicates.length ? 'review_required' : 'low', suggestedNextScan: unresolved.length ? `Capture closer images for ${unresolved.slice(0,3).map((item) => item.label).join(', ')}.` : hiddenAreas.length ? 'Photograph the hidden or unscanned areas.' : 'Select representative samples to improve valuation.' },
    valuation: { directlyIdentified: { value: directValue, tier: 1 }, visibleCategory: { low: visibleValueLow, high: visibleValueHigh, tier: 2 }, sampleBased: { low: sampleLow, high: sampleHigh, tier: 3 }, bulkFloor: { low: bulkLow, high: bulkHigh, tier: 4 }, indeterminate: !(directValue || visibleValueHigh || sampleHigh || bulkHigh), dataTimestamp: text(input.valuation?.dataTimestamp || new Date().toISOString(), 80), comparableSaleQuality: text(input.valuation?.comparableSaleQuality || 'not_evaluated', 80), disclaimer: 'Collection Survey estimates are evidence-bounded ranges, not guaranteed values or formal appraisals.' },
    review: { humanReviewRequired: Boolean(unresolved.length || possibleDuplicates.length || hiddenAreas.length), unresolvedObjectIds: unresolved.map((item) => item.id), approvedAt: existing?.review?.approvedAt || null, approvedBy: existing?.review?.approvedBy || null },
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export async function saveCollectionSurvey(store, actor, input, existing = null) {
  if (!store.state.collectionSurveys) store.state.collectionSurveys = [];
  const survey = buildCollectionSurvey({ ...input, userId: actor.userId }, existing);
  const index = store.state.collectionSurveys.findIndex((item) => item.id === survey.id && item.userId === actor.userId);
  if (index >= 0) store.state.collectionSurveys[index] = survey; else store.state.collectionSurveys.unshift(survey);
  await store.audit?.({ type: index >= 0 ? 'collection_survey_updated' : 'collection_survey_created', userId: actor.userId, surveyId: survey.id, status: survey.status, estimatedCards: survey.countEstimate.expected });
  await store.persist();
  return structuredClone(survey);
}

export function listCollectionSurveys(state, actor) {
  return (state.collectionSurveys || []).filter((item) => item.userId === actor.userId).map((item) => structuredClone(item));
}
