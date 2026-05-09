import { Routes } from '@angular/router';

export const orgPurchaseOrdersRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./purchase-orders.component').then(
        (c) => c.OrgPurchaseOrdersComponent,
      ),
    children: [
      {
        path: '',
        pathMatch: 'full',
        loadComponent: () =>
          import('./pages/list/purchase-orders-list.component').then(
            (c) => c.OrgPurchaseOrdersListComponent,
          ),
      },
      {
        path: 'create',
        loadComponent: () =>
          import('./pages/create/purchase-order-create.component').then(
            (c) => c.OrgPurchaseOrderCreateComponent,
          ),
      },
      {
        path: ':id',
        loadComponent: () =>
          import('./pages/detail/purchase-order-detail.component').then(
            (c) => c.OrgPurchaseOrderDetailComponent,
          ),
      },
    ],
  },
];
