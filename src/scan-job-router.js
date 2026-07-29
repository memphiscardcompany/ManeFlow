import { DurableScanJobSpool } from './services/durable-scan-jobs.js';
import {
  csrfTokenForSession,
  hashSessionToken,
  requestCredential,
} from './services/auth.js';
import { RateLimiter } from './services/rate-limit.js';
import {
  forbidden,
  json,
  readJson,
  timingSafeEqualString,
  unauthorized,
} from './services/utils.js';

function originAllowed(req, config) {
  const origin = String(req.headers.origin || '');
  if (!origin) return true;
  try {
    const own = new URL(config.publicBaseUrl).origin;
    return origin === own || (config.allowedOrigins || []).includes(origin);
  } catch {
    return false;
  }
}

function sessionActor(req, config, store) {
  const credential = requestCredential(req);
  const token = credential.token;
  if (!token) return null;
  if (
    (config.serviceToken && timingSafeEqualString(token, config.serviceToken))
    || (config.apiToken && timingSafeEqualString(token, config.apiToken))
    || (config.adminToken && timingSafeEqualString(token, config.adminToken))
  ) {
    return null;
  }
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
    tokenHash,
    authSource: credential.source,
    csrfToken: csrfTokenForSession(token),
  };
}

function mutationAllowed(req, config, actor) {
  if (!originAllowed(req, config)) return { allowed: false, message: 'Request origin is not allowed.' };
  if (config.csrfProtection && actor.authSource === 'cookie') {
    const supplied = String(req.headers['x-maneflow-csrf'] || '');
    if (!actor.csrfToken || !timingSafeEqualString(supplied, actor.csrfToken)) {
      return { allowed: false, message: 'A valid CSRF token is required.' };
    }
  }
  return { allowed: true };
}

function routeError(res, error) {
  const message = error instanceof Error ? error.message : String(error);
  const status = /not found/i.test(message) ? 404
    : /no longer accepting|cannot be|no failed items|upload at least/i.test(message) ? 409
      : /limit|exceeds|unsupported|required|does not match|authorization/i.test(message) ? 400
        : 500;
  return json(res, status, {
    error: error?.code || 'SCAN_JOB_OPERATION_FAILED',
    message,
  });
}

export async function createDurableScanJobRouter({ config, store, processor } = {}) {
  const spool = new DurableScanJobSpool({
    rootDir: config.scanJobDir,
    processor: async ({ ownerUserId, fileName, dataUrl, trainingConsent, jobId, itemId }) => processor({
      ownerUserId,
      body: {
        frontDataUrl: dataUrl,
        imageName: fileName,
        sourceType: 'durable_folder_upload',
        scanJobId: jobId,
        scanJobItemId: itemId,
        trainingConsent: trainingConsent === true,
      },
    }),
    maxItems: config.scanJobMaxItems,
    maxItemBytes: config.scanJobMaxItemBytes,
    concurrency: config.scanJobConcurrency,
    maxAttempts: config.scanJobMaxAttempts,
    retentionHours: config.scanJobRetentionHours,
    retryBackoffMs: config.scanJobRetryBackoffMs,
  });
  await spool.initialize();
  const mutationLimiter = new RateLimiter({ windowMs: 60_000, max: 600 });

  async function handle(req, res) {
    let url;
    try {
      url = new URL(req.url || '/', config.publicBaseUrl);
    } catch {
      return false;
    }
    if (!url.pathname.startsWith('/api/scan-jobs')) return false;
    res.setHeader('cache-control', 'no-store');
    const method = String(req.method || 'GET').toUpperCase();
    const actor = sessionActor(req, config, store);
    if (!actor) {
      unauthorized(res);
      return true;
    }
    if (method !== 'GET') {
      const rate = mutationLimiter.check(`scan-job:${actor.userId}`);
      if (!rate.allowed) {
        json(res, 429, { error: 'SCAN_JOB_RATE_LIMITED', message: 'Upload rate limit reached. Continue after the retry window.' });
        return true;
      }
      const security = mutationAllowed(req, config, actor);
      if (!security.allowed) {
        forbidden(res, security.message);
        return true;
      }
    }

    const jobRead = url.pathname.match(/^\/api\/scan-jobs\/([0-9a-f-]+)$/i);
    const itemCreate = url.pathname.match(/^\/api\/scan-jobs\/([0-9a-f-]+)\/items$/i);
    const commitJob = url.pathname.match(/^\/api\/scan-jobs\/([0-9a-f-]+)\/commit$/i);
    const retryJob = url.pathname.match(/^\/api\/scan-jobs\/([0-9a-f-]+)\/retry-failed$/i);
    const cancelJob = url.pathname.match(/^\/api\/scan-jobs\/([0-9a-f-]+)\/cancel$/i);

    try {
      if (url.pathname === '/api/scan-jobs' && method === 'POST') {
        const body = await readJson(req, 100_000);
        if (body.processingAuthorization !== true) {
          const error = new Error('Explicit authorization to process these images is required.');
          error.code = 'SCAN_IMAGE_AUTHORIZATION_REQUIRED';
          throw error;
        }
        const idempotencyKey = String(req.headers['idempotency-key'] || body.idempotencyKey || '').trim();
        const result = await spool.createJob({
          ownerUserId: actor.userId,
          idempotencyKey,
          expectedItems: body.expectedItems,
          trainingConsent: body.trainingConsent === true,
        });
        json(res, result.reused ? 200 : 201, result);
        return true;
      }

      if (url.pathname === '/api/scan-jobs' && method === 'GET') {
        json(res, 200, {
          jobs: spool.listJobs(actor.userId, { limit: Number(url.searchParams.get('limit') || 50) }),
        });
        return true;
      }

      if (itemCreate && method === 'POST') {
        const body = await readJson(req, Math.max(config.maxRequestBytes, Math.ceil(config.scanJobMaxItemBytes * 1.5)));
        const result = await spool.addItem(actor.userId, itemCreate[1], body);
        if (!result) json(res, 404, { error: 'SCAN_JOB_NOT_FOUND' });
        else json(res, result.reused ? 200 : 201, result);
        return true;
      }

      if (commitJob && method === 'POST') {
        await readJson(req, 10_000).catch(() => ({}));
        const job = await spool.commit(actor.userId, commitJob[1]);
        if (!job) json(res, 404, { error: 'SCAN_JOB_NOT_FOUND' });
        else json(res, 202, { job });
        return true;
      }

      if (retryJob && method === 'POST') {
        await readJson(req, 10_000).catch(() => ({}));
        const job = await spool.retryFailed(actor.userId, retryJob[1]);
        if (!job) json(res, 404, { error: 'SCAN_JOB_NOT_FOUND' });
        else json(res, 202, { job });
        return true;
      }

      if (cancelJob && method === 'POST') {
        await readJson(req, 10_000).catch(() => ({}));
        const job = await spool.cancel(actor.userId, cancelJob[1]);
        if (!job) json(res, 404, { error: 'SCAN_JOB_NOT_FOUND' });
        else json(res, 200, { job });
        return true;
      }

      if (jobRead && method === 'GET') {
        const job = spool.getJob(actor.userId, jobRead[1], {
          offset: Number(url.searchParams.get('offset') || 0),
          limit: Number(url.searchParams.get('limit') || 100),
        });
        if (!job) json(res, 404, { error: 'SCAN_JOB_NOT_FOUND' });
        else json(res, 200, { job });
        return true;
      }

      json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
      return true;
    } catch (error) {
      routeError(res, error);
      return true;
    }
  }

  return {
    handle,
    close: () => spool.close(),
    spool,
  };
}
