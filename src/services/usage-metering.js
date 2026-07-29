import { makeId } from './utils.js';
import { entitlementsFor, withinLimit } from './plans.js';

export const USAGE_EVENTS = Object.freeze([
  'scan',
  'scan_session',
  'valuation_view',
  'portfolio_snapshot',
  'export',
  'shop_seat',
  'shop_inventory_item',
  'api_request',
  'public_widget',
  'public_value_page',
  'provider_import',
  'bulk_intake_batch',
]);

function periodKey(date = new Date(), period = 'day') {
  const d = new Date(date);
  if (period === 'month') return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  return d.toISOString().slice(0, 10);
}

function usageBucket(store, userId) {
  if (!store.state.usageRecords) store.state.usageRecords = [];
  return store.state.usageRecords.filter((item) => item.userId === userId);
}

export function currentUsage(store, userId, { eventType = null, period = 'day', now = new Date() } = {}) {
  const key = periodKey(now, period);
  return usageBucket(store, userId).filter((item) => (
    (!eventType || item.eventType === eventType) && item.period === period && item.periodKey === key
  )).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
}

export async function recordUsage(store, actor, eventType, quantity = 1, metadata = {}, options = {}) {
  if (!USAGE_EVENTS.includes(eventType)) throw new Error(`Unsupported usage event: ${eventType}`);
  const userId = actor?.userId || options.userId || 'guest';
  const period = options.period || 'day';
  const now = options.now || new Date();
  const item = {
    id: makeId('usage'),
    userId,
    organizationId: options.organizationId || metadata.organizationId || null,
    eventType,
    quantity: Math.max(1, Math.floor(Number(quantity) || 1)),
    period,
    periodKey: periodKey(now, period),
    metadata,
    createdAt: now.toISOString(),
  };
  if (!store.state.usageRecords) store.state.usageRecords = [];
  store.state.usageRecords.unshift(item);
  store.state.usageRecords = store.state.usageRecords.slice(0, 25_000);
  if (typeof store.audit === 'function') await store.audit({ type: 'usage_recorded', userId, eventType, quantity: item.quantity, organizationId: item.organizationId });
  else await store.persist();
  return item;
}

export function usageGate(store, actor, eventType, quantity = 1, options = {}) {
  const entitlements = entitlementsFor(actor);
  const limits = {
    scan: entitlements.scansPerDay,
    scan_session: entitlements.scansPerDay,
    export: entitlements.exports ? null : 0,
    shop_inventory_item: entitlements.vaultItems,
    api_request: entitlements.apiAccess ? null : 0,
  };
  const limit = limits[eventType];
  if (limit === undefined || limit === null) return { allowed: true, limit: null, used: 0, remaining: null, entitlements };
  const used = currentUsage(store, actor?.userId || 'guest', { eventType, period: 'day', now: options.now || new Date() });
  const allowed = withinLimit(used + quantity - 1, limit);
  return { allowed, limit, used, remaining: Math.max(0, limit - used), entitlements };
}

export function summarizeUsage(store, userId, { now = new Date() } = {}) {
  return Object.fromEntries(USAGE_EVENTS.map((eventType) => [eventType, currentUsage(store, userId, { eventType, now })]));
}
