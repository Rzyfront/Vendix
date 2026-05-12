import { Routes } from '@angular/router';

export const PROMOTIONAL_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./promotional.component').then((m) => m.PromotionalComponent),
  },
  {
    path: ':id',
    loadComponent: () =>
      import('./promotional-detail.component').then((m) => m.PromotionalDetailComponent),
  },
];
