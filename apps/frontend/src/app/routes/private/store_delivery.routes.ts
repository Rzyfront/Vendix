import { Routes } from '@angular/router';

/**
 * STUB TEMPORAL (Fase F1) — Vendix Repartos (app_type STORE_DELIVERY).
 *
 * Este archivo se crea vacío para que `AppConfigService.resolvePrivateRoutes`
 * pueda referenciar `storeDeliveryRoutes` sin romper el build AOT mientras la
 * shell móvil dedicada aún no existe.
 *
 * La Fase F2 REEMPLAZA este stub por el árbol real:
 *   nodo raíz `path:'repartos'` → StoreDeliveryLayoutComponent
 *   canActivate:[AuthGuard, carrierGuard], children lazy (pool/ruta/mapa/sesion).
 */
export const storeDeliveryRoutes: Routes = [];
