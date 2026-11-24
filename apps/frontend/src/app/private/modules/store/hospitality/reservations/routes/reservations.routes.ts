import { inject } from '@angular/core';
import { Router, Routes } from '@angular/router';

/**
 * Hospitality Suite — old "Reservas de hotel" URL.
 *
 * Mounted under `/admin/hospitality/reservations` from
 * `routes/private/store_admin.routes.ts`. Agenda F2: hotel reservations are
 * no longer a module; they are the main tab of Recepción. Bookmarks, links
 * and the module catalog still pointing here land on that tab, without
 * adding a history entry. Panel_ui key (unchanged): `hospitality_reservations`,
 * the same one Recepción uses.
 */
const toReservationsTab = () =>
  inject(Router).createUrlTree(['/admin/hospitality/front-desk'], {
    queryParams: { tab: 'reservations' },
  });

export const hospitalityReservationsRoutes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: toReservationsTab },
  { path: '**', redirectTo: toReservationsTab },
];
