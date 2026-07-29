import {
  csrfTokenForSession,
  hashSessionToken,
  requestCredential,
} from './services/auth.js';
import { entitlementsFor, withinLimit } from './services/plans.js';
import { confirmScanSession } from './services/scan-session.js';
import {
  forbidden,
  json,
  readJson,
  timingSafeEqualString,
  unauthorized,
} from './services/utils.js';

function actorFromRequest(req, config, store) {
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
    authSource: credential.source,
    csrfToken: csrfTokenForSession(token),
  };
}

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

function collectionInput(body = {}) {
  return {
    cardId: body.cardId || null,
    name: body.name,
    quantity: body.quantity,
    purchasePrice: body.purchasePrice,
    purchaseDate: body.purchaseDate,
    notes: body.notes,
    acquiredFrom: body.acquiredFrom,
    location: body.location,
    certNumber: body.certNumber,
    status: body.status,
    mergeDuplicates: body.mergeDuplicates,
  };
}

function routeError(res, error) {
  const status = Math.max(400, Math.min(599, Number(error?.status || 400)));
  return json(res, status, {
    error: error?.code || 'AUTOMATIC_PRICING_OPERATION_FAILED',
    message: error instanceof Error ? error.message : String(error),
  });
}

export function createAutomaticPricingRouter({
  config,
  store,
  cache,
  pricingEngine,
  catalog,
} = {}) {
  if (!config || !store || !cache || !pricingEngine || typeof catalog !== 'function') {
    throw new TypeError('Automatic pricing router requires config, store, cache, pricingEngine, and catalog.');
  }

  function matchCard(cardId) {
    return catalog().find((card) => card.id === cardId) || null;
  }

  return async function handleAutomaticPricingRoute(req, res) {
    let url;
    try {
      url = new URL(req.url || '/', config.publicBaseUrl);
    } catch {
      return false;
    }
    const method = String(req.method || 'GET').toUpperCase();
    const scanConfirm = /^\/api\/scan-sessions\/([^/]+)\/confirm$/.exec(url.pathname);
    const cardPricing = /^\/api\/pricing\/cards\/([^/]+)$/.exec(url.pathname);
    const collectionCreate = url.pathname === '/api/collection' && method === 'POST';
    if (!scanConfirm && !cardPricing && !collectionCreate) return false;

    res.setHeader('cache-control', 'no-store');
    const actor = actorFromRequest(req, config, store);
    if (!actor) {
      unauthorized(res);
      return true;
    }
    if (method !== 'GET') {
      const security = mutationAllowed(req, config, actor);
      if (!security.allowed) {
        forbidden(res, security.message);
        return true;
      }
    }

    try {
      if (cardPricing && method === 'GET') {
        const card = matchCard(decodeURIComponent(cardPricing[1]));
        if (!card) {
          json(res, 404, { error: 'CARD_NOT_FOUND' });
          return true;
        }
        const pricing = await pricingEngine.priceCard(card, {
          actor,
          reason: 'authenticated_card_pricing_read',
        });
        json(res, 200, { pricing });
        return true;
      }

      if (scanConfirm && method === 'POST') {
        const body = await readJson(req, 100_000);
        const session = await confirmScanSession(
          store,
          actor,
          decodeURIComponent(scanConfirm[1]),
          body,
        );
        if (!session) {
          json(res, 404, { error: 'SCAN_SESSION_NOT_FOUND' });
          return true;
        }
        let pricing = null;
        if (!body.rejected && session.selectedCardId) {
          const card = matchCard(session.selectedCardId);
          pricing = card
            ? await pricingEngine.priceCard(card, {
              actor,
              reason: 'confirmed_scan_identity',
            })
            : {
              status: 'card_identity_unavailable',
              cardId: session.selectedCardId,
              valuation: null,
            };
        }
        json(res, 200, {
          session,
          pricing,
          message: body.rejected
            ? 'Scan result rejected. No market value was generated.'
            : pricing
              ? 'Identity confirmed. ManeFlow refreshed authorized pricing evidence and calculated the value automatically.'
              : 'Scan result confirmed without an exact catalog card; valuation remains unavailable.',
        });
        return true;
      }

      if (collectionCreate) {
        const body = await readJson(req, 300_000);
        if (!body.cardId && !body.name) {
          json(res, 400, { error: 'CARD_OR_NAME_REQUIRED' });
          return true;
        }
        const card = body.cardId ? matchCard(body.cardId) : null;
        if (body.cardId && !card) {
          json(res, 400, { error: 'UNKNOWN_CARD_ID' });
          return true;
        }
        const limits = entitlementsFor(actor);
        const input = collectionInput(body);
        const holdings = store.userSnapshot(actor.userId).collection.length;
        const mergeTarget = store.findMergeableCollectionItem(actor.userId, input);
        if (!mergeTarget && !withinLimit(holdings, limits.vaultItems)) {
          json(res, 402, {
            error: 'PLAN_LIMIT',
            message: `${limits.name} plan Vault limit reached.`,
            plan: limits.plan,
          });
          return true;
        }
        const item = await store.addCollectionItem(actor.userId, input);
        cache.clear();
        const pricing = card
          ? await pricingEngine.priceCard(card, {
            actor,
            reason: item.merged ? 'vault_item_merged' : 'vault_item_created',
          })
          : {
            status: 'card_identity_required',
            cardId: null,
            valuation: null,
            refresh: { attempted: false, reason: 'card_identity_required' },
          };
        json(res, item.merged ? 200 : 201, {
          item,
          merged: Boolean(item.merged),
          pricing,
          message: item.merged
            ? 'Existing Vault row quantity updated. ManeFlow recalculated market value automatically.'
            : 'Vault row created. ManeFlow calculated market value automatically from authorized completed-sale evidence.',
        });
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
