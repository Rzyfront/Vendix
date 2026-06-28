import { Routes } from '@angular/router';

/**
 * Store-admin Serial Numbers (Números de Serie) routes.
 *
 * Mounted under `/admin/inventory/serials` from
 * `routes/private/store_admin.routes.ts`.
 *
 * Backend permission enforcement:
 *   - GET list → store:inventory:serial_numbers:read
 *
 * Read-only module: the serial-number pool is populated by purchase-receipt
 * and POS flows; this view only lists and searches it.
 */
export const serialNumbersRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import(
        '../pages/serial-numbers-list-page/serial-numbers-list-page.component'
      ).then((c) => c.SerialNumbersListPageComponent),
    data: { permission: 'store:inventory:serial_numbers:read' },
  },
];
