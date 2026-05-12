import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'application' },
  {
    path: 'application',
    loadComponent: () =>
      import('./application/application.component').then(
        (m) => m.ApplicationComponent,
      ),
  },
  {
    path: 'payment-methods',
    loadComponent: () =>
      import('./payment-methods/payment-methods.component').then(
        (m) => m.PaymentMethodsComponent,
      ),
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class ConfigRoutingModule {}
