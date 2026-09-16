import { Routes } from '@angular/router';

/**
 * Directorio de tiendas del super admin + ficha de tenant.
 *
 * `:storeId` cuelga del directorio a propósito: la ficha ES el detalle de una
 * fila de esta tabla, y colgarla aquí hace que la URL cuente la jerarquía
 * (`/super-admin/stores/12/general`) sin inventar un módulo paralelo.
 *
 * El segmento de alcance que viaja al backend es `stores`, en PLURAL:
 * `DomainScopeGuard` responde 403 a cualquier ruta de API que contenga el
 * literal `/store/` con un token `VENDIX_ADMIN`.
 */
export const STORES_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./stores.component').then((c) => c.StoresComponent),
  },
  // Ranking de actividad (`Cuentas > Actividad`). Va ANTES de `:storeId`
  // para que el param no capture el literal `activity`.
  {
    path: 'activity',
    loadComponent: () =>
      import('./activity/store-activity-page.component').then(
        (c) => c.StoreActivityPageComponent,
      ),
  },
  {
    path: ':storeId',
    loadChildren: () =>
      import('../tenants/tenant-profile.routes').then((m) =>
        m.tenantProfileRoutes('stores', 'storeId'),
      ),
  },
];
