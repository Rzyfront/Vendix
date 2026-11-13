import { Routes } from '@angular/router';

/**
 * Retenciones: the three views are sibling pills of Impuestos (layer 4), so
 * each one is a route. `/admin/accounting/taxes/withholding` keeps working and
 * lands on Conceptos.
 */
export const withholdingTaxRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./withholding-tax.component').then(m => m.WithholdingTaxComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'concepts' },
      {
        path: 'concepts',
        loadComponent: () =>
          import('./components/withholding-concepts-tab.component').then(
            m => m.WithholdingConceptsTabComponent,
          ),
      },
      {
        path: 'calculations',
        loadComponent: () =>
          import('./components/withholding-calculations-list.component').then(
            m => m.WithholdingCalculationsListComponent,
          ),
      },
      {
        path: 'certificates',
        loadComponent: () =>
          import('./components/withholding-certificate-viewer.component').then(
            m => m.WithholdingCertificateViewerComponent,
          ),
      },
      { path: '**', redirectTo: 'concepts' },
    ],
  },
];
