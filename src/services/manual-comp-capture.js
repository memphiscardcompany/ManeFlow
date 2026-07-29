import { makeId } from './utils.js';
import { parseEvidenceText } from './evidence-parser.js';

function clean(value, max = 2000) {
  return String(value ?? '').trim().slice(0, max);
}

export function manualCompToPricingRow(comp = {}) {
  const extracted = comp.extracted || {};
  return {
    id: comp.id,
    provider: comp.provider || extracted.provider || 'Manual Comp Evidence',
    authorizationBasis: comp.authorizationBasis || 'user_authorized_export',
    sourceMode: 'production',
    rawProviderId: comp.id,
    rawUrl: extracted.rawUrl || comp.sourceUrl || '',
    title: extracted.title || comp.title,
    soldAt: extracted.soldAt || comp.soldAt,
    price: extracted.price ?? comp.price,
    shipping: extracted.shipping ?? comp.shipping ?? 0,
    buyerPremium: extracted.buyerPremium ?? comp.buyerPremium ?? 0,
    currency: extracted.currency || comp.currency || 'USD',
    saleType: 'manual_evidence',
    listingType: 'completed',
    isCompletedSale: Boolean(extracted.soldAt || comp.soldAt),
    player: extracted.player || comp.player || '',
    year: extracted.year || comp.year || '',
    brand: extracted.brand || comp.brand || '',
    set: extracted.set || comp.set || '',
    cardNumber: extracted.cardNumber || comp.cardNumber || '',
    parallel: extracted.parallel || comp.parallel || '',
    serialNumber: extracted.serialNumber || comp.serialNumber || '',
    grader: extracted.grader || comp.grader || '',
    grade: extracted.grade || comp.grade || '',
    verified: false,
    confidence: Math.min(0.72, Number(extracted.confidence || comp.confidence || 0.45)),
    rightsNotes: comp.rightsNotes || 'Manual evidence captured by an authorized ManeFlow user. Requires review before valuation use.',
  };
}

export async function captureManualComp(store, actor, input = {}) {
  if (!actor?.userId || actor.readOnly) throw Object.assign(new Error('Authentication required.'), { status: 401 });
  if (!store.state.manualComps) store.state.manualComps = [];
  const extracted = parseEvidenceText(input);
  const now = new Date().toISOString();
  const item = {
    id: makeId('manual_comp'),
    userId: actor.userId,
    organizationId: input.organizationId || null,
    provider: clean(input.provider || extracted.provider || 'Manual Comp Evidence', 160),
    sourceUrl: clean(input.url || input.sourceUrl || extracted.rawUrl || '', 800),
    evidenceType: ['screenshot_evidence', 'receipt_or_invoice', 'manual_evidence', 'user_uploaded_export'].includes(input.evidenceType) ? input.evidenceType : 'manual_evidence',
    title: clean(input.title || extracted.title, 240),
    notes: clean(input.notes, 2500),
    extracted,
    reviewStatus: 'needs_review',
    valuationUse: false,
    publicDisplayEligible: false,
    evidenceRetained: Boolean(input.retainEvidence && input.evidenceDataUrl),
    evidenceDataUrl: input.retainEvidence ? clean(input.evidenceDataUrl, 1_000_000) : '',
    rightsNotes: clean(input.rightsNotes || 'Manual comp evidence requires admin review before valuation use.', 1000),
    createdAt: now,
    updatedAt: now,
  };
  store.state.manualComps.unshift(item);
  store.state.manualComps = store.state.manualComps.slice(0, 5000);
  await store.audit?.({ type: 'manual_comp_captured', userId: actor.userId, organizationId: item.organizationId, provider: item.provider, evidenceType: item.evidenceType });
  await store.persist();
  return structuredClone({ ...item, evidenceDataUrl: item.evidenceDataUrl ? '[retained]' : '' });
}

export async function reviewManualComp(store, actor, compId, input = {}) {
  if (actor?.role !== 'admin') throw Object.assign(new Error('Administrator authorization is required.'), { status: 403 });
  const item = (store.state.manualComps || []).find((comp) => comp.id === compId);
  if (!item) return null;
  const decision = ['approved', 'rejected', 'needs_review', 'private_research'].includes(input.decision) ? input.decision : 'needs_review';
  item.reviewStatus = decision;
  item.valuationUse = decision === 'approved' && Boolean(input.valuationUse);
  item.publicDisplayEligible = decision === 'approved' && Boolean(input.publicDisplayEligible);
  item.reviewedBy = actor.userId;
  item.reviewNotes = clean(input.notes, 2500);
  item.updatedAt = new Date().toISOString();
  await store.audit?.({ type: 'manual_comp_reviewed', adminUserId: actor.userId, compId, decision, valuationUse: item.valuationUse });
  await store.persist();
  return structuredClone({ ...item, evidenceDataUrl: item.evidenceDataUrl ? '[retained]' : '' });
}

export function listManualComps(store, { reviewStatus = '', organizationId = '' } = {}) {
  return (store.state.manualComps || [])
    .filter((item) => !reviewStatus || item.reviewStatus === reviewStatus)
    .filter((item) => !organizationId || item.organizationId === organizationId)
    .map((item) => ({ ...structuredClone(item), evidenceDataUrl: item.evidenceDataUrl ? '[retained]' : '' }));
}
