import { Routes } from '@angular/router';

export const COMMISSIONS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./partner-commissions.component').then(
        (c) => c.PartnerCommissionsComponent,
      ),
  },
];
