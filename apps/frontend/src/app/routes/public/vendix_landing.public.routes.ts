import { Routes } from '@angular/router';
import { pricingRoutes } from '../../public/pricing/pricing.routes';

export const vendixLandingPublicRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import(
        '../../public/landing/vendix-landing/vendix-landing.component'
      ).then((c) => c.VendixLandingComponent),
  },
  ...pricingRoutes,
];
