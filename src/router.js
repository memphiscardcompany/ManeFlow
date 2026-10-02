import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { calculateValuation } from './services/valuation.js';
import { excludedComps, needsReviewComps, publicCompSummary, scoreComps } from './services/comp-quality.js';
import { summarizeDataHealth } from './services/data-health.js';
import { identifyCard } from './services/identification.js';
import { normalizeSale } from './services/normalizer.js';
import { rankCards, smartMatchCard } from './services/catalog.js';
import { attachCardImage, imageConfig, imageSourceStatus } from './services/card-images.js';
import { buildCatalogIndex, catalogAutocomplete, completeManualEntry, smartCatalogAutocomplete, submissionAutocomplete } from './services/catalog-autocomplete.js';
import { portfolioAnalytics } from './services/portfolio.js';
import { buildPortfolioIntelligence, generateTaxEstimate, getInventoryHealth, runScenarioAnalysis } from './services/portfolio-intelligence.js';
import {
  acceptOrganizationInvite,
  createOrganization,
  createOrganizationInvite,
  deactivateOrganization,
  getOrganizationForActor,
  listOrganizationsForActor,
  removeOrganizationMember,
  revokeOrganizationInvite,
  updateOrganizationMemberRole,
  updateOrganizationProfile,
} from './services/organizations.js';
import { addShopInventoryItem, listShopInventory, shopDashboard, updateShopInventoryItem } from './services/shop-inventory.js';
import { canAccessOrganization } from './services/shop-permissions.js';
import { evaluateScanConfidence } from './services/scan-confidence.js';
import { createScanSession, confirmScanSession, scanQualityAnalytics } from './services/scan-session.js';
import { recognizeCardScene } from './services/recognition-engine.js';
import { parseRecognitionBenchmarkInput, runRecognitionBenchmark } from './services/recognition-benchmark.js';
import { buildDealerDecision } from './services/dealer-decision.js';
import { createIntakeBatch, addIntakeBatchItem, updateIntakeBatchStatus, generateOfferSheet } from './services/intake-batches.js';
import { createImportJob, recordImportJobRun, summarizeImportJobs } from './services/import-jobs.js';
import { parseCsv } from './services/csv.js';
import { buildPricingImportTemplate, ingestPricingData, rollbackPricingBatch, summarizePricingData, validatePricingRows, normalizeCatalogRows } from './services/pricing-data.js';
import { importSportsChecklistCsv, importSportsChecklistJson } from './services/sports-catalog-importer.js';
import { importTcgCatalog } from './services/tcg-catalog-importer.js';
import { analyzeCardImages, analyzeCardScene } from './services/vision.js';
import { VisionWorkerClient, workerCardToLegacyVision } from './services/vision-worker-client.js';
import { analyzeGradedCert } from './services/graded-cert.js';
import { buildCollectionSurvey, listCollectionSurveys, saveCollectionSurvey } from './services/collection-survey.js';
import { imageCoverageReport, ingestImageEnrichment, rollbackImageEnrichmentBatch } from './services/image-enrichment.js';
import { authorizeAcquisition, recordAcquisitionRun, summarizeAcquisition } from './services/acquisition-gate.js';
import { consumeEbayOAuthState, issueEbayOAuthState } from './services/ebay-oauth-state.js';
import { ensureSourcePolicies, listSourcePolicies, upsertSourcePolicy } from './services/data-rights-registry.js';
import { captureManualComp, listManualComps, manualCompToPricingRow, reviewManualComp } from './services/manual-comp-capture.js';
import { parseEvidenceText } from './services/evidence-parser.js';
import { validateRuntimeConfig } from './services/config-runtime.js';
import { RateLimiter } from './services/rate-limit.js';
import { billingSummary, upsertBillingEntitlement, verifyStripeSignature, subscriptionFromStripeEvent } from './services/billing.js';
import { recordUsage, summarizeUsage, usageGate } from './services/usage-metering.js';
import { PLAN_DEFINITIONS, entitlementsFor, withinLimit } from './services/plans.js';
import {
  clearSessionCookie, createSessionToken, hashPassword, hashSessionToken,
  csrfTokenForSession, normalizeEmail, passwordHashNeedsUpgrade, requestCredential, sanitizeUser,
  sessionCookie, validateEmail, validatePassword, verifyLoginPassword, verifyPassword,
} from './services/auth.js';
import { buildTotpEnrollmentUri, generateTotpSecret, verifyTotpCode } from './services/mfa.js';
import {
  badRequest, forbidden, json, notFound, parseWindow, readBody, readJson,
  text, timingSafeEqualString, toCsv, unauthorized, verifyHmac,
} from './services/utils.js';
import { ingestMetaWebhook } from './manebrain/meta-intake.js';
import { metaOperationMode, requirePlatformOwner } from './manebrain/owner-authority.js';
import { verifyMetaChallenge } from './manebrain/meta-security.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '../public');
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};
const allowedAuthorizationBases = new Set(['official_api', 'ebay_api', 'written_license', 'commercial_partner', 'user_authorized_export', 'user_csv']);

function normalizeRemoteAddress(value) {
  const address = String(value || '').trim();
  if (!address) return 'unknown';
  return address.startsWith('::ffff:') ? address.slice(7) : address;
}

export function clientIp(req, config = {}) {
  const remoteAddress = normalizeRemoteAddress(req.socket?.remoteAddress);
  if (config.trustProxy !== true) return remoteAddress;

  const trustedProxyAddresses = new Set(
    (config.trustedProxyAddresses || []).map(normalizeRemoteAddress),
  );
  if (!trustedProxyAddresses.has(remoteAddress)) return remoteAddress;

  const forwarded = String(req.headers?.['x-forwarded-for'] || '')
    .split(',')
    .map((value) => normalizeRemoteAddress(value))
    .filter((value) => value && value !== 'unknown');
  return forwarded[0] || remoteAddress;
}

function saleQueryFromCard(card) {
  return [card.year, card.brand, card.set, card.player, card.cardNumber, card.parallel, card.grade?.company, card.grade?.grade]
    .filter(Boolean).join(' ');
}

