import { Routes } from '@angular/router';
import type { AccountingSubTab } from '../../store/accounting/components/sub-tabs-shell/sub-tabs-shell.component';

// Org accounting mirrors the store accounting super-tab architecture
// (configuration / cartera / taxes with internal sub-navigation), reusing the
// standalone `AccountingSubTabsShellComponent` from the store module. The org
// module only declares sub-tabs for functions it actually implements — e.g.
// "configuration" has no "flows" sub-tab because the org scope has no
// accounting-flows page.

const CONFIGURATION_SUB_TABS: AccountingSubTab[] = [
  {
    id: 'mappings',
    label: 'Mapeos',
    icon: 'arrow-left-right',
    route: '/admin/accounting/configuration/mappings',
  },
];

const CARTERA_SUB_TABS: AccountingSubTab[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: 'layout-dashboard',
    route: '/admin/accounting/cartera/dashboard',
  },
  {
    id: 'receivables',
    label: 'CxC',
    icon: 'arrow-down-circle',
    route: '/admin/accounting/cartera/receivables',
  },
  {
    id: 'payables',
    label: 'CxP',
    icon: 'arrow-up-circle',
    route: '/admin/accounting/cartera/payables',
  },
  {
    id: 'aging',
    label: 'Vencimientos',
    icon: 'clock',
    route: '/admin/accounting/cartera/aging',
  },
];

const TAXES_SUB_TABS: AccountingSubTab[] = [
  {
    id: 'withholding',
    label: 'Retenciones',
    icon: 'percent',
    route: '/admin/accounting/taxes/withholding',
  },
  {
    id: 'exogenous',
    label: 'Exógena',
    icon: 'file-spreadsheet',
    route: '/admin/accounting/taxes/exogenous',
  },
  {
    id: 'ica',
    label: 'ICA Municipal',
    icon: 'landmark',
    route: '/admin/accounting/taxes/ica',
  },
];

export const orgAccountingRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./accounting.component').then((c) => c.OrgAccountingComponent),
    children: [
      {
        path: '',
        redirectTo: 'chart-of-accounts',
        pathMatch: 'full',
      },
      {
        path: 'chart-of-accounts',
        loadComponent: () =>
          import('./pages/chart-of-accounts/chart-of-accounts.component').then(
            (c) => c.OrgChartOfAccountsComponent,
          ),
      },
      {
        path: 'journal-entries',
        loadComponent: () =>
          import('./pages/journal-entries/journal-entries.component').then(
            (c) => c.OrgJournalEntriesComponent,
          ),
      },
      {
        path: 'fiscal-periods',
        loadComponent: () =>
          import('./pages/fiscal-periods/fiscal-periods.component').then(
            (c) => c.OrgFiscalPeriodsComponent,
          ),
      },
      // Configuración — super-tab; org scope only implements account mappings.
      {
        path: 'configuration',
        loadComponent: () =>
          import(
            '../../store/accounting/components/sub-tabs-shell/sub-tabs-shell.component'
          ).then((c) => c.AccountingSubTabsShellComponent),
        data: {
          subTabs: CONFIGURATION_SUB_TABS,
          subTabsAriaLabel: 'Configuración contable',
        },
        children: [
          {
            path: '',
            redirectTo: 'mappings',
            pathMatch: 'full',
          },
          {
            path: 'mappings',
            loadComponent: () =>
              import('./pages/account-mappings/account-mappings.component').then(
                (c) => c.OrgAccountMappingsComponent,
              ),
          },
        ],
      },
      // Cartera — super-tab grouping dashboard + CxC + CxP + aging.
      {
        path: 'cartera',
        loadComponent: () =>
          import(
            '../../store/accounting/components/sub-tabs-shell/sub-tabs-shell.component'
          ).then((c) => c.AccountingSubTabsShellComponent),
        data: {
          subTabs: CARTERA_SUB_TABS,
          subTabsAriaLabel: 'Gestión de cartera',
        },
        children: [
          {
            path: '',
            redirectTo: 'dashboard',
            pathMatch: 'full',
          },
          {
            path: 'dashboard',
            loadComponent: () =>
              import(
                './pages/cartera-dashboard/cartera-dashboard.component'
              ).then((c) => c.OrgCarteraDashboardComponent),
          },
          {
            path: 'receivables',
            loadComponent: () =>
              import('./pages/receivables/receivables.component').then(
                (c) => c.OrgReceivablesComponent,
              ),
          },
          {
            path: 'payables',
            loadComponent: () =>
              import('./pages/payables/payables.component').then(
                (c) => c.OrgPayablesComponent,
              ),
          },
          {
            path: 'aging',
            loadComponent: () =>
              import('./pages/aging/aging.component').then(
                (c) => c.OrgAgingComponent,
              ),
          },
        ],
      },
      // Impuestos — super-tab grouping retenciones / exógena / ICA.
      {
        path: 'taxes',
        loadComponent: () =>
          import(
            '../../store/accounting/components/sub-tabs-shell/sub-tabs-shell.component'
          ).then((c) => c.AccountingSubTabsShellComponent),
        data: {
          subTabs: TAXES_SUB_TABS,
          subTabsAriaLabel: 'Gestión de impuestos',
        },
        children: [
          {
            path: '',
            redirectTo: 'withholding',
            pathMatch: 'full',
          },
          {
            path: 'withholding',
            loadComponent: () =>
              import('./fiscal/withholding-tax/withholding-tax.component').then(
                (c) => c.OrgWithholdingTaxComponent,
              ),
          },
          {
            path: 'exogenous',
            loadComponent: () =>
              import('./fiscal/exogenous/exogenous.component').then(
                (c) => c.OrgExogenousComponent,
              ),
          },
          {
            path: 'ica',
            loadComponent: () =>
              import('./fiscal/ica/ica.component').then(
                (c) => c.OrgIcaComponent,
              ),
          },
        ],
      },
      // ── Legacy redirects ─────────────────────────────────────────────
      // Old flat tab routes were regrouped under the configuration /
      // cartera / taxes super-tabs. Keep redirects so bookmarks, sidebar
      // entries and deep links keep working.
      {
        path: 'account-mappings',
        redirectTo: 'configuration/mappings',
        pathMatch: 'full',
      },
      {
        path: 'receivables',
        redirectTo: 'cartera/receivables',
        pathMatch: 'full',
      },
      {
        path: 'payables',
        redirectTo: 'cartera/payables',
        pathMatch: 'full',
      },
      {
        path: 'aging',
        redirectTo: 'cartera/aging',
        pathMatch: 'full',
      },
      {
        path: 'withholding-tax',
        redirectTo: 'taxes/withholding',
        pathMatch: 'full',
      },
      {
        path: 'exogenous',
        redirectTo: 'taxes/exogenous',
        pathMatch: 'full',
      },
      {
        path: 'ica',
        redirectTo: 'taxes/ica',
        pathMatch: 'full',
      },
    ],
  },
];
