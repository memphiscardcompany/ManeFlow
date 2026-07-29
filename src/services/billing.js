import crypto from 'node:crypto';
import { makeId, timingSafeEqualString } from './utils.js';

export const SUBSCRIPTION_STATES = Object.freeze([
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'comped',
  'manual_enterprise',
]);

const STRIPE_TO_MANEFLOW_STATE = Object.freeze({
  trialing: 'trialing',
  active: 'active',
  past_due: 'past_due',
  canceled: 'canceled',
  unpaid: 'unpaid',
  incomplete_expired: 'unpaid',
  paused: 'past_due',
});

function safeState(value, fallback = 'active') {
  return SUBSCRIPTION_STATES.includes(value) ? value : fallback;
}

export function verifyStripeSignature(rawBody, signatureHeader, secret, toleranceSeconds = 300, now = Date.now()) {
  if (!secret || !signatureHeader) return false;
  const parts = Object.fromEntries(String(signatureHeader).split(',').map((part) => {
    const [key, value] = part.split('=');
    return [key, value];
  }));
  const timestamp = Number(parts.t);
  const signature = parts.v1;
  if (!timestamp || !signature) return false;
  if (Math.abs(now / 1000 - timestamp) > toleranceSeconds) return false;
  const signedPayload = `${timestamp}.${Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody)}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  return timingSafeEqualString(signature, expected);
}

export function subscriptionFromStripeEvent(event = {}) {
  const object = event.data?.object || {};
  const status = STRIPE_TO_MANEFLOW_STATE[object.status] || 'past_due';
  const plan = object.metadata?.maneflow_plan || object.items?.data?.[0]?.price?.metadata?.maneflow_plan || 'collector';
  return {
    provider: 'stripe',
    providerCustomerId: object.customer || null,
    providerSubscriptionId: object.id || null,
    status: safeState(status),
    plan: ['free', 'collector', 'merchant', 'enterprise'].includes(plan) ? plan : 'collector',
    currentPeriodEnd: object.current_period_end ? new Date(object.current_period_end * 1000).toISOString() : null,
    cancelAtPeriodEnd: Boolean(object.cancel_at_period_end),
    syncedAt: new Date().toISOString(),
  };
}

export async function upsertBillingEntitlement(store, actor, input = {}) {
  const userId = input.userId || actor?.userId;
  if (!userId) throw new Error('userId is required for billing entitlement updates');
  if (!store.state.billingEntitlements) store.state.billingEntitlements = [];
  const now = new Date().toISOString();
  const existing = store.state.billingEntitlements.find((item) => item.userId === userId && item.provider === (input.provider || 'manual'));
  const entitlement = existing || { id: makeId('billing'), userId, provider: input.provider || 'manual', createdAt: now };
  Object.assign(entitlement, {
    status: safeState(input.status || entitlement.status || 'active'),
    plan: input.plan || entitlement.plan || 'collector',
    providerCustomerId: input.providerCustomerId || entitlement.providerCustomerId || null,
    providerSubscriptionId: input.providerSubscriptionId || entitlement.providerSubscriptionId || null,
    currentPeriodEnd: input.currentPeriodEnd || entitlement.currentPeriodEnd || null,
    cancelAtPeriodEnd: Boolean(input.cancelAtPeriodEnd),
    notes: String(input.notes || entitlement.notes || '').slice(0, 1000),
    updatedAt: now,
  });
  if (!existing) store.state.billingEntitlements.push(entitlement);
  const user = store.findUserById?.(userId);
  if (user && ['trialing', 'active', 'comped', 'manual_enterprise'].includes(entitlement.status)) {
    user.plan = entitlement.plan;
    user.updatedAt = now;
  }
  await store.audit({ type: 'billing_entitlement_updated', userId, actorUserId: actor?.userId || 'system', provider: entitlement.provider, status: entitlement.status, plan: entitlement.plan });
  return structuredClone(entitlement);
}

export function billingSummary(store, userId) {
  const entitlements = (store.state.billingEntitlements || []).filter((item) => item.userId === userId);
  const active = entitlements.find((item) => ['trialing', 'active', 'comped', 'manual_enterprise'].includes(item.status)) || null;
  return {
    entitlements: structuredClone(entitlements),
    active,
    billingReady: true,
    disclaimer: 'Billing records enforce ManeFlow entitlements. Live charges require owner-controlled Stripe, Apple, or Google configuration.',
  };
}
