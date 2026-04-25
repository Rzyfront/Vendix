import { Routes } from '@angular/router';

export const OVERVIEW_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./org-subscriptions-overview.component').then(
        (c) => c.OrgSubscriptionsOverviewComponent,
      ),
  },
];
