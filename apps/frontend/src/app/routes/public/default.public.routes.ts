import { Routes } from '@angular/router';
import { pricingRoutes } from '../../public/pricing/pricing.routes';

export const defaultPublicRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import(
        '../../public/landing/vendix-landing/vendix-landing.component'
      ).then((c) => c.VendixLandingComponent),
  },
  // G8 — Página pública de términos. El checkout linkea al anchor
  // #pagos-y-reembolsos con la política oficial de no-reembolso.
  {
    path: 'legal/terminos',
    loadComponent: () =>
      import('../../public/legal/terms/terms.component').then(
        (m) => m.TermsComponent,
      ),
  },
  ...pricingRoutes,
];
