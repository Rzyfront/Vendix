import { Routes } from '@angular/router';

export const domainsRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./domains.component').then((c) => c.DomainsComponent),
  },
];
