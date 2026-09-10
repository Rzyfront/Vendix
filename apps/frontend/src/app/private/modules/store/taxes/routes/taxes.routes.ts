import { Routes } from '@angular/router';

/**
 * Store-admin Impuestos (tax_categories) routes.
 *
 * El montaje bajo `/admin/taxes` en `routes/private/store_admin.routes.ts`
 * lo hace otro agente; este archivo solo declara las rutas del módulo.
 *
 * Backend permission enforcement:
 *   - GET list/detail  → store:taxes:read
 *   - POST/seed        → store:taxes:create
 *   - PATCH            → store:taxes:update
 *   - DELETE           → store:taxes:delete
 *
 * Crear/editar va en modal (`TaxFormModalComponent`), no en páginas de
 * formulario: la única ruta es la lista.
 */
export const taxesRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('../pages/taxes-list-page/taxes-list-page.component').then(
        (c) => c.TaxesListPageComponent,
      ),
    data: { permission: 'store:taxes:read' },
  },
];
