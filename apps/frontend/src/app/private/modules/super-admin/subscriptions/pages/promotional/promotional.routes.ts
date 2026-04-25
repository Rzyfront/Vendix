import { Routes } from '@angular/router';

export const PROMOTIONAL_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./promotional.component').then((m) => m.PromotionalComponent),
  },
];
