import { Routes } from '@angular/router';

export const MARGINS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./partner-margins.component').then(
        (c) => c.PartnerMarginsComponent,
      ),
  },
];
