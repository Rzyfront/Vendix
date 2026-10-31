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
    loadComponent: () =>
      import('./pages/production-list-page/production-list-page.component').then(
        (c) => c.ProductionListPageComponent,
      ),
  },
];
