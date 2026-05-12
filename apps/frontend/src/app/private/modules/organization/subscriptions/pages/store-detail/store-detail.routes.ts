import { Routes } from '@angular/router';

export const STORE_DETAIL_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./store-subscription-detail.component').then(
        (c) => c.StoreSubscriptionDetailComponent,
      ),
  },
];
