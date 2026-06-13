import { Routes } from '@angular/router';

/**
 * Store-admin Production Orders (Restaurant Suite — Fase C) routes.
 *
 * Mounted under `/admin/restaurant-ops/production` from
 * `routes/private/store_admin.routes.ts` (wire-up deferred to Fase I).
 *
 * Backend permission enforcement:
 *   - GET list/detail  → store:production_orders:read
 *   - POST create      → store:production_orders:create
 *   - POST start/complete/cancel → store:production_orders:update
 *
 * Sidebar visibility is wired in Fase I (panel_ui); for now the routes
 * exist and the component code is in place.
 */
export const productionOrdersRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import(
        '../pages/production-orders-list-page/production-orders-list-page.component'
      ).then((c) => c.ProductionOrdersListPageComponent),
    data: { permission: 'store:production_orders:read' },
  },
  {
    path: 'new',
    loadComponent: () =>
      import(
        '../pages/production-order-form-page/production-order-form-page.component'
      ).then((c) => c.ProductionOrderFormPageComponent),
    data: { permission: 'store:production_orders:create' },
  },
];
