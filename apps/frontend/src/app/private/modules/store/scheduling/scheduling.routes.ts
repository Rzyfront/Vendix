import { Routes } from '@angular/router';

/** Órdenes → Programación (`/admin/orders/scheduling`). */
export const SCHEDULING_LIST_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('./pages/scheduling-list-page/scheduling-list-page.component').then(
        (c) => c.SchedulingListPageComponent,
      ),
  },
];

/** Órdenes → Agenda (`/admin/orders/agenda`). */
export const SCHEDULING_AGENDA_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('./pages/scheduling-agenda-page/scheduling-agenda-page.component').then(
        (c) => c.SchedulingAgendaPageComponent,
      ),
  },
];
