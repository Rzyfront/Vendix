import { Routes } from '@angular/router';

export const orgLandingPublicRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import(
        '../../public/dynamic-landing/components/org-landing/org-landing.component'
      ).then((c) => c.OrgLandingComponent),
  }
];