function publicSlugForCard(card) {
  return [card.year, card.brand, card.set, card.player, card.cardNumber, card.parallel, card.grade?.company, card.grade?.grade]
    .filter(Boolean).join('-').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function embedOriginAllowed(req, config) {
  const origin = String(req.headers.origin || '');
  if (!origin) return true;
  const allow = config.widgetAllowedOrigins?.length ? config.widgetAllowedOrigins : config.allowedOrigins;
  return allow.includes(origin);
}

function safeStaticPath(urlPath) {
  const requested = urlPath === '/' ? '/index.html' : urlPath;
  const normalized = path.normalize(requested).replace(/^(\.\.(\/|\\|$))+/, '');
  const absolute = path.join(publicDir, normalized);
  return absolute.startsWith(publicDir) ? absolute : null;
}

function securityHeaders(config = {}) {
  const imageHosts = [...imageConfig(config).allowedHosts].map((host) => `https://${host}`).join(' ');
  return {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'camera=(self), microphone=(), geolocation=()',
    'cross-origin-opener-policy': 'same-origin',
    'content-security-policy': `default-src 'self'; img-src 'self' data: blob: http://127.0.0.1:8741 ${imageHosts}; media-src 'self' blob:; connect-src 'self' http://127.0.0.1:8741; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
  };
}

function isMutation(method) {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method);
}

function originAllowed(req, config) {
  const origin = String(req.headers.origin || '');
  if (!origin) return true;
  try {
    const ownOrigin = new URL(config.publicBaseUrl).origin;
    return origin === ownOrigin || config.allowedOrigins.includes(origin);
  } catch {
    return false;
  }
}

function marketMode(config, customSalesCount) {
  if (config.demoMode && customSalesCount === 0) return 'demo';
  if (config.demoMode && customSalesCount > 0) return 'mixed';
  return 'production';
}

export function createRouter({ config, cards: bundledCards, sales: bundledSales, providers, store, cache, runtimeValidation = null, storage = null, ocrService = null, databaseRuntime = null }) {
  ensureSourcePolicies(store.state);
  const cardImageOptions = imageConfig(config);
  const generalLimiter = new RateLimiter({ windowMs: 60_000, max: 240 });
  const metaWebhookLimiter = new RateLimiter({ windowMs: 60_000, max: 6_000 });
  const authLimiter = new RateLimiter({ windowMs: 15 * 60_000, max: 30 });
  const authAccountLimiter = new RateLimiter({ windowMs: 15 * 60_000, max: 10 });
  const scanLimiter = new RateLimiter({ windowMs: 60_000, max: 30 });
  const requestIp = (req) => clientIp(req, config);
  const visionWorker = new VisionWorkerClient({ baseUrl: config.visionWorkerUrl, timeoutMs: config.visionWorkerTimeoutMs });

  function catalog() {
    return [...bundledCards, ...store.state.customCards];
  }

  function applyCompCorrections(sales) {
    const corrections = store.compCorrections?.() || {};
    return sales.map((sale) => corrections[sale.id]?.correction ? { ...sale, ...corrections[sale.id].correction, corrected: true } : sale);
  }

  function allSales() {
    const demoSales = config.demoMode ? bundledSales.map((sale) => ({ ...sale, sourceMode: 'demo', authorizationBasis: 'demo', rightsNotes: 'Synthetic demonstration comp. Not a public market value.' })) : [];
    return applyCompCorrections([...demoSales, ...store.state.customSales]);
  }

  function matchCard(id) {
    return catalog().find((card) => card.id === id) || null;
  }

  function salesForCard(card) {
    return card?.id ? allSales().filter((sale) => sale.cardId === card.id) : [];
  }

  async function activeAskingListingsForCard(card, { limit = 12, categoryIds = null } = {}) {
    const ebay = providers.byName.get('eBay');
    if (!card || !ebay?.supportsActiveListings || typeof ebay.searchActiveListings !== 'function') return { listings: [], error: null };
    try {
      const listings = await ebay.searchActiveListings({ query: saleQueryFromCard(card), limit, categoryIds, binOnly: true });
      return { listings, error: null };
    } catch (error) {
      return { listings: [], error: error.message };
    }
  }

  function isTcgCard(card = {}) {
    const domain = String(card.sport || card.game || card.category || '').toLowerCase();
    return ['pokemon', 'pokémon', 'magic', 'magic the gathering', 'mtg', 'yu-gi-oh', 'yugioh', 'lorcana', 'one piece', 'digimon', 'union arena', 'flesh and blood', 'dragon ball'].some((name) => domain.includes(name));
  }

  async function marketContextForCard(card) {
    if (!card) return { available: false, provider: null, reason: 'missing_card' };
    const key = `market-context:${card.id || saleQueryFromCard(card)}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const query = saleQueryFromCard(card);
    try {
      if (isTcgCard(card)) {
        const provider = providers.byName.get('JustTCG');
        if (!provider || provider.mode === 'credentials_required' || typeof provider.searchCards !== 'function') {
          return { available: false, provider: 'JustTCG', reason: 'credentials_required' };
        }
        const result = await provider.searchCards({ query, game: card.sport || card.game || '', set: card.set || '', limit: 10, includePriceHistory: true });
        const payload = { available: result.cards.length > 0, provider: 'JustTCG', sourceType: 'current_market_context', valuationUse: false, cards: result.cards, usage: result.usage || null, explanation: 'Current TCG market context only. It is not a verified completed-sale comp feed.' };
        cache.set(key, payload, 15 * 60_000);
        return payload;
      }
      const provider = providers.byName.get('SportsCardsPro');
      if (!provider || provider.mode === 'credentials_required' || typeof provider.getProduct !== 'function') {
        return { available: false, provider: 'SportsCardsPro', reason: 'credentials_required' };
      }
      const result = await provider.getProduct({ query });
      const payload = { available: Boolean(result.product?.providerCardId), provider: 'SportsCardsPro', sourceType: 'price_guide_context', valuationUse: false, product: result.product, explanation: 'Current guide and retail context only. It is not historic completed-sale evidence.' };
      cache.set(key, payload, 24 * 60 * 60_000);
      return payload;
    } catch (error) {
      return { available: false, provider: isTcgCard(card) ? 'JustTCG' : 'SportsCardsPro', reason: 'provider_error', error: error.message };
    }
  }

  function withCardImage(card, cardSales = null) {
    return card ? attachCardImage(card, cardImageOptions, { sales: cardSales || salesForCard(card), imageOverrides: store.state.cardImageOverrides || {} }) : card;
  }

  function autocompleteWithImages(payload) {
    if (!payload || typeof payload !== 'object') return payload;
    const next = { ...payload };
    for (const key of ['likelyCards', 'matches', 'candidates']) {
      if (Array.isArray(next[key])) next[key] = next[key].map(withCardImage);
    }
    for (const key of ['exactCard', 'publicCard', 'card']) {
      if (next[key]) next[key] = withCardImage(next[key]);
    }
    if (next.autopopulate && (next.publicCard || next.card)) {
      const imageCard = withCardImage(next.publicCard || next.card);
      next.autopopulate = { ...next.autopopulate, image: imageCard.image, imageMeta: imageCard.imageMeta };
    }
    return next;
  }

  async function issueAccountToken(user, type) {
    const rawToken = createSessionToken();
    const expiresAt = new Date(Date.now() + Number(config.accountTokenMinutes || 60) * 60_000).toISOString();
    await store.createAccountToken({ userId: user.id, type, tokenHash: hashSessionToken(rawToken), expiresAt });
    const route = type === 'verify_email' ? 'verify' : 'reset';
    const actionUrl = `${config.publicBaseUrl}/#/account?${route}=${encodeURIComponent(rawToken)}`;
    const subject = type === 'verify_email' ? 'Verify your ManeFlow email' : 'Reset your ManeFlow password';
    let status = 'queued';
    let deliveryError = null;
    if (config.emailWebhookUrl) {
      try {
        const response = await fetch(config.emailWebhookUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(config.emailWebhookSecret ? { authorization: `Bearer ${config.emailWebhookSecret}` } : {}) },
          body: JSON.stringify({ type, to: user.email, subject, actionUrl, expiresAt, app: config.appName }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error(`Email webhook returned ${response.status}`);
        status = 'delivered';
      } catch (error) { status = 'failed'; deliveryError = error.message; }
    }
    await store.recordOutbox({ type, to: user.email, userId: user.id, expiresAt, actionUrl, subject, status, deliveryError });
    return { expiresAt, delivery: status, ...(config.exposeDevTokens ? { token: rawToken, actionUrl } : {}) };
  }

  function enrichCard(card) {
    const cardSales = allSales().filter((sale) => sale.cardId === card.id);
    return { ...withCardImage(card, cardSales), market: calculateValuation(cardSales, { card, demoMode: config.demoMode, overrides: store.compOverrides?.() || {} }), saleCount: cardSales.length };
  }

  function actorFromRequest(req) {
    const credential = requestCredential(req);
    const { token } = credential;
    if (!token) return null;
    if (config.allowLegacyAdminToken !== false && config.adminToken && timingSafeEqualString(token, config.adminToken)) {
      return { userId: 'owner', role: 'admin', service: true, tokenHash: null, authSource: credential.source };
    }
    if (config.serviceToken && timingSafeEqualString(token, config.serviceToken)) {
      return { userId: 'internal-service', role: 'service', service: true, tokenHash: null, authSource: credential.source };
    }
    if (config.apiToken && timingSafeEqualString(token, config.apiToken)) {
      return { userId: 'owner', role: 'merchant', service: true, tokenHash: null, authSource: credential.source };
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

  function personalActor(req, res, { write = false } = {}) {
    const actor = actorFromRequest(req);
    if (actor) return actor;
    if (config.requireAuthentication) {
      unauthorized(res);
      return null;
    }
    if (!write) return { userId: 'guest-readonly', role: 'guest', user: null, service: false, readOnly: true };
    if (config.allowGuestWrites) return { userId: 'guest', role: 'guest', user: null, service: false, readOnly: false };
    unauthorized(res);
    return null;
  }

  function optionalWriteActor(req) {
    const actor = actorFromRequest(req);
    if (actor) return actor;
    if (config.allowGuestWrites) return { userId: 'guest', role: 'guest', user: null, service: false, readOnly: false };
    return null;
  }

  function adminActor(req, res) {
    const actor = actorFromRequest(req);
    if (actor?.role === 'admin') return actor;
    forbidden(res, 'Administrator authorization is required.');
    return null;
  }

  function platformOwnerActor(req, res, options = {}) {
    try {
      return requirePlatformOwner(actorFromRequest(req), config, options);
    } catch (error) {
      forbidden(res, error.message);
      return null;
    }
  }

  function configuredMetaOwnerId() {
    return config.platformOwnerUserIds.length === 1 ? config.platformOwnerUserIds[0] : null;
  }

  async function dashboardFor(userId) {
    const snapshot = store.userSnapshot(userId);
    const currentSales = allSales();
    const collection = snapshot.collection.map((item) => {
      const card = matchCard(item.cardId);
      const cardSales = card ? currentSales.filter((sale) => sale.cardId === card.id) : [];
      const market = card ? calculateValuation(cardSales, { card, demoMode: config.demoMode, overrides: store.compOverrides?.() || {} }) : null;
      const currentValue = market?.value ? market.value * item.quantity : 0;
      const costBasis = item.purchasePrice * item.quantity;
      return { ...item, card: withCardImage(card, cardSales), market, currentValue, costBasis, gain: currentValue - costBasis };
    });
    const watchlist = snapshot.watchlist.map((watch) => {
      const card = matchCard(watch.cardId);
      const cardSales = card ? currentSales.filter((sale) => sale.cardId === card.id) : [];
      const market = card ? calculateValuation(cardSales, { card, demoMode: config.demoMode, overrides: store.compOverrides?.() || {} }) : null;
      const triggered = Boolean(watch.enabled && market?.value && watch.targetPrice !== null && (
        watch.direction === 'above' ? market.value >= watch.targetPrice : market.value <= watch.targetPrice
      ));
      return { ...watch, card: withCardImage(card, cardSales), market, triggered };
    });
    for (const watch of watchlist.filter((entry) => entry.triggered && entry.card && entry.market?.value)) {
      await store.upsertAlert(userId, {
        key: `watch:${watch.id}:${watch.direction}:${watch.targetPrice}`, type: 'price_target', cardId: watch.cardId,
        title: `${watch.card.player || 'Card'} target reached`,
        message: `Market estimate ${watch.direction === 'above' ? 'rose to' : 'fell to'} ${watch.market.value}; target ${watch.targetPrice}.`,
        value: watch.market.value, targetPrice: watch.targetPrice,
      });
    }
    const refreshed = store.userSnapshot(userId);
    const intelligenceOptions = { cards: catalog(), sales: currentSales, demoMode: config.demoMode, overrides: store.compOverrides?.() || {} };
    const portfolio = portfolioAnalytics(collection, intelligenceOptions);
    const intelligence = buildPortfolioIntelligence(collection, intelligenceOptions);
    return {
      totals: { currentValue: portfolio.totalValue, costBasis: portfolio.totalCost, gain: portfolio.totalGain },
      portfolio,
      intelligence,
      collection,
      watchlist,
      listingDrafts: snapshot.listingDrafts,
      scanHistory: snapshot.scanHistory.slice(0, 25),
      imports: snapshot.imports.slice(0, 25),
      alerts: refreshed.alerts.filter((alert) => !alert.resolvedAt).slice(0, 50),
      unreadAlerts: refreshed.alerts.filter((alert) => !alert.resolvedAt && !alert.readAt).length,
      preferences: snapshot.preferences,
    };
  }

  async function handleAuth(req, res, url) {
    const method = req.method || 'GET';
    if (url.pathname === '/api/auth/me' && method === 'GET') {
      const actor = actorFromRequest(req);
      return json(res, 200, {
        authenticated: Boolean(actor && actor.user),
        user: sanitizeUser(actor?.user),
        entitlements: entitlementsFor(actor),
        guestMode: !actor && config.allowGuestWrites,
        csrfToken: actor?.csrfToken || null,
      });
    }

    if (url.pathname === '/api/auth/register' && method === 'POST') {
      if (!config.allowPublicSignups) return forbidden(res, 'Public account creation is disabled.');
      const limit = authLimiter.check(`register:${requestIp(req)}`);
      if (!limit.allowed) return json(res, 429, { error: 'rate_limited', message: 'Too many account attempts. Try again later.' });
      try {
        const body = await readJson(req, 100_000);
        const email = normalizeEmail(body.email);
        if (!validateEmail(email)) return badRequest(res, 'Enter a valid email address.');
        const passwordError = validatePassword(body.password);
        if (passwordError) return badRequest(res, passwordError);
        const { salt, hash, params } = await hashPassword(body.password);
        const existing = store.findUserByEmail(email);
        if (!existing) {
          const user = await store.createUser({
            email,
            name: body.name,
            passwordHash: hash,
            passwordSalt: salt,
            passwordParams: params,
            role: 'collector',
          });
          await issueAccountToken(user, 'verify_email');
          await store.audit({ type: 'account_created', userId: user.id, ip: requestIp(req) });
        } else {
          await store.audit({ type: 'account_registration_requested_existing', userId: null, ip: requestIp(req) });
        }
        return json(res, 202, {
          queued: true,
          message: 'If this address can be registered, account instructions have been queued.',
        });
      } catch (error) {
        return badRequest(res, error.message);
      }
    }

    if (url.pathname === '/api/auth/login' && method === 'POST') {
      const limit = authLimiter.check(`login:${requestIp(req)}`);
      if (!limit.allowed) return json(res, 429, { error: 'rate_limited', message: 'Too many login attempts. Try again later.' });
      try {
        const body = await readJson(req, 100_000);
        const accountLimit = authAccountLimiter.check(`login:${normalizeEmail(body.email) || 'missing'}`);
        if (!accountLimit.allowed) return json(res, 429, { error: 'rate_limited', message: 'Too many login attempts. Try again later.' });
        const user = store.findUserByEmail(body.email);
        const valid = await verifyLoginPassword(user, body.password);
        if (!valid) return json(res, 401, { error: 'invalid_credentials', message: 'Email or password is incorrect.' });
        if (user.disabledAt) return json(res, 403, { error: 'account_disabled', message: 'This account is disabled. Contact support.' });
        if (config.requireEmailVerification && !user.emailVerifiedAt) return json(res, 403, { error: 'email_not_verified', message: 'Verify your email before signing in.' });
        if (passwordHashNeedsUpgrade(user)) {
          const upgraded = await hashPassword(body.password);
          await store.updatePassword(user.id, {
            passwordHash: upgraded.hash,
            passwordSalt: upgraded.salt,
            passwordParams: upgraded.params,
          });
        }
        const token = createSessionToken();
        await store.createSession({
          tokenHash: hashSessionToken(token), userId: user.id,
          expiresAt: new Date(Date.now() + config.sessionDays * 86_400_000).toISOString(),
          userAgent: req.headers['user-agent'], ip: requestIp(req),
        });
        await store.audit({ type: 'login', userId: user.id, ip: requestIp(req) });
        return json(res, 200, {
          user: sanitizeUser(user),
          csrfToken: csrfTokenForSession(token),
          ...(body.native === true ? { sessionToken: token } : {}),
        }, { 'set-cookie': sessionCookie(token, config) });
      } catch (error) {
        return badRequest(res, error.message);
      }
    }

    if (url.pathname === '/api/auth/request-verification' && method === 'POST') {
      const limit = authLimiter.check(`verification:${requestIp(req)}`);
      if (!limit.allowed) return json(res, 429, { error: 'rate_limited', message: 'Too many requests. Try again later.' });
      try {
        const body = await readJson(req, 100_000);
        const actor = actorFromRequest(req);
        const verificationAccount = normalizeEmail(body.email || actor?.user?.email || '');
        const accountLimit = authAccountLimiter.check(`verification:${verificationAccount || 'missing'}`);
        if (!accountLimit.allowed) return json(res, 429, { error: 'rate_limited', message: 'Too many requests. Try again later.' });
        const user = actor?.user || store.findUserByEmail(body.email);
        let verification = null;
        if (user && !user.disabledAt && !user.emailVerifiedAt) {
          verification = await issueAccountToken(user, 'verify_email');
        }
        await store.audit({ type: 'verification_requested', userId: user?.id || null, ip: requestIp(req) });
        return json(res, 202, {
          queued: true,
          message: 'If the account exists and needs verification, instructions have been queued.',
          ...(config.exposeDevTokens && verification ? { verification } : {}),
        });
      } catch (error) { return badRequest(res, error.message); }
    }

    if (url.pathname === '/api/auth/verify-email' && method === 'POST') {
      try {
        const body = await readJson(req, 100_000);
        const consumed = await store.consumeAccountToken('verify_email', hashSessionToken(body.token));
        if (!consumed) return badRequest(res, 'Verification token is invalid or expired.');
        const user = await store.markEmailVerified(consumed.userId);
        await store.audit({ type: 'email_verified', userId: consumed.userId, ip: requestIp(req) });
        return json(res, 200, { verified: true, user: sanitizeUser(user) });
      } catch (error) { return badRequest(res, error.message); }
    }

    if (url.pathname === '/api/auth/forgot-password' && method === 'POST') {
      const limit = authLimiter.check(`forgot:${requestIp(req)}`);
      if (!limit.allowed) return json(res, 429, { error: 'rate_limited', message: 'Too many requests. Try again later.' });
      try {
        const body = await readJson(req, 100_000);
        const accountLimit = authAccountLimiter.check(`forgot:${normalizeEmail(body.email) || 'missing'}`);
        if (!accountLimit.allowed) return json(res, 429, { error: 'rate_limited', message: 'Too many requests. Try again later.' });
        const user = store.findUserByEmail(body.email);
        let reset = null;
        if (user && !user.disabledAt) reset = await issueAccountToken(user, 'reset_password');
        await store.audit({ type: 'password_reset_requested', userId: user?.id || null, ip: requestIp(req) });
        return json(res, 202, { queued: true, message: 'If the account exists, password-reset instructions have been queued.', ...(config.exposeDevTokens && reset ? { reset } : {}) });
      } catch (error) { return badRequest(res, error.message); }
    }

    if (url.pathname === '/api/auth/reset-password' && method === 'POST') {
      try {
        const body = await readJson(req, 100_000);
        const passwordError = validatePassword(body.password);
        if (passwordError) return badRequest(res, passwordError);
        const consumed = await store.consumeAccountToken('reset_password', hashSessionToken(body.token));
        if (!consumed) return badRequest(res, 'Reset token is invalid or expired.');
        const { salt, hash, params } = await hashPassword(body.password);
        await store.updatePassword(consumed.userId, { passwordHash: hash, passwordSalt: salt, passwordParams: params });
        await store.audit({ type: 'password_reset_completed', userId: consumed.userId, ip: requestIp(req) });
        return json(res, 200, { reset: true, message: 'Password updated. Sign in with the new password.' }, { 'set-cookie': clearSessionCookie(config) });
      } catch (error) { return badRequest(res, error.message); }
    }

    if (url.pathname === '/api/auth/change-password' && method === 'POST') {
      const actor = actorFromRequest(req);
      if (!actor?.user) return unauthorized(res);
      try {
        const body = await readJson(req, 100_000);
        const valid = await verifyPassword(body.currentPassword, actor.user.passwordSalt, actor.user.passwordHash, actor.user.passwordParams);
        if (!valid) return json(res, 401, { error: 'invalid_credentials', message: 'Current password is incorrect.' });
        const passwordError = validatePassword(body.newPassword);
        if (passwordError) return badRequest(res, passwordError);
        const { salt, hash, params } = await hashPassword(body.newPassword);
        await store.updatePassword(actor.userId, { passwordHash: hash, passwordSalt: salt, passwordParams: params });
        await store.audit({ type: 'password_changed', userId: actor.userId, ip: requestIp(req) });
        return json(res, 200, { changed: true }, { 'set-cookie': clearSessionCookie(config) });
      } catch (error) { return badRequest(res, error.message); }
    }

    if (url.pathname === '/api/auth/mfa/totp/enroll' && method === 'POST') {
      const actor = actorFromRequest(req);
      if (!actor?.user || !actor.tokenHash) return unauthorized(res);
      try {
        const body = await readJson(req, 100_000);
        const valid = await verifyPassword(
          body.password,
          actor.user.passwordSalt,
          actor.user.passwordHash,
          actor.user.passwordParams,
        );
        if (!valid) return json(res, 401, { error: 'invalid_credentials', message: 'Current password is incorrect.' });
        const secret = generateTotpSecret();
        await store.beginTotpEnrollment(actor.userId, secret);
        const now = new Date().toISOString();
        await store.markSessionStepUp(actor.tokenHash, { reauthenticatedAt: now });
        await store.audit({ type: 'mfa_totp_enrollment_started', userId: actor.userId, ip: requestIp(req) });
        return json(res, 200, {
          method: 'totp',
          secret,
          otpauthUrl: buildTotpEnrollmentUri({
            secret,
            accountName: actor.user.email,
            issuer: config.appName || 'ManeFlow',
          }),
        });
      } catch (error) { return badRequest(res, error.message); }
    }

    if (url.pathname === '/api/auth/mfa/totp/confirm' && method === 'POST') {
      const actor = actorFromRequest(req);
      if (!actor?.user || !actor.tokenHash) return unauthorized(res);
      try {
        const body = await readJson(req, 100_000);
        const pendingSecret = actor.user.mfaTotpPendingSecret;
        if (!pendingSecret) return json(res, 409, { error: 'mfa_enrollment_not_started', message: 'Start TOTP enrollment first.' });
        if (!verifyTotpCode(pendingSecret, body.code)) {
          return json(res, 401, { error: 'invalid_mfa_code', message: 'The authentication code is invalid.' });
        }
        await store.completeTotpEnrollment(actor.userId);
        const now = new Date().toISOString();
        await store.markSessionStepUp(actor.tokenHash, { mfaVerifiedAt: now, reauthenticatedAt: now });
        await store.audit({ type: 'mfa_totp_enabled', userId: actor.userId, ip: requestIp(req) });
        return json(res, 200, { enabled: true, method: 'totp' });
      } catch (error) { return badRequest(res, error.message); }
    }

    if (url.pathname === '/api/auth/mfa/verify' && method === 'POST') {
      const actor = actorFromRequest(req);
      if (!actor?.user || !actor.tokenHash) return unauthorized(res);
      try {
        const body = await readJson(req, 100_000);
        if (!actor.user.mfaTotpSecret || !actor.user.mfaEnabledAt) {
          return json(res, 409, { error: 'mfa_not_enrolled', message: 'MFA enrollment is required.' });
        }
        if (!verifyTotpCode(actor.user.mfaTotpSecret, body.code)) {
          return json(res, 401, { error: 'invalid_mfa_code', message: 'The authentication code is invalid.' });
        }
        const now = new Date().toISOString();
        await store.markSessionStepUp(actor.tokenHash, { mfaVerifiedAt: now });
        await store.audit({ type: 'mfa_verified', userId: actor.userId, ip: requestIp(req) });
        return json(res, 200, { verified: true, mfaVerifiedAt: now });
      } catch (error) { return badRequest(res, error.message); }
    }

    if (url.pathname === '/api/auth/reauth' && method === 'POST') {
      const actor = actorFromRequest(req);
      if (!actor?.user || !actor.tokenHash) return unauthorized(res);
      try {
        const body = await readJson(req, 100_000);
        const valid = await verifyPassword(
          body.password,
          actor.user.passwordSalt,
          actor.user.passwordHash,
          actor.user.passwordParams,
        );
        if (!valid) return json(res, 401, { error: 'invalid_credentials', message: 'Current password is incorrect.' });
        let mfaVerifiedAt = actor.session?.mfaVerifiedAt || null;
        if (actor.user.mfaTotpSecret && actor.user.mfaEnabledAt) {
          if (!verifyTotpCode(actor.user.mfaTotpSecret, body.code)) {
            return json(res, 401, { error: 'invalid_mfa_code', message: 'A valid MFA code is required.' });
          }
          mfaVerifiedAt = new Date().toISOString();
        }
        const reauthenticatedAt = new Date().toISOString();
        await store.markSessionStepUp(actor.tokenHash, { mfaVerifiedAt, reauthenticatedAt });
        await store.audit({ type: 'session_reauthenticated', userId: actor.userId, ip: requestIp(req) });
        return json(res, 200, { reauthenticated: true, reauthenticatedAt, mfaVerifiedAt });
      } catch (error) { return badRequest(res, error.message); }
    }

    if (url.pathname === '/api/auth/sessions' && method === 'GET') {
      const actor = actorFromRequest(req);
      if (!actor?.user) return unauthorized(res);
      return json(res, 200, { sessions: store.listSessions(actor.userId) });
    }

    if (url.pathname === '/api/auth/sessions/revoke-all' && method === 'POST') {
      const actor = actorFromRequest(req);
      if (!actor?.user) return unauthorized(res);
      const removed = await store.deleteAllUserSessions(actor.userId);
      await store.audit({ type: 'sessions_revoked_all', userId: actor.userId, ip: requestIp(req), metadata: { removed } });
      return json(res, 200, { removed, loggedOut: true }, { 'set-cookie': clearSessionCookie(config) });
    }

    const sessionMatch = /^\/api\/auth\/sessions\/([^/]+)$/.exec(url.pathname);
    if (sessionMatch && method === 'DELETE') {
      const actor = actorFromRequest(req);
      if (!actor?.user) return unauthorized(res);
      const removed = await store.deleteSessionById(actor.userId, decodeURIComponent(sessionMatch[1]));
      return removed ? json(res, 200, { removed: true }) : notFound(res, 'Session not found');
    }

    if (url.pathname === '/api/auth/export' && method === 'GET') {
      const actor = actorFromRequest(req);
      if (!actor?.user) return unauthorized(res);
      const payload = store.exportUserData(actor.userId);
      return json(res, 200, payload, { 'content-disposition': `attachment; filename="maneflow-account-${actor.userId}.json"` });
    }

    if (url.pathname === '/api/auth/account' && method === 'PATCH') {
      const actor = actorFromRequest(req);
      if (!actor?.user) return unauthorized(res);
      try {
        const body = await readJson(req, 100_000);
        const user = await store.updateUser(actor.userId, { name: body.name });
        return json(res, 200, { user: sanitizeUser(user) });
      } catch (error) { return badRequest(res, error.message); }
    }

    if (url.pathname === '/api/auth/account' && method === 'DELETE') {
      const actor = actorFromRequest(req);
      if (!actor?.user) return unauthorized(res);
      try {
        const body = await readJson(req, 100_000);
        const valid = await verifyPassword(body.password, actor.user.passwordSalt, actor.user.passwordHash, actor.user.passwordParams);
        if (!valid) return json(res, 401, { error: 'invalid_credentials', message: 'Password is incorrect.' });
        await store.audit({ type: 'account_deleted', userId: actor.userId, ip: requestIp(req) });
        await store.deleteUser(actor.userId);
        return json(res, 200, { deleted: true }, { 'set-cookie': clearSessionCookie(config) });
      } catch (error) { return badRequest(res, error.message); }
    }

    if (url.pathname === '/api/auth/logout' && method === 'POST') {
      const actor = actorFromRequest(req);
      if (actor?.tokenHash) await store.deleteSession(actor.tokenHash);
      return json(res, 200, { loggedOut: true }, { 'set-cookie': clearSessionCookie(config) });
    }
    return null;
  }

  async function handleApi(req, res, url) {
    const method = req.method || 'GET';
    const limiter = url.pathname === '/api/webhooks/meta' ? metaWebhookLimiter : generalLimiter;
    const rate = limiter.check(`${requestIp(req)}:${url.pathname.split('/').slice(0, 3).join('/')}`);
    res.setHeader('x-ratelimit-remaining', String(rate.remaining));
    res.setHeader('x-ratelimit-reset', String(Math.ceil(rate.resetAt / 1000)));
    if (!rate.allowed) return json(res, 429, { error: 'rate_limited', message: 'Request limit reached. Try again shortly.' });
    if (isMutation(method) && !originAllowed(req, config)) return forbidden(res, 'Request origin is not allowed.');
    const csrfExempt = new Set([
      '/api/auth/register',
      '/api/auth/login',
      '/api/auth/request-verification',
      '/api/auth/verify-email',
      '/api/auth/forgot-password',
      '/api/auth/reset-password',
      '/api/billing/stripe/webhook',
      '/api/admin/provider-ingest',
      '/api/webhooks/meta',
    ]);
    if (config.csrfProtection && isMutation(method) && !csrfExempt.has(url.pathname)) {
      const actor = actorFromRequest(req);
      if (actor?.authSource === 'cookie') {
        const supplied = String(req.headers['x-maneflow-csrf'] || '');
        if (!actor.csrfToken || !timingSafeEqualString(supplied, actor.csrfToken)) {
          return forbidden(res, 'A valid CSRF token is required.');
        }
      }
    }

    if (url.pathname === '/api/ocr/readiness' && method === 'GET') {
      return json(res, 200, ocrService?.readiness?.() || {
        enabled: false,
        available: false,
        reason: 'ocr_service_not_configured',
      });
    }

    if (url.pathname === '/api/health' && method === 'GET') {
      const database = databaseRuntime?.health ? await databaseRuntime.health() : { configured: false, ready: false, mode: 'disabled' };
      return json(res, 200, {
        ok: true, name: config.appName, version: config.version, releaseChannel: config.releaseChannel,
        time: new Date().toISOString(), marketMode: marketMode(config, store.state.customSales.length),
        catalogCards: catalog().length, customSales: store.state.customSales.length,
        database,
        providers: providers.status().filter((item) => item.mode !== 'partnership_required').map(({ name, mode }) => ({ name, mode })),
      });
    }

    if (url.pathname === '/api/release' && method === 'GET') {
      return json(res, 200, {
        version: config.version,
        commitSha: config.releaseCommitSha || null,
        deployedAt: config.releaseDeployedAt || null,
        environment: config.releaseEnvironment || 'unknown',
        releases: {
          web: config.webReleaseId || null,
          api: config.apiReleaseId || null,
          vision: config.visionReleaseId || null,
        },
        migrationVersion: config.migrationVersion || null,
      });
    }

    if (url.pathname === '/api/webhooks/meta' && method === 'GET') {
      const verification = verifyMetaChallenge({
        mode: url.searchParams.get('hub.mode'),
        token: url.searchParams.get('hub.verify_token'),
        challenge: url.searchParams.get('hub.challenge'),
      }, config.metaWebhookVerifyToken);
      if (!verification.ok) {
        return json(res, verification.status, { error: verification.error });
      }
      return text(res, 200, verification.challenge);
    }

    if (url.pathname === '/api/webhooks/meta' && method === 'POST') {
      const ownerUserId = configuredMetaOwnerId();
      if (!ownerUserId) {
        return json(res, 503, { error: 'META_OWNER_CONFIGURATION_INVALID' });
      }
      try {
        const rawBody = await readBody(req, Math.min(config.maxRequestBytes, 1_000_000));
        const outcome = await ingestMetaWebhook({
          rawBody,
          signature: req.headers['x-hub-signature-256'],
          config,
          repository: databaseRuntime?.metaInboundRepository,
          ownerUserId,
        });
        return json(res, outcome.status, outcome.body);
      } catch (error) {
        const known = error?.code === 'META_ASSET_NOT_PROVISIONED'
          ? { status: 503, code: error.code }
          : error?.code === 'META_REPLAY_PAYLOAD_MISMATCH'
            ? { status: 409, code: error.code }
            : { status: 500, code: 'META_INTAKE_FAILED' };
        return json(res, known.status, { error: known.code });
      }
    }

    if (url.pathname === '/api/owner/meta/status' && method === 'GET') {
      const actor = platformOwnerActor(req, res);
      if (!actor) return;
      return json(res, 200, {
        mode: metaOperationMode(config),
        intakeEnabled: config.metaIntakeEnabled === true,
        outboundEnabled: config.metaOutboundEnabled === true,
        killSwitch: config.metaKillSwitch !== false,
        databaseReady: Boolean(databaseRuntime?.metaInboundRepository),
        assetsConfigured: Boolean(
          config.metaAppId
          && config.metaBusinessId
          && config.metaPageId
          && config.metaInstagramAccountId
        ),
        webhookConfigured: Boolean(config.metaAppSecret && config.metaWebhookVerifyToken),
      });
    }

    if (url.pathname === '/api/owner/meta/conversations' && method === 'GET') {
      const actor = platformOwnerActor(req, res);
      if (!actor) return;
      if (!databaseRuntime?.metaInboundRepository) {
        return json(res, 503, { error: 'META_INBOX_NOT_READY' });
      }
      try {
        const conversations = await databaseRuntime.metaInboundRepository.listConversations(actor.userId, {
          limit: Number(url.searchParams.get('limit') || 50),
          beforeUpdatedAt: url.searchParams.get('beforeUpdatedAt'),
          beforeId: url.searchParams.get('beforeId'),
        });
        return json(res, 200, { conversations });
      } catch {
        return json(res, 400, { error: 'META_INBOX_QUERY_INVALID' });
      }
    }

    const metaConversation = url.pathname.match(/^\/api\/owner\/meta\/conversations\/([0-9a-f-]+)$/i);
    if (metaConversation && method === 'GET') {
      const actor = platformOwnerActor(req, res);
      if (!actor) return;
      if (!databaseRuntime?.metaInboundRepository) {
        return json(res, 503, { error: 'META_INBOX_NOT_READY' });
      }
      try {
        const conversation = await databaseRuntime.metaInboundRepository.getConversation(
          actor.userId,
          decodeURIComponent(metaConversation[1]),
        );
        return conversation
          ? json(res, 200, conversation)
          : notFound(res, 'Meta conversation not found.');
      } catch {
        return json(res, 400, { error: 'META_INBOX_QUERY_INVALID' });
      }
    }

    if (url.pathname === '/api/internal/card-pricing' && method === 'POST') {
      const actor = actorFromRequest(req);
      if (!actor?.service) return unauthorized(res, 'A ManeFlow service token is required.');
      try {
        const body = await readJson(req, 500_000);
        const input = body.predictedCard || body.card || {};
        const direct = body.cardId ? matchCard(String(body.cardId)) : null;
        const normalized = {
          year: input.year ?? null,
          brand: input.brand ?? null,
          set: input.set_name ?? input.set ?? null,
          player: input.player_name ?? input.player ?? input.subject_name ?? null,
          cardNumber: input.card_number ?? input.cardNumber ?? null,
          parallel: input.parallel ?? input.parallel_name ?? null,
          grader: input.grader ?? null,
          grade: input.grade ?? null,
        };
        const ranked = direct ? null : smartMatchCard(catalog(), normalized);
        const candidate = direct || (ranked?.accepted ? ranked.best?.card || null : null);
        if (!candidate) {
          return json(res, 200, {
            pricing_status: 'price_unverifiable',
            value_low: null, value_mid: null, value_high: null, confidence_score: 0,
            recommended_cash_offer_low: null, recommended_cash_offer_high: null, recommended_list_price: null,
            comps_used: 0, outliers_removed: 0,
            explanation: 'No exact catalog identity was accepted, so verified pricing was not requested.',
          });
        }
        const completedSales = salesForCard(candidate).filter((sale) => sale.sourceMode !== 'demo');
        const valuation = calculateValuation(completedSales, {
          card: candidate,
          demoMode: false,
          includeCompDetails: true,
          verifiedOnly: false,
          overrides: store.compOverrides?.() || {},
        });
        const compsUsed = valuation.compDetails?.included?.length || 0;
        const verified = valuation.value != null && compsUsed >= 3 && valuation.confidence >= 45;
        return json(res, 200, {
          pricing_status: verified ? 'verified' : (compsUsed ? 'insufficient_comps' : 'price_unverifiable'),
          value_low: verified ? valuation.range.low : null,
          value_mid: verified ? valuation.value : null,
          value_high: verified ? valuation.range.high : null,
          confidence_score: verified ? Math.min(1, valuation.confidence / 100) : Math.min(0.49, valuation.confidence / 100),
          recommended_cash_offer_low: verified ? Math.round(valuation.value * 0.60 * 100) / 100 : null,
          recommended_cash_offer_high: verified ? Math.round(valuation.value * 0.75 * 100) / 100 : null,
          recommended_list_price: verified ? Math.round(valuation.value * 1.10 * 100) / 100 : null,
          comps_used: compsUsed,
          outliers_removed: valuation.outlierCount || 0,
          catalog_card_id: candidate.id,
          explanation: verified
            ? `Verified completed-sale pricing from ${compsUsed} included comp(s); active listings and demo rows are excluded.`
            : `Only ${compsUsed} verified completed-sale comp(s) qualified; ManeFlow abstained from returning a price.`,
        });
      } catch (error) {
        return json(res, 400, { error: 'card_pricing_request_failed', message: error instanceof Error ? error.message : String(error) });
      }
    }

    if (url.pathname === '/api/internal/visual-search' && method === 'POST') {
      const actor = actorFromRequest(req);
      if (!actor?.service) return unauthorized(res, 'A ManeFlow service token is required.');
      if (!databaseRuntime?.findVisualMatches) {
        return json(res, 503, { error: 'vector_search_unavailable', message: 'PostgreSQL vector search is not configured.' });
      }
      try {
        const body = await readJson(req, 2_000_000);
        const matches = await databaseRuntime.findVisualMatches({
          embedding: body.embedding,
          shopId: body.shopId,
          limit: body.limit ?? 10,
        });
        return json(res, 200, {
          contractVersion: 'visual-search.v1',
          shopId: body.shopId,
          modelName: config.embeddingModelName,
          modelVersion: config.embeddingModelVersion,
          matches,
        });
      } catch (error) {
        const status = error instanceof TypeError ? 400 : 503;
        return json(res, status, {
          error: status === 400 ? 'invalid_visual_search_request' : 'visual_search_failed',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (url.pathname === '/api/internal/catalog/cards/upsert' && method === 'POST') {
      const actor = actorFromRequest(req);
      if (!actor?.service) return unauthorized(res, 'A ManeFlow service token is required.');
      if (!databaseRuntime?.upsertCatalogCards) {
        return json(res, 503, { error: 'catalog_repository_unavailable', message: 'PostgreSQL catalog storage is not configured.' });
      }
      try {
        const body = await readJson(req, 4_000_000);
        const items = Array.isArray(body?.items) ? body.items : [body];
        if (items.length === 0 || items.length > 250) throw new TypeError('items must contain between 1 and 250 catalog records.');
        const saved = await databaseRuntime.upsertCatalogCards(items);
        return json(res, 200, { contractVersion: 'catalog-upsert.v1', count: saved.length, items: saved });
      } catch (error) {
        const status = error instanceof TypeError ? 400 : 503;
        return json(res, status, {
          error: status === 400 ? 'invalid_catalog_upsert_request' : 'catalog_upsert_failed',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (url.pathname === '/api/internal/catalog/embeddings/upsert' && method === 'POST') {
      const actor = actorFromRequest(req);
      if (!actor?.service) return unauthorized(res, 'A ManeFlow service token is required.');
      if (!databaseRuntime?.upsertCardEmbeddings) {
        return json(res, 503, { error: 'embedding_repository_unavailable', message: 'PostgreSQL embedding storage is not configured.' });
      }
      try {
        const body = await readJson(req, 24_000_000);
        const items = Array.isArray(body?.items) ? body.items : [body];
        if (items.length === 0 || items.length > 50) throw new TypeError('items must contain between 1 and 50 embedding records.');
        const saved = await databaseRuntime.upsertCardEmbeddings(items);
        return json(res, 200, { contractVersion: 'catalog-embedding-upsert.v1', count: saved.length, items: saved });
      } catch (error) {
        const status = error instanceof TypeError || error instanceof RangeError ? 400 : 503;
        return json(res, status, {
          error: status === 400 ? 'invalid_embedding_upsert_request' : 'embedding_upsert_failed',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (url.pathname === '/api/config' && method === 'GET') {
      return json(res, 200, {
        appName: config.appName, version: config.version, releaseChannel: config.releaseChannel,
        demoMode: config.demoMode, marketMode: marketMode(config, store.state.customSales.length),
        allowGuestWrites: config.allowGuestWrites, allowPublicSignups: config.allowPublicSignups,
        requireAuthentication: Boolean(config.requireAuthentication),
        visionEnabled: Boolean(config.openaiApiKey && config.openaiVisionModel),
        requireEmailVerification: config.requireEmailVerification,
        accountRecoveryEnabled: true,
        cardImages: {
          enabled: true,
          placeholder: imageSourceStatus(config).placeholder,
          configuredHosts: imageSourceStatus(config).configuredHosts,
        },
      });
    }

    if (url.pathname === '/api/card-images/sources' && method === 'GET') {
      return json(res, 200, {
        ...imageSourceStatus(config),
        coverage: imageCoverageReport({ cards: catalog(), sales: allSales(), config, overrides: store.state.cardImageOverrides || {} }),
      });
    }

    if (url.pathname === '/api/card-images/coverage' && method === 'GET') {
      return json(res, 200, imageCoverageReport({ cards: catalog(), sales: allSales(), config, overrides: store.state.cardImageOverrides || {} }));
    }

    if (url.pathname === '/api/plans' && method === 'GET') {
      return json(res, 200, { plans: PLAN_DEFINITIONS, billingConnected: config.billingProvider !== 'mock', billingProvider: config.billingProvider, message: 'Plan entitlements are active. Live checkout requires the owner billing account and store-policy configuration.' });
    }

    if (url.pathname === '/api/billing/summary' && method === 'GET') {
      const actor = personalActor(req, res);
      if (!actor) return;
      return json(res, 200, { billing: billingSummary(store, actor.userId), usage: summarizeUsage(store, actor.userId), entitlements: entitlementsFor(actor) });
    }

    if (url.pathname === '/api/billing/stripe/webhook' && method === 'POST') {
      const raw = await readBody(req, config.maxRequestBytes);
      if (config.billingProvider !== 'stripe') return json(res, 202, { ignored: true, message: 'Stripe billing provider is not enabled.' });
      if (!verifyStripeSignature(raw, req.headers['stripe-signature'], config.stripeWebhookSecret)) return forbidden(res, 'Invalid Stripe webhook signature.');
      try {
        const event = JSON.parse(raw.toString('utf8'));
        const subscription = subscriptionFromStripeEvent(event);
        const userId = event.data?.object?.metadata?.maneflow_user_id;
        if (!userId) return json(res, 202, { ignored: true, message: 'Webhook lacks maneflow_user_id metadata.' });
        const entitlement = await upsertBillingEntitlement(store, { userId: 'stripe_webhook', service: true }, { ...subscription, userId });
        return json(res, 202, { received: true, entitlement });
      } catch (error) { return badRequest(res, error.message); }
    }

    const authResponse = await handleAuth(req, res, url);
    if (authResponse !== null || res.writableEnded) return authResponse;

    if (url.pathname === '/api/providers' && method === 'GET') {
      return json(res, 200, {
        providers: providers.status(),
        policy: 'ManeFlow ingests only official, licensed, partner-approved, or user-authorized data and never labels asking prices as completed sales.',
        recentIngests: store.state.providerIngests.slice(0, 20),
      });
    }


    if (url.pathname === '/api/embed/config' && method === 'GET') {
      const origin = String(req.headers.origin || '');
      const allowed = embedOriginAllowed(req, config);
      return json(res, allowed ? 200 : 403, {
        allowed,
        appName: config.appName,
        marketMode: marketMode(config, store.state.customSales.length),
        demoMode: config.demoMode,
        publicBaseUrl: config.publicBaseUrl,
        widgets: ['valuation', 'scan_intake', 'consignment_intake', 'shop_inventory_preview'],
        message: allowed ? 'Public widget configuration is origin-checked and public-safe.' : 'This origin is not allowed for ManeFlow embeds.',
      });
    }

    if (url.pathname === '/api/embed/scan-intake' && method === 'POST') {
      if (!embedOriginAllowed(req, config)) return forbidden(res, 'This website origin is not allowed for ManeFlow embeds.');
      try {
        const body = await readJson(req, 500_000);
        const item = await store.recordEmbedIntake({ type: 'scan_intake', origin: req.headers.origin || '', cardId: body.cardId || null, customerName: body.customerName, email: body.email, notes: body.notes, payload: { manualText: body.manualText || '', sourcePage: body.sourcePage || '' } });
        return json(res, 202, { intake: item, message: 'Scan intake received. No private Vault data was exposed.' });
      } catch (error) { return badRequest(res, error.message); }
    }

    if (url.pathname === '/api/embed/consignment-intake' && method === 'POST') {
      if (!embedOriginAllowed(req, config)) return forbidden(res, 'This website origin is not allowed for ManeFlow embeds.');
      try {
        const body = await readJson(req, 500_000);
        const item = await store.recordEmbedIntake({ type: 'consignment_intake', origin: req.headers.origin || '', cardId: body.cardId || null, customerName: body.customerName, email: body.email, notes: body.notes, payload: { phone: body.phone || '', sourcePage: body.sourcePage || '' } });
        return json(res, 202, { intake: item, message: 'Consignment intake received for owner review.' });
      } catch (error) { return badRequest(res, error.message); }
    }

    const publicValueMatch = /^\/api\/public\/cards\/([^/]+)\/value$/.exec(url.pathname);
    if (publicValueMatch && method === 'GET') {
      const slugOrId = decodeURIComponent(publicValueMatch[1]);
      const card = matchCard(slugOrId) || catalog().find((item) => publicSlugForCard(item) === slugOrId);
      if (!card) return notFound(res, 'Public card value not found');
      const imageCard = withCardImage(card);
      const market = calculateValuation(allSales().filter((sale) => sale.cardId === card.id), { card, demoMode: config.demoMode, overrides: store.compOverrides?.() || {}, includeCompDetails: true });
      return json(res, 200, {
        card: { id: card.id, slug: publicSlugForCard(card), player: card.player, year: card.year, brand: card.brand, set: card.set, cardNumber: card.cardNumber, parallel: card.parallel, grade: card.grade, sport: card.sport, image: imageCard.image, imageAlt: imageCard.imageAlt, imageMeta: imageCard.imageMeta },
        value: market.value,
        range: market.range,
        confidence: market.confidence,
        liquidityScore: market.liquidityScore,
        compQuality: market.compQuality,
        includedComps: market.compDetails?.included || [],
        marketMode: marketMode(config, store.state.customSales.length),
        disclaimer: 'Public values are estimates based only on included source-labeled comps. They are not appraisals, guarantees, authentication, or grade opinions.',
      });
    }

    if (url.pathname === '/api/market/pulse' && method === 'GET') {
      const enriched = catalog().map(enrichCard).filter((card) => card.market.value !== null);
      return json(res, 200, {
        hot: [...enriched].sort((a, b) => (b.market.liquidityScore + (b.market.trend30Pct || 0)) - (a.market.liquidityScore + (a.market.trend30Pct || 0))).slice(0, 8),
        rising: [...enriched].filter((card) => card.market.trend30Pct !== null).sort((a, b) => b.market.trend30Pct - a.market.trend30Pct).slice(0, 8),
        falling: [...enriched].filter((card) => card.market.trend30Pct !== null).sort((a, b) => a.market.trend30Pct - b.market.trend30Pct).slice(0, 8),
        marketMode: marketMode(config, store.state.customSales.length),
      });
    }

    if (url.pathname === '/api/catalog/autocomplete' && method === 'GET') {
      const input = {
        q: url.searchParams.get('q') || '',
        sport: url.searchParams.get('sport') || '',
        year: url.searchParams.get('year') || '',
        brand: url.searchParams.get('brand') || '',
        set: url.searchParams.get('set') || '',
        cardNumber: url.searchParams.get('cardNumber') || '',
        player: url.searchParams.get('player') || '',
        parallel: url.searchParams.get('parallel') || '',
        limit: url.searchParams.get('limit') || 12,
      };
      const cacheKey = `catalog:auto:${JSON.stringify(input)}:${store.state.customCards.length}`;
      const cached = cache.get(cacheKey);
      if (cached) return json(res, 200, cached);
      const payload = autocompleteWithImages(catalogAutocomplete(catalog(), input));
      cache.set(cacheKey, payload, 30_000);
      return json(res, 200, payload);
    }

    if (url.pathname === '/api/catalog/coverage' && method === 'GET') {
      return json(res, 200, {
        coverage: catalogAutocomplete(catalog(), { limit: 1 }).coverage,
        imageCoverage: imageCoverageReport({ cards: catalog(), sales: allSales(), config, overrides: store.state.cardImageOverrides || {} }),
      });
    }

    if ((url.pathname === '/api/catalog/smart-autocomplete' || url.pathname === '/api/catalog/submission-autocomplete') && method === 'GET') {
      const input = {
        q: url.searchParams.get('q') || '',
        sport: url.searchParams.get('sport') || '',
        year: url.searchParams.get('year') || '',
        brand: url.searchParams.get('brand') || '',
        set: url.searchParams.get('set') || '',
        cardNumber: url.searchParams.get('cardNumber') || '',
        player: url.searchParams.get('player') || '',
        parallel: url.searchParams.get('parallel') || '',
        limit: url.searchParams.get('limit') || 10,
      };
      const cacheKey = `catalog:${url.pathname.includes('submission') ? 'submission' : 'smart'}:${JSON.stringify(input)}:${store.state.customCards.length}`;
      const cached = cache.get(cacheKey);
      if (cached) return json(res, 200, cached);
      const payload = autocompleteWithImages(url.pathname === '/api/catalog/submission-autocomplete'
        ? submissionAutocomplete(catalog(), input)
        : smartCatalogAutocomplete(catalog(), input));
      cache.set(cacheKey, payload, 30_000);
      return json(res, 200, payload);
    }

    if (url.pathname === '/api/catalog/complete' && method === 'POST') {
      try {
        const body = await readJson(req, 100_000);
        return json(res, 200, autocompleteWithImages(completeManualEntry(catalog(), body)));
      } catch (error) { return badRequest(res, error.message); }
    }

    if (url.pathname === '/api/catalog/sets' && method === 'GET') {
      const input = {
        sport: url.searchParams.get('sport') || '',
        year: url.searchParams.get('year') || '',
        brand: url.searchParams.get('brand') || '',
        set: url.searchParams.get('set') || '',
        q: url.searchParams.get('q') || '',
      };
      const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') || 50)));
      const auto = catalogAutocomplete(catalog(), input);
      return json(res, 200, {
        version: auto.version,
        sets: buildCatalogIndex(catalog().filter((card) => {
          if (input.sport && String(card.sport || '').toLowerCase() !== String(input.sport).toLowerCase()) return false;
          if (input.year && String(card.year || '') !== String(input.year)) return false;
          if (input.brand && String(card.brand || '').toLowerCase() !== String(input.brand).toLowerCase()) return false;
          if (input.set && String(card.set || '').toLowerCase() !== String(input.set).toLowerCase()) return false;
          if (!input.q) return true;
          return [card.year, card.brand, card.set, card.sport].filter(Boolean).join(' ').toLowerCase().includes(String(input.q).toLowerCase());
        })).slice(0, limit),
        coverage: auto.coverage,
        disclaimer: auto.disclaimer,
      });
    }

    if (url.pathname === '/api/cards' && method === 'GET') {
      const query = String(url.searchParams.get('q') || '').trim();
      const sport = String(url.searchParams.get('sport') || '').trim();
      const gradeCompany = String(url.searchParams.get('grader') || '').trim();
      const year = String(url.searchParams.get('year') || '').trim();
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 25)));
      const cacheKey = `cards:${query}:${sport}:${gradeCompany}:${year}:${limit}:${store.state.customSales.length}:${store.state.customCards.length}`;
      const cached = cache.get(cacheKey);
      if (cached) return json(res, 200, cached);
      const ranked = rankCards(catalog(), query, { limit, sport, gradeCompany, year });
      const resultCards = ranked.map(enrichCard);
      const payload = { cards: resultCards, total: resultCards.length, marketMode: marketMode(config, store.state.customSales.length) };
      cache.set(cacheKey, payload, 30_000);
      return json(res, 200, payload);
    }

    const cardMatch = /^\/api\/cards\/([^/]+)$/.exec(url.pathname);
    if (cardMatch && method === 'GET') {
      const card = matchCard(decodeURIComponent(cardMatch[1]));
      if (!card) return notFound(res, 'Card not found');
      return json(res, 200, { card: enrichCard(card), marketMode: marketMode(config, store.state.customSales.length) });
    }

    const compsMatch = /^\/api\/cards\/([^/]+)\/comps$/.exec(url.pathname);
    if (compsMatch && method === 'GET') {
      const card = matchCard(decodeURIComponent(compsMatch[1]));
      if (!card) return notFound(res, 'Card not found');
      const requestedDays = parseWindow(url.searchParams.get('window') || '365d');
      const cutoff = Date.now() - requestedDays * 86_400_000;
      const visible = allSales().filter((sale) => sale.cardId === card.id && (!sale.soldAt || new Date(sale.soldAt).getTime() >= cutoff));
      const scoredSales = scoreComps(visible, { card, demoMode: config.demoMode, overrides: store.compOverrides?.() || {} });
      return json(res, 200, {
        cardId: card.id,
        message: 'ManeFlow shows why each comp was included or excluded. Values are estimates, not appraisals.',
        included: scoredSales.filter((sale) => sale.valuationUse && sale.inclusionStatus === 'included').map(publicCompSummary),
        excluded: excludedComps(scoredSales).map(publicCompSummary),
        needsReview: needsReviewComps(scoredSales).map(publicCompSummary),
      });
    }

    const marketMatch = /^\/api\/cards\/([^/]+)\/market$/.exec(url.pathname);
    if (marketMatch && method === 'GET') {
      const card = matchCard(decodeURIComponent(marketMatch[1]));
      if (!card) return notFound(res, 'Card not found');
      const requestedDays = parseWindow(url.searchParams.get('window') || '90d');
      const marketActor = actorFromRequest(req);
      const maxHistoryDays = entitlementsFor(marketActor).historyDays;
      const days = Math.min(requestedDays, maxHistoryDays);
      const cardSales = allSales().filter((sale) => sale.cardId === card.id);
      const cutoff = Date.now() - days * 86_400_000;
      const visible = cardSales.filter((sale) => new Date(sale.soldAt).getTime() >= cutoff);
      const activeResult = url.searchParams.get('active') === '1'
        ? await activeAskingListingsForCard(card, { limit: Number(url.searchParams.get('activeLimit') || 12) })
        : { listings: [], error: null };
      const valuation = calculateValuation(visible, {
        card,
        demoMode: config.demoMode,
        overrides: store.compOverrides?.() || {},
        includeCompDetails: true,
        askingListings: activeResult.listings,
      });
      return json(res, 200, {
        card: withCardImage(card), valuation,
        historyWindowDays: days, historyTruncated: days < requestedDays,
        sales: visible.sort((a, b) => new Date(b.soldAt) - new Date(a.soldAt)),
        activeListings: activeResult.listings,
        activeListingError: activeResult.error,
        marketMode: marketMode(config, store.state.customSales.length),
      });
    }

    const contextMatch = /^\/api\/cards\/([^/]+)\/context$/.exec(url.pathname);
    if (contextMatch && method === 'GET') {
      const card = matchCard(decodeURIComponent(contextMatch[1]));
      if (!card) return notFound(res, 'Card not found');
      return json(res, 200, { card: withCardImage(card), marketContext: await marketContextForCard(card) });
    }

    if (url.pathname === '/api/scan' && method === 'POST') {
      const scanRate = scanLimiter.check(`scan:${requestIp(req)}`);
      if (!scanRate.allowed) return json(res, 429, { error: 'scan_rate_limited', message: 'Scan limit reached. Try again in a minute.' });
      try {
        const actor = optionalWriteActor(req);
        if (actor) {
          const limits = entitlementsFor(actor);
          const today = new Date().toISOString().slice(0, 10);
          const scansToday = store.userSnapshot(actor.userId).scanHistory.filter((scan) => String(scan.createdAt).startsWith(today)).length;
          if (!withinLimit(scansToday, limits.scansPerDay)) return json(res, 402, { error: 'plan_limit', message: `${limits.name} plan daily scan limit reached.`, plan: limits.plan });
          const gate = usageGate(store, actor, 'scan');
          if (!gate.allowed) return json(res, 402, { error: 'usage_limit', message: `${gate.entitlements.name} plan daily scan usage limit reached.`, usage: gate });
        }
        let body = await readJson(req, config.maxRequestBytes);
        const frontDataUrl = body.frontDataUrl || body.dataUrl || '';
        const backDataUrl = body.backDataUrl || '';
        const certDataUrl = body.certDataUrl || '';
        let localOcr = null;
        if (ocrService?.enabled && (frontDataUrl || certDataUrl)) {
          try {
            localOcr = await ocrService.recognizeDataUrl(frontDataUrl || certDataUrl);
            body = {
              ...body,
              ocrText: [body.ocrText, localOcr.text].filter(Boolean).join(' '),
              localOcrFields: localOcr.fields,
              localOcrFieldConfidence: localOcr.fieldConfidence,
            };
          } catch (error) {
            localOcr = { error: error.message, code: error.code || 'OCR_FAILED', processedRemotely: false };
          }
        }
        let sceneAnalysis = null;
        let vision = null;
        let workerScan = null;
        let workerError = null;
        let vectorMatches = [];
        let vectorSearchError = null;
        if (frontDataUrl || certDataUrl) {
          try {
            workerScan = await visionWorker.scanDataUrl(frontDataUrl || certDataUrl, {
              filename: body.imageName || body.filename || 'card-scan.jpg',
            });
          } catch (error) {
            workerError = error.message;
          }
        }
        const workerEmbedding = workerScan?.visual_embedding?.vector;
        const requestedShopId = String(body.shopId || body.organizationId || '').trim();
        if (Array.isArray(workerEmbedding) && workerEmbedding.length === 1152 && requestedShopId && databaseRuntime?.findVisualMatches) {
          const access = actor ? canAccessOrganization(store.state, actor, requestedShopId, 'viewer') : { allowed: false };
          if (access.allowed) {
            try {
              vectorMatches = await databaseRuntime.findVisualMatches({
                embedding: workerEmbedding,
                shopId: requestedShopId,
                limit: Math.max(3, Math.min(25, Number(body.vectorCandidateLimit || 10))),
              });
            } catch (error) {
              vectorSearchError = error instanceof Error ? error.message : String(error);
            }
          } else {
            vectorSearchError = 'Vector search was skipped because this account cannot access the requested shop.';
          }
        }
        if (!vision && vectorMatches[0] && Number(vectorMatches[0].cosineSimilarity || 0) >= 0.70) {
          const top = vectorMatches[0];
          vision = {
            facts: {
              player: top.subjectName,
              year: top.releaseYear,
              brand: top.brand || top.manufacturer,
              set: top.setName,
              cardNumber: top.cardNumber,
              parallel: top.parallelName,
            },
            player: top.subjectName,
            year: top.releaseYear,
            brand: top.brand || top.manufacturer,
            set: top.setName,
            cardNumber: top.cardNumber,
            parallel: top.parallelName,
            fieldConfidence: {
              player: top.cosineSimilarity, year: top.cosineSimilarity, brand: top.cosineSimilarity,
              set: top.cosineSimilarity, cardNumber: top.cosineSimilarity, parallel: top.cosineSimilarity,
            },
            confidence: top.cosineSimilarity,
            provider: 'maneflow_pgvector',
            imageProcessedRemotely: false,
            warnings: top.cosineSimilarity < 0.86 ? ['Visual vector match requires OCR or checklist confirmation.'] : [],
          };
        }

        if ((frontDataUrl || certDataUrl) && config.openaiApiKey && config.openaiVisionModel) {
          sceneAnalysis = await analyzeCardScene({
            frontDataUrl: frontDataUrl || certDataUrl, backDataUrl, certDataUrl, apiKey: config.openaiApiKey, model: config.openaiVisionModel,
          });
          vision = sceneAnalysis?.primaryCard || null;
        }
        if (!vision && workerScan && Number(workerScan.identity_confidence || 0) > 0) {
          vision = workerCardToLegacyVision(workerScan);
        }
        const gradedCert = await analyzeGradedCert({ body, vision }, { state: store.state, actor });
        const scanBody = { ...body, gradedCert };
        const recognition = recognizeCardScene({
          cards: catalog(),
          body: scanBody,
          sceneAnalysis,
          vision,
          gradedCert,
          corrections: store.state.scanCorrections || [],
          enrichCard,
        });
        const primary = recognition.primary || {};
        const matches = primary.matches || [];
        const scanConfidence = primary.scanConfidence || evaluateScanConfidence({ body: scanBody, vision, result: { gradedCert }, matches });
        const result = {
          mode: primary.mode || (sceneAnalysis ? 'vision_scene_catalog_match' : 'manual_text_match'),
          query: primary.query || '',
          exact: Boolean(primary.exact && !scanConfidence.needsManualConfirmation),
          needsConfirmation: scanConfidence.needsManualConfirmation,
          message: recognition.message,
          matches,
        };
        const marketContext = matches[0] ? await marketContextForCard(matches[0]) : { available: false, provider: null, reason: 'no_match' };
        let scan = null;
        let scanSession = null;
        if (actor) {
          scan = await store.recordScan(actor.userId, {
            mode: result.mode, query: result.query, matchIds: matches.map((card) => card.id),
            imageProcessedRemotely: Boolean(sceneAnalysis), frontBack: Boolean(backDataUrl), warnings: [...(vision?.warnings || []), ...scanConfidence.warnings],
          });
          await recordUsage(store, actor, 'scan', 1, { mode: result.mode, remoteVision: Boolean(sceneAnalysis), confidence: scanConfidence.scanConfidenceScore, detectedCards: recognition.summary.detectedCards });
          scanSession = await createScanSession(store, actor, { body: scanBody, vision, result: { ...result, gradedCert }, matches, recognition }, { cards: catalog() });
          await recordUsage(store, actor, 'scan_session', 1, { scanSessionId: scanSession.id, needsManualConfirmation: scanConfidence.needsManualConfirmation });
        }
        return json(res, 200, {
          ...result, matches, recognition, vision, sceneAnalysis, workerScan, workerError, vectorMatches, vectorSearchError, localOcr, gradedCert, scanConfidence, marketContext, scanId: scan?.id || null, scanSessionId: scanSession?.id || null,
          imageProcessedRemotely: Boolean(sceneAnalysis || workerScan?.image_processed_remotely), visionWorkerUsed: Boolean(workerScan), marketMode: marketMode(config, store.state.customSales.length),
          message: scanConfidence.needsManualConfirmation ? scanConfidence.recommendedNextStep : (sceneAnalysis ? 'Scene imagery was analyzed, then each detected region was matched against the ManeFlow catalog. Confirm condition before transacting.' : result.message),
        });
      } catch (error) {
        return badRequest(res, error.message);
      }
    }

    if (url.pathname === '/api/cert/extract' && method === 'POST') {
      const scanRate = scanLimiter.check(`cert:${requestIp(req)}`);
      if (!scanRate.allowed) return json(res, 429, { error: 'cert_rate_limited', message: 'Cert extraction limit reached. Try again in a minute.' });
      try {
        const actor = optionalWriteActor(req);
        let body = await readJson(req, config.maxRequestBytes);
        const certDataUrl = body.certDataUrl || body.frontDataUrl || body.dataUrl || '';
        let localOcr = null;
        if (ocrService?.enabled && certDataUrl) {
          try {
            localOcr = await ocrService.recognizeDataUrl(certDataUrl);
            body = {
              ...body,
              ocrText: [body.ocrText, localOcr.text].filter(Boolean).join(' '),
              localOcrFields: localOcr.fields,
              localOcrFieldConfidence: localOcr.fieldConfidence,
            };
          } catch (error) {
            localOcr = { error: error.message, code: error.code || 'OCR_FAILED', processedRemotely: false };
          }
        }
        let vision = body.vision || null;
        if (!vision && certDataUrl && config.openaiApiKey && config.openaiVisionModel) {
          vision = await analyzeCardImages({ frontDataUrl: certDataUrl, certDataUrl, apiKey: config.openaiApiKey, model: config.openaiVisionModel });
        }
        const gradedCert = await analyzeGradedCert({ body: { ...body, certDataUrl }, vision }, { state: store.state, actor });
        const result = identifyCard({
          cards: catalog(),
          imageName: body.imageName || 'cert-label',
          manualText: [body.manualText, body.certText, body.barcodeText, body.qrText].filter(Boolean).join(' '),
          ocrText: body.ocrText,
          vision,
          gradedCert,
        });
        const matches = result.matches.map(enrichCard);
        const scanConfidence = evaluateScanConfidence({ body: { ...body, certDataUrl, gradedCert }, vision, result: { ...result, gradedCert }, matches });
        if (actor) await recordUsage(store, actor, 'scan', 1, { mode: 'cert_extract', confidence: gradedCert.certConfidence || 0 });
        return json(res, 200, {
          gradedCert,
          localOcr,
          scanConfidence,
          matches,
          exact: result.exact,
          marketMode: marketMode(config, store.state.customSales.length),
          message: gradedCert.slabbed
            ? 'Cert evidence extracted. Confirm the official cert page and card match before using value.'
            : 'No graded cert was confidently detected. Capture the slab label closer or enter the cert number manually.',
        });
      } catch (error) {
        return badRequest(res, error.message);
      }
    }


    if (url.pathname === '/api/vision/status' && method === 'GET') {
      try {
        const [health, readiness] = await Promise.all([visionWorker.health(), visionWorker.readiness()]);
        return json(res, 200, { connected: true, health, readiness });
      } catch (error) {
        return json(res, 503, { connected: false, error: error.message });
      }
    }

    if (url.pathname === '/api/vision/lot-analyze' && method === 'POST') {
      const scanRate = scanLimiter.check(`lot:${requestIp(req)}`);
      if (!scanRate.allowed) return json(res, 429, { error: 'lot_rate_limited', message: 'Lot analysis limit reached. Try again in a minute.' });
      try {
        const body = await readJson(req, config.maxRequestBytes * 4);
        const result = await visionWorker.analyzeLotDataUrls({
          images: body.images,
          listingPrice: body.listingPrice,
          inboundShipping: body.inboundShipping,
          salesTax: body.salesTax,
          sourceType: body.sourceType,
          sourceUrl: body.sourceUrl,
          marketplaceFeeRate: body.marketplaceFeeRate,
          paymentFeeFixed: body.paymentFeeFixed,
          outboundShippingPerItem: body.outboundShippingPerItem,
          targetRoi: body.targetRoi,
        });
        return json(res, 200, result);
      } catch (error) {
        return badRequest(res, error.message);
      }
    }

    if (url.pathname === '/api/vision/lot-analyze-ebay' && method === 'POST') {
      const scanRate = scanLimiter.check(`lot-ebay:${requestIp(req)}`);
      if (!scanRate.allowed) return json(res, 429, { error: 'lot_rate_limited', message: 'Lot analysis limit reached. Try again in a minute.' });
      try {
        const body = await readJson(req, 250_000);
        const result = await visionWorker.analyzeEbayListing({
          sourceUrl: body.sourceUrl,
          listingPriceOverride: body.listingPriceOverride,
          inboundShippingOverride: body.inboundShippingOverride,
          salesTax: body.salesTax,
          marketplaceFeeRate: body.marketplaceFeeRate,
          paymentFeeFixed: body.paymentFeeFixed,
          outboundShippingPerItem: body.outboundShippingPerItem,
          targetRoi: body.targetRoi,
        });
        return json(res, 200, result);
      } catch (error) {
        return badRequest(res, error.message);
      }
    }

    const lotJob = /^\/api\/vision\/lots\/([^/]+)$/.exec(url.pathname);
    if (lotJob && method === 'GET') {
      try { return json(res, 200, await visionWorker.getLot(decodeURIComponent(lotJob[1]))); }
      catch (error) { return badRequest(res, error.message); }
    }

    const lotCorrection = /^\/api\/vision\/lots\/([^/]+)\/correct$/.exec(url.pathname);
    if (lotCorrection && method === 'POST') {
      try { return json(res, 200, await visionWorker.correctLotItem(decodeURIComponent(lotCorrection[1]), await readJson(req, 250_000))); }
      catch (error) { return badRequest(res, error.message); }
    }

    if (url.pathname === '/api/bulk-intake/contributors' && method === 'GET') {
      try { return json(res, 200, { contributors: await visionWorker.getContributors() }); }
      catch (error) { return json(res, 503, { error: 'vision_worker_unavailable', message: error.message }); }
    }

    if (url.pathname === '/api/bulk-intake/contributors' && method === 'POST') {
      try { return json(res, 200, { contributor: await visionWorker.saveContributor(await readJson(req, 100_000)) }); }
      catch (error) { return badRequest(res, error.message); }
    }

    const contributorRevoke = /^\/api\/bulk-intake\/contributors\/([^/]+)\/revoke$/.exec(url.pathname);
    if (contributorRevoke && method === 'POST') {
      try { return json(res, 200, { contributor: await visionWorker.revokeContributor(decodeURIComponent(contributorRevoke[1])) }); }
      catch (error) { return badRequest(res, error.message); }
    }

    if (url.pathname === '/api/bulk-intake/ricoh/import-folder' && method === 'POST') {
      try {
        const batch = await visionWorker.importRicohFolder(await readJson(req, 500_000));
        return json(res, 200, { batch });
      } catch (error) { return badRequest(res, error.message); }
    }

    if (url.pathname === '/api/bulk-intake/photos/import-folder' && method === 'POST') {
      try {
        const batch = await visionWorker.importPhotoFolder(await readJson(req, 500_000));
        return json(res, 200, { batch });
      } catch (error) { return badRequest(res, error.message); }
    }

    if (url.pathname === '/api/bulk-intake/batches' && method === 'GET') {
      try { return json(res, 200, { batches: await visionWorker.listBatches(Number(url.searchParams.get('limit') || 100)) }); }
      catch (error) { return json(res, 503, { error: 'vision_worker_unavailable', message: error.message }); }
    }

    const bulkBatch = /^\/api\/bulk-intake\/batches\/([^/]+)$/.exec(url.pathname);
    if (bulkBatch && method === 'GET') {
      try { return json(res, 200, { batch: await visionWorker.getBatch(decodeURIComponent(bulkBatch[1])) }); }
      catch (error) { return badRequest(res, error.message); }
    }

    const bulkBatchProcess = /^\/api\/bulk-intake\/batches\/([^/]+)\/process$/.exec(url.pathname);
    if (bulkBatchProcess && method === 'POST') {
      try {
        const body = await readJson(req, 100_000).catch(() => ({}));
        return json(res, 200, { batch: await visionWorker.processBatch(decodeURIComponent(bulkBatchProcess[1]), body.limit || null) });
      } catch (error) { return badRequest(res, error.message); }
    }

    const bulkItemReview = /^\/api\/bulk-intake\/items\/([^/]+)\/review$/.exec(url.pathname);
    if (bulkItemReview && method === 'POST') {
      try { return json(res, 200, { item: await visionWorker.reviewItem(decodeURIComponent(bulkItemReview[1]), await readJson(req, 250_000)) }); }
      catch (error) { return badRequest(res, error.message); }
    }

    if (url.pathname === '/api/contributions/stats' && method === 'GET') {
      try { return json(res, 200, await visionWorker.contributionStats()); }
      catch (error) { return json(res, 503, { error: 'vision_worker_unavailable', message: error.message }); }
    }

    if (url.pathname === '/api/contributions/dataset-manifest' && method === 'GET') {
      try { return json(res, 200, await visionWorker.contributionDatasetManifest()); }
      catch (error) { return json(res, 503, { error: 'vision_worker_unavailable', message: error.message }); }
    }

    if (url.pathname === '/api/contributions/examples' && method === 'GET') {
      try {
        const examples = await visionWorker.listContributionExamples({
          limit: Number(url.searchParams.get('limit') || 200),
          curationStatus: url.searchParams.get('curation_status') || null,
        });
        return json(res, 200, { examples });
      } catch (error) {
        return json(res, 503, { error: 'vision_worker_unavailable', message: error.message });
      }
    }

    const contributionCuration = /^\/api\/contributions\/examples\/([^/]+)\/curate$/.exec(url.pathname);
    if (contributionCuration && method === 'POST') {
      try {
        const example = await visionWorker.curateContributionExample(
          decodeURIComponent(contributionCuration[1]),
          await readJson(req, 100_000),
        );
        return json(res, 200, { example });
      } catch (error) { return badRequest(res, error.message); }
    }

    if (url.pathname === '/api/dashboard' && method === 'GET') {
      const actor = personalActor(req, res);
      if (!actor) return;
      return json(res, 200, { ...(await dashboardFor(actor.userId)), marketMode: marketMode(config, store.state.customSales.length), user: sanitizeUser(actor.user), entitlements: entitlementsFor(actor) });
    }

    if (url.pathname === '/api/alerts' && method === 'GET') {
      const actor = personalActor(req, res);
      if (!actor) return;
      const alerts = store.userSnapshot(actor.userId).alerts || [];
      return json(res, 200, { alerts: alerts.filter((alert) => !alert.resolvedAt), unread: alerts.filter((alert) => !alert.resolvedAt && !alert.readAt).length });
    }

    const alertItem = /^\/api\/alerts\/([^/]+)$/.exec(url.pathname);
    if (alertItem && method === 'PATCH') {
      const actor = personalActor(req, res, { write: true });
      if (!actor) return;
      try {
        const alert = await store.markAlert(actor.userId, decodeURIComponent(alertItem[1]), await readJson(req));
        return alert ? json(res, 200, { alert }) : notFound(res, 'Alert not found');
      } catch (error) { return badRequest(res, error.message); }
    }

    if (url.pathname === '/api/scans' && method === 'GET') {
      const actor = personalActor(req, res);
      if (!actor) return;
      return json(res, 200, { scans: store.userSnapshot(actor.userId).scanHistory });
    }


    const scanSessionConfirm = /^\/api\/scan-sessions\/([^/]+)\/confirm$/.exec(url.pathname);
    if (scanSessionConfirm && method === 'POST') {
      const actor = personalActor(req, res, { write: true });
      if (!actor) return;
      try {
        const session = await confirmScanSession(store, actor, decodeURIComponent(scanSessionConfirm[1]), await readJson(req, 100_000));
        return session ? json(res, 200, { session }) : notFound(res, 'Scan session not found');
      } catch (error) { return badRequest(res, error.message); }
    }

    if (url.pathname === '/api/scan-sessions' && method === 'GET') {
      const actor = personalActor(req, res);
      if (!actor) return;
      return json(res, 200, { sessions: (store.state.scanSessions || []).filter((session) => session.userId === actor.userId).slice(0, 100) });
    }

    if (url.pathname === '/api/collection' && method === 'GET') {
      const actor = personalActor(req, res);
      if (!actor) return;
      return json(res, 200, { collection: (await dashboardFor(actor.userId)).collection });
    }

    if (url.pathname === '/api/collection' && method === 'POST') {
      const actor = personalActor(req, res, { write: true });
      if (!actor) return;
      try {
        const limits = entitlementsFor(actor);
        const body = await readJson(req);
        if (!body.cardId && !body.name) return badRequest(res, 'cardId or name is required');
        if (body.cardId && !matchCard(body.cardId)) return badRequest(res, 'Unknown cardId');
        const holdings = store.userSnapshot(actor.userId).collection.length;
        const mergeTarget = store.findMergeableCollectionItem(actor.userId, body);
        if (!mergeTarget && !withinLimit(holdings, limits.vaultItems)) return json(res, 402, { error: 'plan_limit', message: `${limits.name} plan Vault limit reached.`, plan: limits.plan });
        const item = await store.addCollectionItem(actor.userId, body);
        cache.clear();
        return json(res, item.merged ? 200 : 201, { item, merged: Boolean(item.merged), message: item.merged ? 'Existing collection row quantity updated.' : 'Collection row created.' });
      } catch (error) { return badRequest(res, error.message); }
    }

    const collectionItem = /^\/api\/collection\/([^/]+)$/.exec(url.pathname);
    if (collectionItem && method === 'PATCH') {
      const actor = personalActor(req, res, { write: true });
      if (!actor) return;
      try {
        const body = await readJson(req);
        if (body.cardId && !matchCard(body.cardId)) return badRequest(res, 'Unknown cardId');
        const item = await store.updateCollectionItem(actor.userId, decodeURIComponent(collectionItem[1]), body);
        cache.clear();
        return item ? json(res, 200, { item }) : notFound(res);
      } catch (error) { return badRequest(res, error.message); }
    }
    if (collectionItem && method === 'DELETE') {
      const actor = personalActor(req, res, { write: true });
      if (!actor) return;
      const removed = await store.removeCollectionItem(actor.userId, decodeURIComponent(collectionItem[1]));
      cache.clear();
      return removed ? json(res, 200, { removed: true }) : notFound(res);
    }

    if (url.pathname === '/api/collection/export.csv' && method === 'GET') {
      const actor = personalActor(req, res);
      if (!actor) return;
      const collection = (await dashboardFor(actor.userId)).collection;
      const headers = ['id', 'cardId', 'name', 'quantity', 'purchasePrice', 'purchaseDate', 'currentUnitValue', 'currentValue', 'gain', 'status', 'location', 'certNumber', 'notes'];
      const rows = collection.map((item) => ({
        id: item.id, cardId: item.cardId || '', name: item.name || item.card?.player || '', quantity: item.quantity,
        purchasePrice: item.purchasePrice, purchaseDate: item.purchaseDate || '', currentUnitValue: item.market?.value || '',
        currentValue: item.currentValue, gain: item.gain, status: item.status, location: item.location, certNumber: item.certNumber, notes: item.notes,
      }));
      return text(res, 200, toCsv(headers, rows), 'text/csv; charset=utf-8', { 'content-disposition': 'attachment; filename="maneflow-collection.csv"' });
    }


    if (url.pathname === '/api/portfolio/intelligence' && method === 'GET') {
      const actor = personalActor(req, res);
      if (!actor) return;
      const intelligence = (await dashboardFor(actor.userId)).intelligence;
      return json(res, 200, { intelligence, privacy: 'private_user_vault' });
    }

    if (url.pathname === '/api/portfolio/scenario' && method === 'POST') {
      const actor = personalActor(req, res, { write: true });
      if (!actor) return;
      try {
        const body = await readJson(req, 200_000);
        const dashboard = await dashboardFor(actor.userId);
        const result = runScenarioAnalysis(dashboard.collection, body.scenario || body, {
          cards: catalog(), sales: allSales(), demoMode: config.demoMode, overrides: store.compOverrides?.() || {},
        });
        return json(res, 200, { scenario: result, privacy: 'private_user_vault' });
      } catch (error) { return badRequest(res, error.message); }
    }

    if (url.pathname === '/api/portfolio/tax-report.csv' && method === 'GET') {
      const actor = personalActor(req, res);
      if (!actor) return;
      const dashboard = await dashboardFor(actor.userId);
      const tax = generateTaxEstimate(dashboard.collection, { cards: catalog(), sales: allSales(), demoMode: config.demoMode, overrides: store.compOverrides?.() || {} });
      await store.recordTaxReport?.(actor.userId, { taxYear: tax.taxYear, realizedTaxEstimate: tax.realizedTaxEstimate, ifLiquidatedTaxEstimate: tax.ifLiquidatedTaxEstimate });
      const headers = ['taxYear', 'costBasis', 'realizedShortTermGain', 'realizedLongTermGain', 'unrealizedShortTermGain', 'unrealizedLongTermGain', 'realizedTaxEstimate', 'ifLiquidatedTaxEstimate', 'disclaimer'];
      return text(res, 200, toCsv(headers, [tax]), 'text/csv; charset=utf-8', { 'content-disposition': 'attachment; filename="maneflow-tax-summary.csv"' });
    }

    if (url.pathname === '/api/portfolio/inventory-report.csv' && method === 'GET') {
      const actor = personalActor(req, res);
      if (!actor) return;
      const entitlements = entitlementsFor(actor);
      if (!entitlements.merchantTools && actor.role !== 'admin') return forbidden(res, 'Inventory Intelligence requires a Merchant or Enterprise plan.');
      const dashboard = await dashboardFor(actor.userId);
      const inventory = getInventoryHealth(dashboard.collection, { cards: catalog(), sales: allSales(), demoMode: config.demoMode, overrides: store.compOverrides?.() || {} });
      await store.recordInventoryReport?.(actor.userId, { inventoryValue: inventory.inventoryValue, itemCount: inventory.itemCount, lowStockAlerts: inventory.lowStockAlerts.length });
      const headers = ['cardId', 'label', 'quantity', 'value', 'monthlyVelocity', 'daysOfSupply', 'suggestedReorderPoint'];
      const rows = inventory.reorderPoints.map((item) => ({ ...item, quantity: item.currentQuantity, value: '' }));
      return text(res, 200, toCsv(headers, rows), 'text/csv; charset=utf-8', { 'content-disposition': 'attachment; filename="maneflow-inventory-health.csv"' });
    }

    if (url.pathname === '/api/watchlist' && method === 'POST') {
      const actor = personalActor(req, res, { write: true });
      if (!actor) return;
      try {
        const body = await readJson(req);
        if (!body.cardId || !matchCard(body.cardId)) return badRequest(res, 'Valid cardId is required');
        return json(res, 201, { watch: await store.addWatch(actor.userId, body) });
      } catch (error) { return badRequest(res, error.message); }
    }

    const watchItem = /^\/api\/watchlist\/([^/]+)$/.exec(url.pathname);
    if (watchItem && method === 'PATCH') {
      const actor = personalActor(req, res, { write: true });
      if (!actor) return;
      try {
        const watch = await store.updateWatch(actor.userId, decodeURIComponent(watchItem[1]), await readJson(req));
        return watch ? json(res, 200, { watch }) : notFound(res);
      } catch (error) { return badRequest(res, error.message); }
    }
    if (watchItem && method === 'DELETE') {
      const actor = personalActor(req, res, { write: true });
      if (!actor) return;
      const removed = await store.removeWatch(actor.userId, decodeURIComponent(watchItem[1]));
      return removed ? json(res, 200, { removed: true }) : notFound(res);
    }

    if (url.pathname === '/api/import/collection-csv' && method === 'POST') {
      const actor = personalActor(req, res, { write: true });
      if (!actor) return;
      try {
        const body = await readJson(req, 8_000_000);
        const rows = parseCsv(body.csv || '');
        const errors = [];
        const review = [];
        const limits = entitlementsFor(actor);
        const existingHoldings = store.userSnapshot(actor.userId).collection.length;
        let imported = 0;
        for (const row of rows) {
          if (!withinLimit(existingHoldings + imported, limits.vaultItems)) {
            errors.push({ row: row.__row, error: `${limits.name} plan Vault limit reached.` });
            continue;
          }
          let card = row.cardId ? matchCard(row.cardId) : null;
          if (!card && !row.cardId) {
            const matching = smartMatchCard(catalog(), row);
            if (matching.accepted) card = matching.best;
            else if (matching.best) review.push({ row: row.__row, query: matching.query, matches: matching.matches });
          }
          if (row.cardId && !card) {
            errors.push({ row: row.__row, error: `Unknown cardId: ${row.cardId}` });
            continue;
          }
          await store.addCollectionItem(actor.userId, {
            cardId: card?.id || null, name: row.name || row.player || card?.player || '',
            quantity: row.quantity || 1, purchasePrice: row.purchasePrice || 0,
            purchaseDate: row.purchaseDate || null, notes: row.notes || '',
            acquiredFrom: row.acquiredFrom || '', location: row.location || '', certNumber: row.certNumber || '', status: row.status || 'owned',
          });
          imported += 1;
        }
        const summary = await store.recordImport(actor.userId, { type: 'collection_csv', imported, errors: errors.length, review: review.length, rows: rows.length });
        cache.clear();
        return json(res, 200, { summary, errors, review });
      } catch (error) { return badRequest(res, error.message); }
    }

    if (url.pathname === '/api/import/catalog-csv' && method === 'POST') {
      const actor = personalActor(req, res, { write: true });
      if (!actor) return;
      try {
        const body = await readJson(req, 10_000_000);
        const format = String(body.format || body.catalogFormat || 'sports-checklist-csv').toLowerCase();
        let importedCatalog;
        if (format.includes('pokemon') || format.includes('scryfall') || format.includes('lorcast') || format.includes('lorcana') || format.includes('tcg')) {
          importedCatalog = importTcgCatalog(body.json || body.data || body.csv || '', { format, sourceName: body.sourceName || body.provider || 'authorized_tcg_catalog' });
        } else if (format.includes('json')) {
          importedCatalog = importSportsChecklistJson(body.json || body.data || [], { sourceName: body.sourceName || body.provider || 'authorized_sports_checklist' });
        } else {
          importedCatalog = importSportsChecklistCsv(body.csv || '', { sourceName: body.sourceName || body.provider || 'authorized_sports_checklist' });
        }
        const result = await store.addCustomCards(importedCatalog.cards);
        const summary = await store.recordImport(actor.userId, { type: 'catalog_csv', format, imported: importedCatalog.cards.length, errors: importedCatalog.errors.length, rows: importedCatalog.summary.parsed });
        cache.clear();
        return json(res, 200, { summary, result, errors: importedCatalog.errors, catalog: importedCatalog.summary, coverage: catalogAutocomplete(catalog(), { limit: 1 }).coverage });
      } catch (error) { return badRequest(res, error.message); }
    }

    if (url.pathname === '/api/import/sales-csv' && method === 'POST') {
      const actor = personalActor(req, res, { write: true });
      if (!actor) return;
      try {
        const body = await readJson(req, 12_000_000);
        const rows = parseCsv(body.csv || '');
        const source = {
          provider: body.provider || rows[0]?.provider || 'User CSV import',
          sourceMode: body.sourceMode || rows[0]?.sourceMode || 'production',
          authorizationBasis: body.authorizationBasis || rows[0]?.authorizationBasis || 'user_csv',
          dataRightsStatus: body.dataRightsStatus || 'user_authorized_upload',
          rightsNotes: body.rightsNotes || 'User uploaded CSV. Values remain source-labeled and comp-scored before valuation use.',
        };
        const ingest = await ingestPricingData({ rows, cards: catalog(), store, source, actor, config });
        const summary = await store.recordImport(actor.userId, { type: 'sales_csv', imported: ingest.result.added || 0, updated: ingest.result.updated || 0, skipped: ingest.result.skipped || 0, errors: ingest.errors.length, review: ingest.review.length, rows: rows.length, valuationEligible: ingest.summary.valuationEligible });
        cache.clear();
        await dashboardFor(actor.userId);
        return json(res, 200, { summary, errors: ingest.errors, review: ingest.review, rejected: ingest.rejected, compQuality: ingest.summary.compQuality, providerIngest: ingest.ingest });
      } catch (error) { return badRequest(res, error.message); }
    }

    if (url.pathname === '/api/pricing-data/template.csv' && method === 'GET') {
      return text(res, 200, buildPricingImportTemplate(), 'text/csv; charset=utf-8', { 'content-disposition': 'attachment; filename="maneflow-pricing-import-template.csv"' });
    }

    if (url.pathname === '/api/pricing-data/validate' && method === 'POST') {
      const actor = personalActor(req, res, { write: true });
      if (!actor) return;
      try {
        const body = await readJson(req, 12_000_000);
        const rows = body.rows || parseCsv(body.csv || '');
        const validation = validatePricingRows(rows, { source: body.source || { provider: body.provider || 'User pricing data', authorizationBasis: body.authorizationBasis || 'user_csv', sourceMode: body.sourceMode || 'production' }, cards: catalog() });
        return json(res, 200, { summary: validation.summary, errors: validation.errors, warnings: validation.warnings, review: validation.review, rejected: validation.rejected, compQuality: validation.summary.compQuality });
      } catch (error) { return badRequest(res, error.message); }
    }

    if (url.pathname === '/api/pricing-data/report' && method === 'GET') {
      const actor = personalActor(req, res);
      if (!actor) return;
      const report = summarizePricingData({ sales: allSales(), cards: catalog(), providers: providers.status(), config, overrides: store.compOverrides?.() || {} });
      return json(res, 200, { report, mode: marketMode(config, store.state.customSales.length), message: 'Pricing data is source-labeled and valuation uses only included comps.' });
    }

    if (url.pathname === '/api/admin/data-sources' && method === 'GET') {
      const actor = adminActor(req, res);
      if (!actor) return;
      return json(res, 200, { sources: listSourcePolicies(store.state), acquisition: summarizeAcquisition(store.state) });
    }

    if (url.pathname === '/api/admin/data-sources' && method === 'POST') {
      const actor = adminActor(req, res);
      if (!actor) return;
      try {
        const source = await upsertSourcePolicy(store, actor, await readJson(req, 200_000));
        return json(res, 200, { source });
      } catch (error) { return badRequest(res, error.message); }
    }

    if (url.pathname === '/api/admin/acquisition/authorize' && method === 'POST') {
      const actor = adminActor(req, res);
      if (!actor) return;
      try {
        const body = await readJson(req, 200_000);
        const decision = authorizeAcquisition(store.state, body.provider || body.source, { ...body, actor, history: store.state.acquisitionRuns || [] });
        const run = await recordAcquisitionRun(store, decision, { actor, targetUrl: body.url || body.targetUrl, purpose: body.purpose || 'admin_authorization_check', dryRun: body.dryRun !== false });
        return json(res, decision.allowed ? 200 : 409, { decision, run });
      } catch (error) { return badRequest(res, error.message); }
    }

    if (url.pathname === '/api/admin/evidence/parse' && method === 'POST') {
      const actor = adminActor(req, res);
      if (!actor) return;
      try {
        return json(res, 200, { evidence: parseEvidenceText(await readJson(req, config.maxRequestBytes)), message: 'Parsed evidence is review-only until captured and approved.' });
      } catch (error) { return badRequest(res, error.message); }
    }

    if (url.pathname === '/api/admin/manual-comps' && method === 'GET') {
      const actor = adminActor(req, res);
      if (!actor) return;
      return json(res, 200, { manualComps: listManualComps(store, { reviewStatus: url.searchParams.get('status') || '' }) });
    }

    if (url.pathname === '/api/admin/manual-comps' && method === 'POST') {
      const actor = adminActor(req, res);
      if (!actor) return;
      try {
        const comp = await captureManualComp(store, actor, await readJson(req, config.maxRequestBytes));
        return json(res, 201, { comp, message: 'Manual comp captured as needs_review. It cannot affect valuation until approved and promoted.' });
      } catch (error) { return badRequest(res, error.message); }
    }

    const manualCompReview = /^\/api\/admin\/manual-comps\/([^/]+)\/review$/.exec(url.pathname);
    if (manualCompReview && method === 'POST') {
      const actor = adminActor(req, res);
      if (!actor) return;
      try {
        const comp = await reviewManualComp(store, actor, decodeURIComponent(manualCompReview[1]), await readJson(req, 200_000));
        return comp ? json(res, 200, { comp }) : notFound(res, 'Manual comp not found');
      } catch (error) { return json(res, error.status || 400, { error: 'manual_comp_review_error', message: error.message }); }
    }

    const manualCompPromote = /^\/api\/admin\/manual-comps\/([^/]+)\/promote$/.exec(url.pathname);
    if (manualCompPromote && method === 'POST') {
      const actor = adminActor(req, res);
      if (!actor) return;
      try {
        const comp = (store.state.manualComps || []).find((item) => item.id === decodeURIComponent(manualCompPromote[1]));
        if (!comp) return notFound(res, 'Manual comp not found');
        if (comp.reviewStatus !== 'approved' || !comp.valuationUse) return json(res, 409, { error: 'not_valuation_ready', message: 'Manual comp must be approved with valuationUse=true before promotion.' });
        const row = manualCompToPricingRow(comp);
        const body = await readJson(req, 200_000);
        const ingest = await ingestPricingData({
          rows: [{ ...row, ...(body.rowOverrides || {}) }],
          cards: catalog(),
          store,
          source: {
            provider: comp.provider || 'Manual Comp Evidence',
            sourceMode: 'production',
            authorizationBasis: 'user_authorized_export',
            dataRightsStatus: 'manual_evidence_admin_approved',
            rightsNotes: comp.rightsNotes || 'Admin-approved manual evidence. Original source rights are tracked in the manual comp record.',
          },
          actor,
          config,
          dryRun: body.dryRun === true,
        });
        if (!body.dryRun) await store.reviewComp(row.id, { decision: 'approved', notes: 'Promoted from admin-approved manual evidence.', adminUserId: actor.userId });
        cache.clear();
        return json(res, 202, { ingest: ingest.ingest, summary: ingest.summary, errors: ingest.errors, review: ingest.review, rejected: ingest.rejected });
      } catch (error) { return badRequest(res, error.message); }
    }


    if (url.pathname === '/api/organizations' && method === 'GET') {
      const actor = personalActor(req, res);
      if (!actor) return;
      return json(res, 200, { organizations: listOrganizationsForActor(store, actor) });
    }

    if (url.pathname === '/api/organizations' && method === 'POST') {
      const actor = personalActor(req, res, { write: true });
      if (!actor) return;
      const limits = entitlementsFor(actor);
      if (!limits.merchantTools) return forbidden(res, 'Shop organizations require a Merchant or Enterprise plan.');
      try { return json(res, 201, await createOrganization(store, actor, await readJson(req, 200_000))); }
      catch (error) { return json(res, error.status || 400, { error: 'organization_error', message: error.message }); }
    }

    const orgInvite = /^\/api\/organizations\/([^/]+)\/invites$/.exec(url.pathname);
    if (orgInvite && method === 'POST') {
      const actor = personalActor(req, res, { write: true });
      if (!actor) return;
      try { return json(res, 201, { invite: await createOrganizationInvite(store, actor, decodeURIComponent(orgInvite[1]), await readJson(req, 200_000)) }); }
      catch (error) { return json(res, error.status || 400, { error: 'invite_error', message: error.message }); }
    }

    const acceptInvite = /^\/api\/organizations\/invites\/([^/]+)\/accept$/.exec(url.pathname);
    if (acceptInvite && method === 'POST') {
      const actor = personalActor(req, res, { write: true });
      if (!actor) return;
      try { return json(res, 200, { membership: await acceptOrganizationInvite(store, actor, decodeURIComponent(acceptInvite[1])) }); }
      catch (error) { return json(res, error.status || 400, { error: 'invite_error', message: error.message }); }
    }

    const revokeInvite = /^\/api\/organizations\/([^/]+)\/invites\/([^/]+)$/.exec(url.pathname);
    if (revokeInvite && method === 'DELETE') {
      const actor = personalActor(req, res, { write: true });
      if (!actor) return;
      try {
        const invite = await revokeOrganizationInvite(store, actor, decodeURIComponent(revokeInvite[1]), decodeURIComponent(revokeInvite[2]));
        return invite ? json(res, 200, { invite }) : notFound(res, 'Invite not found');
      } catch (error) { return json(res, error.status || 400, { error: 'invite_error', message: error.message }); }
    }

    const orgProfile = /^\/api\/organizations\/([^/]+)\/profile$/.exec(url.pathname);
    if (orgProfile && method === 'PATCH') {
      const actor = personalActor(req, res, { write: true });
      if (!actor) return;
      try { return json(res, 200, { organization: await updateOrganizationProfile(store, actor, decodeURIComponent(orgProfile[1]), await readJson(req, 200_000)) }); }
      catch (error) { return json(res, error.status || 400, { error: 'organization_error', message: error.message }); }
    }

    const orgDeactivate = /^\/api\/organizations\/([^/]+)\/deactivation$/.exec(url.pathname);
    if (orgDeactivate && method === 'POST') {
      const actor = personalActor(req, res, { write: true });
      if (!actor) return;
      try { return json(res, 200, { organization: await deactivateOrganization(store, actor, decodeURIComponent(orgDeactivate[1]), await readJson(req, 100_000)) }); }
      catch (error) { return json(res, error.status || 400, { error: 'organization_error', message: error.message }); }
    }

    const orgMember = /^\/api\/organizations\/([^/]+)\/members\/([^/]+)$/.exec(url.pathname);
    if (orgMember && method === 'PATCH') {
      const actor = personalActor(req, res, { write: true });
      if (!actor) return;
      try {
        const body = await readJson(req, 100_000);
        const membership = await updateOrganizationMemberRole(store, actor, decodeURIComponent(orgMember[1]), decodeURIComponent(orgMember[2]), body.role);
        return membership ? json(res, 200, { membership }) : notFound(res, 'Membership not found');
      } catch (error) { return json(res, error.status || 400, { error: 'organization_error', message: error.message }); }
    }
    if (orgMember && method === 'DELETE') {
      const actor = personalActor(req, res, { write: true });
      if (!actor) return;
      try {
        const membership = await removeOrganizationMember(store, actor, decodeURIComponent(orgMember[1]), decodeURIComponent(orgMember[2]));
        return membership ? json(res, 200, { membership }) : notFound(res, 'Membership not found');
      } catch (error) { return json(res, error.status || 400, { error: 'organization_error', message: error.message }); }
    }

    const orgMatch = /^\/api\/organizations\/([^/]+)$/.exec(url.pathname);
    if (orgMatch && method === 'GET') {
      const actor = personalActor(req, res);
      if (!actor) return;
      const org = getOrganizationForActor(store, actor, decodeURIComponent(orgMatch[1]), 'viewer');
      return org ? json(res, 200, org) : forbidden(res, 'You do not have access to this shop.');
    }

    const shopDashMatch = /^\/api\/organizations\/([^/]+)\/dashboard$/.exec(url.pathname);
    if (shopDashMatch && method === 'GET') {
      const actor = personalActor(req, res);
      if (!actor) return;
      try { return json(res, 200, { dashboard: shopDashboard(store, actor, decodeURIComponent(shopDashMatch[1]), { cards: catalog(), sales: allSales(), demoMode: config.demoMode, overrides: store.compOverrides?.() || {} }), marketMode: marketMode(config, store.state.customSales.length) }); }
      catch (error) { return json(res, error.status || 400, { error: 'shop_dashboard_error', message: error.message }); }
    }

    const shopInventoryMatch = /^\/api\/organizations\/([^/]+)\/inventory$/.exec(url.pathname);
    if (shopInventoryMatch && method === 'GET') {
      const actor = personalActor(req, res);
      if (!actor) return;
      try { return json(res, 200, { inventory: listShopInventory(store, actor, decodeURIComponent(shopInventoryMatch[1]), { cards: catalog(), sales: allSales(), demoMode: config.demoMode, overrides: store.compOverrides?.() || {} }) }); }
      catch (error) { return json(res, error.status || 400, { error: 'shop_inventory_error', message: error.message }); }
    }
    if (shopInventoryMatch && method === 'POST') {
      const actor = personalActor(req, res, { write: true });
      if (!actor) return;
      try {
        const item = await addShopInventoryItem(store, actor, decodeURIComponent(shopInventoryMatch[1]), await readJson(req, 200_000), { cards: catalog(), sales: allSales(), demoMode: config.demoMode, overrides: store.compOverrides?.() || {} });
        return json(res, item.merged ? 200 : 201, { item, merged: Boolean(item.merged), message: item.merged ? 'Existing shop inventory row quantity updated.' : 'Shop inventory row created.' });
      }
      catch (error) { return json(res, error.status || 400, { error: 'shop_inventory_error', message: error.message }); }
    }

    const shopInventoryItem = /^\/api\/organizations\/([^/]+)\/inventory\/([^/]+)$/.exec(url.pathname);
    if (shopInventoryItem && method === 'PATCH') {
      const actor = personalActor(req, res, { write: true });
      if (!actor) return;
      try {
        const item = await updateShopInventoryItem(store, actor, decodeURIComponent(shopInventoryItem[1]), decodeURIComponent(shopInventoryItem[2]), await readJson(req, 200_000), { cards: catalog(), sales: allSales(), demoMode: config.demoMode, overrides: store.compOverrides?.() || {} });
        return item ? json(res, 200, { item }) : notFound(res, 'Shop inventory item not found');
      } catch (error) { return json(res, error.status || 400, { error: 'shop_inventory_error', message: error.message }); }
    }

    const dealerDecisionMatch = /^\/api\/cards\/([^/]+)\/dealer-decision$/.exec(url.pathname);
    if (dealerDecisionMatch && method === 'GET') {
      const actor = personalActor(req, res);
      if (!actor) return;
      const limits = entitlementsFor(actor);
      if (!limits.merchantTools) return forbidden(res, 'Dealer decision tools require a Merchant or Enterprise plan.');
      const card = matchCard(decodeURIComponent(dealerDecisionMatch[1]));
      if (!card) return notFound(res, 'Card not found');
      const activeResult = url.searchParams.get('active') === '1' ? await activeAskingListingsForCard(card, { limit: 12 }) : { listings: [], error: null };
      const decision = buildDealerDecision({ card, sales: allSales(), askingListings: activeResult.listings, demoMode: config.demoMode, overrides: store.compOverrides?.() || {} });
      return json(res, 200, { decision, marketMode: marketMode(config, store.state.customSales.length) });
    }

    if (url.pathname === '/api/intake-batches' && method === 'GET') {
      const actor = personalActor(req, res);
      if (!actor) return;
      const batches = (store.state.intakeBatches || []).filter((batch) => batch.userId === actor.userId || (batch.organizationId && canAccessOrganization(store.state, actor, batch.organizationId, 'viewer').allowed));
      return json(res, 200, { batches });
    }
    if (url.pathname === '/api/intake-batches' && method === 'POST') {
      const actor = personalActor(req, res, { write: true });
      if (!actor) return;
      try { return json(res, 201, { batch: await createIntakeBatch(store, actor, await readJson(req, 200_000)) }); }
      catch (error) { return json(res, error.status || 400, { error: 'intake_error', message: error.message }); }
    }

    const intakeItemMatch = /^\/api\/intake-batches\/([^/]+)\/items$/.exec(url.pathname);
    if (intakeItemMatch && method === 'POST') {
      const actor = personalActor(req, res, { write: true });
      if (!actor) return;
      try {
        const item = await addIntakeBatchItem(store, actor, decodeURIComponent(intakeItemMatch[1]), await readJson(req, 200_000), { cards: catalog(), sales: allSales(), demoMode: config.demoMode, overrides: store.compOverrides?.() || {} });
        return item ? json(res, 201, { item }) : notFound(res, 'Intake batch not found');
      } catch (error) { return json(res, error.status || 400, { error: 'intake_error', message: error.message }); }
    }

    const intakeStatusMatch = /^\/api\/intake-batches\/([^/]+)\/status$/.exec(url.pathname);
    if (intakeStatusMatch && method === 'PATCH') {
      const actor = personalActor(req, res, { write: true });
      if (!actor) return;
      try { const body = await readJson(req, 100_000); const batch = await updateIntakeBatchStatus(store, actor, decodeURIComponent(intakeStatusMatch[1]), body.status); return batch ? json(res, 200, { batch }) : notFound(res, 'Intake batch not found'); }
      catch (error) { return json(res, error.status || 400, { error: 'intake_error', message: error.message }); }
    }

    const offerSheetMatch = /^\/api\/intake-batches\/([^/]+)\/offer-sheet$/.exec(url.pathname);
    if (offerSheetMatch && method === 'GET') {
      const actor = personalActor(req, res);
      if (!actor) return;
      const batch = (store.state.intakeBatches || []).find((entry) => entry.id === decodeURIComponent(offerSheetMatch[1]) && (entry.userId === actor.userId || (entry.organizationId && canAccessOrganization(store.state, actor, entry.organizationId, 'viewer').allowed)));
      return batch ? json(res, 200, { offerSheet: generateOfferSheet(batch) }) : notFound(res, 'Intake batch not found');
    }

    if (url.pathname === '/api/listings' && method === 'GET') {
      const actor = personalActor(req, res);
      if (!actor) return;
      return json(res, 200, { listings: store.userSnapshot(actor.userId).listingDrafts });
    }
    if (url.pathname === '/api/listings' && method === 'POST') {
      const actor = personalActor(req, res, { write: true });
      if (!actor) return;
      try {
        const body = await readJson(req);
        if (body.cardId && !matchCard(body.cardId)) return badRequest(res, 'Unknown cardId');
        return json(res, 201, { listing: await store.addListingDraft(actor.userId, body), message: 'Listing draft created. Marketplace submission requires an authorized marketplace connection.' });
      } catch (error) { return badRequest(res, error.message); }
    }
    const listingItem = /^\/api\/listings\/([^/]+)$/.exec(url.pathname);
    if (listingItem && method === 'PATCH') {
      const actor = personalActor(req, res, { write: true });
      if (!actor) return;
      try {
        const listing = await store.updateListingDraft(actor.userId, decodeURIComponent(listingItem[1]), await readJson(req));
        return listing ? json(res, 200, { listing }) : notFound(res);
      } catch (error) { return badRequest(res, error.message); }
    }
    if (listingItem && method === 'DELETE') {
      const actor = personalActor(req, res, { write: true });
      if (!actor) return;
      const removed = await store.removeListingDraft(actor.userId, decodeURIComponent(listingItem[1]));
      return removed ? json(res, 200, { removed: true }) : notFound(res);
    }

    if (url.pathname === '/api/preferences' && method === 'PATCH') {
      const actor = personalActor(req, res, { write: true });
      if (!actor) return;
      try { return json(res, 200, { preferences: await store.setPreferences(actor.userId, await readJson(req)) }); }
      catch (error) { return badRequest(res, error.message); }
    }

    if (url.pathname === '/api/consignment-review' && method === 'POST') {
      const actor = personalActor(req, res, { write: true });
      if (!actor) return;
      try {
        const body = await readJson(req);
        if (!body.email && !actor.user?.email) return badRequest(res, 'Email is required');
        const request = await store.addConsignmentRequest(actor.userId, { ...body, email: body.email || actor.user.email, customerName: body.customerName || actor.user?.name });
        return json(res, 201, { request, message: 'Consignment review request recorded for human review. No binding offer has been made.' });
      } catch (error) { return badRequest(res, error.message); }
    }

    const listingSuggestion = /^\/api\/cards\/([^/]+)\/listing-suggestion$/.exec(url.pathname);
    if (listingSuggestion && method === 'GET') {
      const card = matchCard(decodeURIComponent(listingSuggestion[1]));
      if (!card) return notFound(res, 'Card not found');
      const activeResult = await activeAskingListingsForCard(card, { limit: 12 });
      const valuation = calculateValuation(allSales().filter((sale) => sale.cardId === card.id), { card, demoMode: config.demoMode, overrides: store.compOverrides?.() || {}, askingListings: activeResult.listings });
      if (!valuation.value && !valuation.askingPriceContext?.suggestedListAnchor) return json(res, 200, { card, suggestion: null, reason: 'Insufficient completed-sale and active BIN pricing context' });
      const feePct = Math.max(0, Math.min(0.4, Number(url.searchParams.get('feePct') || 0.13)));
      const listingAnchor = valuation.value || valuation.askingPriceContext?.suggestedListAnchor;
      return json(res, 200, {
        card,
        suggestion: {
          quickSale: Math.round((valuation.value ? valuation.value * 0.9 : listingAnchor * 0.9) * 100) / 100,
          market: valuation.value,
          patientAsk: Math.round(listingAnchor * 1.1 * 100) / 100,
          floor: valuation.range.low || Math.round(listingAnchor * 0.85 * 100) / 100,
          ceiling: valuation.range.high || Math.round(listingAnchor * 1.2 * 100) / 100,
          estimatedNetAtMarket: valuation.value ? Math.round(valuation.value * (1 - feePct) * 100) / 100 : null,
          askInformed: !valuation.value && Boolean(valuation.askingPriceContext?.suggestedListAnchor),
          askingPriceContext: valuation.askingPriceContext,
          feePct,
        },
        disclaimer: valuation.disclaimer,
      });
    }

    if (url.pathname === '/api/admin/users' && method === 'GET') {
      const actor = adminActor(req, res);
      if (!actor) return;
      return json(res, 200, { users: store.state.users.map((user) => ({ ...sanitizeUser(user), sessions: store.state.sessions.filter((session) => session.userId === user.id).length, holdings: store.userSnapshot(user.id).collection.length })) });
    }

    const adminUser = /^\/api\/admin\/users\/([^/]+)$/.exec(url.pathname);
    if (adminUser && method === 'PATCH') {
      const actor = adminActor(req, res);
      if (!actor) return;
      try {
        const userId = decodeURIComponent(adminUser[1]);
        const body = await readJson(req, 100_000);
        if (userId === actor.userId && body.disabledAt) return badRequest(res, 'You cannot disable your current administrator account.');
        const user = await store.updateUser(userId, body);
        if (!user) return notFound(res, 'User not found');
        if (body.disabledAt) await store.deleteAllUserSessions(userId);
        await store.audit({ type: 'admin_user_updated', userId, adminUserId: actor.userId, fields: Object.keys(body).slice(0, 20) });
        return json(res, 200, { user: sanitizeUser(user) });
      } catch (error) { return badRequest(res, error.message); }
    }

    const adminBilling = /^\/api\/admin\/users\/([^/]+)\/billing$/.exec(url.pathname);
    if (adminBilling && method === 'POST') {
      const actor = adminActor(req, res);
      if (!actor) return;
      try {
        const userId = decodeURIComponent(adminBilling[1]);
        if (!store.findUserById(userId)) return notFound(res, 'User not found');
        const body = await readJson(req, 100_000);
        const entitlement = await upsertBillingEntitlement(store, actor, {
          userId,
          provider: body.provider || 'manual',
          status: body.status || 'comped',
          plan: body.plan || 'collector',
          notes: body.notes || 'Owner-controlled billing override.',
        });
        return json(res, 200, { entitlement, billing: billingSummary(store, userId) });
      } catch (error) { return badRequest(res, error.message); }
    }

    if (url.pathname === '/api/admin/consignments' && method === 'GET') {
      const actor = adminActor(req, res);
      if (!actor) return;
      const requests = Object.entries(store.state.dataByUser).flatMap(([userId, data]) => (data.consignmentRequests || []).map((request) => ({ ...request, userId })));
      requests.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return json(res, 200, { requests });
    }

    const adminConsignment = /^\/api\/admin\/consignments\/([^/]+)\/([^/]+)$/.exec(url.pathname);
    if (adminConsignment && method === 'PATCH') {
      const actor = adminActor(req, res);
      if (!actor) return;
      try {
        const request = await store.updateConsignmentRequest(decodeURIComponent(adminConsignment[1]), decodeURIComponent(adminConsignment[2]), await readJson(req));
        return request ? json(res, 200, { request }) : notFound(res, 'Consignment request not found');
      } catch (error) { return badRequest(res, error.message); }
    }

    if (url.pathname === '/api/admin/outbox' && method === 'GET') {
      const actor = adminActor(req, res);
      if (!actor) return;
      return json(res, 200, { messages: store.state.outbox.slice(0, 200) });
    }

    if (url.pathname === '/api/admin/audit' && method === 'GET') {
      const actor = adminActor(req, res);
      if (!actor) return;
      return json(res, 200, { events: store.state.auditLog.slice(0, 500) });
    }

    if (url.pathname === '/api/admin/comps/review' && method === 'GET') {
      const actor = adminActor(req, res);
      if (!actor) return;
      const scoredSales = scoreComps(allSales(), { demoMode: config.demoMode, overrides: store.compOverrides?.() || {} });
      const review = [...needsReviewComps(scoredSales), ...excludedComps(scoredSales).filter((sale) => ['excluded_unverified_source', 'excluded_wrong_grade', 'excluded_wrong_parallel'].includes(sale.inclusionStatus))]
        .sort((a, b) => new Date(b.scoredAt) - new Date(a.scoredAt))
        .slice(0, 500)
        .map(publicCompSummary);
      return json(res, 200, { review, total: review.length, audit: (store.state.compAuditLog || []).slice(0, 100) });
    }

    const adminCompAction = /^\/api\/admin\/comps\/([^/]+)\/(approve|reject|correct)$/.exec(url.pathname);
    if (adminCompAction && method === 'POST') {
      const actor = adminActor(req, res);
      if (!actor) return;
      try {
        const compId = decodeURIComponent(adminCompAction[1]);
        const action = adminCompAction[2];
        const body = await readJson(req, 200_000);
        const exists = allSales().some((sale) => sale.id === compId);
        if (!exists) return notFound(res, 'Comp not found');
        let result;
        if (action === 'approve') result = await store.reviewComp(compId, { decision: 'approved', notes: body.notes || '', adminUserId: actor.userId });
        if (action === 'reject') result = await store.reviewComp(compId, { decision: 'rejected', inclusionStatus: body.inclusionStatus || 'excluded_wrong_card', notes: body.notes || '', adminUserId: actor.userId });
        if (action === 'correct') result = await store.correctComp(compId, body.correction || body, { adminUserId: actor.userId });
        await store.audit({ type: `admin_comp_${action}`, compId, adminUserId: actor.userId });
        cache.clear();
        return json(res, 200, { result });
      } catch (error) { return badRequest(res, error.message); }
    }


    if (url.pathname === '/api/admin/ebay/oauth/start' && method === 'POST') {
      const actor = adminActor(req, res);
      if (!actor) return;
      const ebay = providers.byName.get('eBay');
      if (!ebay) return notFound(res, 'eBay provider is not registered');
      const secret = config.ebayOauthStateSecret;
      try {
        const issued = issueEbayOAuthState({
          storeState: store.state,
          secret,
          actorId: actor.userId,
          ttlMs: config.ebayOauthStateTtlMs,
        });
        await store.persist();
        const authorizationUrl = ebay.buildUserConsentUrl({ state: issued.state });
        await store.audit({ type: 'admin_ebay_oauth_started', adminUserId: actor.userId, expiresAt: issued.expiresAt });
        return json(res, 200, { authorizationUrl, stateExpiresAt: issued.expiresAt });
      } catch (error) {
        return json(res, 503, { error: 'ebay_oauth_unavailable', message: error.message });
      }
    }

    if (url.pathname === '/api/admin/ebay/oauth/exchange' && method === 'POST') {
      const actor = adminActor(req, res);
      if (!actor) return;
      const ebay = providers.byName.get('eBay');
      if (!ebay) return notFound(res, 'eBay provider is not registered');
      const secret = config.ebayOauthStateSecret;
      try {
        const body = await readJson(req, 200_000);
        consumeEbayOAuthState({
          storeState: store.state,
          secret,
          actorId: actor.userId,
          state: body.state,
        });
        await store.persist();
        const token = await ebay.exchangeAuthorizationCode(body.code);
        await store.audit({
          type: 'admin_ebay_oauth_completed',
          adminUserId: actor.userId,
          accessTokenExpiresAt: token.accessTokenExpiresAt,
          refreshTokenReceived: Boolean(token.refreshToken),
        });
        return json(res, 200, {
          connected: true,
          accessTokenExpiresAt: token.accessTokenExpiresAt,
          refreshTokenReceived: Boolean(token.refreshToken),
          message: 'eBay authorization succeeded. Persist tokens through the encrypted desktop credential bridge before restarting ManeFlow.',
        });
      } catch (error) {
        return json(res, 400, { error: 'ebay_oauth_exchange_failed', message: error.message });
      }
    }

    if (url.pathname === '/api/admin/ebay/status' && method === 'GET') {
      const actor = adminActor(req, res);
      if (!actor) return;
      const ebay = providers.byName.get('eBay');
      if (!ebay) return notFound(res, 'eBay provider is not registered');
      const recentIngests = store.state.providerIngests
        .filter((ingest) => String(ingest.provider || '').toLowerCase().includes('ebay'))
        .slice(0, 25);
      return json(res, 200, {
        provider: ebay.status(),
        recentIngests,
        message: 'eBay active listings, seller orders, and Marketplace Insights completed-sale imports are tracked separately. Active listings are never used as completed-sale valuation comps.',
      });
    }

    if (url.pathname === '/api/admin/ebay/import-completed' && method === 'POST') {
      const actor = adminActor(req, res);
      if (!actor) return;
      const ebay = providers.byName.get('eBay');
      if (!ebay) return notFound(res, 'eBay provider is not registered');
      try {
        const body = await readJson(req, 500_000);
        const card = body.cardId ? matchCard(body.cardId) : null;
        if (body.cardId && !card) return notFound(res, 'Card not found');
        const query = body.query || (card ? saleQueryFromCard(card) : '');
        if (!query && !body.gtin && !body.epid && !body.categoryIds && !body.categoryId) return badRequest(res, 'query, gtin, epid, categoryIds, or cardId is required');
        const cardContext = card ? {
          cardId: card.id,
          player: card.player,
          year: card.year,
          brand: card.brand,
          set: card.set,
          cardNumber: card.cardNumber,
          parallel: card.parallel,
          grader: card.grade?.company,
          grade: card.grade,
        } : (body.cardContext || {});
        const importResult = await ebay.searchCompletedSales({
          query,
          gtin: body.gtin,
          epid: body.epid,
          categoryIds: body.categoryIds || body.categoryId,
          limit: body.limit || 50,
          offset: body.offset || 0,
          dateFrom: body.dateFrom || null,
          dateTo: body.dateTo || null,
          filters: body.filters || [],
          conditionIds: body.conditionIds || [],
          conditions: body.conditions || [],
          priceMin: body.priceMin ?? null,
          priceMax: body.priceMax ?? null,
          currency: body.currency || 'USD',
          cardContext,
          importedBy: actor.userId,
        });
        const ingest = await ingestPricingData({
          rows: importResult.sales,
          cards: catalog(),
          store,
          source: {
            provider: 'eBay Marketplace Insights',
            sourceMode: 'production',
            authorizationBasis: 'ebay_api',
            dataRightsStatus: 'ebay_marketplace_insights_limited_release',
            refreshPolicy: body.incremental ? 'incremental_marketplace_insights_import' : 'manual_marketplace_insights_import',
            rightsNotes: 'Imported with configured eBay Marketplace Insights access. eBay sold-history API access is limited/restricted and must be approved for this app.',
          },
          actor,
          config,
        });
        await store.audit({ type: 'admin_ebay_completed_import', adminUserId: actor.userId, query, cardId: card?.id || null, rawCount: importResult.rawCount, salesAdded: ingest.result.added, salesUpdated: ingest.result.updated, errors: ingest.errors.length });
        cache.clear();
        for (const user of store.state.users) await dashboardFor(user.id);
        return json(res, 202, { import: { provider: importResult.provider, query: importResult.query, total: importResult.total, rawCount: importResult.rawCount, next: importResult.next }, ingest: ingest.ingest, summary: ingest.summary, errors: ingest.errors, review: ingest.review, rejected: ingest.rejected });
      } catch (error) { return badRequest(res, error.message, { code: error.code || null, status: error.status || null }); }
    }

    if (url.pathname === '/api/admin/ebay/import-seller-orders' && method === 'POST') {
      const actor = adminActor(req, res);
      if (!actor) return;
      const ebay = providers.byName.get('eBay');
      if (!ebay) return notFound(res, 'eBay provider is not registered');
      try {
        const body = await readJson(req, 500_000);
        const importResult = await ebay.fetchSellerOrders({
          dateFrom: body.dateFrom || null,
          dateTo: body.dateTo || null,
          limit: body.limit || 100,
          offset: body.offset || 0,
          orderFulfillmentStatus: body.orderFulfillmentStatus || null,
          userAccessToken: body.userAccessToken || undefined,
          importedBy: actor.userId,
        });
        const ingest = await ingestPricingData({
          rows: importResult.sales,
          cards: catalog(),
          store,
          source: {
            provider: 'eBay Seller Orders',
            sourceMode: 'production',
            authorizationBasis: 'ebay_api',
            dataRightsStatus: 'seller_account_authorized_orders_only',
            refreshPolicy: 'manual_seller_order_import',
            rightsNotes: 'Authenticated eBay seller-order import. This data represents the connected seller account only and is not market-wide sold-history coverage.',
          },
          actor,
          config,
        });
        await store.audit({ type: 'admin_ebay_seller_order_import', adminUserId: actor.userId, orders: importResult.orders, salesAdded: ingest.result.added, salesUpdated: ingest.result.updated, errors: ingest.errors.length });
        cache.clear();
        for (const user of store.state.users) await dashboardFor(user.id);
        return json(res, 202, { import: { provider: importResult.provider, orders: importResult.orders, total: importResult.total }, ingest: ingest.ingest, summary: ingest.summary, errors: ingest.errors, review: ingest.review, rejected: ingest.rejected });
      } catch (error) { return badRequest(res, error.message, { code: error.code || null, status: error.status || null }); }
    }

    if (url.pathname === '/api/admin/pricing-data/report' && method === 'GET') {
      const actor = adminActor(req, res);
      if (!actor) return;
      const report = summarizePricingData({ sales: allSales(), cards: catalog(), providers: providers.status(), config, overrides: store.compOverrides?.() || {} });
      return json(res, 200, { report, recentIngests: store.state.providerIngests.slice(0, 50), adminOnly: true });
    }

    if (url.pathname === '/api/admin/card-images' && method === 'GET') {
      const actor = adminActor(req, res);
      if (!actor) return;
      return json(res, 200, {
        sources: imageSourceStatus(config),
        coverage: imageCoverageReport({ cards: catalog(), sales: allSales(), config, overrides: store.state.cardImageOverrides || {} }),
        overrides: Object.values(store.state.cardImageOverrides || {}).slice(0, 250),
        auditLog: (store.state.cardImageAuditLog || []).slice(0, 100),
      });
    }

    if (url.pathname === '/api/admin/card-images/enrich' && method === 'POST') {
      const actor = adminActor(req, res);
      if (!actor) return;
      try {
        const body = await readJson(req, config.maxRequestBytes);
        const rows = body.csv ? parseCsv(body.csv) : (body.rows || body.images || []);
        const result = await ingestImageEnrichment({
          rows,
          cards: catalog(),
          sales: allSales(),
          store,
          source: {
            provider: body.provider || body.source?.provider || 'Admin Image Enrichment',
            sourceMode: body.sourceMode || body.source?.sourceMode || 'production',
            authorizationBasis: body.authorizationBasis || body.source?.authorizationBasis || 'user_csv',
            dataRightsStatus: body.dataRightsStatus || body.source?.dataRightsStatus || 'image_display_authorized',
            rightsNotes: body.rightsNotes || body.source?.rightsNotes || 'Admin-approved image enrichment import.',
            providerBatchId: body.providerBatchId || body.source?.providerBatchId,
          },
          actor,
          config,
          dryRun: body.dryRun !== false,
        });
        cache.clear();
        return json(res, body.dryRun === false ? 202 : 200, result);
      } catch (error) { return badRequest(res, error.message); }
    }

    if (url.pathname === '/api/admin/card-images/rollback' && method === 'POST') {
      const actor = adminActor(req, res);
      if (!actor) return;
      try {
        const body = await readJson(req, 100_000);
        const result = await rollbackImageEnrichmentBatch(store, body.providerBatchId, { actor, reason: body.reason || 'Admin image enrichment rollback.' });
        cache.clear();
        return json(res, 202, result);
      } catch (error) { return badRequest(res, error.message); }
    }

    if (url.pathname === '/api/admin/pricing-data/import' && method === 'POST') {
      const actor = adminActor(req, res);
      if (!actor) return;
      try {
        const body = await readJson(req, config.maxRequestBytes);
        const rows = body.rows || parseCsv(body.csv || '');
        const cardRows = body.cards || [];
        let cardResult = { added: 0, updated: 0 };
        let cardErrors = [];
        if (cardRows.length) {
          const normalizedCards = normalizeCatalogRows(cardRows, { source: body.provider || body.source?.provider || 'admin_pricing_import' });
          cardErrors = normalizedCards.errors;
          cardResult = await store.addCustomCards(normalizedCards.cards);
        }
        const ingest = await ingestPricingData({
          rows,
          cards: catalog(),
          store,
          source: body.source || {
            provider: body.provider || 'Admin pricing import',
            sourceMode: body.sourceMode || 'production',
            authorizationBasis: body.authorizationBasis || 'user_authorized_export',
            dataRightsStatus: body.dataRightsStatus || 'owner_authorized_import',
            rightsNotes: body.rightsNotes || 'Owner-admin pricing import.',
          },
          actor,
          config,
          dryRun: body.dryRun === true,
        });
        cache.clear();
        for (const user of store.state.users) await dashboardFor(user.id);
        return json(res, 202, { cards: cardResult, cardErrors, ingest: ingest.ingest, summary: ingest.summary, errors: ingest.errors, review: ingest.review, rejected: ingest.rejected });
      } catch (error) { return badRequest(res, error.message); }
    }

    if (url.pathname === '/api/admin/pricing-data/rollback' && method === 'POST') {
      const actor = adminActor(req, res);
      if (!actor) return;
      try {
        const body = await readJson(req, 100_000);
        const result = await rollbackPricingBatch(store, { providerRunId: body.providerRunId, providerBatchId: body.providerBatchId, actor, reason: body.reason || 'Admin pricing rollback.' });
        cache.clear();
        return json(res, 200, { result });
      } catch (error) { return badRequest(res, error.message); }
    }

    if (url.pathname === '/api/admin/data-health' && method === 'GET') {
      const actor = adminActor(req, res);
      if (!actor) return;
      const health = summarizeDataHealth({
        sales: allSales(),
        cards: catalog(),
        providers: providers.status(),
        config,
        overrides: store.compOverrides?.() || {},
      });
      const configBlockers = [];
      if (!config.publicBaseUrl.startsWith('https://')) configBlockers.push('PUBLIC_BASE_URL is not HTTPS.');
      if (!config.adminToken) configBlockers.push('MANEFLOW_ADMIN_TOKEN is not configured.');
      if (!config.providerWebhookSecret) configBlockers.push('PROVIDER_WEBHOOK_SECRET is not configured.');
      if (!config.allowedOrigins.length) configBlockers.push('ALLOWED_ORIGINS is empty.');
      return json(res, 200, {
        ...health,
        readyForPublicValueClaims: health.readyForPublicValueClaims && configBlockers.length === 0,
        blockers: [...health.publicValueBlockers, ...configBlockers],
        saleCount: health.totalComps,
        catalogCount: catalog().length,
        mappedSales: allSales().filter((sale) => sale.cardId && matchCard(sale.cardId)).length,
        unmappedSales: allSales().filter((sale) => !sale.cardId || !matchCard(sale.cardId)).length,
        verifiedSales: allSales().filter((sale) => sale.verified).length,
        verifiedPct: allSales().length ? Math.round((allSales().filter((sale) => sale.verified).length / allSales().length) * 1000) / 10 : 0,
        duplicateIds: health.byStatus.excluded_duplicate || 0,
      });
    }


    if (url.pathname === '/api/admin/portfolio-intelligence' && method === 'GET') {
      const actor = adminActor(req, res);
      if (!actor) return;
      const rows = [];
      for (const user of store.state.users) {
        const dashboard = await dashboardFor(user.id);
        rows.push({
          userId: user.id, email: user.email, name: user.name, role: user.role, plan: user.plan,
          currentValue: dashboard.intelligence.metrics.currentValue,
          costBasis: dashboard.intelligence.metrics.costBasis,
          unrealizedGain: dashboard.intelligence.metrics.unrealizedGain,
          averageConfidence: dashboard.intelligence.metrics.averageConfidence,
          lowConfidenceCount: dashboard.intelligence.metrics.lowConfidenceCount,
          concentrationRisk: dashboard.intelligence.metrics.concentrationRisk,
          itemCount: dashboard.intelligence.metrics.itemCount,
        });
      }
      return json(res, 200, { generatedAt: new Date().toISOString(), portfolios: rows, privacy: 'administrator_only_private_summary' });
    }

    if (url.pathname === '/api/admin/inventory-intelligence' && method === 'GET') {
      const actor = adminActor(req, res);
      if (!actor) return;
      const shops = [];
      for (const user of store.state.users.filter((user) => ['merchant', 'admin'].includes(user.role) || ['merchant', 'enterprise'].includes(user.plan))) {
        const dashboard = await dashboardFor(user.id);
        const inventory = getInventoryHealth(dashboard.collection, { cards: catalog(), sales: allSales(), demoMode: config.demoMode, overrides: store.compOverrides?.() || {} });
        shops.push({ userId: user.id, email: user.email, name: user.name, role: user.role, plan: user.plan, inventory });
      }
      return json(res, 200, { generatedAt: new Date().toISOString(), shops, privacy: 'administrator_only_shop_summary' });
    }

    if (url.pathname === '/api/admin/alerts/evaluate' && method === 'POST') {
      const actor = adminActor(req, res);
      if (!actor) return;
      let evaluated = 0;
      for (const user of store.state.users) { await dashboardFor(user.id); evaluated += 1; }
      return json(res, 200, { evaluated });
    }

    if (url.pathname === '/api/admin/provider-ingest' && method === 'POST') {
      const raw = await readBody(req, config.maxRequestBytes);
      const signature = req.headers['x-maneflow-signature'];
      const actor = actorFromRequest(req);
      const hmacValid = verifyHmac(raw, signature, config.providerWebhookSecret);
      if (actor?.role !== 'admin' && !hmacValid) return forbidden(res, 'Valid admin authorization or provider webhook signature required.');
      try {
        const body = JSON.parse(raw.toString('utf8'));
        if (!body.provider) return badRequest(res, 'provider is required');
        if (!allowedAuthorizationBases.has(body.authorizationBasis)) return badRequest(res, 'authorizationBasis must document an approved data-access basis');
        const normalizedCards = normalizeCatalogRows(body.cards || [], { source: body.provider });
        const cardResult = await store.addCustomCards(normalizedCards.cards);
        const currentCatalog = catalog();
        const ingest = await ingestPricingData({
          rows: body.sales || [],
          cards: currentCatalog,
          store,
          source: {
            provider: body.provider,
            authorizationBasis: body.authorizationBasis,
            sourceMode: 'production',
            dataRightsStatus: body.dataRightsStatus || 'provider_authorized',
            refreshPolicy: body.refreshPolicy || 'provider_webhook_or_batch',
            rightsNotes: body.rightsNotes || body.notes || 'Provider webhook import. Authorization basis recorded by sender.',
          },
          actor: actor || { userId: 'provider_webhook', role: 'provider' },
          config,
        });
        const mergedIngest = {
          ...ingest.ingest,
          cardsAdded: cardResult.added,
          cardsUpdated: cardResult.updated,
          cardErrors: normalizedCards.errors.length,
        };
        cache.clear();
        for (const user of store.state.users) await dashboardFor(user.id);
        return json(res, 202, { ingest: mergedIngest, cardErrors: normalizedCards.errors, saleErrors: ingest.errors, review: ingest.review, rejected: ingest.rejected, compQuality: ingest.summary.compQuality });
      } catch (error) { return badRequest(res, error.message); }
    }


    if (url.pathname === '/api/admin/scan-quality' && method === 'GET') {
      const actor = adminActor(req, res);
      if (!actor) return;
      return json(res, 200, { analytics: scanQualityAnalytics(store.state), recentSessions: (store.state.scanSessions || []).slice(0, 100) });
    }

    if (url.pathname === '/api/admin/recognition-benchmarks' && method === 'GET') {
      const actor = adminActor(req, res);
      if (!actor) return;
      const policies = listSourcePolicies(store.state);
      return json(res, 200, {
        benchmarks: store.state.recognitionBenchmarks || [],
        eligibleSources: policies
          .filter((policy) => policy.benchmarkEligible || policy.catalogEligible || policy.imageEligible)
          .map(({ provider, sourceType, dataRightsStatus, benchmarkEligible, catalogEligible, imageEligible, legalReviewStatus, ownerApprovalStatus, notes }) => ({
            provider, sourceType, dataRightsStatus, benchmarkEligible, catalogEligible, imageEligible, legalReviewStatus, ownerApprovalStatus, notes,
          })),
        blockedSources: policies
          .filter((policy) => policy.sourceType === 'prohibited')
          .map(({ provider, dataRightsStatus, termsUrl, notes }) => ({ provider, dataRightsStatus, termsUrl, notes })),
        policy: 'Recognition benchmark data is internal testing evidence only. It can improve scan accuracy reports and correction priorities, but it cannot create public market values.',
      });
    }

    if (url.pathname === '/api/admin/recognition-benchmarks/run' && method === 'POST') {
      const actor = adminActor(req, res);
      if (!actor) return;
      try {
        const body = await readJson(req, config.maxRequestBytes);
        const sourceName = body.sourceName || body.dataset || body.provider || 'Recognition Benchmark Dataset';
        const sourcePolicy = listSourcePolicies(store.state).find((policy) => String(policy.provider || '').toLowerCase() === String(sourceName).toLowerCase());
        if (sourcePolicy?.sourceType === 'prohibited') {
          return json(res, 409, {
            error: 'This source is blocked until written permission is recorded in the data-rights registry.',
            provider: sourcePolicy.provider,
            dataRightsStatus: sourcePolicy.dataRightsStatus,
            termsUrl: sourcePolicy.termsUrl || '',
          });
        }
        const cases = parseRecognitionBenchmarkInput(body.cases || body.rows || body.data || body.csv || body.json || body, { sourceName });
        if (!cases.length) return badRequest(res, 'At least one benchmark case is required.');
        const report = runRecognitionBenchmark(cases, {
          cards: catalog(),
          corrections: store.state.scanCorrections || [],
          enrichCard,
        });
        const saved = await store.recordRecognitionBenchmark({
          ...report,
          sourceName,
          caseCount: cases.length,
          actorUserId: actor.userId,
        });
        return json(res, 200, {
          benchmark: saved,
          report: body.includeDetails === true ? report : { version: report.version, generatedAt: report.generatedAt, metrics: report.metrics, recommendations: report.recommendations, policy: report.policy },
          sourcePolicy: sourcePolicy ? {
            provider: sourcePolicy.provider,
            sourceType: sourcePolicy.sourceType,
            benchmarkEligible: sourcePolicy.benchmarkEligible,
            dataRightsStatus: sourcePolicy.dataRightsStatus,
            legalReviewStatus: sourcePolicy.legalReviewStatus,
            ownerApprovalStatus: sourcePolicy.ownerApprovalStatus,
          } : null,
        });
      } catch (error) { return badRequest(res, error.message); }
    }

    if (url.pathname === '/api/admin/import-jobs' && method === 'GET') {
      const actor = adminActor(req, res);
      if (!actor) return;
      return json(res, 200, summarizeImportJobs(store.state, providers.status()));
    }

    if (url.pathname === '/api/admin/import-jobs' && method === 'POST') {
      const actor = adminActor(req, res);
      if (!actor) return;
      try { return json(res, 201, { job: await createImportJob(store, actor, await readJson(req, 200_000)) }); }
      catch (error) { return json(res, error.status || 400, { error: 'import_job_error', message: error.message }); }
    }

    const importJobRunMatch = /^\/api\/admin\/import-jobs\/([^/]+)\/runs$/.exec(url.pathname);
    if (importJobRunMatch && method === 'POST') {
      const actor = adminActor(req, res);
      if (!actor) return;
      try { return json(res, 202, { run: await recordImportJobRun(store, decodeURIComponent(importJobRunMatch[1]), await readJson(req, 200_000)) }); }
      catch (error) { return json(res, error.status || 400, { error: 'import_job_error', message: error.message }); }
    }

    if (url.pathname === '/api/admin/organizations' && method === 'GET') {
      const actor = adminActor(req, res);
      if (!actor) return;
      return json(res, 200, { organizations: store.state.organizations || [], members: store.state.organizationMembers || [], invites: store.state.organizationInvites || [], shopAuditLog: (store.state.shopAuditLog || []).slice(0, 100) });
    }

    if (url.pathname === '/api/admin/status' && method === 'GET') {
      const actor = adminActor(req, res);
      if (!actor) return;
      return json(res, 200, {
        version: config.version, releaseChannel: config.releaseChannel, marketMode: marketMode(config, store.state.customSales.length),
        counts: {
          users: store.state.users.length, sessions: store.state.sessions.length,
          customCards: store.state.customCards.length, customSales: store.state.customSales.length,
          providerIngests: store.state.providerIngests.length, outbox: store.state.outbox.length, accountTokens: store.state.accountTokens.length,
        },
        providers: providers.status(), recentAudit: store.state.auditLog.slice(0, 100),
      });
    }


    if (url.pathname === '/api/collection-surveys' && method === 'GET') {
      const actor = personalActor(req, res);
      if (!actor) return;
      return json(res, 200, { surveys: listCollectionSurveys(store.state, actor) });
    }

    if (url.pathname === '/api/collection-surveys/estimate' && method === 'POST') {
      const actor = personalActor(req, res, { write: true });
      if (!actor) return;
      const body = await readJson(req, config.maxRequestBytes);
      return json(res, 200, { survey: buildCollectionSurvey({ ...body, userId: actor.userId }) });
    }

    if (url.pathname === '/api/collection-surveys' && method === 'POST') {
      const actor = personalActor(req, res, { write: true });
      if (!actor) return;
      const body = await readJson(req, config.maxRequestBytes);
      const survey = await saveCollectionSurvey(store, actor, body);
      return json(res, 201, { survey });
    }

    const surveyMatch = /^\/api\/collection-surveys\/([^/]+)$/.exec(url.pathname);
    if (surveyMatch && method === 'PATCH') {
      const actor = personalActor(req, res, { write: true });
      if (!actor) return;
      const existing = (store.state.collectionSurveys || []).find((item) => item.id === decodeURIComponent(surveyMatch[1]) && item.userId === actor.userId);
      if (!existing) return notFound(res, 'Collection survey not found');
      const body = await readJson(req, config.maxRequestBytes);
      const survey = await saveCollectionSurvey(store, actor, { ...existing, ...body, id: existing.id }, existing);
      return json(res, 200, { survey });
    }

    if (url.pathname === '/api/admin/system/health' && method === 'GET') {
      const actor = adminActor(req, res);
      if (!actor) return;
      const validation = validateRuntimeConfig(config);
      let storageHealth = { ok: true, mode: config.storageMode || 'json' };
      if (storage && typeof storage.health === 'function') storageHealth = await storage.health();
      return json(res, 200, {
        generatedAt: new Date().toISOString(),
        version: config.version,
        releaseChannel: config.releaseChannel,
        runtime: validation,
        storage: storageHealth,
        providers: providers.status(),
        counts: {
          users: store.state.users.length,
          customCards: store.state.customCards.length,
          customSales: store.state.customSales.length,
          organizations: store.state.organizations.length,
          shopInventory: store.state.shopInventory.length,
          providerIngests: store.state.providerIngests.length,
          importJobs: store.state.importJobs.length,
          usageRecords: (store.state.usageRecords || []).length,
          billingEntitlements: (store.state.billingEntitlements || []).length,
        },
        message: 'Administrator-only health report. Secrets are not exposed.',
      });
    }

    return notFound(res, 'API route not found');
  }

  async function handleStatic(req, res, url) {
    const filePath = safeStaticPath(url.pathname);
    if (!filePath) return notFound(res);
    try {
      const stat = await fs.stat(filePath);
      const resolved = stat.isDirectory() ? path.join(filePath, 'index.html') : filePath;
      const body = await fs.readFile(resolved);
      const ext = path.extname(resolved);
      res.writeHead(200, {
        'content-type': mime[ext] || 'application/octet-stream',
        'content-length': body.length,
        'cache-control': ext === '.html' || ext === '.webmanifest' ? 'no-cache' : 'public, max-age=3600',
        ...securityHeaders(config),
      });
      res.end(body);
    } catch (error) {
      if (error.code === 'ENOENT') {
        const body = await fs.readFile(path.join(publicDir, 'index.html'));
        res.writeHead(200, { 'content-type': mime['.html'], 'content-length': body.length, 'cache-control': 'no-cache', ...securityHeaders(config) });
        return res.end(body);
      }
      throw error;
    }
  }

  return async function router(req, res) {
    try {
      const url = new URL(req.url || '/', config.publicBaseUrl);
      if (url.pathname === '/healthz') {
        return json(res, 200, {
          ok: true,
          app: config.appName,
          version: config.version,
          releaseChannel: config.releaseChannel,
          generatedAt: new Date().toISOString(),
        });
      }
      if (url.pathname === '/readyz') {
        const validation = runtimeValidation || validateRuntimeConfig(config);
        let storageHealth = { ok: true, mode: config.storageMode || 'json' };
        if (storage && typeof storage.health === 'function') storageHealth = await storage.health();
        const ready = validation.ok && storageHealth.ok !== false;
        return json(res, ready ? 200 : 503, {
          ready,
          config: validation,
          storage: storageHealth,
          marketData: {
            demoMode: config.demoMode,
            customSales: store.state.customSales.length,
            publicValueClaimsAllowed: !config.demoMode && store.state.customSales.length > 0,
          },
        });
      }
      if (req.method === 'OPTIONS') {
        const origin = String(req.headers.origin || '');
        if (origin && originAllowed(req, config)) res.setHeader('access-control-allow-origin', origin);
        res.setHeader('access-control-allow-credentials', 'true');
        res.setHeader('access-control-allow-headers', 'content-type, authorization, x-maneflow-token, x-maneflow-signature, x-maneflow-csrf');
        res.setHeader('access-control-allow-methods', 'GET, POST, PATCH, DELETE, OPTIONS');
        res.writeHead(204);
        return res.end();
      }
      const origin = String(req.headers.origin || '');
      if (origin && originAllowed(req, config)) {
        res.setHeader('access-control-allow-origin', origin);
        res.setHeader('access-control-allow-credentials', 'true');
        res.setHeader('vary', 'Origin');
      }
      for (const [name, value] of Object.entries(securityHeaders(config))) res.setHeader(name, value);
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
      if (url.pathname.startsWith('/value/')) return await handleStatic(req, res, new URL('/value.html', config.publicBaseUrl));
      return await handleStatic(req, res, url);
    } catch (error) {
      console.error(error);
      return json(res, 500, { error: 'internal_error', message: 'Unexpected server error' });
    }
  };
}
