import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { ConfigComponent } from './config.component';

const routes: Routes = [
  {
    path: '',
    component: ConfigComponent,
    children: [
      {
        path: 'application',
        loadComponent: () =>
          import('./application/application.component').then(
            (m) => m.ApplicationComponent,
          ),
      },
      {
        path: 'policies',
        loadComponent: () =>
          import('./policies/policies.component').then(
            (m) => m.PoliciesComponent,
          ),
      },
      {
        path: 'integrations',
        loadComponent: () =>
          import('./integrations/integrations.component').then(
            (m) => m.IntegrationsComponent,
          ),
      },
      {
        path: 'taxes',
        loadComponent: () =>
          import('./taxes/taxes.component').then((m) => m.TaxesComponent),
      },
      {
        path: 'domains',
        loadComponent: () =>
          import('./domains/domains.component').then((m) => m.DomainsComponent),
      },
      {
        path: '',
        redirectTo: 'application',
        pathMatch: 'full',
      },
    ],
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class ConfigRoutingModule {}
