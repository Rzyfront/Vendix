import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { InventoryComponent } from './inventory.component';

const routes: Routes = [
  {
    path: '',
    component: InventoryComponent,
    children: [
      {
        path: 'stock',
        loadComponent: () =>
          import('./stock/stock.component').then((m) => m.StockComponent),
      },
      {
        path: 'transfers',
        loadComponent: () =>
          import('./transfers/transfers.component').then(
            (m) => m.TransfersComponent,
          ),
      },
      {
        path: 'suppliers',
        loadComponent: () =>
          import('./suppliers/suppliers.component').then(
            (m) => m.SuppliersComponent,
          ),
      },
      {
        path: 'demand-forecast',
        loadComponent: () =>
          import('./demand-forecast/demand-forecast.component').then(
            (m) => m.DemandForecastComponent,
          ),
      },
      {
        path: '',
        redirectTo: 'stock',
        pathMatch: 'full',
      },
    ],
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class InventoryRoutingModule {}
