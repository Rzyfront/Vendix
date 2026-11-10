import { Routes } from '@angular/router';

export const SCHEDULED_ORDERS_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('./pages/agenda-page/agenda-page.component').then((c) => c.AgendaPageComponent),
  },
  {
    path: 'production',
    // T14 (QUI-996): same shared view as Operaciones → Producción and Planta.
    loadComponent: () =>
      import(
        '../restaurant-ops/production/components/production-day-list/production-day-list.component'
      ).then((c) => c.ProductionDayListComponent),
    data: {
      detailBase: '/admin/restaurant-ops/production/orders',
      consolidatedPath: '/admin/scheduled-orders/production/insumos',
    },
  },
  {
    // Printable consolidated ingredients of the day (the former production list).
    path: 'production/insumos',
    loadComponent: () =>
      import('./pages/production-list-page/production-list-page.component').then(
        (c) => c.ProductionListPageComponent,
      ),
  },
];
