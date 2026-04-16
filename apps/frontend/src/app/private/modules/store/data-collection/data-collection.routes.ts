import { Routes } from '@angular/router';
import { DataCollectionLayoutComponent } from './data-collection-layout.component';

export const DATA_COLLECTION_ROUTES: Routes = [
  {
    path: '',
    component: DataCollectionLayoutComponent,
    children: [
      {
        path: '',
        redirectTo: 'fields',
        pathMatch: 'full',
      },
      {
        path: 'fields',
        loadComponent: () =>
          import('./fields/fields.component').then((c) => c.FieldsComponent),
      },
      {
        path: 'templates',
        loadComponent: () =>
          import('./templates/templates.component').then(
            (c) => c.TemplatesComponent,
          ),
      },
      {
        path: 'templates/:id/edit',
        loadComponent: () =>
          import('./templates/template-editor/template-editor.component').then(
            (c) => c.TemplateEditorComponent,
          ),
      },
      {
        path: 'submissions',
        loadComponent: () =>
          import('./submissions/submissions.component').then(
            (c) => c.SubmissionsComponent,
          ),
      },
    ],
  },
];
