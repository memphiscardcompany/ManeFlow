import { makeId, roundMoney } from './utils.js';
import { assertOrganizationAccess } from './shop-permissions.js';
import { buildDealerDecision } from './dealer-decision.js';

const STATUSES = new Set(['draft', 'reviewing', 'offer_sent', 'accepted', 'rejected', 'consigned', 'inventoried']);

export async function createIntakeBatch(store, actor, input = {}) {
  const organizationId = input.organizationId || null;
  if (organizationId) assertOrganizationAccess(store.state, actor, organizationId, 'staff');
  if (!actor?.userId) throw Object.assign(new Error('Authentication required.'), { status: 401 });
  const now = new Date().toISOString();
  const batch = {
    id: makeId('intake_batch'), userId: actor.userId, organizationId,
    source: ['show', 'walk-in', 'collection buy', 'consignment', 'trade night', 'online intake'].includes(input.source) ? input.source : 'walk-in',
    status: 'draft', title: String(input.title || 'ManeFlow intake batch').slice(0, 180), customerName: String(input.customerName || '').slice(0, 160),
    customerEmail: String(input.customerEmail || '').slice(0, 320), notes: String(input.notes || '').slice(0, 2500), items: [], createdAt: now, updatedAt: now,
  };
  store.state.intakeBatches.unshift(batch);
  await store.persist();
  return batch;
}

export async function addIntakeBatchItem(store, actor, batchId, input = {}, context = {}) {
  const batch = (store.state.intakeBatches || []).find((entry) => entry.id === batchId && (entry.userId === actor?.userId || entry.organizationId));
  if (!batch) return null;
  if (batch.organizationId) assertOrganizationAccess(store.state, actor, batch.organizationId, 'staff');
  const card = input.cardId ? (context.cards || []).find((entry) => entry.id === input.cardId) : null;
  const decision = card ? buildDealerDecision({ card, sales: context.sales || [], demoMode: context.demoMode, overrides: context.overrides || {} }) : null;
  const item = { id: makeId('intake_item'), cardId: input.cardId || null, name: String(input.name || card?.player || '').slice(0, 240), quantity: Math.max(1, Number(input.quantity || 1)), conditionNotes: String(input.conditionNotes || '').slice(0, 1000), reviewStatus: input.reviewStatus || 'pending', dealerDecision: decision, createdAt: new Date().toISOString() };
  batch.items.push(item);
  batch.updatedAt = new Date().toISOString();
  await store.persist();
  return item;
}

export async function updateIntakeBatchStatus(store, actor, batchId, status) {
  const batch = (store.state.intakeBatches || []).find((entry) => entry.id === batchId && (entry.userId === actor?.userId || entry.organizationId));
  if (!batch) return null;
  if (batch.organizationId) assertOrganizationAccess(store.state, actor, batch.organizationId, 'manager');
  if (STATUSES.has(status)) batch.status = status;
  batch.updatedAt = new Date().toISOString();
  await store.persist();
  return batch;
}

export function generateOfferSheet(batch) {
  const rows = (batch.items || []).map((item) => ({ cardId: item.cardId, name: item.name, quantity: item.quantity, buyLow: item.dealerDecision?.dealerBuyRange?.low || '', buyHigh: item.dealerDecision?.dealerBuyRange?.high || '', suggestedAction: item.dealerDecision?.suggestedAction || 'Review needed' }));
  const high = rows.reduce((sum, row) => sum + (Number(row.buyHigh) || 0) * (Number(row.quantity) || 1), 0);
  return { batchId: batch.id, status: batch.status, itemCount: rows.length, estimatedOfferHigh: roundMoney(high), rows, disclaimer: 'Offer sheet is an internal decision aid and not a binding offer.' };
}
