import { makeId } from './utils.js';

const PROVIDER_STUBS = Object.freeze(['cardladder_partner', 'fanatics_collect_partner', 'goldin_partner', 'heritage_partner', 'comc_partner', 'tcgplayer_partner', 'whatnot_partner']);

export function providerExpansionStubs() {
  return PROVIDER_STUBS.map((name) => ({ name, mode: 'partner_stub', authorizationBasis: 'written_license_required', dataRightsStatus: 'not_connected', supportsCompletedSales: true, refreshPolicy: 'disabled_until_agreement' }));
}

export async function createImportJob(store, actor, input = {}) {
  if (actor?.role !== 'admin' && !actor?.service) throw Object.assign(new Error('Administrator authorization is required.'), { status: 403 });
  const now = new Date().toISOString();
  const job = {
    id: makeId('import_job'), provider: String(input.provider || 'manual').slice(0, 120), jobType: String(input.jobType || 'completed_sales').slice(0, 120),
    cadence: String(input.cadence || 'manual').slice(0, 80), enabled: Boolean(input.enabled), dryRun: input.dryRun !== false,
    filters: input.filters || {}, rateLimit: input.rateLimit || {}, lastSuccessAt: null, lastFailureAt: null, lastError: null, createdBy: actor.userId, createdAt: now, updatedAt: now,
  };
  store.state.importJobs.unshift(job);
  await store.persist();
  return job;
}

export async function recordImportJobRun(store, jobId, input = {}) {
  const job = (store.state.importJobs || []).find((entry) => entry.id === jobId);
  const now = new Date().toISOString();
  const history = { id: makeId('import_run'), jobId, status: input.status || 'completed', imported: Number(input.imported || 0), updated: Number(input.updated || 0), rejected: Number(input.rejected || 0), dryRun: Boolean(input.dryRun), error: input.error || null, createdAt: now };
  store.state.importJobHistory.unshift(history);
  store.state.importJobHistory = store.state.importJobHistory.slice(0, 1000);
  if (job) { if (history.status === 'completed') job.lastSuccessAt = now; else { job.lastFailureAt = now; job.lastError = history.error; } job.updatedAt = now; }
  await store.persist();
  return history;
}

export function summarizeImportJobs(state, providerStatuses = []) {
  return {
    jobs: state.importJobs || [],
    recentRuns: (state.importJobHistory || []).slice(0, 50),
    providerStubs: providerExpansionStubs(),
    providerFreshness: providerStatuses.map((provider) => ({ name: provider.name, mode: provider.mode, dataRightsStatus: provider.dataRightsStatus, refreshPolicy: provider.refreshPolicy, lastSuccessAt: provider.lastSuccessAt || null, lastFailureAt: provider.lastFailureAt || null })),
    message: 'Scheduled imports define production data operations but remain disabled until credentials and data rights are configured.',
  };
}
