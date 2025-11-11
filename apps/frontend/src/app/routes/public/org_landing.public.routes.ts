import { Routes } from '@angular/router';

export const orgLandingPublicRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('../../public/dynamic-landing/components/org-landing/org-landing.component').then(c => c.OrgLandingComponent)
  },
  {
    path: 'shop',
    loadComponent: () => import('../../public/ecommerce/components/storefront/storefront.component').then(c => c.StorefrontComponent)
  }
];