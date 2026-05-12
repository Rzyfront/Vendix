import { Routes } from '@angular/router';

export const EVENTS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./subscription-events.component').then((m) => m.SubscriptionEventsComponent),
  },
];
