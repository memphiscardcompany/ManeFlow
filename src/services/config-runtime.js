import { ConfigurationError, redactSecrets } from './errors.js';

function has(value) {
  return String(value ?? '').trim().length > 0;
}

function isHttps(value) {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function isOwnerUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

export function runtimeMode(config = {}, env = process.env) {
  if (config.productionMode !== undefined) return config.productionMode ? 'production' : 'local';
  if (env.NODE_ENV === 'production' || config.releaseChannel === 'production') return 'production';
  return 'local';
}

export function validateRuntimeConfig(config = {}, env = process.env) {
  const mode = runtimeMode(config, env);
  const errors = [];
  const warnings = [];
  if (mode === 'production') {
    if (!isHttps(config.publicBaseUrl)) errors.push('PUBLIC_BASE_URL must be HTTPS in production.');
    if (config.secureCookies !== true) errors.push('Secure cookies are required in production.');
    if (config.requireAuthentication !== true) errors.push('MANEFLOW_REQUIRE_AUTHENTICATION must be true in production.');
    if (config.requireEmailVerification !== true) errors.push('MANEFLOW_REQUIRE_EMAIL_VERIFICATION must be true in production.');
    if (config.csrfProtection !== true) errors.push('MANEFLOW_CSRF_PROTECTION must be true in production.');
    if (config.allowGuestWrites === true) errors.push('MANEFLOW_ALLOW_GUEST_WRITES must be false in production.');
    if (config.allowLegacyAdminToken === true) errors.push('MANEFLOW_ALLOW_LEGACY_ADMIN_TOKEN must be false in production.');
    if (!has(config.apiToken)) errors.push('MANEFLOW_API_TOKEN is required in production.');
    if (!has(config.serviceToken)) errors.push('MANEFLOW_SERVICE_TOKEN is required in production.');
    if (!has(config.providerWebhookSecret)) errors.push('PROVIDER_WEBHOOK_SECRET is required in production.');
    if (!Array.isArray(config.allowedOrigins) || config.allowedOrigins.length === 0) errors.push('ALLOWED_ORIGINS must include production web origins.');
    if (config.demoMode === true) warnings.push('MANEFLOW_DEMO_MODE=true; public market-value claims must remain disabled.');
    if (config.exposeDevTokens === true) errors.push('MANEFLOW_EXPOSE_DEV_TOKENS must be false in production.');
    if (config.storageMode !== 'postgres') errors.push('STORAGE_MODE must be postgres in production.');
    if (!has(config.emailWebhookUrl)) errors.push('MANEFLOW_EMAIL_WEBHOOK_URL is required for production verification and recovery email.');
    if (!has(config.releaseCommitSha) || config.releaseCommitSha === 'unverified') warnings.push('RELEASE_COMMIT_SHA is not verified.');
    if (!has(config.releaseDeployedAt)) warnings.push('RELEASE_DEPLOYED_AT is not set.');
    if (config.metaIntakeEnabled === true) {
      if (config.metaKillSwitch === true) errors.push('MANEBRAIN_META_KILL_SWITCH must be false before Meta intake can be enabled.');
      if (!Array.isArray(config.platformOwnerUserIds) || config.platformOwnerUserIds.length !== 1) {
        errors.push('MANEFLOW_PLATFORM_OWNER_USER_IDS must contain exactly one verified immutable owner UUID before owner-only Meta intake can be enabled.');
      } else if (!isOwnerUuid(config.platformOwnerUserIds[0])) {
        errors.push('MANEFLOW_PLATFORM_OWNER_USER_IDS must use the canonical PostgreSQL owner UUID.');
      }
      for (const [name, value] of [
        ['META_APP_SECRET', config.metaAppSecret],
        ['META_WEBHOOK_VERIFY_TOKEN', config.metaWebhookVerifyToken],
        ['META_APP_ID', config.metaAppId],
        ['META_BUSINESS_ID', config.metaBusinessId],
        ['META_PAGE_ID', config.metaPageId],
        ['META_INSTAGRAM_ACCOUNT_ID', config.metaInstagramAccountId],
      ]) {
        if (!has(value)) errors.push(`${name} is required before Meta intake can be enabled.`);
      }
      if (!Array.isArray(config.metaAttachmentAllowedHosts) || config.metaAttachmentAllowedHosts.length === 0) {
        errors.push('META_ATTACHMENT_ALLOWED_HOSTS must contain exact provider hosts before Meta intake can be enabled.');
      }
    }
    if (config.metaOutboundEnabled === true) {
      if (config.metaIntakeEnabled !== true) errors.push('MANEBRAIN_META_INTAKE_ENABLED must be true before Meta outbound can be enabled.');
      if (config.metaKillSwitch === true) errors.push('MANEBRAIN_META_KILL_SWITCH must be false before Meta outbound can be enabled.');
      if (!Array.isArray(config.platformOwnerUserIds) || config.platformOwnerUserIds.length !== 1 || !isOwnerUuid(config.platformOwnerUserIds[0])) {
        errors.push('MANEFLOW_PLATFORM_OWNER_USER_IDS must contain exactly one verified immutable owner UUID before Meta outbound can be enabled.');
      }
      for (const [name, value] of [
        ['META_APP_ID', config.metaAppId],
        ['META_BUSINESS_ID', config.metaBusinessId],
        ['META_PAGE_ID', config.metaPageId],
        ['META_INSTAGRAM_ACCOUNT_ID', config.metaInstagramAccountId],
        ['META_PAGE_ACCESS_TOKEN', config.metaPageAccessToken],
        ['META_INSTAGRAM_ACCESS_TOKEN', config.metaInstagramAccessToken],
      ]) {
        if (!has(value)) errors.push(`${name} is required before Meta outbound can be enabled.`);
      }
      if (!/^v\d+\.\d+$/.test(String(config.metaGraphApiVersion || ''))) {
        errors.push('META_GRAPH_API_VERSION must use the vNN.N format.');
      }
      if (!isHttps(config.metaMessengerGraphBaseUrl)) errors.push('META_MESSENGER_GRAPH_BASE_URL must be HTTPS.');
      if (!isHttps(config.metaInstagramGraphBaseUrl)) errors.push('META_INSTAGRAM_GRAPH_BASE_URL must be HTTPS.');
    }
  }
  if (config.storageMode === 'postgres' && !has(config.databaseUrl)) {
    errors.push('DATABASE_URL is required when STORAGE_MODE=postgres.');
  }
  if ((has(config.ebayClientId) || has(config.ebayClientSecret) || has(config.ebayRedirectUriName)) && !has(config.ebayOauthStateSecret)) {
    errors.push('EBAY_OAUTH_STATE_SECRET is required when eBay OAuth is configured.');
  }
  if (config.billingProvider === 'stripe') {
    if (!has(config.stripeSecretKey)) errors.push('STRIPE_SECRET_KEY is required when BILLING_PROVIDER=stripe.');
    if (!has(config.stripeWebhookSecret)) errors.push('STRIPE_WEBHOOK_SECRET is required for Stripe webhooks.');
  }
  return {
    mode,
    ok: errors.length === 0,
    errors,
    warnings,
    safeConfig: redactSecrets({
      version: config.version,
      releaseChannel: config.releaseChannel,
      publicBaseUrl: config.publicBaseUrl,
      storageMode: config.storageMode,
      cacheMode: config.cacheMode,
      billingProvider: config.billingProvider,
      demoMode: config.demoMode,
      secureCookies: config.secureCookies,
      requireAuthentication: config.requireAuthentication,
      requireEmailVerification: config.requireEmailVerification,
      csrfProtection: config.csrfProtection,
      metaIntakeMode: config.metaIntakeEnabled === true && config.metaKillSwitch === false
        ? 'enabled'
        : 'disabled',
      metaAttachmentAllowedHostCount: Array.isArray(config.metaAttachmentAllowedHosts)
        ? config.metaAttachmentAllowedHosts.length
        : 0,
      metaGraphApiVersion: config.metaGraphApiVersion,
      metaMode: config.metaKillSwitch === true
        ? 'disabled'
        : config.metaOutboundEnabled === true
          ? 'owner_approval'
          : 'draft_only',
      allowedOrigins: config.allowedOrigins,
      widgetAllowedOrigins: config.widgetAllowedOrigins,
    }),
  };
}

export function assertRuntimeConfig(config = {}, env = process.env) {
  const validation = validateRuntimeConfig(config, env);
  if (!validation.ok) throw new ConfigurationError('ManeFlow production configuration is not safe to start.', validation);
  return validation;
}
