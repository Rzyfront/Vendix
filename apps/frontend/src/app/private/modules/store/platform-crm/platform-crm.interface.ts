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

/** Lo que leen las compuertas del bloque de la sesión (`AuthFacade`). */
export interface VendixAccountSession {
  hasPermission(name: string): boolean;
  /** Tienda activa: `user.store` del login o del cambio de entorno. */
  userStore(): unknown;
}

/**
 * La tienda activa es de la organización plataforma. El login y el cambio de
 * entorno ya sirven la fila de su organización en `user.store.organizations`,
 * `is_platform` incluido: no hace falta pedir nada. Sin el dato → `false`.
 */
export function isPlatformStoreSession(store: unknown): boolean {
  const organization = (store as { organizations?: { is_platform?: unknown } } | null | undefined)
    ?.organizations;
  return organization?.is_platform === true;
}

/**
 * El bloque solo se monta en una tienda de la org plataforma Y con
 * `platform:crm_link:read`. El permiso solo no basta: super admin lo recibe
 * (recibe todos) aunque esté en una tienda ajena. Fuera de la tienda de Vendix
 * Platform el componente ni se descarga ni consulta el backend.
 */
export function canSeeVendixAccount(session: VendixAccountSession): boolean {
  return (
    isPlatformStoreSession(session.userStore()) &&
    session.hasPermission(PLATFORM_CRM_PERMISSIONS.READ)
  );
}

export function canManageVendixAccount(session: VendixAccountSession): boolean {
  return (
    isPlatformStoreSession(session.userStore()) &&
    session.hasPermission(PLATFORM_CRM_PERMISSIONS.MANAGE)
  );
}
