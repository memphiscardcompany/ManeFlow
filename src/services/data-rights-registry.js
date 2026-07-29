import { makeId, normalizeText } from './utils.js';

export const DATA_RIGHTS_VERSION = 'data-rights-v1.0';

export const SOURCE_TYPES = Object.freeze([
  'official_api',
  'seller_authorized_api',
  'user_uploaded_export',
  'partner_feed',
  'signed_webhook',
  'licensed_vendor',
  'manual_evidence',
  'screenshot_evidence',
  'receipt_or_invoice',
  'approved_public_web',
  'review_only',
  'prohibited',
]);

export const REVIEW_STATUSES = Object.freeze(['draft', 'needs_review', 'approved', 'blocked', 'expired']);

export const DEFAULT_SOURCE_POLICIES = Object.freeze([
  {
    provider: 'eBay Marketplace Insights',
    sourceType: 'official_api',
    authorizationBasis: 'ebay_api',
    dataRightsStatus: 'restricted_api_approval_required',
    termsUrl: 'https://developer.ebay.com/join/api-license-agreement',
    valuationEligible: true,
    publicDisplayEligible: true,
    legalReviewStatus: 'needs_review',
    ownerApprovalStatus: 'pending',
    notes: 'Limited-release eBay sold-history API. Enable only after approved access and written use rights are confirmed.',
  },
  {
    provider: 'eBay Seller Orders',
    sourceType: 'seller_authorized_api',
    authorizationBasis: 'ebay_api',
    dataRightsStatus: 'seller_account_authorized_orders_only',
    termsUrl: 'https://developer.ebay.com/join/api-license-agreement',
    valuationEligible: true,
    publicDisplayEligible: false,
    legalReviewStatus: 'needs_review',
    ownerApprovalStatus: 'pending',
    notes: 'Authenticated seller orders are real seller-owned sales, not market-wide eBay sold-history coverage.',
  },
  {
    provider: 'eBay Browse',
    sourceType: 'official_api',
    authorizationBasis: 'ebay_api',
    dataRightsStatus: 'active_listing_context_only',
    termsUrl: 'https://developer.ebay.com/api-docs/buy/static/api-browse.html',
    valuationEligible: false,
    publicDisplayEligible: true,
    legalReviewStatus: 'approved',
    ownerApprovalStatus: 'approved',
    notes: 'Active listings are context only and must never become completed-sale valuation comps.',
  },
  {
    provider: 'eBay Browse Listing Images',
    sourceType: 'official_api',
    authorizationBasis: 'ebay_api',
    dataRightsStatus: 'active_listing_images_internal_benchmark_only',
    termsUrl: 'https://developer.ebay.com/api-docs/buy/static/api-browse.html',
    valuationEligible: false,
    publicDisplayEligible: false,
    benchmarkEligible: true,
    imageEligible: false,
    legalReviewStatus: 'approved',
    ownerApprovalStatus: 'approved',
    notes: 'Listing image URLs returned by the official eBay Browse API may be used for internal scanner QA manifests. They are not completed-sale comps, not public catalog artwork, and should not be redistributed.',
  },
  {
    provider: 'TCGplayer',
    sourceType: 'review_only',
    authorizationBasis: 'written_license',
    dataRightsStatus: 'partner_or_store_authorization_required',
    termsUrl: 'https://help.tcgplayer.com/hc/en-us/articles/360061115874-TCGplayer-API-Terms-Conditions',
    valuationEligible: false,
    publicDisplayEligible: false,
    legalReviewStatus: 'blocked',
    ownerApprovalStatus: 'pending',
    notes: 'Do not scrape pricing pages. Use approved API/partner/store-authorized exports only.',
  },
  {
    provider: 'Pokemon TCG API',
    sourceType: 'official_api',
    authorizationBasis: 'api_terms',
    dataRightsStatus: 'catalog_identity_api_with_account_terms',
    termsUrl: 'https://dev.pokemontcg.io/terms',
    valuationEligible: false,
    publicDisplayEligible: true,
    legalReviewStatus: 'needs_review',
    ownerApprovalStatus: 'pending',
    notes: 'Use API keys and documented endpoints for Pokemon catalog identity. Do not overload the API or use stale price fields as completed-sale comps.',
  },
  {
    provider: 'TCGdex API',
    sourceType: 'official_api',
    authorizationBasis: 'api_terms',
    dataRightsStatus: 'catalog_identity_api',
    termsUrl: 'https://tcgdex.dev/rest',
    valuationEligible: false,
    publicDisplayEligible: true,
    catalogEligible: true,
    imageEligible: true,
    legalReviewStatus: 'needs_review',
    ownerApprovalStatus: 'pending',
    notes: 'Use documented HTTPS GET endpoints for Pokemon catalog identity and returned artwork URLs. Do not treat any catalog data as completed-sale pricing.',
  },
  {
    provider: 'Scryfall Bulk Data',
    sourceType: 'official_api',
    authorizationBasis: 'api_terms',
    dataRightsStatus: 'bulk_catalog_identity_data',
    termsUrl: 'https://scryfall.com/docs/api',
    valuationEligible: false,
    publicDisplayEligible: true,
    legalReviewStatus: 'needs_review',
    ownerApprovalStatus: 'pending',
    notes: 'Use Scryfall bulk data for Magic catalog identity. Bulk price fields are not completed-sale comps and should not power storefront pricing.',
  },
  {
    provider: 'YGOPRODeck API',
    sourceType: 'official_api',
    authorizationBasis: 'api_terms',
    dataRightsStatus: 'catalog_identity_api',
    termsUrl: 'https://api.ygoprodeck.com/api-guide/',
    valuationEligible: false,
    publicDisplayEligible: true,
    catalogEligible: true,
    imageEligible: true,
    legalReviewStatus: 'needs_review',
    ownerApprovalStatus: 'pending',
    notes: 'Use documented JSON endpoints and returned image URLs for Yu-Gi-Oh catalog identity. Prices returned by the API are context only, not completed-sale comps.',
  },
  {
    provider: 'GotThatData Sports Cards Dataset',
    sourceType: 'approved_public_web',
    authorizationBasis: 'open_dataset_license',
    dataRightsStatus: 'internal_recognition_benchmark_dataset',
    termsUrl: 'https://huggingface.co/datasets/GotThatData/sports-cards',
    valuationEligible: false,
    publicDisplayEligible: false,
    benchmarkEligible: true,
    aiTrainingAllowed: true,
    legalReviewStatus: 'approved',
    ownerApprovalStatus: 'approved',
    notes: 'MIT-licensed public dataset suitable for internal recognition testing and benchmark reports. Do not convert benchmark labels into production market values.',
  },
  {
    provider: 'acidtib MTG Card Image Dataset',
    sourceType: 'review_only',
    authorizationBasis: 'dataset_terms_review_required',
    dataRightsStatus: 'large_scryfall_derived_image_dataset_review_before_training',
    termsUrl: 'https://huggingface.co/datasets/acidtib/tcg-mtg-cards',
    valuationEligible: false,
    publicDisplayEligible: false,
    benchmarkEligible: true,
    legalReviewStatus: 'needs_review',
    ownerApprovalStatus: 'pending',
    notes: 'Large Scryfall-derived MTG image dataset. Use Scryfall bulk/API directly when possible; require owner/legal review before large-scale local training or redistribution.',
  },
  {
    provider: 'CardSight AI',
    sourceType: 'licensed_vendor',
    authorizationBasis: 'commercial_api_terms',
    dataRightsStatus: 'vendor_api_key_required',
    termsUrl: 'https://cardsight.ai/terms',
    valuationEligible: false,
    publicDisplayEligible: false,
    benchmarkEligible: true,
    legalReviewStatus: 'needs_review',
    ownerApprovalStatus: 'pending',
    notes: 'Commercial recognition/catalog/pricing API. Use as benchmark or fallback only after account setup and terms review; do not expose vendor credentials.',
  },
  {
    provider: 'CardGrader.AI',
    sourceType: 'licensed_vendor',
    authorizationBasis: 'commercial_api_terms',
    dataRightsStatus: 'vendor_api_key_required',
    termsUrl: 'https://cardgrader.ai/api-docs',
    valuationEligible: false,
    publicDisplayEligible: false,
    benchmarkEligible: true,
    legalReviewStatus: 'needs_review',
    ownerApprovalStatus: 'pending',
    notes: 'Commercial async scan/identify/grade/market API. Useful for benchmark comparison only after account setup and terms review; AI grades are estimates.',
  },
  {
    provider: 'JustTCG API',
    sourceType: 'licensed_vendor',
    authorizationBasis: 'commercial_api_terms',
    dataRightsStatus: 'tcg_pricing_context_api_key_required',
    termsUrl: 'https://justtcg.com/docs/quickstart',
    valuationEligible: false,
    publicDisplayEligible: false,
    pricingContextEligible: true,
    legalReviewStatus: 'needs_review',
    ownerApprovalStatus: 'pending',
    notes: 'TCG pricing API can provide pricing context and history under account terms. Keep separate from completed-sale comp averages unless provider terms/data prove completed-sale basis.',
  },
  {
    provider: 'PriceCharting API',
    sourceType: 'licensed_vendor',
    authorizationBasis: 'paid_api_terms',
    dataRightsStatus: 'paid_price_guide_api_required',
    termsUrl: 'https://www.pricecharting.com/api-documentation',
    valuationEligible: false,
    publicDisplayEligible: false,
    pricingContextEligible: true,
    legalReviewStatus: 'needs_review',
    ownerApprovalStatus: 'pending',
    notes: 'Paid guide/API values are useful as secondary pricing context. Documentation states current values, not historical completed sales, so do not mix into completed-sale averages.',
  },
  {
    provider: 'Apify Marketplace Actors',
    sourceType: 'review_only',
    authorizationBasis: 'target_site_authorization_required',
    dataRightsStatus: 'actor_output_requires_target_rights_review',
    termsUrl: 'https://docs.apify.com/legal/general-terms-and-conditions',
    valuationEligible: false,
    publicDisplayEligible: false,
    benchmarkEligible: false,
    legalReviewStatus: 'needs_review',
    ownerApprovalStatus: 'pending',
    notes: 'Apify tooling does not by itself grant rights to target-site content. Only import actor outputs when the target site permits the exact use or written permission is recorded.',
  },
  {
    provider: 'COMC',
    sourceType: 'prohibited',
    authorizationBasis: 'written_permission_required',
    dataRightsStatus: 'site_content_and_images_restricted_without_permission',
    termsUrl: 'https://www.comc.com/UserAgreement',
    valuationEligible: false,
    publicDisplayEligible: false,
    benchmarkEligible: false,
    legalReviewStatus: 'approved',
    ownerApprovalStatus: 'approved',
    notes: 'Do not scrape COMC images/data. Use COMC only through written permission, partner access, seller-authorized exports, or owner-provided files with documented rights.',
  },
  {
    provider: 'Authorized TCG Catalog CSV',
    sourceType: 'user_uploaded_export',
    authorizationBasis: 'user_authorized_export',
    dataRightsStatus: 'catalog_identity_data_only',
    valuationEligible: false,
    publicDisplayEligible: true,
    legalReviewStatus: 'approved',
    ownerApprovalStatus: 'approved',
    notes: 'Shop-owned, user-uploaded, or licensed TCG checklist/catalog CSVs may expand autocomplete only. They do not create market values.',
  },
  {
    provider: 'Topps Official Checklists',
    sourceType: 'approved_public_web',
    authorizationBasis: 'public_web_allowed',
    dataRightsStatus: 'official_public_checklist_identity_data_only',
    termsUrl: 'https://www.topps.com/pages/checklists',
    robotsUrl: 'https://www.topps.com/robots.txt',
    allowedPaths: ['/pages/checklists'],
    valuationEligible: false,
    publicDisplayEligible: true,
    legalReviewStatus: 'approved',
    ownerApprovalStatus: 'approved',
    rateLimitPerMinute: 8,
    crawlDelaySeconds: 2,
    attributionRequired: true,
    attributionText: 'Checklist identity data sourced from Topps public checklist pages.',
    notes: 'Official public checklist pages may be used for card identity autocomplete only. They are not pricing comps and do not create market values.',
  },
  {
    provider: 'Panini Official Checklists',
    sourceType: 'approved_public_web',
    authorizationBasis: 'public_web_allowed',
    dataRightsStatus: 'official_public_checklist_identity_data_only',
    termsUrl: 'https://www.paniniamerica.net/checklist.html',
    robotsUrl: 'https://www.paniniamerica.net/robots.txt',
    allowedPaths: ['/checklist.html', '/resources/checklist.html'],
    valuationEligible: false,
    publicDisplayEligible: true,
    legalReviewStatus: 'approved',
    ownerApprovalStatus: 'approved',
    rateLimitPerMinute: 6,
    crawlDelaySeconds: 3,
    attributionRequired: true,
    attributionText: 'Checklist identity data sourced from Panini public checklist pages.',
    notes: 'Official public checklist pages may be used for card identity autocomplete only. JavaScript/API-backed pages must still be collected without bypassing access controls.',
  },
  {
    provider: 'Upper Deck Official Checklists',
    sourceType: 'approved_public_web',
    authorizationBasis: 'public_web_allowed',
    dataRightsStatus: 'official_public_checklist_identity_data_only',
    termsUrl: 'https://upperdeck.com/checklists/',
    robotsUrl: 'https://upperdeck.com/robots.txt',
    allowedPaths: ['/checklists', '/checklist-brand'],
    valuationEligible: false,
    publicDisplayEligible: true,
    legalReviewStatus: 'approved',
    ownerApprovalStatus: 'approved',
    rateLimitPerMinute: 6,
    crawlDelaySeconds: 3,
    attributionRequired: true,
    attributionText: 'Checklist identity data sourced from Upper Deck public checklist pages.',
    notes: 'Official public checklist pages may be used for card identity autocomplete only and should retain attribution.',
  },
  {
    provider: 'Beckett Checklist Articles',
    sourceType: 'review_only',
    authorizationBasis: 'written_license',
    dataRightsStatus: 'commercial_license_or_manual_review_required',
    termsUrl: 'https://www.beckett.com/news/category/baseball/baseball-card-checklists/',
    valuationEligible: false,
    publicDisplayEligible: false,
    legalReviewStatus: 'needs_review',
    ownerApprovalStatus: 'pending',
    notes: 'Beckett publishes rich checklist articles, but commercial extraction should require source-policy/legal review or written permission.',
  },
  {
    provider: 'Trading Card Database',
    sourceType: 'prohibited',
    authorizationBasis: 'not_allowed',
    dataRightsStatus: 'terms_prohibit_data_mining_and_commercial_exploitation',
    termsUrl: 'https://www.tcdb.com/TermsOfUse.cfm',
    valuationEligible: false,
    publicDisplayEligible: false,
    legalReviewStatus: 'approved',
    ownerApprovalStatus: 'approved',
    notes: 'Terms prohibit data mining, robots, screen scraping, and commercial exploitation without express written consent. Do not collect TCDB data unless written permission is obtained.',
  },
  {
    provider: 'Whatnot',
    sourceType: 'review_only',
    authorizationBasis: 'user_authorized_export',
    dataRightsStatus: 'seller_api_preview_access_required',
    termsUrl: 'https://developers.whatnot.com/docs/getting-started/introduction',
    valuationEligible: false,
    publicDisplayEligible: false,
    legalReviewStatus: 'blocked',
    ownerApprovalStatus: 'pending',
    notes: 'Use approved Seller API/webhooks or user-authorized exports only.',
  },
  {
    provider: 'Manual Comp Evidence',
    sourceType: 'manual_evidence',
    authorizationBasis: 'user_authorized_export',
    dataRightsStatus: 'review_required',
    valuationEligible: false,
    publicDisplayEligible: false,
    legalReviewStatus: 'approved',
    ownerApprovalStatus: 'approved',
    notes: 'Manual comps and screenshots start in review and require admin approval before valuation use.',
  },
  ...['PSA', 'BGS', 'SGC', 'CGC'].map((grader) => ({
    provider: `${grader} Cert Verification`,
    sourceType: 'approved_public_web',
    authorizationBasis: 'public_web_allowed',
    dataRightsStatus: 'cert_verification_linking_only',
    valuationEligible: false,
    publicDisplayEligible: false,
    legalReviewStatus: 'approved',
    ownerApprovalStatus: 'approved',
    rateLimitPerMinute: 6,
    crawlDelaySeconds: 2,
    notes: 'Cert verification supports identity review only. It is not a guarantee of authenticity and must not bypass restricted pages.',
  })),
]);

