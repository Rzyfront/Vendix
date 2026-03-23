import { Routes } from '@angular/router';

export const icaRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./ica-rates.component').then(m => m.IcaRatesComponent),
  },
];
