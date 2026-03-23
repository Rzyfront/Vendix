import { Routes } from '@angular/router';

export const exogenousRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./exogenous.component').then(m => m.ExogenousComponent),
  },
];
