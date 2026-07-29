import {
  csrfTokenForSession,
  hashSessionToken,
  requestCredential,
} from './services/auth.js';
import { entitlementsFor } from './services/plans.js';
import { ScanJobError } from './services/scan-job-queue.js';
import {
  forbidden,
  json,
  readJson,
  timingSafeEqualString,
  unauthorized,
} from './services/utils.js';

const TERMINAL_JOB_STATUSES = new Set(['complete', 'partial', 'failed', 'cancelled']);

function actorFromRequest(req, config, store) {
  const credential = requestCredential(req);
  const token = credential.token;
  if (!token) return null;
  const tokenHash = hashSessionToken(token);
  const session = store.findSession(tokenHash);
  if (!session) return null;
  const user = store.findUserById(session.userId);
  if (!user || user.disabledAt) return null;
  if (config.requireEmailVerification && !user.emailVerifiedAt) return null;
  return {
    userId: user.id,
    role: user.role,
    user,
    session,
    authSource: credential.source,
    csrfToken: csrfTokenForSession(token),
  };
}

function originAllowed(req, config) {
  const origin = String(req.headers.origin || '');
  if (!origin) return true;
  try {
    const ownOrigin = new URL(config.publicBaseUrl).origin;
    return origin === ownOrigin || (config.allowedOrigins || []).includes(origin);
  } catch {
    return false;
  }
}

function requireMutationSecurity(req, res, config, actor) {
  if (!originAllowed(req, config)) {
    forbidden(res, 'Request origin is not allowed.');
    return false;
  }
  if (config.csrfProtection && actor.authSource === 'cookie') {
    const supplied = String(req.headers['x-maneflow-csrf'] || '');
    if (!actor.csrfToken || !timingSafeEqualString(supplied, actor.csrfToken)) {
      forbidden(res, 'A valid CSRF token is required.');
      return false;
    }
  }
  return true;
}

function integer(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(parsed)));
}

function reservedScanCount(store, userId) {
  return (store.state.scanJobs || [])
    .filter((job) => job.userId === userId && !TERMINAL_JOB_STATUSES.has(job.status))
    .reduce((sum, job) => sum + Math.max(0, Number(job.totalItems || 0)), 0);
}

function scansToday(store, userId) {
  const today = new Date().toISOString().slice(0, 10);
  return store.userSnapshot(userId).scanHistory
    .filter((scan) => String(scan.createdAt || '').startsWith(today))
    .length;
}

function routeError(res, error) {
  const status = error instanceof ScanJobError
    ? error.status
    : Math.max(400, Math.min(599, Number(error?.status || 400)));
  return json(res, status, {
    error: error?.code || 'SCAN_JOB_OPERATION_FAILED',
    message: error instanceof Error ? error.message : String(error),
    retryable: error?.retryable === true,
  });
}

