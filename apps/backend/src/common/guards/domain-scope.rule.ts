/**
 * Regla pura de aislamiento de dominio (REGLA CERO), sin Nest ni I/O.
 *
 * Es la matriz que aplica `DomainScopeGuard` sobre cada request y la que usa el
 * puente de la IA (`list_endpoints`, `list_capabilities`, `call_endpoint`) para
 * no ofrecer ni despachar rutas que el guard va a rechazar. Vive aparte para
 * que las dos superficies lean la MISMA decisión: con una copia en el puente,
 * cualquier ajuste al guard (un carve-out nuevo, un app_type nuevo) dejaría al
 * agente ofreciendo rutas que terminan en 403 — lo que pasaba en E2E g09, donde
 * a un STORE_ADMIN se le ofreció `organization/payroll/settings`.
 *
 * No decide sobre `@Public()` ni `@AllowCrossDomain()`: esa metadata es del
 * handler y la evalúa el guard antes de llegar acá.
 */

export interface DomainScopePrincipal {
  app_type?: string | null;
  is_super_admin?: boolean | null;
}

export type DomainScopeDenial =
  | 'missing_app_type'
  | 'org_admin_store_path'
  | 'store_admin_org_path'
  | 'delivery_outside_carrier'
  | 'non_admin_app_type';

export type DomainScopeDecision =
  | { allowed: true }
  | { allowed: false; reason: DomainScopeDenial; message: string };

const STORE_PATH_MARKER = '/store/';
const ORG_PATH_MARKER = '/organization/';
const CARRIER_PATH_MARKER = '/store/carrier/';

/**
 * `path` es el del request (`/api/store/...`); se normaliza a minúsculas como
 * hace el guard. Los marcadores llevan la barra inicial, así que una ruta del
 * catálogo sin prefijo (`store/...`) debe llegar como `/api/store/...`.
 */
export function domainScopeDecision(
  principal: DomainScopePrincipal,
  rawPath: string,
): DomainScopeDecision {
  // Super-admin: bypass total. Acceso cross-domain para soporte.
  if (principal.is_super_admin === true) return { allowed: true };

  const path = (rawPath || '').toLowerCase();

  // VENDIX_ADMIN (superadmin del rail plataforma) tiene acceso a los
  // endpoints `/api/superadmin/*` (facturacion plataforma, control fiscal,
  // configuracion global). El resto de la matriz de aislamiento sigue
  // activa para STORE_ADMIN / ORG_ADMIN.
  if (principal.app_type === 'VENDIX_ADMIN' && path.includes('/api/superadmin/'))
    return { allowed: true };

  const isStorePath = path.includes(STORE_PATH_MARKER);
  const isOrgPath = path.includes(ORG_PATH_MARKER);

  // Path no es de un dominio gobernado por esta regla → bypass.
  // Cubre /api/auth/*, /api/ecommerce/*, /api/superadmin/*, /api/health, etc.
  if (!isStorePath && !isOrgPath) return { allowed: true };

  // A partir de aquí el path es /store/* o /organization/*.
  // Necesitamos un app_type claim válido.
  const appType = principal.app_type ?? undefined;
  if (!appType)
    return {
      allowed: false,
      reason: 'missing_app_type',
      message: 'Token sin app_type claim. Re-login requerido.',
    };

  if (appType === 'ORG_ADMIN' && isStorePath)
    return {
      allowed: false,
      reason: 'org_admin_store_path',
      message: 'ORG_ADMIN no puede acceder a endpoints /store/*',
    };

  if (appType === 'STORE_ADMIN' && isOrgPath)
    return {
      allowed: false,
      reason: 'store_admin_org_path',
      message: 'STORE_ADMIN no puede acceder a endpoints /organization/*',
    };

  // STORE_DELIVERY: solo el namespace carrier. Blast-radius mínimo.
  // Habilita el flujo del transportador en Vendix Repartos sin exponer el
  // resto del árbol /store/*. El match es por substring: ningún endpoint
  // admin sensible cuelga de /store/carrier/ (namespace nuevo).
  if (appType === 'STORE_DELIVERY')
    return path.includes(CARRIER_PATH_MARKER)
      ? { allowed: true }
      : {
          allowed: false,
          reason: 'delivery_outside_carrier',
          message: 'Forbidden resource',
        };

  // Customers (CUSTOMER / STORE_ECOMMERCE): bell notifications
  // only — el namespace /store/notifications ya filtra por store y por
  // `data->>'target_user_id'` (QUI-854), así que el customer solo ve sus
  // propias notificaciones. Sin embargo su token no autoriza las
  // superficies de gestión del bell (subscriptions, Web Push, vapid) ni
  // el resto de /store/*. Carve-out acotado a list/unread-count/stream +
  // mark-read/mark-all (que el servicio scopa por usuario).
  if (appType !== 'ORG_ADMIN' && appType !== 'STORE_ADMIN') {
    const isCustomerBellAllowed =
      path.includes('/store/notifications') &&
      !path.includes('/store/notifications/subscriptions') &&
      !path.includes('/store/notifications/push');
    if (isCustomerBellAllowed) return { allowed: true };
    return {
      allowed: false,
      reason: 'non_admin_app_type',
      message: `Token app_type=${appType} no autoriza acceso a endpoints admin`,
    };
  }

  return { allowed: true };
}
