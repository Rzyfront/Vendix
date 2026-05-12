import { Routes } from '@angular/router';

export const BRANDING_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./partner-branding.component').then(
        (c) => c.PartnerBrandingComponent,
      ),
  },
];
