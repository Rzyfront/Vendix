import { Routes } from '@angular/router';

export const WORKFLOWS_OPS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/workflows-ops-page/workflows-ops-page.component').then(
        (c) => c.WorkflowsOpsPageComponent,
      ),
  },
];
