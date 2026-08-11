/**
 * Contrato de la consola de tenants del super admin.
 *
 * Espeja `apps/backend/src/domains/superadmin/tenant-config/tenant-directory.service.ts`
 * (`list` y `getProfile`). Todo lo que aquí se declara `readonly` lo es porque el
 * rail es de LECTURA: la escritura vive en los controladores hermanos
 * (`tenant-dian-config`, `tenant-resolutions`, `tenant-settings`) y no en este
 * perfil.
 *
 * Regla de oro heredada del backend: los secretos se describen, nunca se
 * entregan. Por eso aquí no existe `software_pin`, `certificate_password` ni
 * `technical_key` — sólo sus booleanos `*_set` / `present`.
 */

/**
 * Segmento `:scope` de la URL, SIEMPRE en plural.
 *
 * No es cosmético: `DomainScopeGuard` devuelve 403 a cualquier ruta que
 * contenga el literal `/store/` con un token `VENDIX_ADMIN`, así que
 * `stores/12` funciona y `store/12` moriría con un 403 sin explicación útil.
 */
export type TenantScopeSegment = 'stores' | 'organizations';

/** Espejo de `OrganizationFiscalScope` / `OrganizationOperatingScope`. */
export type TenantScopeValue = 'STORE' | 'ORGANIZATION';

export const DIAN_ENABLEMENT_STATUSES = [
  'not_started',
  'testing',
  'test_set_passed',
  'enabled',
  'suspended',
  'expired',
] as const;

export type DianEnablementStatus = (typeof DIAN_ENABLEMENT_STATUSES)[number];

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

export interface TenantApiResponse<T> {
  readonly success: boolean;
  readonly message: string;
  readonly data: T;
  readonly meta?: Record<string, unknown>;
}

export interface TenantPaginationMeta {
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly pages: number;
}

export interface TenantPaginatedResponse<T> {
  readonly success: boolean;
  readonly message: string;
  readonly data: readonly T[];
  readonly meta: TenantPaginationMeta;
}

// ---------------------------------------------------------------------------
// Directorio — GET /superadmin/tenants
// ---------------------------------------------------------------------------

export interface TenantDirectoryQuery {
  readonly search?: string;
  readonly enablement_status?: DianEnablementStatus;
  readonly is_active?: boolean;
  readonly page?: number;
  readonly limit?: number;
}

export interface TenantDirectoryRow {
  readonly store_id: number;
  readonly store_name: string;
  readonly store_slug: string | null;
  readonly is_active: boolean;
  readonly created_at: string;
  readonly organization_id: number;
  readonly organization_name: string;
  readonly organization_slug: string | null;
  readonly fiscal_scope: TenantScopeValue;
  readonly operating_scope: TenantScopeValue;
  readonly account_type: string | null;
  readonly enablement_status: DianEnablementStatus;
  readonly environment: string | null;
  /**
   * Configuraciones DIAN ancladas a tienda en una organización que factura con
   * NIT único. El comerciante no las ve desde su panel y son exactamente el
   * motivo por el que llama a soporte.
   */
  readonly scope_drift: number | null;
}

// ---------------------------------------------------------------------------
// Perfil — GET /superadmin/tenants/:scope/:tenantId/profile
// ---------------------------------------------------------------------------

export interface TenantProfileHeader {
  readonly organization_id: number;
  readonly organization_name: string;
  readonly organization_slug: string | null;
  readonly store_id: number | null;
  readonly store_name: string | null;
  readonly is_active: boolean | null;
}

export interface TenantProfileScope {
  readonly fiscal_scope: TenantScopeValue;
  readonly operating_scope: TenantScopeValue;
  /** `true` si la entidad que se está viendo es la que posee el NIT. */
  readonly owns_fiscal_identity: boolean;
  readonly accounting_entity_id: number | null;
  readonly stores_count: number;
}

export interface TenantFiscalIdentity {
  readonly accounting_entity_id: number | null;
  readonly legal_name: string | null;
  readonly nit: string | null;
  readonly nit_dv: string | null;
  readonly nit_type: string | null;
  readonly person_type: string | null;
  readonly tax_regime: string | null;
  readonly responsibilities: readonly string[];
  readonly ciiu: string | null;
  readonly fiscal_address: string | null;
  readonly municipality_code: string | null;
}

export interface TenantDianCertificate {
  readonly present: boolean;
  readonly password_set: boolean;
  readonly expires_at: string | null;
  readonly days_to_expiry: number | null;
  readonly expired: boolean;
  readonly subject: string | null;
  readonly issuer: string | null;
  readonly nit: string | null;
  readonly uploaded_at: string | null;
}

