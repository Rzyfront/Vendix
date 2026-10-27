import { Routes } from '@angular/router';

/**
 * Hospitality Suite — H2.1. Rate plans routes.
 *
 * Mounted under `/admin/hospitality/rates` from
 * `routes/private/store_admin.routes.ts`. Panel_ui key: `hospitality_rates`.
 */
export const hospitalityRatesRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('../pages/rates-page/rates-page.component').then(
        (c) => c.HospitalityRatesPageComponent,
      ),
  },
];
