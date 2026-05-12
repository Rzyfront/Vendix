import { Routes } from '@angular/router';
import { PartnerOrgGuard } from '../../../../core/guards/partner-org.guard';

const subscriptionsRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('./pages/overview/org-subscriptions-overview.component').then(
        (c) => c.OrgSubscriptionsOverviewComponent,
      ),
  },
  {
    path: 'stores/:storeId',
    loadComponent: () =>
      import('./pages/store-detail/store-subscription-detail.component').then(
        (c) => c.StoreSubscriptionDetailComponent,
      ),
  },
  {
    path: 'invoices',
    loadComponent: () =>
      import('./pages/invoices/subscription-invoices.component').then(
        (c) => c.SubscriptionInvoicesComponent,
      ),
  },
  {
    path: 'payment-methods',
    loadComponent: () =>
      import('./pages/payment-methods/subscription-payment-methods.component').then(
        (c) => c.SubscriptionPaymentMethodsComponent,
      ),
  },
  {
    path: 'margins',
    canActivate: [PartnerOrgGuard],
    loadComponent: () =>
      import('./pages/margins/partner-margins.component').then(
        (c) => c.PartnerMarginsComponent,
      ),
  },
  {
    path: 'branding',
    canActivate: [PartnerOrgGuard],
    loadComponent: () =>
      import('./pages/branding/partner-branding.component').then(
        (c) => c.PartnerBrandingComponent,
      ),
  },
  {
    path: 'commissions',
    canActivate: [PartnerOrgGuard],
    loadComponent: () =>
      import('./pages/commissions/partner-commissions.component').then(
        (c) => c.PartnerCommissionsComponent,
      ),
  },
];

export default subscriptionsRoutes;
