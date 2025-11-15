import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { OperationsComponent } from './operations.component';

const routes: Routes = [
  {
    path: '',
    component: OperationsComponent,
    children: [
      {
        path: 'shipping',
        loadComponent: () =>
          import('./shipping/shipping.component').then(
            (m) => m.ShippingComponent,
          ),
      },
      {
        path: 'procurement',
        loadComponent: () =>
          import('./procurement/procurement.component').then(
            (m) => m.ProcurementComponent,
          ),
      },
      {
        path: 'returns',
        loadComponent: () =>
          import('./returns/returns.component').then((m) => m.ReturnsComponent),
      },
      {
        path: 'route-optimization',
        loadComponent: () =>
          import('./route-optimization/route-optimization.component').then(
            (m) => m.RouteOptimizationComponent,
          ),
      },
      {
        path: '',
        redirectTo: 'shipping',
        pathMatch: 'full',
      },
    ],
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class OperationsRoutingModule {}
