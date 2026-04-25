import { Routes } from '@angular/router';

export const PAYOUTS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./partner-payouts.component').then((m) => m.PartnerPayoutsComponent),
  },
];
