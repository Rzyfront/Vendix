import { inject, type Provider } from '@angular/core';

import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import {
  DIAN_API_CONTEXT,
  DianConfigApiService,
  type DianApiCapabilities,
  type DianApiContext,
} from '../../../../../shared/services/dian';

/**
 * Permisos que gobiernan el riel fiscal de la PLATAFORMA.
 *
 * Son literalmente las filas sembradas en el backend
 * (`permissions-roles.seed.ts`) y las mismas cadenas que declaran los
 * `@Permissions(...)` de `SubscriptionFiscalController`. Repetir la cadena exacta
 * a los dos lados evita el mapeo intermedio que se desincroniza en silencio: si
 * el backend renombra el permiso, aquí deja de haber capacidad y el botón
 * desaparece — que es el fallo seguro.
 */
export const PLATFORM_FISCAL_CAPABILITY = {
  read: 'superadmin:subscriptions:fiscal:read',
  write: 'superadmin:subscriptions:fiscal:write',
} as const;

/**
 * Roles que el backend deja pasar SIN comprobar permisos.
 *
 * `PermissionsGuard` corta la evaluación en cuanto ve `super_admin` en los roles,
 * y `SubscriptionFiscalController` además exige ese rol para todas sus rutas: el
 * riel entero es inalcanzable para cualquier otro. La UI tiene que reflejar esa
 * autorización real y no una más estricta — si se gateara sólo por la cadena del
 * permiso, un payload de login que no traiga la lista dejaría el panel en modo
 * lectura sobre un servidor que sí acepta la escritura, y no habría nada en
 * pantalla que explicara por qué.
 *
 * Se aceptan las dos grafías porque el payload de autenticación ha viajado con
 * ambas.
 */
const PLATFORM_FISCAL_BYPASS_ROLES = ['super_admin', 'SUPER_ADMIN'];

/**
 * Base RELATIVA del riel fiscal de plataforma, sin barra final.
 *
 * Es un literal y no una derivación: la plataforma es UNA organización
 * (`PLATFORM_ORGANIZATION_ID`) con UNA configuración DIAN, y el backend resuelve
 * las dos desde sus propios ajustes. No hay identificador de tenant que capturar,
 * así que tampoco existe el riesgo de resolución temprana que obliga al riel de
 * tenants a leer su store en cada llamada.
 */
export const PLATFORM_FISCAL_API_BASE = 'superadmin/subscriptions/fiscal';

/**
 * Contexto DIAN reapuntado al riel fiscal de la plataforma.
 *
 * Con esto los componentes COMPARTIDOS de `shared/components/dian/` operan sobre
 * la configuración DIAN de Vendix —la que factura las suscripciones— en vez de
 * sobre `store/invoicing`, que es la tienda del usuario autenticado. Las rutas
 * del backend se declararon con la misma forma que las de tienda
 * (`dian-config/:id/numbering-ranges[/apply]`) precisamente para que reapuntar la
 * base sea todo el trabajo.
 *
 * `capabilities` se resuelve en CADA invocación y no se congela al construirse:
 * los permisos llegan por NgRx y pueden poblarse después de que la ruta cree su
 * injector, así que una foto tomada en el factory dejaría el panel en modo
 * lectura para siempre.
 */
export function createPlatformDianContext(auth: AuthFacade): DianApiContext {
  const can = (permission: string): boolean =>
    auth.hasPermission(permission) ||
    auth.hasAnyRole(PLATFORM_FISCAL_BYPASS_ROLES);

  return {
    basePath: () => PLATFORM_FISCAL_API_BASE,
    capabilities: (): DianApiCapabilities => ({
      // Sincronizar numeración crea o edita `invoice_resolutions`, así que se
      // gobierna con el permiso de escritura del riel — el mismo que autoriza
      // `POST .../numbering-ranges/apply` en el backend.
      writeConfig: can(PLATFORM_FISCAL_CAPABILITY.write),
      uploadCertificate: can(PLATFORM_FISCAL_CAPABILITY.write),
      runTestSet: can(PLATFORM_FISCAL_CAPABILITY.write),
      promoteToProduction: can(PLATFORM_FISCAL_CAPABILITY.write),
    }),
  };
}

/**
 * Providers que hacen que los componentes DIAN compartidos hablen con la
 * configuración de la PLATAFORMA.
 *
 * **`DianConfigApiService` se re-provee a propósito.** Lleva
 * `providedIn: 'root'`, así que el singleton de raíz resuelve `DIAN_API_CONTEXT`
 * contra el injector RAÍZ: sobrescribir sólo el token en esta rama de ruta no lo
 * tocaría y el panel seguiría pegándole a `store/invoicing` — compilaría, se
 * vería bien y consultaría la numeración de la tienda del operador en vez de la
 * de Vendix. Declarar la clase aquí crea una instancia propia de esta rama, que
 * sí resuelve el token contra este injector.
 *
 * El resto del panel (POS, ajustes de tienda, effects de facturación) sigue
 * inyectando el singleton de raíz con su base por defecto: ninguna de esas
 * superficies cuelga de esta rama del árbol de rutas.
 */
export function providePlatformDianApi(): Provider[] {
  return [
    {
      provide: DIAN_API_CONTEXT,
      useFactory: () => createPlatformDianContext(inject(AuthFacade)),
    },
    DianConfigApiService,
  ];
}
