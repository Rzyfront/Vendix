import { Routes } from '@angular/router';

/**
 * Hospitality Suite — H0.1. Rooms routes.
 *
 * Mounted under `/admin/hospitality/rooms` from
 * `routes/private/store_admin.routes.ts`. Panel_ui key: `hospitality_rooms`.
 */
export const hospitalityRoomsRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('../pages/rooms-page/rooms-page.component').then(
        (c) => c.HospitalityRoomsPageComponent,
      ),
  },
];
