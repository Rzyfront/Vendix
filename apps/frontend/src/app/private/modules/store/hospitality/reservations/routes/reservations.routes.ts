import { Routes } from '@angular/router';

/**
 * Hospitality Suite — H1.1. Reservations routes.
 *
 * Mounted under `/admin/hospitality/reservations` from
 * `routes/private/store_admin.routes.ts`. Panel_ui key:
 * `hospitality_reservations`.
 */
export const hospitalityReservationsRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('../pages/reservations-page/reservations-page.component').then(
        (c) => c.HospitalityReservationsPageComponent,
      ),
  },
];
