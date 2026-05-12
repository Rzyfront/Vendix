import { Routes } from '@angular/router';
import { operatingScopeGuard } from '../../../../core/guards/operating-scope.guard';

export const orgPurchaseOrdersRoutes: Routes = [
  {
    path: '',
    canActivate: [operatingScopeGuard],
    data: {
      requiredOperatingScope: 'ORGANIZATION',
      lockedTooltip:
        'Selecciona una tienda para administrar inventario en modo STORE.',
    },
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
