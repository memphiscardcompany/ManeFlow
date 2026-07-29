import {
  csrfTokenForSession,
  hashSessionToken,
  requestCredential,
} from '../services/auth.js';
import {
  forbidden,
  json,
  notFound,
  readJson,
  timingSafeEqualString,
  unauthorized,
} from '../services/utils.js';
import { MetaOwnerRepository } from '../db/metaOwnerRepository.js';
import { MetaOutboundQueryRepository } from '../db/metaOutboundQueryRepository.js';
import { dispatchMetaBatch } from './meta-dispatcher.js';
import { generateMetaReplyDraft } from './meta-draft-service.js';
import { requirePlatformOwner } from './owner-authority.js';

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

function actorFromRequest(req, config, store) {
  const credential = requestCredential(req);
  const { token } = credential;
  if (!token) return null;
  if (config.serviceToken && timingSafeEqualString(token, config.serviceToken)) {
    return { userId: 'internal-service', role: 'service', service: true, authSource: credential.source };
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
    service: false,
    tokenHash,
    authSource: credential.source,
    csrfToken: csrfTokenForSession(token),
  };
}

function ownerActor(req, res, config, store, { recent = false } = {}) {
  try {
    return requirePlatformOwner(actorFromRequest(req, config, store), config, { requireRecentReauth: recent });
  } catch (error) {
    forbidden(res, error.message);
    return null;
  }
}

function requireMutationSecurity(req, res, config, actor) {
  if (!originAllowed(req, config)) {
    forbidden(res, 'Request origin is not allowed.');
    return false;
  }
  if (config.csrfProtection && actor?.authSource === 'cookie') {
    const supplied = String(req.headers['x-maneflow-csrf'] || '');
    if (!actor.csrfToken || !timingSafeEqualString(supplied, actor.csrfToken)) {
      forbidden(res, 'A valid CSRF token is required.');
      return false;
    }
  }
  return true;
}

function publicJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    conversationId: job.conversation_id || null,
    draftId: job.draft_id || null,
    status: job.status,
    attempts: Number(job.attempts || 0),
    maxAttempts: Number(job.max_attempts || 0),
    deliveryCertainty: job.delivery_certainty || null,
    providerMessageId: job.provider_message_id || null,
    providerEchoAt: job.provider_echo_at || null,
    lastErrorCode: job.last_error_code || null,
    channel: job.channel || null,
    draftVersion: job.draft_version == null ? null : Number(job.draft_version),
    draftSource: job.draft_source || null,
    createdAt: job.created_at || null,
    updatedAt: job.updated_at || null,
    sentAt: job.sent_at || null,
    terminalAt: job.terminal_at || null,
  };
}

function routeError(res, error) {
  const status = Number(error?.status || 400);
  return json(res, status, {
    error: error?.code || 'META_OWNER_OPERATION_FAILED',
    message: error instanceof Error ? error.message : String(error),
  });
}

