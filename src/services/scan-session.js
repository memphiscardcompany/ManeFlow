import { makeId } from './utils.js';
import { evaluateScanConfidence } from './scan-confidence.js';

export async function createScanSession(store, actor, input = {}, context = {}) {
  if (!actor?.userId || actor.readOnly) throw Object.assign(new Error('Authentication required.'), { status: 401 });
  const confidence = evaluateScanConfidence(input);
  const now = new Date().toISOString();
  const session = {
    id: makeId('scan_session'), userId: actor.userId, organizationId: input.organizationId || null,
    status: confidence.needsManualConfirmation ? 'needs_confirmation' : 'matched',
    recognitionVersion: input.recognition?.version || null,
    sceneType: input.recognition?.scene?.type || null,
    detectedCardCount: input.recognition?.summary?.detectedCards || null,
    recognitionSummary: input.recognition?.summary || null,
    frontStatus: input.body?.frontDataUrl || input.frontDataUrl ? 'present' : 'missing',
    backStatus: input.body?.backDataUrl || input.backDataUrl ? 'present' : 'missing',
    certStatus: input.body?.certDataUrl || input.certDataUrl ? 'present' : 'optional_missing',
    selectedCardId: confidence.bestMatchId, matchIds: (input.matches || []).map((card) => card.id).slice(0, 10), confidence,
    topCandidates: confidence.topCandidates || [],
    regions: (input.recognition?.items || []).map((item) => ({
      regionId: item.regionId,
      boundingBox: item.boundingBox,
      cardType: item.cardType,
      slabbed: item.slabbed,
      path: item.path,
      selectedCardId: item.matches?.[0]?.id || null,
      confidence: item.scanConfidence?.scanConfidenceScore || null,
      requiresManualConfirmation: item.requiresManualConfirmation,
      topCandidates: item.topCandidates || [],
    })).slice(0, 80),
    explanation: confidence.explanation || null,
    manualConfirmationReasons: confidence.manualConfirmationReasons || [],
    evidence: {
      query: input.result?.query || '',
      mode: input.result?.mode || 'scan',
      imageProcessedRemotely: Boolean(input.vision),
      fieldConfidence: confidence.fieldConfidence,
      imageQualityScore: confidence.imageQualityScore,
    },
    gradedCert: input.body?.gradedCert || input.gradedCert || null,
    createdAt: now, updatedAt: now,
  };
  store.state.scanSessions.unshift(session);
  store.state.scanSessions = store.state.scanSessions.slice(0, 2000);
  await store.persist();
  return session;
}

export async function confirmScanSession(store, actor, sessionId, input = {}) {
  const session = (store.state.scanSessions || []).find((entry) => entry.id === sessionId && entry.userId === actor?.userId);
  if (!session) return null;
  session.status = input.rejected ? 'rejected' : 'confirmed';
  const previousCardId = session.selectedCardId || null;
  if (input.cardId) session.selectedCardId = input.cardId;
  session.confirmedBy = actor.userId;
  session.confirmationNotes = String(input.notes || '').slice(0, 1000);
  session.correctedFields = input.correctedFields && typeof input.correctedFields === 'object' ? structuredClone(input.correctedFields) : {};
  session.updatedAt = new Date().toISOString();
  if (!input.rejected && (input.cardId || Object.keys(session.correctedFields).length)) {
    store.state.scanCorrections = store.state.scanCorrections || [];
    store.state.scanCorrections.unshift({
      id: makeId('scan_correction'),
      scanSessionId: session.id,
      userId: actor.userId,
      previousCardId,
      selectedCardId: session.selectedCardId,
      correctedFields: session.correctedFields,
      confidenceBefore: session.confidence?.scanConfidenceScore || null,
      reason: String(input.notes || '').slice(0, 1000),
      createdAt: session.updatedAt,
    });
    store.state.scanCorrections = store.state.scanCorrections.slice(0, 5000);
  }
  await store.persist();
  return session;
}

export function scanQualityAnalytics(state) {
  const sessions = state.scanSessions || [];
  const averageConfidence = sessions.length ? Math.round(sessions.reduce((sum, session) => sum + (session.confidence?.scanConfidenceScore || 0), 0) / sessions.length) : 0;
  const sceneTypes = Object.entries(sessions.reduce((acc, session) => {
    const key = session.sceneType || 'legacy_single_card';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {})).sort((a, b) => b[1] - a[1]).map(([sceneType, count]) => ({ sceneType, count }));
  const recognitionPaths = Object.entries(sessions.flatMap((session) => session.regions || []).reduce((acc, region) => {
    const key = region.path || 'legacy_path';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {})).sort((a, b) => b[1] - a[1]).map(([path, count]) => ({ path, count }));
  return {
    totalScanSessions: sessions.length,
    averageConfidence,
    needsConfirmation: sessions.filter((session) => session.status === 'needs_confirmation').length,
    confirmed: sessions.filter((session) => session.status === 'confirmed' || session.status === 'matched').length,
    corrections: (state.scanCorrections || []).length,
    sceneTypes,
    recognitionPaths,
    detectedCards: sessions.reduce((sum, session) => sum + Number(session.detectedCardCount || 0), 0),
    commonWarnings: Object.entries(sessions.flatMap((session) => session.confidence?.warnings || []).reduce((acc, warning) => { acc[warning] = (acc[warning] || 0) + 1; return acc; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([warning, count]) => ({ warning, count })),
    commonUncertainFields: Object.entries(sessions.flatMap((session) => session.explanation?.uncertainFields || []).reduce((acc, field) => { acc[field] = (acc[field] || 0) + 1; return acc; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([field, count]) => ({ field, count })),
  };
}
