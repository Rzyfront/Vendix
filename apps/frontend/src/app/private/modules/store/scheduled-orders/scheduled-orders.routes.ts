import { Routes } from '@angular/router';

export const SCHEDULED_ORDERS_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('./pages/agenda-page/agenda-page.component').then((c) => c.AgendaPageComponent),
  },
  {
    // T14 (QUI-996): same shared view as Operaciones → Producción and Planta.
    // Day list on its own path; `permission` is route metadata, as in the KDS
    // routes (the backend enforces either production read permission).
    path: 'day',
    loadComponent: () =>
      import(
        '../restaurant-ops/production/components/production-day-list/production-day-list.component'
      ).then((c) => c.ProductionDayListComponent),
    data: {
      permission: 'store:production_orders:read',
      detailBase: '/admin/restaurant-ops/production/orders',
      activeBase: '/admin/restaurant-ops/production/active',
      consolidatedPath: '/admin/scheduled-orders/production',
    },
  },
  {
    // Printable consolidated ingredients of the day (Insumos). Saved links to
    // `/scheduled-orders/production` keep landing here, as before the day list.
    path: 'production',
    loadComponent: () =>
      import('./pages/production-list-page/production-list-page.component').then(
        (c) => c.ProductionListPageComponent,
      ),
  },
  {
    // Alias of the previous Insumos path.
    path: 'production/insumos',
    redirectTo: 'production',
    pathMatch: 'full',
  },
];
