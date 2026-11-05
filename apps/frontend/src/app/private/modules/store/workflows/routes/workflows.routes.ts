import { Routes } from '@angular/router';

/**
 * Workflows routes (Flujos). Mounted under `/admin/workflows` from
 * `routes/private/store_admin.routes.ts`. Panel_ui key: `flows`
 * (industry `administration`, always enforced).
 *
 * Backend permission enforcement (store/workflows): the API checks
 * `store:workflows:*` per endpoint; these entries only describe the read side.
 */
export const workflowsRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('../pages/workflows-page/workflows-page.component').then(
        (c) => c.WorkflowsPageComponent,
      ),
    data: { permission: 'store:workflows:read' },
  },
  {
    path: 'instances/:id',
    loadComponent: () =>
      import('../pages/instance-detail-page/instance-detail-page.component').then(
        (c) => c.InstanceDetailPageComponent,
      ),
    data: { permission: 'store:workflows:read' },
  },
];