export function createScanJobRouter({ config, store, queue }) {
  if (!queue) throw new TypeError('createScanJobRouter requires a ScanJobQueue.');

  return async function handleScanJobRoute(req, res) {
    let url;
    try {
      url = new URL(req.url || '/', config.publicBaseUrl);
    } catch {
      return false;
    }
    if (!url.pathname.startsWith('/api/scan-jobs')) return false;

    const method = String(req.method || 'GET').toUpperCase();
    const actor = actorFromRequest(req, config, store);
    if (!actor?.user) {
      unauthorized(res);
      return true;
    }
    if (method !== 'GET' && !requireMutationSecurity(req, res, config, actor)) return true;

    const jobMatch = /^\/api\/scan-jobs\/([^/]+)$/.exec(url.pathname);
    const itemsMatch = /^\/api\/scan-jobs\/([^/]+)\/items$/.exec(url.pathname);
    const startMatch = /^\/api\/scan-jobs\/([^/]+)\/start$/.exec(url.pathname);
    const cancelMatch = /^\/api\/scan-jobs\/([^/]+)\/cancel$/.exec(url.pathname);

    try {
      if (url.pathname === '/api/scan-jobs' && method === 'GET') {
        return json(res, 200, {
          jobs: queue.listJobs(actor.userId, {
            limit: integer(url.searchParams.get('limit'), 50, 1, 100),
          }),
        });
      }

      if (url.pathname === '/api/scan-jobs' && method === 'POST') {
        if (!String(config.serviceToken || '').trim()) {
          return json(res, 503, {
            error: 'SCAN_JOB_WORKER_NOT_CONFIGURED',
            message: 'Durable scan jobs require MANEFLOW_SERVICE_TOKEN in the server secret manager.',
          });
        }
        const body = await readJson(req, 100_000);
        const totalItems = integer(body.totalItems, 0, 0, config.scanJobMaximumItems || 2_000);
        if (totalItems < 1) {
          return json(res, 400, {
            error: 'SCAN_JOB_TOTAL_REQUIRED',
            message: 'Select at least one supported image.',
          });
        }
        const entitlements = entitlementsFor(actor);
        const limit = Number(entitlements.scansPerDay);
        const used = scansToday(store, actor.userId);
        const reserved = reservedScanCount(store, actor.userId);
        if (Number.isFinite(limit) && used + reserved + totalItems > limit) {
          return json(res, 402, {
            error: 'PLAN_LIMIT',
            message: `${entitlements.name} plan daily scan limit would be exceeded by this folder.`,
            usage: { used, reserved, requested: totalItems, limit },
            plan: entitlements.plan,
          });
        }
        const result = await queue.createJob(actor.userId, {
          clientJobId: body.clientJobId,
          totalItems,
          autoStart: body.autoStart !== false,
        });
        return json(res, result.reused ? 200 : 201, result);
      }

      if (jobMatch && method === 'GET') {
        return json(res, 200, {
          job: queue.getJob(actor.userId, decodeURIComponent(jobMatch[1])),
        });
      }

      if (itemsMatch && method === 'GET') {
        return json(res, 200, {
          job: queue.getJob(actor.userId, decodeURIComponent(itemsMatch[1]), {
            includeItems: true,
            offset: integer(url.searchParams.get('offset'), 0, 0, 1_000_000),
            limit: integer(url.searchParams.get('limit'), 50, 1, 200),
          }),
        });
      }

      if (itemsMatch && method === 'POST') {
        const maximumBodyBytes = Math.max(
          Number(config.maxRequestBytes || 30_000_000),
          Math.ceil(Number(config.scanJobMaximumImageBytes || 30_000_000) * 1.45),
        );
        const body = await readJson(req, maximumBodyBytes);
        const result = await queue.addItem(
          actor.userId,
          decodeURIComponent(itemsMatch[1]),
          {
            clientItemId: body.clientItemId,
            index: body.index,
            fileName: body.fileName,
            dataUrl: body.dataUrl,
          },
        );
        return json(res, result.reused ? 200 : 201, result);
      }

      if (startMatch && method === 'POST') {
        const jobId = decodeURIComponent(startMatch[1]);
        const current = queue.getJob(actor.userId, jobId);
        if (current.uploadedCount !== current.totalItems) {
          throw new ScanJobError(
            `Upload is incomplete: ${current.uploadedCount} of ${current.totalItems} images are stored.`,
            {
              code: 'SCAN_JOB_UPLOAD_INCOMPLETE',
              status: 409,
              retryable: true,
            },
          );
        }
        return json(res, 202, {
          job: await queue.startJob(actor.userId, jobId),
        });
      }

      if (cancelMatch && method === 'POST') {
        return json(res, 200, {
          job: await queue.cancelJob(actor.userId, decodeURIComponent(cancelMatch[1])),
        });
      }

      json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
      return true;
    } catch (error) {
      routeError(res, error);
      return true;
    }
  };
}
