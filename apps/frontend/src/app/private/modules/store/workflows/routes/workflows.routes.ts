import { Routes } from '@angular/router';

/**
 * Workflows routes (Flujos). Mounted under `/admin/workflows` from
 * `routes/private/store_admin.routes.ts`. Panel_ui key: `flows`
 * (industry `administration`, always enforced).
 *
 * Permissions are enforced by the API per endpoint (`store:workflows:*`);
 * staff with only `start`/`task` reach their requests and "Mis tareas", and
 * the backend answers 403 with its message on anything else.
 */
export const workflowsRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('../pages/workflows-page/workflows-page.component').then(
        (c) => c.WorkflowsPageComponent,
      ),
  },
  {
    path: 'inbox',
    loadComponent: () =>
      import('../pages/inbox-page/inbox-page.component').then((c) => c.InboxPageComponent),
  },
  {
    path: ':id/board',
    loadComponent: () =>
      import('../pages/board-page/board-page.component').then((c) => c.BoardPageComponent),
  },
  {
    path: ':id/edit',
    loadComponent: () =>
      import('../editor/workflow-editor-page.component').then(
        (c) => c.WorkflowEditorPageComponent,
      ),
  },
  {
    path: 'instances/:id',
    loadComponent: () =>
      import('../pages/instance-detail-page/instance-detail-page.component').then(
        (c) => c.InstanceDetailPageComponent,
      ),
  },
];
