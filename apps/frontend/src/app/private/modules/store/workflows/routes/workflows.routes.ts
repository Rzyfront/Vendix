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
      import('../pages/inbox-page/inbox-page.component').then(
        (c) => c.InboxPageComponent,
      ),
  },
  {
    path: 'integrations',
    loadComponent: () =>
      import('../integrations/pages/integrations-page/integrations-page.component').then(
        (c) => c.IntegrationsPageComponent,
      ),
  },
  {
    path: 'connectors',
    loadComponent: () =>
      import('../connectors/pages/connectors-page/connectors-page.component').then(
        (c) => c.ConnectorsPageComponent,
      ),
  },
  {
    path: 'records',
    loadComponent: () =>
      import('../records/pages/collections-page/collections-page.component').then(
        (c) => c.CollectionsPageComponent,
      ),
  },
  {
    path: 'records/collections/new',
    loadComponent: () =>
      import('../records/pages/collection-designer-page/collection-designer-page.component').then(
        (c) => c.CollectionDesignerPageComponent,
      ),
  },
  {
    path: 'records/collections/:collectionId/edit',
    loadComponent: () =>
      import('../records/pages/collection-designer-page/collection-designer-page.component').then(
        (c) => c.CollectionDesignerPageComponent,
      ),
  },
  {
    path: 'records/collections/:collectionId',
    loadComponent: () =>
      import('../records/pages/records-list-page/records-list-page.component').then(
        (c) => c.RecordsListPageComponent,
      ),
  },
  {
    path: 'records/collections/:collectionId/new',
    loadComponent: () =>
      import('../records/pages/record-form-page/record-form-page.component').then(
        (c) => c.RecordFormPageComponent,
      ),
  },
  {
    path: 'records/:recordId/edit',
    loadComponent: () =>
      import('../records/pages/record-form-page/record-form-page.component').then(
        (c) => c.RecordFormPageComponent,
      ),
  },
  {
    path: 'records/:recordId',
    loadComponent: () =>
      import('../records/pages/record-detail-page/record-detail-page.component').then(
        (c) => c.RecordDetailPageComponent,
      ),
  },
  {
    path: ':id/board',
    loadComponent: () =>
      import('../pages/board-page/board-page.component').then(
        (c) => c.BoardPageComponent,
      ),
  },
  {
    path: ':id/analytics',
    loadComponent: () =>
      import('../pages/analytics-page/analytics-page.component').then(
        (c) => c.AnalyticsPageComponent,
      ),
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