/**
 * Estado del set de pruebas de habilitación.
 *
 * Opcional a propósito: hoy el perfil expone `enablement_status` +
 * `test_set_id` planos, y el bloque anidado lo añade la tarea de backend que
 * está en vuelo. Tipar el campo como opcional hace que la UI compile con las
 * dos formas de la respuesta y que la pantalla no reviente el día que aparezca.
 */
export interface TenantDianTestSet {
  readonly state?: string | null;
  readonly test_set_id?: string | null;
  readonly submitted_at?: string | null;
  readonly last_checked_at?: string | null;
}

export interface TenantDianConfig {
  readonly id: number;
  readonly name: string | null;
  readonly is_default: boolean;
  readonly nit: string | null;
  readonly nit_dv: string | null;
  readonly nit_type: string | null;
  readonly configuration_type: string | null;
  readonly operation_mode: string | null;
  readonly environment: string | null;
  readonly enablement_status: DianEnablementStatus;
  readonly test_set_id: string | null;
  readonly enabled_at: string | null;
  readonly updated_at: string | null;
  readonly software_id_set: boolean;
  readonly software_pin_set: boolean;
  readonly certificate: TenantDianCertificate;
  readonly test_set?: TenantDianTestSet | null;
}

export interface TenantResolution {
  readonly id: number;
  readonly document_type: string | null;
  readonly prefix: string | null;
  readonly resolution_number: string | null;
  readonly resolution_date: string | null;
  readonly range_from: number;
  readonly range_to: number;
  readonly current_number: number;
  readonly valid_from: string | null;
  readonly valid_to: string | null;
  readonly is_active: boolean;
  /** La clave técnica alimenta el CUFE: se reporta puesta, jamás su valor. */
  readonly technical_key_set: boolean;
  readonly consumed_pct: number;
}

export interface TenantSubscriptionPlan {
  readonly id: number;
  readonly name: string;
  readonly code: string | null;
}

export interface TenantSubscription {
  readonly state: string;
  readonly started_at: string | null;
  readonly trial_ends_at: string | null;
  readonly current_period_end: string | null;
  readonly next_billing_at: string | null;
  readonly grace_soft_until: string | null;
  readonly grace_hard_until: string | null;
  readonly effective_price: string | number | null;
  readonly currency: string | null;
  readonly auto_renew: boolean | null;
  readonly lock_reason: string | null;
  readonly plan: TenantSubscriptionPlan | null;
}

/**
 * Qué se le permite ESCRIBIR al super admin sobre este tenant.
 *
 * Mapa abierto porque la autorización real vive en el backend y este objeto
 * sólo gobierna qué botones se ofrecen. Consumirlo siempre vía
 * `TenantContextStore.can()`, que devuelve `false` cuando la clave falta:
 * ofrecer un botón por ausencia de dato es peor que no ofrecerlo.
 */
export interface TenantCapabilities {
  readonly [capability: string]: boolean | undefined;
}

export interface TenantProfile {
  readonly header: TenantProfileHeader;
  readonly scope: TenantProfileScope;
  readonly fiscal_identity: TenantFiscalIdentity;
  /** JSON libre de `settings.fiscal_status`; se lee, no se modela. */
  readonly fiscal_status: Record<string, unknown> | null;
  readonly dian_configs: readonly TenantDianConfig[];
  readonly resolutions: readonly TenantResolution[];
  readonly subscription: TenantSubscription | null;
  readonly capabilities?: TenantCapabilities | null;
}

// ---------------------------------------------------------------------------
// Etiquetas
// ---------------------------------------------------------------------------

export const DIAN_ENABLEMENT_LABELS: Record<DianEnablementStatus, string> = {
  not_started: 'Sin iniciar',
  testing: 'En pruebas',
  test_set_passed: 'Set de pruebas superado',
  enabled: 'Habilitado',
  suspended: 'Suspendido',
  expired: 'Expirado',
};

export const TENANT_SCOPE_LABELS: Record<TenantScopeValue, string> = {
  STORE: 'Tienda',
  ORGANIZATION: 'Organización',
};

/** Ruta del directorio del que cuelga cada alcance. */
export const TENANT_SCOPE_LIST_ROUTE: Record<TenantScopeSegment, string> = {
  stores: '/super-admin/stores',
  organizations: '/super-admin/organizations',
};