function clean(value, max = 1000) {
  return String(value ?? '').trim().slice(0, max);
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'y', 'approved', 'allow', 'allowed'].includes(normalizeText(value));
}

export function sourceKey(value) {
  return normalizeText(value || 'unknown').replace(/\s+/g, '_') || 'unknown';
}

export function normalizeSourcePolicy(input = {}, now = new Date()) {
  const provider = clean(input.provider || input.name, 160);
  if (!provider) throw new Error('provider is required');
  const sourceType = SOURCE_TYPES.includes(input.sourceType) ? input.sourceType : 'review_only';
  const legalReviewStatus = REVIEW_STATUSES.includes(input.legalReviewStatus) ? input.legalReviewStatus : 'needs_review';
  const ownerApprovalStatus = ['approved', 'pending', 'rejected'].includes(input.ownerApprovalStatus) ? input.ownerApprovalStatus : 'pending';
  const valuationEligible = bool(input.valuationEligible, false) && legalReviewStatus === 'approved' && ownerApprovalStatus === 'approved' && sourceType !== 'prohibited' && sourceType !== 'review_only';
  return {
    id: clean(input.id, 120) || `source_${sourceKey(provider)}`,
    provider,
    sourceKey: sourceKey(provider),
    sourceType,
    authorizationBasis: clean(input.authorizationBasis || (sourceType === 'manual_evidence' ? 'user_authorized_export' : 'unknown'), 120),
    dataRightsStatus: clean(input.dataRightsStatus || 'needs_review', 160),
    termsUrl: clean(input.termsUrl, 800),
    robotsUrl: clean(input.robotsUrl, 800),
    allowedPaths: Array.isArray(input.allowedPaths) ? input.allowedPaths.map((item) => clean(item, 300)).filter(Boolean) : [],
    disallowedPaths: Array.isArray(input.disallowedPaths) ? input.disallowedPaths.map((item) => clean(item, 300)).filter(Boolean) : [],
    crawlDelaySeconds: Math.max(0, Number(input.crawlDelaySeconds || input.crawlDelay || 0)),
    rateLimitPerMinute: Math.max(1, Math.floor(Number(input.rateLimitPerMinute || 12))),
    attributionRequired: bool(input.attributionRequired, false),
    attributionText: clean(input.attributionText, 500),
    retentionPolicy: clean(input.retentionPolicy || 'retain_normalized_fields; raw evidence optional by owner setting', 500),
    redistributionRules: clean(input.redistributionRules || 'public_safe_summaries_only_when_approved', 500),
    aiTrainingAllowed: bool(input.aiTrainingAllowed, false),
    personalDataAllowed: bool(input.personalDataAllowed, false),
    legalReviewStatus,
    ownerApprovalStatus,
    valuationEligible,
    publicDisplayEligible: bool(input.publicDisplayEligible, false) && legalReviewStatus === 'approved' && ownerApprovalStatus === 'approved',
    benchmarkEligible: bool(input.benchmarkEligible, false) && legalReviewStatus === 'approved' && ownerApprovalStatus === 'approved' && sourceType !== 'prohibited',
    catalogEligible: bool(input.catalogEligible, bool(input.publicDisplayEligible, false)) && sourceType !== 'prohibited',
    imageEligible: bool(input.imageEligible, bool(input.publicDisplayEligible, false)) && sourceType !== 'prohibited',
    pricingContextEligible: bool(input.pricingContextEligible, false) && sourceType !== 'prohibited',
    lastReviewedAt: input.lastReviewedAt || (legalReviewStatus === 'approved' ? now.toISOString() : null),
    reviewedBy: clean(input.reviewedBy, 160),
    notes: clean(input.notes || input.rightsNotes, 1500),
    updatedAt: input.updatedAt || now.toISOString(),
    createdAt: input.createdAt || now.toISOString(),
  };
}

