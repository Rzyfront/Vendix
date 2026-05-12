import { Routes } from '@angular/router';

export const PARTNERS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./partners.component').then((m) => m.PartnersComponent),
  },
];
