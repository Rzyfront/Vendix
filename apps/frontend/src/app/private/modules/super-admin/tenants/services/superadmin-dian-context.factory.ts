import { inject, type Provider } from '@angular/core';

import { environment } from '../../../../../../environments/environment';
import {
  DIAN_API_CONTEXT,
  DianConfigApiService,
  type DianApiCapabilities,
  type DianApiContext,
} from '../../../../../shared/services/dian';
import { TENANT_SCOPE_LIST_ROUTE } from '../interfaces/tenant-profile.interface';
import { TenantContextStore } from '../state/tenant-context.store';

/**
 * Claves de capacidad que publica el perfil del tenant.
 *
 * Son literalmente los permisos sembrados en el backend
 * (`superadmin:tenants:*`). Mantener la misma cadena a los dos lados evita el
 * mapeo intermedio que se desincroniza en silencio: si el backend renombra un
 * permiso, aquí deja de haber capacidad y el botón desaparece — que es
 * exactamente el fallo seguro.
 */
export const TENANT_CAPABILITY = {
  read: 'superadmin:tenants:read',
  dianRead: 'superadmin:tenants:dian:read',
  dianWrite: 'superadmin:tenants:dian:write',
  dianCertificateWrite: 'superadmin:tenants:dian:certificate:write',
  dianPromote: 'superadmin:tenants:dian:promote',
  resolutionsRead: 'superadmin:tenants:resolutions:read',
  resolutionsWrite: 'superadmin:tenants:resolutions:write',
  settingsRead: 'superadmin:tenants:settings:read',
  settingsWrite: 'superadmin:tenants:settings:write',
} as const;

/**
 * Se lanza cuando se intenta construir una URL de tenant sin contexto sembrado.
 *
 * **Es deliberado que sea un throw y no un fallback.** El default del token
 * `DIAN_API_CONTEXT` apunta a `store/invoicing`, la tienda del usuario
 * autenticado. Caer a ese default desde la consola de super admin significaría
 * que un PATCH destinado al tenant #99 escribe en la tienda del propio
 * operador. En una pantalla que sube certificados digitales y promueve
 * configuraciones a producción, una excepción ruidosa es infinitamente
 * preferible a una escritura silenciosa contra el tenant equivocado.
 */
export class TenantContextNotSeededError extends Error {
  constructor() {
    super(
      'El contexto de tenant no está sembrado: no se puede resolver la URL del rail /superadmin/tenants. ' +
        'Esta pantalla sólo puede montarse bajo una ruta protegida por seedTenantContextGuard.',
    );
    this.name = 'TenantContextNotSeededError';
  }
}

/**
 * Base RELATIVA del rail del tenant, sin barra final. Ej:
 * `superadmin/tenants/stores/12`.
 *
 * **Se resuelve en cada invocación, jamás al construirse.** El router de
 * Angular cachea el `EnvironmentInjector` de una ruta en `route._injector` y
 * NO lo destruye al desactivarla (`getOrCreateRouteInjectorIfNeeded`,
 * router2.mjs), y `loadChildren` además queda cacheado en `_loadedRoutes`. Ir
 * de `/super-admin/stores/12/…` a `/super-admin/stores/99/…` reutiliza el mismo
 * injector, el mismo `TenantContextStore` y el mismo objeto de contexto DIAN.
 * Capturar el `tenantId` en el factory dejaría a la segunda tienda escribiendo
 * en la primera.
 */
export function tenantApiBase(store: TenantContextStore): string {
  const tenantId = store.tenantId();
  if (tenantId === null) {
    throw new TenantContextNotSeededError();
  }
  // El segmento de alcance va en PLURAL (`stores` / `organizations`):
  // `DomainScopeGuard` responde 403 a cualquier ruta que contenga el literal
  // `/store/` con un token VENDIX_ADMIN. `store.scope` ya es del tipo correcto.
  return `superadmin/tenants/${store.scope}/${tenantId}`;
}