export function ensureSourcePolicies(state) {
  if (!state.sourcePolicies) state.sourcePolicies = [];
  const byKey = new Map(state.sourcePolicies.map((policy) => [policy.sourceKey || sourceKey(policy.provider), policy]));
  for (const seed of DEFAULT_SOURCE_POLICIES) {
    const key = sourceKey(seed.provider);
    if (!byKey.has(key)) {
      const policy = normalizeSourcePolicy(seed);
      state.sourcePolicies.push(policy);
      byKey.set(key, policy);
    }
  }
  return state.sourcePolicies;
}

export function listSourcePolicies(state) {
  return ensureSourcePolicies(state).map((policy) => structuredClone(policy));
}

export function findSourcePolicy(state, provider) {
  const key = sourceKey(provider);
  return ensureSourcePolicies(state).find((policy) => (policy.sourceKey || sourceKey(policy.provider)) === key) || null;
}

export async function upsertSourcePolicy(store, actor, input = {}) {
  const policies = ensureSourcePolicies(store.state);
  const normalized = normalizeSourcePolicy({
    ...input,
    reviewedBy: input.reviewedBy || actor?.userId || input.reviewedBy,
  });
  const index = policies.findIndex((policy) => policy.id === normalized.id || policy.sourceKey === normalized.sourceKey);
  if (index >= 0) policies[index] = { ...policies[index], ...normalized, createdAt: policies[index].createdAt || normalized.createdAt };
  else policies.unshift(normalized);
  await store.audit?.({ type: 'source_policy_upserted', userId: actor?.userId || null, provider: normalized.provider, sourceType: normalized.sourceType, legalReviewStatus: normalized.legalReviewStatus, ownerApprovalStatus: normalized.ownerApprovalStatus });
  await store.persist();
  return structuredClone(index >= 0 ? policies[index] : normalized);
}

export function publicSourcePolicy(policy = {}) {
  return {
    provider: policy.provider,
    sourceType: policy.sourceType,
    dataRightsStatus: policy.dataRightsStatus,
    valuationEligible: Boolean(policy.valuationEligible),
    publicDisplayEligible: Boolean(policy.publicDisplayEligible),
    benchmarkEligible: Boolean(policy.benchmarkEligible),
    catalogEligible: Boolean(policy.catalogEligible),
    imageEligible: Boolean(policy.imageEligible),
    pricingContextEligible: Boolean(policy.pricingContextEligible),
    attributionRequired: Boolean(policy.attributionRequired),
    attributionText: policy.attributionText || '',
    legalReviewStatus: policy.legalReviewStatus,
    ownerApprovalStatus: policy.ownerApprovalStatus,
    notes: policy.notes || '',
  };
}
