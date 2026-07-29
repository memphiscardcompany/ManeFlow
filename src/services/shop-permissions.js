const ROLE_RANK = Object.freeze({ viewer: 1, staff: 2, manager: 3, owner: 4 });

export const SHOP_ROLES = Object.freeze(Object.keys(ROLE_RANK));

export const SHOP_PERMISSIONS = Object.freeze({
  VIEW_INVENTORY: 'view_inventory',
  EDIT_INVENTORY: 'edit_inventory',
  IMPORT_DATA: 'import_data',
  EXPORT_DATA: 'export_data',
  MANAGE_STAFF: 'manage_staff',
  MANAGE_BILLING: 'manage_billing',
  MANAGE_PROVIDER_SETTINGS: 'manage_provider_settings',
  MANAGE_PRICING_RULES: 'manage_pricing_rules',
  MANAGE_PUBLIC_WIDGETS: 'manage_public_widgets',
  APPROVE_COMPS: 'approve_comps',
  REVIEW_CONSIGNMENTS: 'review_consignments',
  GENERATE_OFFER_SHEETS: 'generate_offer_sheets',
});

export const ROLE_PERMISSIONS = Object.freeze({
  owner: Object.values(SHOP_PERMISSIONS),
  manager: [
    SHOP_PERMISSIONS.VIEW_INVENTORY,
    SHOP_PERMISSIONS.EDIT_INVENTORY,
    SHOP_PERMISSIONS.IMPORT_DATA,
    SHOP_PERMISSIONS.EXPORT_DATA,
    SHOP_PERMISSIONS.MANAGE_PRICING_RULES,
    SHOP_PERMISSIONS.MANAGE_PUBLIC_WIDGETS,
    SHOP_PERMISSIONS.APPROVE_COMPS,
    SHOP_PERMISSIONS.REVIEW_CONSIGNMENTS,
    SHOP_PERMISSIONS.GENERATE_OFFER_SHEETS,
  ],
  staff: [
    SHOP_PERMISSIONS.VIEW_INVENTORY,
    SHOP_PERMISSIONS.EDIT_INVENTORY,
    SHOP_PERMISSIONS.REVIEW_CONSIGNMENTS,
    SHOP_PERMISSIONS.GENERATE_OFFER_SHEETS,
  ],
  viewer: [SHOP_PERMISSIONS.VIEW_INVENTORY],
});

export function roleRank(role) {
  return ROLE_RANK[role] || 0;
}

export function isPlatformAdmin(actor) {
  return actor?.role === 'admin' || actor?.service === true;
}

export function organizationMembership(state, organizationId, userId) {
  return (state.organizationMembers || []).find((membership) => membership.organizationId === organizationId && membership.userId === userId && !membership.revokedAt) || null;
}

export function canAccessOrganization(state, actor, organizationId, minRole = 'viewer') {
  const organization = (state.organizations || []).find((org) => org.id === organizationId);
  if (organization?.disabledAt && !isPlatformAdmin(actor)) return { allowed: false, role: null, membership: null, disabled: true };
  if (isPlatformAdmin(actor)) return { allowed: true, role: 'platform_admin', membership: null };
  if (!actor?.userId) return { allowed: false, role: null, membership: null };
  const membership = organizationMembership(state, organizationId, actor.userId);
  if (!membership) return { allowed: false, role: null, membership: null };
  return { allowed: roleRank(membership.role) >= roleRank(minRole), role: membership.role, membership };
}

export function permissionsForRole(role) {
  return ROLE_PERMISSIONS[role] || [];
}

export function canUseShopPermission(state, actor, organizationId, permission) {
  const access = canAccessOrganization(state, actor, organizationId, 'viewer');
  if (!access.allowed) return { allowed: false, role: access.role, permission, membership: access.membership };
  if (isPlatformAdmin(actor)) return { allowed: true, role: access.role, permission, membership: access.membership };
  return {
    allowed: permissionsForRole(access.role).includes(permission),
    role: access.role,
    permission,
    membership: access.membership,
  };
}

export function assertOrganizationAccess(state, actor, organizationId, minRole = 'viewer') {
  const access = canAccessOrganization(state, actor, organizationId, minRole);
  if (!access.allowed) {
    const error = new Error('This shop action requires authorized organization access.');
    error.status = 403;
    throw error;
  }
  return access;
}

export function publicOrganization(org) {
  if (!org) return null;
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    type: org.type,
    plan: org.plan,
    brand: org.brand || {},
    disabledAt: org.disabledAt || null,
    createdAt: org.createdAt,
    updatedAt: org.updatedAt,
  };
}
