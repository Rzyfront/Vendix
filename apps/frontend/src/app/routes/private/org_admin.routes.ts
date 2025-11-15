import { Routes } from '@angular/router';
import { AuthGuard } from '../../core/guards/auth.guard';

export const orgAdminRoutes: Routes = [
  {
    path: 'admin',
    loadComponent: () =>
      import(
        '../../private/layouts/organization-admin/organization-admin-layout.component'
      ).then((c) => c.OrganizationAdminLayoutComponent),
    canActivate: [AuthGuard],
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
            '../../private/modules/organization/dashboard/dashboard.component'
          ).then((c) => c.DashboardComponent),
      },
      {
        path: 'financial',
        children: [
          {
            path: '',
            pathMatch: 'full',
            loadComponent: () =>
              import(
                '../../private/modules/organization/financial/financial.component'
              ).then((c) => c.FinancialComponent),
          },
          {
            path: 'reports',
            loadComponent: () =>
              import(
                '../../private/modules/organization/financial/reports/reports.component'
              ).then((c) => c.ReportsComponent),
          },
          {
            path: 'billing',
            loadComponent: () =>
              import(
                '../../private/modules/organization/financial/billing/billing.component'
              ).then((c) => c.BillingComponent),
          },
          {
            path: 'cost-analysis',
            loadComponent: () =>
              import(
                '../../private/modules/organization/financial/cost-analysis/cost-analysis.component'
              ).then((c) => c.CostAnalysisComponent),
          },
          {
            path: 'cash-flow',
            loadComponent: () =>
              import(
                '../../private/modules/organization/financial/cash-flow/cash-flow.component'
              ).then((c) => c.CashFlowComponent),
          },
        ],
      },
      {
        path: 'analytics',
        children: [
          {
            path: '',
            pathMatch: 'full',
            loadComponent: () =>
              import(
                '../../private/modules/organization/analytics/analytics.component'
              ).then((c) => c.AnalyticsComponent),
          },
          {
            path: 'predictive',
            loadComponent: () =>
              import(
                '../../private/modules/organization/analytics/predictive/predictive.component'
              ).then((c) => c.PredictiveComponent),
          },
          {
            path: 'cross-store',
            loadComponent: () =>
              import(
                '../../private/modules/organization/analytics/cross-store/cross-store.component'
              ).then((c) => c.CrossStoreComponent),
          },
        ],
      },
      {
        path: 'stores-management',
        loadComponent: () =>
          import(
            '../../private/modules/organization/stores-management/stores-management.component'
          ).then((c) => c.StoresManagementComponent),
      },
      {
        path: 'users',
        children: [
          {
            path: '',
            pathMatch: 'full',
            loadComponent: () =>
              import(
                '../../private/modules/organization/users-management/users-management.component'
              ).then((c) => c.UsersManagementComponent),
          },
          {
            path: 'global-users',
            loadComponent: () =>
              import(
                '../../private/modules/organization/users-management/global-users/global-users.component'
              ).then((c) => c.GlobalUsersComponent),
          },
          {
            path: 'roles-permissions',
            loadComponent: () =>
              import(
                '../../private/modules/organization/users-management/roles-permissions/roles-permissions.component'
              ).then((c) => c.RolesPermissionsComponent),
          },
          {
            path: 'store-assignments',
            loadComponent: () =>
              import(
                '../../private/modules/organization/users-management/store-assignments/store-assignments.component'
              ).then((c) => c.StoreAssignmentsComponent),
          },
          {
            path: 'access-audit',
            loadComponent: () =>
              import(
                '../../private/modules/organization/users-management/access-audit/access-audit.component'
              ).then((c) => c.AccessAuditComponent),
          },
        ],
      },
      {
        path: 'inventory',
        children: [
          {
            path: '',
            pathMatch: 'full',
            loadComponent: () =>
              import(
                '../../private/modules/organization/inventory/inventory.component'
              ).then((c) => c.InventoryComponent),
          },
          {
            path: 'stock',
            loadComponent: () =>
              import(
                '../../private/modules/organization/inventory/stock/stock.component'
              ).then((c) => c.StockComponent),
          },
          {
            path: 'transfers',
            loadComponent: () =>
              import(
                '../../private/modules/organization/inventory/transfers/transfers.component'
              ).then((c) => c.TransfersComponent),
          },
          {
            path: 'suppliers',
            loadComponent: () =>
              import(
                '../../private/modules/organization/inventory/suppliers/suppliers.component'
              ).then((c) => c.SuppliersComponent),
          },
          {
            path: 'demand-forecast',
            loadComponent: () =>
              import(
                '../../private/modules/organization/inventory/demand-forecast/demand-forecast.component'
              ).then((c) => c.DemandForecastComponent),
          },
        ],
      },
      {
        path: 'operations',
        children: [
          {
            path: '',
            pathMatch: 'full',
            loadComponent: () =>
              import(
                '../../private/modules/organization/operations/operations.component'
              ).then((c) => c.OperationsComponent),
          },
          {
            path: 'shipping',
            loadComponent: () =>
              import(
                '../../private/modules/organization/operations/shipping/shipping.component'
              ).then((c) => c.ShippingComponent),
          },
          {
            path: 'procurement',
            loadComponent: () =>
              import(
                '../../private/modules/organization/operations/procurement/procurement.component'
              ).then((c) => c.ProcurementComponent),
          },
          {
            path: 'returns',
            loadComponent: () =>
              import(
                '../../private/modules/organization/operations/returns/returns.component'
              ).then((c) => c.ReturnsComponent),
          },
          {
            path: 'route-optimization',
            loadComponent: () =>
              import(
                '../../private/modules/organization/operations/route-optimization/route-optimization.component'
              ).then((c) => c.RouteOptimizationComponent),
          },
        ],
      },
      {
        path: 'audit',
        children: [
          {
            path: '',
            pathMatch: 'full',
            loadComponent: () =>
              import(
                '../../private/modules/organization/audit/audit.component'
              ).then((c) => c.AuditComponent),
          },
          {
            path: 'logs',
            loadComponent: () =>
              import(
                '../../private/modules/organization/audit/logs/logs.component'
              ).then((c) => c.LogsComponent),
          },
          {
            path: 'compliance',
            loadComponent: () =>
              import(
                '../../private/modules/organization/audit/compliance/compliance.component'
              ).then((c) => c.ComplianceComponent),
          },
          {
            path: 'legal-docs',
            loadComponent: () =>
              import(
                '../../private/modules/organization/audit/legal-docs/legal-docs.component'
              ).then((c) => c.LegalDocsComponent),
          },
          {
            path: 'backup',
            loadComponent: () =>
              import(
                '../../private/modules/organization/audit/backup/backup.component'
              ).then((c) => c.BackupComponent),
          },
        ],
      },
      {
        path: 'config',
        children: [
          {
            path: '',
            pathMatch: 'full',
            loadComponent: () =>
              import(
                '../../private/modules/organization/config/config.component'
              ).then((c) => c.ConfigComponent),
          },
          {
            path: 'application',
            loadComponent: () =>
              import(
                '../../private/modules/organization/config/application/application.component'
              ).then((c) => c.ApplicationComponent),
          },
          {
            path: 'policies',
            loadComponent: () =>
              import(
                '../../private/modules/organization/config/policies/policies.component'
              ).then((c) => c.PoliciesComponent),
          },
          {
            path: 'integrations',
            loadComponent: () =>
              import(
                '../../private/modules/organization/config/integrations/integrations.component'
              ).then((c) => c.IntegrationsComponent),
          },
          {
            path: 'taxes',
            loadComponent: () =>
              import(
                '../../private/modules/organization/config/taxes/taxes.component'
              ).then((c) => c.TaxesComponent),
          },
          {
            path: 'domains',
            loadComponent: () =>
              import(
                '../../private/modules/organization/config/domains/domains.component'
              ).then((c) => c.DomainsComponent),
          },
        ],
      },
    ],
  },
];
