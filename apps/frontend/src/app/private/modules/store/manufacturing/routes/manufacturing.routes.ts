import { Routes } from '@angular/router';

/**
 * Store-admin Manufactura (MVP) routes.
 *
 * Mounted under `/admin/manufacturing` from
 * `routes/private/store_admin.routes.ts`.
 *
 * Backend permission enforcement:
 *   - formulas  → store:manufacturing:formulas:read|create|update|delete
 *   - orders    → store:manufacturing:orders:read|create|update
 *   - settings  → store:manufacturing:settings:read|update
 *
 * Sidebar visibility: panel_ui keys `manufacturing`, `manufacturing_formulas`,
 * `manufacturing_orders`, `manufacturing_settings` (hidden for every industry
 * except `manufacturing` via INDUSTRY_HIDDEN_MODULES).
 */
export const manufacturingRoutes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'formulas' },

  // Fórmulas
  {
    path: 'formulas',
    pathMatch: 'full',
    loadComponent: () =>
      import('../formulas/pages/formulas-list-page/formulas-list-page.component').then(
        (c) => c.FormulasListPageComponent,
      ),
    data: { permission: 'store:manufacturing:formulas:read' },
  },
  {
    path: 'formulas/new',
    loadComponent: () =>
      import('../formulas/pages/formula-form-page/formula-form-page.component').then(
        (c) => c.FormulaFormPageComponent,
      ),
    data: { permission: 'store:manufacturing:formulas:create' },
  },
  {
    path: 'formulas/:id/edit',
    loadComponent: () =>
      import('../formulas/pages/formula-form-page/formula-form-page.component').then(
        (c) => c.FormulaFormPageComponent,
      ),
    data: { permission: 'store:manufacturing:formulas:update' },
  },

  // Órdenes de producción
  {
    path: 'orders',
    pathMatch: 'full',
    loadComponent: () =>
      import('../orders/pages/orders-list-page/orders-list-page.component').then(
        (c) => c.OrdersListPageComponent,
      ),
    data: { permission: 'store:manufacturing:orders:read' },
  },
  {
    path: 'orders/new',
    loadComponent: () =>
      import('../orders/pages/order-form-page/order-form-page.component').then(
        (c) => c.OrderFormPageComponent,
      ),
    data: { permission: 'store:manufacturing:orders:create' },
  },
  {
    path: 'orders/:id/edit',
    loadComponent: () =>
      import('../orders/pages/order-form-page/order-form-page.component').then(
        (c) => c.OrderFormPageComponent,
      ),
    data: { permission: 'store:manufacturing:orders:update' },
  },
  {
    path: 'orders/:id',
    loadComponent: () =>
      import('../orders/pages/order-detail-page/order-detail-page.component').then(
        (c) => c.OrderDetailPageComponent,
      ),
    data: { permission: 'store:manufacturing:orders:read' },
  },

  // Planta
  {
    path: 'settings',
    loadComponent: () =>
      import('../settings/pages/plant-settings-page/plant-settings-page.component').then(
        (c) => c.PlantSettingsPageComponent,
      ),
    data: { permission: 'store:manufacturing:settings:read' },
  },
];
