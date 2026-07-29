export const PLAN_DEFINITIONS = Object.freeze({
  free: {
    name: 'Free', monthlyPrice: 0, vaultItems: 250, scansPerDay: 50, historyDays: 90,
    csvImports: true, exports: true, merchantTools: false, apiAccess: false,
    description: 'Core scanning, pricing, watchlists, and collection tracking.',
  },
  collector: {
    name: 'Collector', monthlyPrice: 9.99, vaultItems: 10_000, scansPerDay: 500, historyDays: 365,
    csvImports: true, exports: true, merchantTools: false, apiAccess: false,
    description: 'Deep history, larger Vaults, and higher scan limits for active collectors.',
  },
  merchant: {
    name: 'Merchant', monthlyPrice: 29.99, vaultItems: 100_000, scansPerDay: 5_000, historyDays: 3650,
    csvImports: true, exports: true, merchantTools: true, apiAccess: true,
    description: 'High-volume workflows, merchant analytics, bulk operations, and API access.',
  },
  enterprise: {
    name: 'Enterprise', monthlyPrice: null, vaultItems: null, scansPerDay: null, historyDays: 3650,
    csvImports: true, exports: true, merchantTools: true, apiAccess: true,
    description: 'Custom limits, team operations, data integrations, and service commitments.',
  },
});

export function entitlementsFor(actor) {
  if (actor?.role === 'admin' || actor?.service) return { plan: 'enterprise', ...PLAN_DEFINITIONS.enterprise };
  const plan = actor?.user?.plan && PLAN_DEFINITIONS[actor.user.plan] ? actor.user.plan : 'free';
  return { plan, ...PLAN_DEFINITIONS[plan] };
}

export function withinLimit(current, limit) {
  return limit === null || current < limit;
}
