import { Routes } from '@angular/router';
import { AuthGuard } from '../../core/guards/auth.guard';
import { carrierGuard } from '../../core/guards/carrier.guard';

/**
 * Rutas de Vendix Repartos (app_type STORE_DELIVERY) — cáscara móvil dedicada
 * para usuarios `carrier`. Referenciadas por `AppConfigService.resolvePrivateRoutes`.
 *
 * Nodo raíz `/repartos` → `StoreDeliveryLayoutComponent`, protegido por:
 *   - `AuthGuard`      (defensa en profundidad: sesión + dashboard por rol).
 *   - `carrierGuard`   (gate PRINCIPAL: solo rol `carrier` activa `/repartos/*`).
 *
 * Hijos lazy: pool / ruta / mapa / sesión. Los componentes de página son
 * PLACEHOLDERS creados en F2 y serán REEMPLAZADOS por F3-F6.
 */
export const storeDeliveryRoutes: Routes = [
  {
    path: 'repartos',
    loadComponent: () =>
      import(
        '../../private/layouts/store-delivery/store-delivery-layout.component'
      ).then((m) => m.StoreDeliveryLayoutComponent),
    canActivate: [AuthGuard, carrierGuard],
    children: [
      { path: '', redirectTo: 'pool', pathMatch: 'full' },
      {
        path: 'pool',
        loadComponent: () =>
          import(
            '../../private/modules/store-delivery/pool/pool-page.component'
          ).then((m) => m.PoolPageComponent),
      },
      {
        path: 'ruta',
        loadComponent: () =>
          import(
            '../../private/modules/store-delivery/ruta/ruta-activa-page.component'
          ).then((m) => m.RutaActivaPageComponent),
      },
      {
        path: 'mapa',
        loadComponent: () =>
          import(
            '../../private/modules/store-delivery/mapa/mapa-page.component'
          ).then((m) => m.MapaPageComponent),
      },
      {
        path: 'sesion',
        loadComponent: () =>
          import(
            '../../private/modules/store-delivery/sesion/sesion-page.component'
          ).then((m) => m.SesionPageComponent),
      },
    ],
  },
];
