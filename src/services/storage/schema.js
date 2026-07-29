export const STORAGE_DOMAINS = Object.freeze([
  'users',
  'sessions',
  'vaults',
  'cards',
  'organizations',
  'shopInventory',
  'shopMembers',
  'shopInvites',
  'pricingData',
  'compReviews',
  'providerImports',
  'watchlists',
  'alerts',
  'intakeBatches',
  'consignmentRecords',
  'listingDrafts',
  'auditLogs',
  'billingEntitlements',
  'usageRecords',
  'publicValuePages',
  'scanSessions',
]);

export function storageSchemaSummary() {
  return {
    version: 8,
    domains: STORAGE_DOMAINS,
    jsonMode: 'fully_supported_local_and_demo_mode',
    postgresMode: 'supported_when_pg_dependency_and_DATABASE_URL_are_configured',
  };
}
