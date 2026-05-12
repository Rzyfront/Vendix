import { Routes } from '@angular/router';

export const pricingRoutes: Routes = [
  {
    path: 'pricing',
    loadComponent: () =>
      import('./pricing.component').then((c) => c.PricingComponent),
  },
];
