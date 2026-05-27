import { Routes } from '@angular/router';

/**
 * Store-admin Price Tiers (Precios y Tarifas) routes.
 *
 * Mounted under `/admin/price-tiers` from `routes/private/store_admin.routes.ts`.
 *
 * Backend permission enforcement:
 *   - GET list/detail  → store:price-tiers:read
 *   - POST/PATCH       → store:price-tiers:create | store:price-tiers:update
 *   - DELETE/restore   → store:price-tiers:delete
 *
 * Sidebar visibility is driven by the `settings_price_tiers` panel_ui key
 * (mapped from the menu label "Precios y Tarifas" in MenuFilterService).
 */
export const priceTiersRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import(
        '../pages/price-tiers-list-page/price-tiers-list-page.component'
      ).then((c) => c.PriceTiersListPageComponent),
    data: { permission: 'store:price-tiers:read' },
  },
  {
    path: 'new',
    loadComponent: () =>
      import(
        '../pages/price-tier-form-page/price-tier-form-page.component'
      ).then((c) => c.PriceTierFormPageComponent),
    data: { permission: 'store:price-tiers:create' },
  },
  {
    path: ':id/edit',
    loadComponent: () =>
      import(
        '../pages/price-tier-form-page/price-tier-form-page.component'
      ).then((c) => c.PriceTierFormPageComponent),
    data: { permission: 'store:price-tiers:update' },
  },
];
