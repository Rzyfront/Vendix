import { Routes } from '@angular/router';
import { AuthGuard } from '../../core/guards/auth.guard';

export const superAdminRoutes: Routes = [
  {
    path: 'super-admin',
    loadComponent: () =>
      import(
        '../../private/layouts/super-admin/super-admin-layout.component'
      ).then((c) => c.SuperAdminLayoutComponent),
    canActivate: [AuthGuard], // O un guardia específico para Super Admin
    children: [
      {
        path: '',
        pathMatch: 'full',
        redirectTo: 'dashboard',
      },
      {
        path: 'dashboard',
        loadComponent: () =>
          import(
            '../../private/modules/super-admin/dashboard/dashboard.component'
          ).then((c) => c.DashboardComponent),
      },
      {
        path: 'organizations',
        loadComponent: () =>
          import(
            '../../private/modules/super-admin/organizations/organizations.component'
          ).then((c) => c.OrganizationsComponent),
      },
      {
        path: 'users',
        loadComponent: () =>
          import(
            '../../private/modules/super-admin/users/users.component'
          ).then((c) => c.UsersComponent),
      },
      {
        path: 'roles',
        loadComponent: () =>
          import(
            '../../private/modules/super-admin/roles/roles.component'
          ).then((c) => c.RolesComponent),
      },
      {
        path: 'payment-methods',
        loadComponent: () =>
          import(
            '../../private/modules/super-admin/payment-methods/payment-methods.component'
          ).then((c) => c.PaymentMethodsComponent),
      },
      {
        path: 'stores',
        loadComponent: () =>
          import(
            '../../private/modules/super-admin/stores/stores.component'
          ).then((c) => c.StoresComponent),
      },
      {
        path: 'audit',
        loadComponent: () =>
          import(
            '../../private/modules/super-admin/audit/audit.component'
          ).then((c) => c.AuditComponent),
      },
      {
        path: 'domains',
        loadComponent: () =>
          import(
            '../../private/modules/super-admin/domains/domains.component'
          ).then((c) => c.DomainsComponent),
      },
      {
        path: 'currencies',
        loadComponent: () =>
          import(
            '../../private/modules/super-admin/currencies/currencies.component'
          ).then((c) => c.CurrenciesComponent),
      },
      {
        path: 'system/ai-engine',
        loadComponent: () =>
          import(
            '../../private/modules/super-admin/ai-engine/ai-engine.component'
          ).then((c) => c.AIEngineComponent),
      },
      {
        path: 'system/templates',
        loadComponent: () =>
          import(
            '../../private/modules/super-admin/templates/templates.component'
          ).then((c) => c.TemplatesComponent),
      },
      {
        path: 'settings/shipping',
        loadComponent: () =>
          import(
            '../../private/modules/super-admin/shipping/shipping.component'
          ).then((c) => c.ShippingLayoutComponent),
      },
      {
        path: 'legal-documents',
        loadComponent: () =>
          import(
            '../../private/modules/super-admin/legal-documents/legal-documents.component'
          ).then((c) => c.LegalDocumentsComponent),
      },
      {
        path: 'help-center',
        loadComponent: () =>
          import(
            '../../private/modules/super-admin/help-center/help-center-admin.component'
          ).then((c) => c.HelpCenterAdminComponent),
      },
      {
        path: 'help-center/articles/new',
        loadComponent: () =>
          import(
            '../../private/modules/super-admin/help-center/pages/article-form/article-form.component'
          ).then((c) => c.ArticleFormComponent),
      },
      {
        path: 'help-center/articles/:id/edit',
        loadComponent: () =>
          import(
            '../../private/modules/super-admin/help-center/pages/article-form/article-form.component'
          ).then((c) => c.ArticleFormComponent),
      },
      {
        path: 'monitoring',
        loadChildren: () =>
          import(
            '../../private/modules/super-admin/monitoring/monitoring.routes'
          ).then((m) => m.MONITORING_ROUTES),
      },
      {
        path: 'billing',
        redirectTo: 'subscriptions',
        pathMatch: 'full',
      },
      {
        path: 'support',
        loadChildren: () =>
          import('../../private/modules/super-admin/support/support.routes').then(
            (m) => m.SUPPORT_ROUTES
          ),
      },
      {
        path: 'system/backups',
        loadComponent: () =>
          import(
            '../../private/modules/super-admin/backups/backups.component'
          ).then((c) => c.BackupsComponent),
      },
      {
        path: 'system/payroll-defaults',
        loadComponent: () =>
          import(
            '../../private/modules/super-admin/payroll-defaults/payroll-defaults.component'
          ).then((c) => c.PayrollDefaultsComponent),
      },
      {
        path: 'system/settings-sync',
        loadComponent: () =>
          import(
            '../../private/modules/super-admin/settings-sync/settings-sync.component'
          ).then((c) => c.SuperAdminSettingsSyncComponent),
      },
      {
        path: 'subscriptions',
        loadChildren: () =>
          import(
            '../../private/modules/super-admin/subscriptions/subscriptions.routes'
          ).then((m) => m.SUBSCRIPTIONS_ROUTES),
      },
    ],
  },
];
