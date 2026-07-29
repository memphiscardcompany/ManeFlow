import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../src/services/store.js';
import { createOrganization, createOrganizationInvite, deactivateOrganization, removeOrganizationMember, updateOrganizationMemberRole, updateOrganizationProfile } from '../src/services/organizations.js';
import { canAccessOrganization, canUseShopPermission, SHOP_PERMISSIONS } from '../src/services/shop-permissions.js';
import { addShopInventoryItem, listShopInventory } from '../src/services/shop-inventory.js';

async function makeStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'maneflow-shop-life-'));
  const store = await new JsonStore(path.join(dir, 'state.json')).init();
  return { store, dir };
}

test('shop profile, permissions, member role, and deactivation are enforced', async () => {
  const { store, dir } = await makeStore();
  const owner = await store.createUser({ email: 'owner@example.com', name: 'Owner', passwordHash: 'h', passwordSalt: 's', role: 'merchant' });
  const staff = await store.createUser({ email: 'staff@example.com', name: 'Staff', passwordHash: 'h', passwordSalt: 's', role: 'merchant' });
  const ownerActor = { userId: owner.id, role: owner.role, user: owner };
  const staffActor = { userId: staff.id, role: staff.role, user: staff };
  const { organization } = await createOrganization(store, ownerActor, { name: '901 Cards' });
  const updated = await updateOrganizationProfile(store, ownerActor, organization.id, { brand: { publicName: '901 Cards Pro' } });
  assert.equal(updated.brand.publicName, '901 Cards Pro');
  const invite = await createOrganizationInvite(store, ownerActor, organization.id, { email: staff.email, role: 'staff' });
  store.state.organizationMembers.push({ id: 'member_staff', organizationId: organization.id, userId: staff.id, role: invite.role, createdAt: new Date().toISOString() });
  assert.equal(canUseShopPermission(store.state, staffActor, organization.id, SHOP_PERMISSIONS.GENERATE_OFFER_SHEETS).allowed, true);
  assert.equal(canUseShopPermission(store.state, staffActor, organization.id, SHOP_PERMISSIONS.MANAGE_BILLING).allowed, false);
  const member = await updateOrganizationMemberRole(store, ownerActor, organization.id, 'member_staff', 'manager');
  assert.equal(member.role, 'manager');
  await removeOrganizationMember(store, ownerActor, organization.id, 'member_staff');
  assert.equal(canAccessOrganization(store.state, staffActor, organization.id, 'viewer').allowed, false);
  await deactivateOrganization(store, ownerActor, organization.id, { reason: 'closing test shop' });
  assert.equal(canAccessOrganization(store.state, ownerActor, organization.id, 'viewer').allowed, false);
  await fs.rm(dir, { recursive: true, force: true });
});

test('shop inventory logging merges identical card rows but preserves meaningful differences', async () => {
  const { store, dir } = await makeStore();
  const owner = await store.createUser({ email: 'inventory-owner@example.com', name: 'Owner', passwordHash: 'h', passwordSalt: 's', role: 'merchant' });
  const actor = { userId: owner.id, role: owner.role, user: owner };
  const { organization } = await createOrganization(store, actor, { name: '901 Cards' });
  const cards = [{ id: 'card_1', player: 'Pikachu', year: 2023, brand: 'Pokemon', set: 'Scarlet & Violet 151', cardNumber: '173/165', parallel: 'Illustration Rare', sport: 'Pokemon', grade: { company: 'RAW', grade: 'Raw' } }];
  const first = await addShopInventoryItem(store, actor, organization.id, { cardId: 'card_1', name: 'Pikachu', quantity: 1, costBasis: 12, location: 'Case 1' }, { cards, sales: [] });
  assert.equal(first.merged, false);
  const second = await addShopInventoryItem(store, actor, organization.id, { cardId: 'card_1', name: 'Pikachu', quantity: 4, costBasis: 12, location: 'Case 1' }, { cards, sales: [] });
  assert.equal(second.merged, true);
  assert.equal(second.quantity, 5);
  await addShopInventoryItem(store, actor, organization.id, { cardId: 'card_1', name: 'Pikachu', quantity: 1, costBasis: 12, location: 'Grading box', status: 'grading' }, { cards, sales: [] });
  const inventory = listShopInventory(store, actor, organization.id, { cards, sales: [] });
  assert.equal(inventory.length, 2);
  assert.equal(inventory.find((item) => item.location === 'Case 1').quantity, 5);
  assert.ok(store.state.shopAuditLog.some((entry) => entry.type === 'inventory_quantity_merged'));
  await fs.rm(dir, { recursive: true, force: true });
});
