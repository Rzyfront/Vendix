import { Routes } from '@angular/router';

export const ACTIVE_SUBSCRIPTIONS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./active-subscriptions.component').then((m) => m.ActiveSubscriptionsComponent),
  },
  {
    path: ':id',
    loadComponent: () =>
      import('./active-subscription-detail.component').then(
        (m) => m.ActiveSubscriptionDetailComponent,
      ),
  },
];
