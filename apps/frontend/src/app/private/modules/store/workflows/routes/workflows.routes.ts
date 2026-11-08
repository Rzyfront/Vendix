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
    // P5.5: multi-flow board filtered by flow, role and branch.
    path: 'board',
    loadComponent: () =>
      import('../pages/board-all-page/board-all-page.component').then(
        (c) => c.BoardAllPageComponent,
      ),
  },
  {
    // P6: AI token consumption and weekly summaries (sidebar child `flows_insights`).
    path: 'insights',
    loadComponent: () =>
      import('../pages/insights-page/insights-page.component').then(
        (c) => c.InsightsPageComponent,
      ),
  },
  {
    // P7.1: month usage against the plan limits (sidebar child `flows_usage`).
    path: 'usage',
    loadComponent: () =>
      import('../pages/plan-usage-page/plan-usage-page.component').then(
        (c) => c.PlanUsagePageComponent,
      ),
  },
  {
    // P7.2: append-only audit trail, integrity check and XLSX (`flows_audit`).
    path: 'audit',
    loadComponent: () =>
      import('../pages/audit-page/audit-page.component').then(
        (c) => c.AuditPageComponent,
      ),
  },
  {
    // P7.6: full ZIP export of flows, requests and dossiers (`flows_exports`).
    path: 'exports',
    loadComponent: () =>
      import('../pages/export-page/export-page.component').then(
        (c) => c.ExportPageComponent,
      ),
  },
  {
    // P7.7: help and FAQ of Flows and Documents (`flows_help`).
    path: 'help',
    loadComponent: () =>
      import('../pages/help-page/help-page.component').then(
        (c) => c.HelpPageComponent,
      ),
  },
  {
    // P5.4: gallery of ready-made Administration templates.
    path: 'templates',
    loadComponent: () =>
      import('../pages/templates-gallery-page/templates-gallery-page.component').then(
        (c) => c.TemplatesGalleryPageComponent,
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
