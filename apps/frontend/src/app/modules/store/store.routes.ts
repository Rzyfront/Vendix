import { Routes } from '@angular/router';

export const storeRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/storefront/storefront.component').then(c => c.StorefrontComponent)
  },
  {
    path: '**',
    redirectTo: ''
  }
];
