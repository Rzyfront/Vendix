import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AnalyticsComponent } from './analytics.component';

const routes: Routes = [
  {
    path: '',
    component: AnalyticsComponent,
    children: [
      {
        path: 'predictive',
        loadComponent: () =>
          import('./predictive/predictive.component').then(
            (m) => m.PredictiveComponent,
          ),
      },
      {
        path: 'cross-store',
        loadComponent: () =>
          import('./cross-store/cross-store.component').then(
            (m) => m.CrossStoreComponent,
          ),
      },
      {
        path: '',
        redirectTo: 'predictive',
        pathMatch: 'full',
      },
    ],
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class AnalyticsRoutingModule {}
