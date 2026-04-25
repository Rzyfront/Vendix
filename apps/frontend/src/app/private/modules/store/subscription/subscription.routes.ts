import { Routes } from '@angular/router';

const subscriptionRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('./pages/my-subscription/my-subscription.component').then(
        (c) => c.MySubscriptionComponent,
      ),
  },
  {
    path: 'plans',
    loadComponent: () =>
      import('./pages/plans/plan-catalog.component').then(
        (c) => c.PlanCatalogComponent,
      ),
  },
  {
    path: 'payment',
    loadComponent: () =>
      import('./pages/payment/payment-method.component').then(
        (c) => c.PaymentMethodComponent,
      ),
  },
  {
    path: 'history',
    loadComponent: () =>
      import('./pages/history/billing-history.component').then(
        (c) => c.BillingHistoryComponent,
      ),
  },
  {
    path: 'checkout/:planId',
    loadComponent: () =>
      import('./pages/checkout/checkout.component').then(
        (c) => c.CheckoutComponent,
      ),
  },
];

export default subscriptionRoutes;
