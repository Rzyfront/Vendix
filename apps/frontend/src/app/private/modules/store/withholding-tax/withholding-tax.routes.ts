import { Routes } from '@angular/router';

export const withholdingTaxRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./withholding-tax.component').then(m => m.WithholdingTaxComponent),
  },
];
