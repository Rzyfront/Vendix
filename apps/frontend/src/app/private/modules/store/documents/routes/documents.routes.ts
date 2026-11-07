import { Routes } from '@angular/router';

/**
 * Documents routes (expedientes). Mounted under `/admin/documents` from
 * `routes/private/store_admin.routes.ts`. Panel_ui key: `documents`
 * (industry `administration`, always enforced).
 *
 * Backend permission: `store:documents:read` on `store/documents/dossiers`.
 */
export const documentsRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('../pages/documents-page/documents-page.component').then(
        (c) => c.DocumentsPageComponent,
      ),
    data: { permission: 'store:documents:read' },
  },
  // P4.4/P4.6/P4.7: búsqueda, carpetas por entidad, vencimientos y retención.
  {
    path: 'search',
    loadComponent: () =>
      import('../pages/documents-search/documents-search-page.component').then(
        (c) => c.DocumentsSearchPageComponent,
      ),
    data: { permission: 'store:documents:read' },
  },
  {
    path: 'folders',
    pathMatch: 'full',
    loadComponent: () =>
      import('../pages/documents-folders/documents-folders-page.component').then(
        (c) => c.DocumentsFoldersPageComponent,
      ),
    data: { permission: 'store:documents:read' },
  },
  {
    path: 'folders/:subjectType',
    pathMatch: 'full',
    loadComponent: () =>
      import('../pages/documents-folders/documents-folders-page.component').then(
        (c) => c.DocumentsFoldersPageComponent,
      ),
    data: { permission: 'store:documents:read' },
  },
  {
    path: 'folders/:subjectType/:subjectId',
    loadComponent: () =>
      import('../pages/documents-folders/documents-folders-page.component').then(
        (c) => c.DocumentsFoldersPageComponent,
      ),
    data: { permission: 'store:documents:read' },
  },
  {
    path: 'expiring',
    loadComponent: () =>
      import('../pages/documents-expiring/documents-expiring-page.component').then(
        (c) => c.DocumentsExpiringPageComponent,
      ),
    data: { permission: 'store:documents:read' },
  },
  {
    path: 'retention',
    pathMatch: 'full',
    loadComponent: () =>
      import('../pages/documents-retention/documents-retention-page.component').then(
        (c) => c.DocumentsRetentionPageComponent,
      ),
    data: { permission: 'store:workflows:design' },
  },
  {
    path: 'retention/runs/:id',
    loadComponent: () =>
      import('../pages/documents-retention/documents-retention-run-page.component').then(
        (c) => c.DocumentsRetentionRunPageComponent,
      ),
    data: { permission: 'store:workflows:design' },
  },
  // P4.1/P4.5: plantillas de documentos (listar: documentos; diseñar: diseño de flujos).
  {
    path: 'templates',
    pathMatch: 'full',
    loadComponent: () =>
      import('../pages/templates-list/templates-list-page.component').then(
        (c) => c.TemplatesListPageComponent,
      ),
    data: { permission: 'store:documents:read' },
  },
  {
    path: 'templates/new',
    pathMatch: 'full',
    loadComponent: () =>
      import('../pages/templates-new/templates-new-page.component').then(
        (c) => c.TemplatesNewPageComponent,
      ),
    data: { permission: 'store:workflows:design' },
  },
  {
    path: 'templates/:id',
    loadComponent: () =>
      import('../pages/templates-editor/templates-editor-page.component').then(
        (c) => c.TemplatesEditorPageComponent,
      ),
    data: { permission: 'store:workflows:design' },
  },
];
