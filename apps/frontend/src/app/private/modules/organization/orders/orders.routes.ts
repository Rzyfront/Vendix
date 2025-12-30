import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

const routes: Routes = [
  {
    children: [
      {
        path: '',
        redirectTo: 'sales',
        pathMatch: 'full',
      },
      {
        path: 'sales',
        loadComponent: () =>
          import('./orders-list.component').then((m) => m.OrdersListComponent),
        title: 'Sales Orders - Organization',
      },
      {
        path: 'purchase-orders',
        loadComponent: () =>
          import('../../store/orders/purchase-orders/purchase-orders.component').then(
            (m) => m.PurchaseOrdersComponent
          ),
        title: 'Purchase Orders - Organization',
      },
    ],
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class OrdersRoutingModule { }
