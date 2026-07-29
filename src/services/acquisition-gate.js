import { makeId } from './utils.js';
import { findSourcePolicy } from './data-rights-registry.js';
import { looksPrivateOrBlockedUrl, MANEFLOW_DATA_BOT, pathAllowedByPolicy, rateBudgetAllowed, robotsDecision } from './source-policy.js';

function clean(value, max = 1000) {
  return String(value ?? '').trim().slice(0, max);
}

function blocked(reason, policy = null, context = {}) {
  return {
    allowed: false,
    blockedReason: reason,
    provider: policy?.provider || clean(context.provider || context.source),
    sourceType: policy?.sourceType || 'unknown',
    valuationEligible: false,
    displayEligible: false,
    storageEligible: false,
    requiredAttribution: policy?.attributionRequired ? policy.attributionText || policy.provider : '',
    maxFreshnessClaim: 'not_available',
    userAgent: context.userAgent || MANEFLOW_DATA_BOT,
  };
}

function allowed(policy, context = {}) {
  return {
    allowed: true,
    blockedReason: null,
    provider: policy.provider,
    sourceType: policy.sourceType,
    valuationEligible: Boolean(policy.valuationEligible),
    displayEligible: Boolean(policy.publicDisplayEligible),
    storageEligible: true,
    requiredAttribution: policy.attributionRequired ? policy.attributionText || policy.provider : '',
    maxFreshnessClaim: policy.sourceType === 'official_api' ? 'provider_refresh_cadence' : policy.sourceType === 'approved_public_web' ? 'approved_public_collection_cadence' : 'manual_or_batch_import',
    userAgent: context.userAgent || MANEFLOW_DATA_BOT,
  };
}

export function authorizeAcquisition(state, source, requestContext = {}) {
  const provider = typeof source === 'string' ? source : source?.provider || requestContext.provider;
  const policy = typeof source === 'object' && source?.provider ? source : findSourcePolicy(state, provider);
  if (!policy) return blocked('Unknown source. Register and approve a source policy before acquisition.', null, { ...requestContext, provider });
  if (policy.sourceType === 'prohibited') return blocked('Source is prohibited by ManeFlow source policy.', policy, requestContext);
  if (policy.legalReviewStatus !== 'approved') return blocked('Source legal review is not approved.', policy, requestContext);
  if (policy.ownerApprovalStatus !== 'approved') return blocked('Owner approval is required before acquisition.', policy, requestContext);

  const targetUrl = clean(requestContext.url || requestContext.targetUrl || '');
  if (targetUrl && looksPrivateOrBlockedUrl(targetUrl)) return blocked('Private, login, checkout, admin, paywall, or CAPTCHA-like URLs are blocked.', policy, requestContext);
  if (targetUrl) {
    const pathDecision = pathAllowedByPolicy(policy, targetUrl);
    if (!pathDecision.allowed) return blocked(pathDecision.reason, policy, requestContext);
    if (requestContext.robotsText !== undefined) {
      const robots = robotsDecision(requestContext.robotsText, targetUrl, requestContext.userAgent || MANEFLOW_DATA_BOT);
      if (!robots.allowed) return blocked(robots.reason, policy, requestContext);
    }
  }

  const history = Array.isArray(requestContext.history) ? requestContext.history : state.acquisitionRuns || [];
  const rate = rateBudgetAllowed(policy, history, requestContext.now || new Date());
  if (!rate.allowed) return blocked(rate.reason, policy, requestContext);

  if (policy.sourceType === 'review_only') return blocked('Source is review-only and cannot run automated acquisition.', policy, requestContext);
  const decision = allowed(policy, requestContext);
  return {
    ...decision,
    auditEvent: {
      type: 'acquisition_authorized',
      provider: policy.provider,
      sourceType: policy.sourceType,
      purpose: clean(requestContext.purpose || 'pricing_data_acquisition', 200),
      targetUrl: targetUrl || null,
      valuationEligible: decision.valuationEligible,
      displayEligible: decision.displayEligible,
    },
  };
}

export async function recordAcquisitionRun(store, decision, details = {}) {
  if (!store.state.acquisitionRuns) store.state.acquisitionRuns = [];
  const item = {
    id: makeId('acquisition_run'),
    provider: decision.provider || details.provider || 'unknown',
    sourceType: decision.sourceType || details.sourceType || 'unknown',
    allowed: Boolean(decision.allowed),
    blockedReason: decision.blockedReason || null,
    purpose: clean(details.purpose || 'pricing_data_acquisition', 200),
    targetUrl: clean(details.targetUrl || details.url || '', 800) || null,
    rowsSeen: Number(details.rowsSeen || 0),
    rowsAccepted: Number(details.rowsAccepted || 0),
    rowsQuarantined: Number(details.rowsQuarantined || 0),
    actorUserId: details.actor?.userId || details.actorUserId || null,
    dryRun: Boolean(details.dryRun),
    createdAt: (details.now || new Date()).toISOString(),
  };
  store.state.acquisitionRuns.unshift(item);
  store.state.acquisitionRuns = store.state.acquisitionRuns.slice(0, 1000);
  await store.audit?.({ type: item.allowed ? 'acquisition_run_recorded' : 'acquisition_blocked', provider: item.provider, actorUserId: item.actorUserId, blockedReason: item.blockedReason });
  await store.persist();
  return structuredClone(item);
}

export function summarizeAcquisition(state) {
  const runs = state.acquisitionRuns || [];
  const manual = state.manualComps || [];
  const evidence = state.evidenceRecords || [];
  return {
    generatedAt: new Date().toISOString(),
    totalRuns: runs.length,
    blockedRuns: runs.filter((run) => !run.allowed).length,
    approvedRuns: runs.filter((run) => run.allowed).length,
    manualComps: manual.length,
    manualNeedsReview: manual.filter((item) => item.reviewStatus === 'needs_review').length,
    evidenceRecords: evidence.length,
    evidenceNeedsReview: evidence.filter((item) => item.reviewStatus === 'needs_review').length,
    recentRuns: runs.slice(0, 25),
  };
}
