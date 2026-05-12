import { Routes } from '@angular/router';
import { pricingRoutes } from '../../public/pricing/pricing.routes';

export const orgLandingPublicRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import(
        '../../public/dynamic-landing/components/org-landing/org-landing.component'
      ).then((c) => c.OrgLandingComponent),
  },
  ...pricingRoutes,
];
