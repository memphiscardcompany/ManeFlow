import { makeId, normalizeText, roundMoney } from './utils.js';
import { assertOrganizationAccess } from './shop-permissions.js';
import { calculateValuation } from './valuation.js';
import { buildCardDecisionSignal, buildShopInventoryDecisionSupport, recommendShopInventoryAction } from './portfolio-decisions.js';

function clean(value, max = 500) { return String(value ?? '').trim().slice(0, max); }
function money(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) && n >= 0 ? roundMoney(n) : fallback; }
function int(value, fallback = 1) { const n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : fallback; }

function inventoryMergeKey(input = {}) {
  return [
    clean(input.organizationId, 160),
    clean(input.cardId, 160) || normalizeText(input.name),
    normalizeText(input.name),
    normalizeText(input.sku),
    normalizeText(input.barcode),
    normalizeText(input.location),
    ['available', 'listed', 'sold', 'hold', 'grading', 'consigned'].includes(input.status) ? input.status : 'available',
    money(input.costBasis ?? input.purchasePrice, 0),
    input.listPrice === null || input.listPrice === undefined ? 'null' : money(input.listPrice, 0),
  ].join('|');
}

export async function addShopInventoryItem(store, actor, organizationId, input = {}, { cards = [], sales = [], demoMode = true, overrides = {} } = {}) {
  assertOrganizationAccess(store.state, actor, organizationId, 'staff');
  const card = input.cardId ? cards.find((item) => item.id === input.cardId) : null;
  const now = new Date().toISOString();
  const normalizedInput = { ...input, organizationId, name: clean(input.name || card?.player || 'Unmatched card', 240) };
  const mergeKey = inventoryMergeKey(normalizedInput);
  const mergeTarget = input.mergeDuplicates === false ? null : (store.state.shopInventory || []).find((entry) => inventoryMergeKey(entry) === mergeKey);
  if (mergeTarget) {
    const quantityAdded = int(input.quantity, 1);
    mergeTarget.quantity += quantityAdded;
    const notes = clean(input.notes, 2500);
    if (notes && !mergeTarget.notes.includes(notes)) mergeTarget.notes = [mergeTarget.notes, notes].filter(Boolean).join('\n');
    mergeTarget.updatedAt = now;
    mergeTarget.lastMergedAt = now;
    mergeTarget.mergeCount = Math.max(0, Number(mergeTarget.mergeCount || 0)) + 1;
    store.state.shopAuditLog.unshift({ id: makeId('shop_audit'), type: 'inventory_quantity_merged', organizationId, userId: actor.userId, itemId: mergeTarget.id, quantityAdded, createdAt: now });
    await store.persist();
    return { ...enrichShopInventoryItem(mergeTarget, { cards, sales, demoMode, overrides }), merged: true, quantityAdded };
  }
  const item = {
    id: makeId('shop_item'), organizationId, cardId: input.cardId || null,
    name: normalizedInput.name, sku: clean(input.sku, 120), barcode: clean(input.barcode, 160),
    quantity: int(input.quantity, 1), costBasis: money(input.costBasis ?? input.purchasePrice, 0), listPrice: input.listPrice === undefined ? null : money(input.listPrice, 0),
    location: clean(input.location, 160), status: ['available', 'listed', 'sold', 'hold', 'grading', 'consigned'].includes(input.status) ? input.status : 'available',
    source: clean(input.source || 'manual', 80), notes: clean(input.notes, 2500), createdBy: actor.userId, createdAt: now, updatedAt: now,
  };
  store.state.shopInventory.push(item);
  store.state.shopAuditLog.unshift({ id: makeId('shop_audit'), type: 'inventory_added', organizationId, userId: actor.userId, itemId: item.id, createdAt: now });
  await store.persist();
  return { ...enrichShopInventoryItem(item, { cards, sales, demoMode, overrides }), merged: false, quantityAdded: item.quantity };
}

export async function updateShopInventoryItem(store, actor, organizationId, itemId, input = {}, context = {}) {
  assertOrganizationAccess(store.state, actor, organizationId, 'staff');
  const item = store.state.shopInventory.find((entry) => entry.organizationId === organizationId && entry.id === itemId);
  if (!item) return null;
  if (input.quantity !== undefined) item.quantity = int(input.quantity, item.quantity);
  if (input.costBasis !== undefined) item.costBasis = money(input.costBasis, item.costBasis);
  if (input.listPrice !== undefined) item.listPrice = input.listPrice === null ? null : money(input.listPrice, item.listPrice);
  for (const key of ['name', 'sku', 'barcode', 'location', 'notes', 'source']) if (input[key] !== undefined) item[key] = clean(input[key], key === 'notes' ? 2500 : 240);
  if (input.status !== undefined && ['available', 'listed', 'sold', 'hold', 'grading', 'consigned'].includes(input.status)) item.status = input.status;
  item.updatedAt = new Date().toISOString();
  store.state.shopAuditLog.unshift({ id: makeId('shop_audit'), type: 'inventory_updated', organizationId, userId: actor.userId, itemId, createdAt: item.updatedAt });
  await store.persist();
  return enrichShopInventoryItem(item, context);
}

export function enrichShopInventoryItem(item, { cards = [], sales = [], demoMode = true, overrides = {} } = {}) {
  const card = cards.find((entry) => entry.id === item.cardId) || null;
  const market = card ? calculateValuation(sales.filter((sale) => sale.cardId === card.id), { card, demoMode, overrides }) : null;
  const marketValue = market?.value ? roundMoney(market.value * item.quantity) : 0;
  const costBasis = roundMoney((Number(item.costBasis) || 0) * item.quantity);
  const enriched = { ...item, card, market, marketValue, currentValue: marketValue, costBasisTotal: costBasis, unrealizedGain: roundMoney(marketValue - costBasis), gain: roundMoney(marketValue - costBasis) };
  const decisionInput = { ...enriched, costBasis };
  const decision = buildCardDecisionSignal(decisionInput);
  return { ...enriched, decision, shopAction: recommendShopInventoryAction(enriched, decision) };
}

export function listShopInventory(store, actor, organizationId, context = {}) {
  assertOrganizationAccess(store.state, actor, organizationId, 'viewer');
  return (store.state.shopInventory || []).filter((item) => item.organizationId === organizationId).map((item) => enrichShopInventoryItem(item, context));
}

export function shopDashboard(store, actor, organizationId, context = {}) {
  const inventory = listShopInventory(store, actor, organizationId, context);
  const quantity = inventory.reduce((sum, item) => sum + item.quantity, 0);
  const inventoryValue = roundMoney(inventory.reduce((sum, item) => sum + item.marketValue, 0));
  const costBasis = roundMoney(inventory.reduce((sum, item) => sum + item.costBasisTotal, 0));
  const stale = inventory.filter((item) => item.market?.freshnessHours === null || item.market?.confidence < 45);
  const decisionSupport = buildShopInventoryDecisionSupport(inventory, context);
  return {
    organizationId,
    itemCount: inventory.length,
    quantity,
    inventoryValue,
    costBasis,
    unrealizedGain: roundMoney(inventoryValue - costBasis),
    staleValuations: stale.length,
    decisionSupport,
    listCandidates: decisionSupport.listCandidates,
    holdCandidates: decisionSupport.holdCandidates,
    repriceCandidates: decisionSupport.repriceCandidates,
    reviewCandidates: decisionSupport.reviewCandidates,
    inventory,
  };
}
