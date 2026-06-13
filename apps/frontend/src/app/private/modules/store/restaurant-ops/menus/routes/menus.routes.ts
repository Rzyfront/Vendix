import { Routes } from '@angular/router';

/**
 * Store-admin Menus (Restaurant Suite — Fase G) routes.
 *
 * Mounted under `/admin/restaurant-ops/menus` from
 * `routes/private/store_admin.routes.ts`.
 *
 * Backend permission enforcement:
 *  - GET list/detail/full  → store:menus:read
 *  - POST create           → store:menus:create
 *  - PATCH/DELETE          → store:menus:update | store:menus:delete
 *  - GET engineering-report → store:menu_engineering:read
 *
 * The list page doubles as the entry point: it owns the "+ Nueva Carta"
 * action that routes to the builder page in "new" mode (where id=0).
 * The builder page handles both create and edit by looking at the route id.
 */
export const menusRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import(
        '../pages/menus-list-page/menus-list-page.component'
      ).then((c) => c.MenusListPageComponent),
    data: { permission: 'store:menus:read' },
  },
  {
    path: 'engineering',
    loadComponent: () =>
      import(
        '../pages/menu-engineering-page/menu-engineering-page.component'
      ).then((c) => c.MenuEngineeringPageComponent),
    data: { permission: 'store:menu_engineering:read' },
  },
  {
    path: 'new',
    loadComponent: () =>
      import(
        '../pages/menu-builder-page/menu-builder-page.component'
      ).then((c) => c.MenuBuilderPageComponent),
    data: { permission: 'store:menus:create' },
  },
  {
    path: ':id/edit',
    loadComponent: () =>
      import(
        '../pages/menu-builder-page/menu-builder-page.component'
      ).then((c) => c.MenuBuilderPageComponent),
    data: { permission: 'store:menus:update' },
  },
  {
    path: ':id',
    pathMatch: 'full',
    redirectTo: ':id/edit',
  },
];
