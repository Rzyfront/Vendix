import { Routes } from '@angular/router';
import { SubscriptionAdminService } from './services/subscription-admin.service';

export const SUBSCRIPTIONS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./subscriptions-layout.component').then(
        (c) => c.SubscriptionsLayoutComponent,
      ),
    providers: [SubscriptionAdminService],
    children: [
      {
        path: '',
        pathMatch: 'full',
        redirectTo: 'plans',
      },
      {
        path: 'plans',
        loadComponent: () =>
          import('./pages/plans/plans.component').then(
            (c) => c.PlansComponent,
          ),
      },
      {
        path: 'plans/new',
        loadComponent: () =>
          import('./pages/plans/plan-form.component').then(
            (c) => c.PlanFormComponent,
          ),
      },
      {
        path: 'plans/:id/edit',
        loadComponent: () =>
          import('./pages/plans/plan-form.component').then(
            (c) => c.PlanFormComponent,
          ),
      },
      {
        path: 'plans/:id',
        loadComponent: () =>
          import('./pages/plans/plan-detail.component').then(
            (c) => c.PlanDetailComponent,
          ),
      },
      {
        path: 'partners',
        loadComponent: () =>
          import('./pages/partners/partners.component').then(
            (c) => c.PartnersComponent,
          ),
      },
      {
        path: 'partners/:id',
        loadComponent: () =>
          import('./pages/partners/partner-detail.component').then(
            (c) => c.PartnerDetailComponent,
          ),
      },
      {
        path: 'promotional',
        loadComponent: () =>
          import('./pages/promotional/promotional.component').then(
            (c) => c.PromotionalComponent,
          ),
      },
      {
        path: 'active',
        loadComponent: () =>
          import('./pages/active/active-subscriptions.component').then(
            (c) => c.ActiveSubscriptionsComponent,
          ),
      },
      {
        path: 'dunning',
        loadComponent: () =>
          import('./pages/dunning/dunning-board.component').then(
            (c) => c.DunningBoardComponent,
          ),
      },
      {
        path: 'payouts',
        loadComponent: () =>
          import('./pages/payouts/partner-payouts.component').then(
            (c) => c.PartnerPayoutsComponent,
          ),
      },
      {
        path: 'events',
        loadComponent: () =>
          import('./pages/events/subscription-events.component').then(
            (c) => c.SubscriptionEventsComponent,
          ),
      },
      {
        path: 'gateway',
        loadComponent: () =>
          import('./pages/gateway/gateway.component').then(
            (c) => c.GatewayComponent,
          ),
      },
      {
        path: 'metrics',
        loadComponent: () =>
          import(
            './pages/metrics/subscription-metrics-dashboard.component'
          ).then((c) => c.SubscriptionMetricsDashboardComponent),
      },
    ],
  },
];
