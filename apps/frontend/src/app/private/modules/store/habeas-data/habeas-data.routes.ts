import { Routes } from '@angular/router';

export const habeasDataRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./habeas-data.component').then(m => m.HabeasDataComponent),
  },
];