/** URL ABSOLUTA del rail del tenant. Misma regla de resolución tardía. */
export function tenantApiUrl(
  store: TenantContextStore,
  endpoint = '',
): string {
  const base = `${environment.apiUrl}/${tenantApiBase(store)}`;
  return endpoint ? `${base}/${endpoint}` : base;
}

/**
 * Aviso de titularidad del NIT, cuando la ficha abierta NO lo posee.
 *
 * Se dispara con `fiscal_scope === 'ORGANIZATION'` estando en una tienda: en
 * ese caso la identidad fiscal y las configuraciones DIAN cuelgan de la
 * organización, y editarlas desde el nivel equivocado crea filas que el propio
 * comerciante no ve en su panel — el defecto `scope_drift` que el directorio ya
 * cuenta por tenant.
 */
export interface FiscalOwnerNotice {
  readonly message: string;
  readonly organizationId: number;
  readonly organizationName: string;
  /** Ruta al perfil de la organización titular. */
  readonly route: readonly (string | number)[];
}

export function fiscalOwnerNotice(
  store: TenantContextStore,
): FiscalOwnerNotice | null {
  const profile = store.profile();
  if (!profile) return null;
  if (profile.scope.owns_fiscal_identity) return null;
  if (profile.scope.fiscal_scope !== 'ORGANIZATION') return null;
  if (store.scope !== 'stores') return null;

  const organizationName = profile.header.organization_name;
  const organizationId = profile.header.organization_id;

  return {
    organizationId,
    organizationName,
    message:
      `La identidad fiscal la lleva ${organizationName}: esta organización factura con NIT ` +
      'único, así que el NIT, el certificado y las resoluciones cuelgan de ella y no de esta ' +
      'tienda. Lo que se edite desde aquí queda anclado al nivel equivocado y el comerciante ' +
      'no lo verá en su propio panel.',
    route: [TENANT_SCOPE_LIST_ROUTE.organizations, organizationId],
  };
}

/**
 * Contexto DIAN reapuntado al rail de super admin.
 *
 * Captura el STORE (una instancia estable de larga vida que expone señales),
 * nunca el tenant. `basePath` y `capabilities` leen del store en cada llamada,
 * así que el mismo objeto sirve para todos los tenants que el operador visite
 * sin necesidad de que el injector se recree — cosa que no ocurre.
 */
export function createSuperadminDianContext(
  store: TenantContextStore,
): DianApiContext {
  return {
    basePath: () => `${tenantApiBase(store)}/invoicing`,
    capabilities: (): DianApiCapabilities => ({
      writeConfig: store.can(TENANT_CAPABILITY.dianWrite),
      uploadCertificate: store.can(TENANT_CAPABILITY.dianCertificateWrite),
      // Encolar el set de pruebas es una escritura DIAN corriente en el
      // backend (`superadmin:tenants:dian:write`), pero consume consecutivos
      // autorizados irrecuperables: la UI la trata aparte y la confirma.
      runTestSet: store.can(TENANT_CAPABILITY.dianWrite),
      promoteToProduction: store.can(TENANT_CAPABILITY.dianPromote),
    }),
  };
}

/**
 * Providers que hacen que el módulo de facturación COMPARTIDO hable con el
 * tenant abierto en vez de con la tienda del operador.
 *
 * **`DianConfigApiService` se re-provee a propósito.** Lleva
 * `providedIn: 'root'`, así que el singleton de raíz resuelve
 * `DIAN_API_CONTEXT` desde el injector RAÍZ: sobrescribir sólo el token en una
 * rama de ruta no lo tocaría y la pantalla seguiría escribiendo en
 * `store/invoicing`. Declarar la clase aquí crea una instancia propia de esta
 * rama, que sí resuelve el token contra este injector.
 *
 * El resto del panel (POS, ajustes de tienda, effects de facturación) sigue
 * inyectando el singleton de raíz con su `basePath` por defecto: ninguna de
 * esas superficies cuelga de esta rama del árbol de rutas.
 */
export function provideSuperadminDianApi(): Provider[] {
  return [
    {
      provide: DIAN_API_CONTEXT,
      useFactory: () => createSuperadminDianContext(inject(TenantContextStore)),
    },
    DianConfigApiService,
  ];
}
