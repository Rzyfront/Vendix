import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { FinancialComponent } from './financial.component';

const routes: Routes = [
  {
    path: '',
    component: FinancialComponent,
    children: [
      {
        path: 'reports',
        loadComponent: () =>
          import('./reports/reports.component').then((m) => m.ReportsComponent),
      },
      {
        path: 'billing',
        loadComponent: () =>
          import('./billing/billing.component').then((m) => m.BillingComponent),
      },
      {
        path: 'cost-analysis',
        loadComponent: () =>
          import('./cost-analysis/cost-analysis.component').then(
            (m) => m.CostAnalysisComponent,
          ),
      },
      {
        path: 'cash-flow',
        loadComponent: () =>
          import('./cash-flow/cash-flow.component').then(
            (m) => m.CashFlowComponent,
          ),
      },
      {
        path: '',
        redirectTo: 'reports',
        pathMatch: 'full',
      },
    ],
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class FinancialRoutingModule {}
