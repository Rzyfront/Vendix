/**
 * Vendix Platform · enlace prospecto CRM ↔ organización cliente.
 * Espejo de `apps/backend/src/domains/platform-crm/platform-crm-links.service.ts`.
 */

export const PLATFORM_CRM_PERMISSIONS = {
  MANAGE: 'platform:crm_link:manage',
  READ: 'platform:crm_link:read',
} as const;

export interface PlatformOrganizationSearchItem {
  id: number;
  name: string;
  slug: string;
  created_at: string | null;
}

export interface PlatformOrganizationSubscription {
  store_name: string;
  plan_name: string | null;
  state: string | null;
  current_period_end: string | null;
  trial_ends_at: string | null;
}

export interface PlatformOrganizationSummary {
  id: number;
  name: string;
  state: string;
  subscriptions: PlatformOrganizationSubscription[];
}

export interface PlatformCrmLink {
  id: number;
  status: string;
  note: string | null;
  linked_at: string;
  linked_by: { id: number; first_name: string | null; last_name: string | null };
}

export interface PlatformCrmLinkView {
  link: PlatformCrmLink | null;
  organization: PlatformOrganizationSummary | null;
}

/**
 * El bloque solo se monta con `platform:crm_link:read` y SIN atajo por owner
 * ni super admin: fuera de la tienda de Vendix Platform nadie tiene ese
 * permiso (es de sistema) y el componente ni se descarga.
 */
export function canSeeVendixAccount(auth: { hasPermission(name: string): boolean }): boolean {
  return auth.hasPermission(PLATFORM_CRM_PERMISSIONS.READ);
}

export function canManageVendixAccount(auth: { hasPermission(name: string): boolean }): boolean {
  return auth.hasPermission(PLATFORM_CRM_PERMISSIONS.MANAGE);
}