export function createMetaOwnerRouter({ config, store, databaseRuntime, fetchImpl = globalThis.fetch }) {
  return async function handleMetaOwnerRoute(req, res) {
    let url;
    try {
      url = new URL(req.url || '/', config.publicBaseUrl);
    } catch {
      return false;
    }
    if (!url.pathname.startsWith('/api/owner/meta/')) return false;
    const method = String(req.method || 'GET').toUpperCase();

    const draftCreate = url.pathname.match(/^\/api\/owner\/meta\/conversations\/([0-9a-f-]+)\/drafts$/i);
    const draftApprove = url.pathname.match(/^\/api\/owner\/meta\/drafts\/([0-9a-f-]+)\/approve$/i);
    const draftReject = url.pathname.match(/^\/api\/owner\/meta\/drafts\/([0-9a-f-]+)\/reject$/i);
    const outboundList = url.pathname === '/api/owner/meta/outbound';
    const outboundQueue = url.pathname.match(/^\/api\/owner\/meta\/outbound\/([0-9a-f-]+)\/queue$/i);
    const outboundRead = url.pathname.match(/^\/api\/owner\/meta\/outbound\/([0-9a-f-]+)$/i);
    const dispatchRun = url.pathname === '/api/owner/meta/dispatch/run';
    if (!draftCreate && !draftApprove && !draftReject && !outboundList && !outboundQueue && !outboundRead && !dispatchRun) return false;

    if (!databaseRuntime?.pool || !databaseRuntime?.metaInboundRepository || !databaseRuntime?.metaOutboundRepository) {
      json(res, 503, { error: 'META_DATABASE_NOT_READY' });
      return true;
    }

    const rawActor = actorFromRequest(req, config, store);
    if (!rawActor?.user) {
      unauthorized(res);
      return true;
    }
    const mutating = method !== 'GET';
    const owner = ownerActor(req, res, config, store, { recent: mutating });
    if (!owner) return true;
    if (mutating && !requireMutationSecurity(req, res, config, rawActor)) return true;

    const repository = new MetaOwnerRepository(databaseRuntime.pool);
    const queryRepository = new MetaOutboundQueryRepository(databaseRuntime.pool);
    try {
      if (draftCreate && method === 'POST') {
        const body = await readJson(req, 300_000);
        let proposal;
        if (body.generate === true) {
          const conversation = await databaseRuntime.metaInboundRepository.getConversation(owner.userId, draftCreate[1]);
          if (!conversation) {
            notFound(res, 'Meta conversation not found.');
            return true;
          }
          proposal = await generateMetaReplyDraft({
            config,
            conversation,
            additionalEvidence: body.evidence,
            fetchImpl,
          });
        } else {
          proposal = {
            body: body.text,
            source: body.source || 'owner_manual',
            evidence: Array.isArray(body.evidence) ? body.evidence : [],
          };
        }
        const draft = await repository.createDraft(owner.userId, {
          conversationId: draftCreate[1],
          body: proposal.body,
          source: proposal.source,
          evidence: [...(proposal.evidence || []), ...(Array.isArray(body.evidence) ? body.evidence : [])].slice(0, 100),
          actorId: owner.userId,
        });
        json(res, 201, { draft, humanApprovalRequired: true });
        return true;
      }

      if (draftApprove && method === 'POST') {
        const body = await readJson(req, 100_000);
        const job = await repository.approveDraft(owner.userId, {
          draftId: draftApprove[1],
          approvedText: body.approvedText,
          approvedBy: owner.userId,
          maxAttempts: body.maxAttempts,
        });
        json(res, 200, {
          job: publicJob(job),
          message: 'Exact text approved and held. Queueing remains a separate owner action.',
        });
        return true;
      }

      if (draftReject && method === 'POST') {
        const body = await readJson(req, 50_000);
        const draft = await repository.rejectDraft(owner.userId, {
          draftId: draftReject[1],
          actorId: owner.userId,
          reason: body.reason,
        });
        json(res, 200, { draft });
        return true;
      }

      if (outboundList && method === 'GET') {
        const jobs = await queryRepository.list(owner.userId, {
          status: url.searchParams.get('status'),
          limit: Number(url.searchParams.get('limit') || 50),
          beforeUpdatedAt: url.searchParams.get('beforeUpdatedAt'),
          beforeId: url.searchParams.get('beforeId'),
        });
        const counts = await queryRepository.counts(owner.userId);
        json(res, 200, {
          jobs: jobs.map(publicJob),
          counts,
          pagination: jobs.length
            ? {
              nextBeforeUpdatedAt: jobs.at(-1).updated_at,
              nextBeforeId: jobs.at(-1).id,
            }
            : null,
        });
        return true;
      }

      if (outboundQueue && method === 'POST') {
        const body = await readJson(req, 100_000);
        const job = await repository.queueApprovedJob(owner.userId, {
          jobId: outboundQueue[1],
          currentText: body.currentText,
          actorId: owner.userId,
        });
        json(res, 200, {
          job: publicJob(job),
          message: 'Owner-approved reply queued. Provider dispatch remains governed by the kill switch and outbound configuration.',
        });
        return true;
      }

      if (outboundRead && method === 'GET') {
        const job = await repository.getOutboundJob(owner.userId, outboundRead[1]);
        if (!job) notFound(res, 'Meta outbound job not found.');
        else json(res, 200, { job: publicJob(job) });
        return true;
      }

      if (dispatchRun && method === 'POST') {
        const body = await readJson(req, 50_000);
        const result = await dispatchMetaBatch({
          repository: databaseRuntime.metaOutboundRepository,
          config,
          ownerUserId: owner.userId,
          fetchImpl,
          limit: body.limit,
        });
        json(res, 200, result);
        return true;
      }

      json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
      return true;
    } catch (error) {
      routeError(res, error);
      return true;
    }
  };
}
