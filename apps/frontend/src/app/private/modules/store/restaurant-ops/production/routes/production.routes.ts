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
    // T14 (QUI-996): shared "Lista de producción" of one day. Static path,
    // declared before any `:id` route.
    path: 'day',
    loadComponent: () =>
      import(
        '../components/production-day-list/production-day-list.component'
      ).then((c) => c.ProductionDayListComponent),
    data: {
      permission: 'store:production_orders:read',
      detailBase: '/admin/restaurant-ops/production/orders',
    },
  },
  {
    path: 'new',
    loadComponent: () =>
      import(
        '../pages/production-order-form-page/production-order-form-page.component'
      ).then((c) => c.ProductionOrderFormPageComponent),
    data: { permission: 'store:production_orders:create' },
  },
  {
    // T13 (QUI-995): shared detail of one production order (born from a sale or manual).
    path: 'orders/:id',
    loadComponent: () =>
      import(
        '../pages/production-order-detail-page/production-order-detail-page.component'
      ).then((c) => c.ProductionOrderDetailPageComponent),
    data: { permission: 'store:production_orders:read' },
  },
];
