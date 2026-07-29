import crypto from 'node:crypto';
import { makeId, normalizeText } from './utils.js';
import { publicOrganization, SHOP_ROLES, canAccessOrganization } from './shop-permissions.js';

function clean(value, max = 240) { return String(value ?? '').trim().slice(0, max); }
function slugify(value) { return normalizeText(value).replaceAll(' ', '-').slice(0, 80) || makeId('shop').slice(0, 12); }
function inviteCode() { return crypto.randomBytes(18).toString('base64url'); }

export async function createOrganization(store, actor, input = {}) {
  if (!actor?.userId || actor.readOnly) throw Object.assign(new Error('Authentication required.'), { status: 401 });
  const name = clean(input.name || input.shopName || `${actor.user?.name || 'Collector'} Shop`, 160);
  const now = new Date().toISOString();
  let slug = slugify(input.slug || name);
  const taken = new Set((store.state.organizations || []).map((org) => org.slug));
  let suffix = 2;
  while (taken.has(slug)) slug = `${slugify(name)}-${suffix++}`;
  const org = {
    id: makeId('org'),
    name,
    slug,
    type: input.type === 'collector_group' ? 'collector_group' : 'card_shop',
    plan: ['merchant', 'enterprise'].includes(input.plan) ? input.plan : 'merchant',
    ownerUserId: actor.userId,
    brand: {
      accent: clean(input.brand?.accent || '#d4af37', 32),
      logoUrl: clean(input.brand?.logoUrl || '', 500),
      websiteUrl: clean(input.brand?.websiteUrl || '', 500),
      publicName: clean(input.brand?.publicName || name, 160),
    },
    demoMode: input.demoMode !== undefined ? Boolean(input.demoMode) : true,
    createdAt: now,
    updatedAt: now,
  };
  const membership = { id: makeId('org_member'), organizationId: org.id, userId: actor.userId, role: 'owner', invitedBy: actor.userId, createdAt: now, updatedAt: now };
  store.state.organizations.push(org);
  store.state.organizationMembers.push(membership);
  await store.audit({ type: 'organization_created', userId: actor.userId, organizationId: org.id, name: org.name });
  await store.persist();
  return { organization: publicOrganization(org), membership };
}

export function listOrganizationsForActor(store, actor) {
  if (actor?.role === 'admin' || actor?.service) return (store.state.organizations || []).map(publicOrganization);
  const ids = new Set((store.state.organizationMembers || []).filter((m) => m.userId === actor?.userId && !m.revokedAt).map((m) => m.organizationId));
  return (store.state.organizations || []).filter((org) => ids.has(org.id)).map(publicOrganization);
}

export function getOrganizationForActor(store, actor, organizationId, minRole = 'viewer') {
  const access = canAccessOrganization(store.state, actor, organizationId, minRole);
  if (!access.allowed) return null;
  const org = (store.state.organizations || []).find((item) => item.id === organizationId) || null;
  return org ? { organization: publicOrganization(org), access } : null;
}

export async function createOrganizationInvite(store, actor, organizationId, input = {}) {
  const access = canAccessOrganization(store.state, actor, organizationId, 'manager');
  if (!access.allowed) throw Object.assign(new Error('Manager or owner access is required to invite staff.'), { status: 403 });
  const role = SHOP_ROLES.includes(input.role) ? input.role : 'staff';
  if (role === 'owner' && access.role !== 'owner' && actor.role !== 'admin') throw Object.assign(new Error('Only owners can invite another owner.'), { status: 403 });
  const now = new Date().toISOString();
  const invite = {
    id: makeId('org_invite'), organizationId, email: clean(input.email, 320).toLowerCase(), role,
    code: inviteCode(), invitedBy: actor.userId, status: 'open', expiresAt: input.expiresAt || new Date(Date.now() + 14 * 86_400_000).toISOString(), createdAt: now, updatedAt: now,
  };
  store.state.organizationInvites.unshift(invite);
  store.state.organizationInvites = store.state.organizationInvites.slice(0, 1000);
  await store.audit({ type: 'organization_invite_created', userId: actor.userId, organizationId, role, email: invite.email });
  await store.persist();
  return { ...invite, code: invite.code };
}

