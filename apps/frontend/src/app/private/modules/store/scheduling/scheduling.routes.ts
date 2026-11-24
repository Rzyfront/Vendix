import { Routes } from '@angular/router';

/**
 * Órdenes → Agenda (`/admin/orders/agenda`): un solo módulo con las pestañas
 * Calendario | Programación | Configuración en `?tab=`.
 */
export const SCHEDULING_AGENDA_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('./pages/agenda-shell/agenda-shell.component').then((c) => c.AgendaShellComponent),
  },
];
