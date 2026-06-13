import { Routes } from '@angular/router';

/**
 * Store-admin Recipes (Restaurant Suite — Phase B) routes.
 *
 * Mounted under `/admin/restaurant-ops/recipes` from
 * `routes/private/store_admin.routes.ts`.
 *
 * Backend permission enforcement:
 *   - GET list/detail  → store:recipes:read
 *   - POST create      → store:recipes:create
 *   - PATCH / DELETE   → store:recipes:update | store:recipes:delete
 *
 * Sidebar visibility will be wired in Phase I (panel_ui) — for now the
 * routes exist and the component code is in place.
 */
export const recipesRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import(
        '../pages/recipes-list-page/recipes-list-page.component'
      ).then((c) => c.RecipesListPageComponent),
    data: { permission: 'store:recipes:read' },
  },
  {
    path: 'new',
    loadComponent: () =>
      import(
        '../pages/recipe-form-page/recipe-form-page.component'
      ).then((c) => c.RecipeFormPageComponent),
    data: { permission: 'store:recipes:create' },
  },
  {
    path: ':id/edit',
    loadComponent: () =>
      import(
        '../pages/recipe-form-page/recipe-form-page.component'
      ).then((c) => c.RecipeFormPageComponent),
    data: { permission: 'store:recipes:update' },
  },
];