export async function acceptOrganizationInvite(store, actor, code) {
  if (!actor?.userId) throw Object.assign(new Error('Authentication required.'), { status: 401 });
  const invite = (store.state.organizationInvites || []).find((item) => item.code === code && item.status === 'open');
  if (!invite || new Date(invite.expiresAt).getTime() < Date.now()) throw Object.assign(new Error('Invite is invalid or expired.'), { status: 404 });
  const existing = (store.state.organizationMembers || []).find((m) => m.organizationId === invite.organizationId && m.userId === actor.userId && !m.revokedAt);
  if (existing) return existing;
  const membership = { id: makeId('org_member'), organizationId: invite.organizationId, userId: actor.userId, role: invite.role, invitedBy: invite.invitedBy, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  invite.status = 'accepted';
  invite.acceptedBy = actor.userId;
  invite.updatedAt = new Date().toISOString();
  store.state.organizationMembers.push(membership);
  await store.audit({ type: 'organization_invite_accepted', userId: actor.userId, organizationId: invite.organizationId, role: invite.role });
  await store.persist();
  return membership;
}

export async function updateOrganizationProfile(store, actor, organizationId, input = {}) {
  const access = canAccessOrganization(store.state, actor, organizationId, 'owner');
  if (!access.allowed) throw Object.assign(new Error('Owner access is required to update shop profile.'), { status: 403 });
  const org = (store.state.organizations || []).find((item) => item.id === organizationId);
  if (!org) throw Object.assign(new Error('Organization not found.'), { status: 404 });
  if (input.name !== undefined) org.name = clean(input.name, 160) || org.name;
  org.brand = {
    ...(org.brand || {}),
    ...(input.brand?.accent !== undefined ? { accent: clean(input.brand.accent, 32) } : {}),
    ...(input.brand?.logoUrl !== undefined ? { logoUrl: clean(input.brand.logoUrl, 500) } : {}),
    ...(input.brand?.websiteUrl !== undefined ? { websiteUrl: clean(input.brand.websiteUrl, 500) } : {}),
    ...(input.brand?.publicName !== undefined ? { publicName: clean(input.brand.publicName, 160) } : {}),
  };
  org.updatedAt = new Date().toISOString();
  await store.audit({ type: 'organization_profile_updated', userId: actor.userId, organizationId });
  await store.persist();
  return publicOrganization(org);
}

export async function revokeOrganizationInvite(store, actor, organizationId, inviteId) {
  const access = canAccessOrganization(store.state, actor, organizationId, 'manager');
  if (!access.allowed) throw Object.assign(new Error('Manager or owner access is required to revoke invites.'), { status: 403 });
  const invite = (store.state.organizationInvites || []).find((item) => item.id === inviteId && item.organizationId === organizationId);
  if (!invite) return null;
  invite.status = 'revoked';
  invite.revokedBy = actor.userId;
  invite.updatedAt = new Date().toISOString();
  await store.audit({ type: 'organization_invite_revoked', userId: actor.userId, organizationId, inviteId });
  await store.persist();
  return structuredClone(invite);
}

export async function updateOrganizationMemberRole(store, actor, organizationId, memberId, role) {
  const access = canAccessOrganization(store.state, actor, organizationId, 'owner');
  if (!access.allowed) throw Object.assign(new Error('Owner access is required to manage staff roles.'), { status: 403 });
  const member = (store.state.organizationMembers || []).find((item) => item.id === memberId && item.organizationId === organizationId && !item.revokedAt);
  if (!member) return null;
  const nextRole = SHOP_ROLES.includes(role) ? role : member.role;
  if (member.userId === actor.userId && member.role === 'owner' && nextRole !== 'owner') throw Object.assign(new Error('You cannot demote your own owner membership.'), { status: 400 });
  member.role = nextRole;
  member.updatedAt = new Date().toISOString();
  await store.audit({ type: 'organization_member_role_updated', userId: actor.userId, organizationId, memberId, role: nextRole });
  await store.persist();
  return structuredClone(member);
}

export async function removeOrganizationMember(store, actor, organizationId, memberId) {
  const access = canAccessOrganization(store.state, actor, organizationId, 'owner');
  if (!access.allowed) throw Object.assign(new Error('Owner access is required to remove staff.'), { status: 403 });
  const member = (store.state.organizationMembers || []).find((item) => item.id === memberId && item.organizationId === organizationId && !item.revokedAt);
  if (!member) return null;
  if (member.userId === actor.userId && member.role === 'owner') throw Object.assign(new Error('You cannot remove your own owner membership.'), { status: 400 });
  member.revokedAt = new Date().toISOString();
  member.revokedBy = actor.userId;
  member.updatedAt = member.revokedAt;
  await store.audit({ type: 'organization_member_removed', userId: actor.userId, organizationId, memberId });
  await store.persist();
  return structuredClone(member);
}

export async function deactivateOrganization(store, actor, organizationId, input = {}) {
  const access = canAccessOrganization(store.state, actor, organizationId, 'owner');
  if (!access.allowed && actor?.role !== 'admin') throw Object.assign(new Error('Owner access is required to deactivate a shop.'), { status: 403 });
  const org = (store.state.organizations || []).find((item) => item.id === organizationId);
  if (!org) return null;
  org.disabledAt = input.disabled === false ? null : new Date().toISOString();
  org.disabledReason = input.disabled === false ? '' : clean(input.reason || 'Owner deactivated shop.', 1000);
  org.updatedAt = new Date().toISOString();
  await store.audit({ type: org.disabledAt ? 'organization_deactivated' : 'organization_reactivated', userId: actor.userId, organizationId, reason: org.disabledReason });
  await store.persist();
  return publicOrganization(org);
}
