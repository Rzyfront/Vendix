import { Routes } from '@angular/router';

/**
 * Directorio de organizaciones del super admin + ficha de tenant.
 *
 * Espeja `stores.routes.ts` con el otro alcance. El parámetro se llama
 * `organizationId` (y no `id`) para que el guard que siembra el contexto no
 * tenga que adivinar qué representa el número de la URL cuando esta ficha se
 * anide bajo otro árbol.
 *
 * El segmento que viaja al backend es `organizations`, en PLURAL, igual que en
 * el rail de tiendas.
 */
export const ORGANIZATIONS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./organizations.component').then((c) => c.OrganizationsComponent),
  },
  {
    path: ':organizationId',
    loadChildren: () =>
      import('../tenants/tenant-profile.routes').then((m) =>
        m.tenantProfileRoutes('organizations', 'organizationId'),
      ),
  },
];
