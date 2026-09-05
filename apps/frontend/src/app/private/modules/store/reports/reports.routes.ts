import { Routes } from '@angular/router';
import { provideState } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import { reportsReducer } from './state/reports.reducer';
import { ReportsEffects } from './state/reports.effects';
import { accountingReducer } from '../accounting/state/reducers/accounting.reducer';
import { AccountingEffects } from '../accounting/state/effects/accounting.effects';

/**
 * Reports route tree.
 *
 * Each catalog/tab entry used to be a `redirectTo: ''` that collapsed into
 * `<app-category-reports-catalog>` (Fix 5). That kept catalog cards from
 * erroring on stale deep-links, but it ALSO meant clicking a card never
 * left the catalog — exactly the symptom described in QUI-722
 * (catalog + tabs no navegan, balance-sheet rejects page/limit).
 *
 * Restore (QUI-722): every sub-route now points at a real
 * `<app-generic-report-page>`. The page reads `reportId` from
 * `route.data`, which selects the matching entry from
 * `REPORT_DEFINITIONS` (the registry at `config/report-registry.ts`)
 * and dispatches `selectReport(...)` → loads via the NgRx effect.
 *
 *   - `overview-summary` keeps its bespoke page (stat cards + catalog).
 *   - `accounting` and `payroll` keep their dedicated pages with
 *     fullViewRoute hops into their modules.
 *   - `inventory-low-stock-by-supplier` keeps its bespoke page (has
 *     its own searchable supplier dropdown).
 */
export const reportsRoutes: Routes = [
  {
    path: '',
    providers: [
      provideState({ name: 'reports', reducer: reportsReducer }),
      provideEffects(ReportsEffects),
      provideState({ name: 'accounting', reducer: accountingReducer }),
      provideEffects(AccountingEffects),
    ],
    children: [
      // Redirect base to first category
      { path: '', redirectTo: 'overview', pathMatch: 'full' },

      // Each category has its own shell with tabs
      {
        path: 'overview',
        loadComponent: () => import('./components/reports-shell/reports-shell.component').then(c => c.ReportsShellComponent),
        data: { categoryId: 'overview' },
        children: [
          { path: '', redirectTo: 'overview-summary', pathMatch: 'full' },
          { path: 'overview-summary', loadComponent: () => import('./pages/overview/overview-summary-report/overview-summary-report.component').then(c => c.OverviewSummaryReportComponent) },
        ],
      },
      {
        path: 'sales',
        loadComponent: () => import('./components/reports-shell/reports-shell.component').then(c => c.ReportsShellComponent),
        data: { categoryId: 'sales' },
        children: [
          {
            path: '',
            loadComponent: () => import('./pages/category-reports-catalog/category-reports-catalog.component').then(c => c.CategoryReportsCatalogComponent),
            data: { categoryId: 'sales' },
          },
          // QUI-722: each sub-route loads GenericReportPageComponent which
          // routes by `reportId` in `data`.
          { path: 'sales-summary',         data: { reportId: 'sales-summary' },         loadComponent: () => import('./pages/generic-report-page/generic-report-page.component').then(c => c.GenericReportPageComponent) },
          { path: 'sales-by-product',      data: { reportId: 'sales-by-product' },      loadComponent: () => import('./pages/generic-report-page/generic-report-page.component').then(c => c.GenericReportPageComponent) },
          { path: 'sales-by-category',     data: { reportId: 'sales-by-category' },     loadComponent: () => import('./pages/generic-report-page/generic-report-page.component').then(c => c.GenericReportPageComponent) },
          { path: 'sales-by-customer',     data: { reportId: 'sales-by-customer' },     loadComponent: () => import('./pages/generic-report-page/generic-report-page.component').then(c => c.GenericReportPageComponent) },
          { path: 'sales-by-payment',      data: { reportId: 'sales-by-payment' },      loadComponent: () => import('./pages/generic-report-page/generic-report-page.component').then(c => c.GenericReportPageComponent) },
          { path: 'sales-by-channel',      data: { reportId: 'sales-by-channel' },      loadComponent: () => import('./pages/generic-report-page/generic-report-page.component').then(c => c.GenericReportPageComponent) },
          { path: 'sales-trends',          data: { reportId: 'sales-trends' },          loadComponent: () => import('./pages/generic-report-page/generic-report-page.component').then(c => c.GenericReportPageComponent) },
        ],
      },
      {
        path: 'inventory',
        loadComponent: () => import('./components/reports-shell/reports-shell.component').then(c => c.ReportsShellComponent),
        data: { categoryId: 'inventory' },
        children: [
          {
            path: '',
            loadComponent: () => import('./pages/category-reports-catalog/category-reports-catalog.component').then(c => c.CategoryReportsCatalogComponent),
            data: { categoryId: 'inventory' },
          },
          // CP-low-stock-by-supplier — bespoke page (searchable supplier
          // dropdown + status filter the viewer doesn't expose).
          {
            path: 'inventory-low-stock-by-supplier',
            loadComponent: () => import('./pages/inventory-low-stock-by-supplier/inventory-low-stock-by-supplier.component').then(c => c.InventoryLowStockBySupplierComponent),
          },
          // QUI-722: every other sub-route is a generic report page.
          { path: 'inventory-overview',            data: { reportId: 'inventory-overview' },            loadComponent: () => import('./pages/generic-report-page/generic-report-page.component').then(c => c.GenericReportPageComponent) },
          { path: 'inventory-stock-info',          data: { reportId: 'inventory-stock-info' },          loadComponent: () => import('./pages/generic-report-page/generic-report-page.component').then(c => c.GenericReportPageComponent) },
          { path: 'inventory-low-stock',           data: { reportId: 'inventory-low-stock' },           loadComponent: () => import('./pages/generic-report-page/generic-report-page.component').then(c => c.GenericReportPageComponent) },
          { path: 'inventory-valuation',           data: { reportId: 'inventory-valuation' },           loadComponent: () => import('./pages/generic-report-page/generic-report-page.component').then(c => c.GenericReportPageComponent) },
          { path: 'inventory-movements',           data: { reportId: 'inventory-movements' },           loadComponent: () => import('./pages/generic-report-page/generic-report-page.component').then(c => c.GenericReportPageComponent) },
          { path: 'inventory-movement-analysis',   data: { reportId: 'inventory-movement-analysis' },   loadComponent: () => import('./pages/generic-report-page/generic-report-page.component').then(c => c.GenericReportPageComponent) },
        ],
      },
      {
        path: 'products',
        loadComponent: () => import('./components/reports-shell/reports-shell.component').then(c => c.ReportsShellComponent),
        data: { categoryId: 'products' },
        children: [
          {
            path: '',
            loadComponent: () => import('./pages/category-reports-catalog/category-reports-catalog.component').then(c => c.CategoryReportsCatalogComponent),
            data: { categoryId: 'products' },
          },
          { path: 'product-performance',  data: { reportId: 'product-performance' },  loadComponent: () => import('./pages/generic-report-page/generic-report-page.component').then(c => c.GenericReportPageComponent) },
          { path: 'product-top-sellers',  data: { reportId: 'product-top-sellers' },  loadComponent: () => import('./pages/generic-report-page/generic-report-page.component').then(c => c.GenericReportPageComponent) },
          { path: 'product-profitability', data: { reportId: 'product-profitability' }, loadComponent: () => import('./pages/generic-report-page/generic-report-page.component').then(c => c.GenericReportPageComponent) },
        ],
      },
      {
        path: 'customers',
        loadComponent: () => import('./components/reports-shell/reports-shell.component').then(c => c.ReportsShellComponent),
        data: { categoryId: 'customers' },
        children: [
          {
            path: '',
            loadComponent: () => import('./pages/category-reports-catalog/category-reports-catalog.component').then(c => c.CategoryReportsCatalogComponent),
            data: { categoryId: 'customers' },
          },
          { path: 'customer-summary',            data: { reportId: 'customer-summary' },            loadComponent: () => import('./pages/generic-report-page/generic-report-page.component').then(c => c.GenericReportPageComponent) },
          { path: 'customer-acquisition',        data: { reportId: 'customer-acquisition' },        loadComponent: () => import('./pages/generic-report-page/generic-report-page.component').then(c => c.GenericReportPageComponent) },
          { path: 'customer-abandoned-carts',    data: { reportId: 'customer-abandoned-carts' },    loadComponent: () => import('./pages/generic-report-page/generic-report-page.component').then(c => c.GenericReportPageComponent) },
          { path: 'customers-top',               data: { reportId: 'customers-top' },               loadComponent: () => import('./pages/generic-report-page/generic-report-page.component').then(c => c.GenericReportPageComponent) },
        ],
      },
      {
        path: 'purchases',
        loadComponent: () => import('./components/reports-shell/reports-shell.component').then(c => c.ReportsShellComponent),
        data: { categoryId: 'purchases' },
        children: [
          {
            path: '',
            loadComponent: () => import('./pages/category-reports-catalog/category-reports-catalog.component').then(c => c.CategoryReportsCatalogComponent),
            data: { categoryId: 'purchases' },
          },
          { path: 'purchase-summary',      data: { reportId: 'purchase-summary' },      loadComponent: () => import('./pages/generic-report-page/generic-report-page.component').then(c => c.GenericReportPageComponent) },
          { path: 'purchase-by-supplier',  data: { reportId: 'purchase-by-supplier' },  loadComponent: () => import('./pages/generic-report-page/generic-report-page.component').then(c => c.GenericReportPageComponent) },
          { path: 'purchase-trends',       data: { reportId: 'purchase-trends' },       loadComponent: () => import('./pages/generic-report-page/generic-report-page.component').then(c => c.GenericReportPageComponent) },
        ],
      },
      {
        path: 'reviews',
        loadComponent: () => import('./components/reports-shell/reports-shell.component').then(c => c.ReportsShellComponent),
        data: { categoryId: 'reviews' },
        children: [
          {
            path: '',
            loadComponent: () => import('./pages/category-reports-catalog/category-reports-catalog.component').then(c => c.CategoryReportsCatalogComponent),
            data: { categoryId: 'reviews' },
          },
          { path: 'reviews-summary',     data: { reportId: 'reviews-summary' },     loadComponent: () => import('./pages/generic-report-page/generic-report-page.component').then(c => c.GenericReportPageComponent) },
          { path: 'reviews-by-product',  data: { reportId: 'reviews-by-product' },  loadComponent: () => import('./pages/generic-report-page/generic-report-page.component').then(c => c.GenericReportPageComponent) },
        ],
      },
      {
        path: 'accounting',
        loadComponent: () => import('./components/reports-shell/reports-shell.component').then(c => c.ReportsShellComponent),
        data: { categoryId: 'accounting' },
        children: [
          { path: '', redirectTo: 'trial-balance', pathMatch: 'full' },
          { path: 'trial-balance', loadComponent: () => import('./pages/accounting/trial-balance-report/trial-balance-report.component').then(c => c.TrialBalanceReportComponent) },
          { path: 'balance-sheet', loadComponent: () => import('./pages/accounting/balance-sheet-report/balance-sheet-report.component').then(c => c.BalanceSheetReportComponent) },
          { path: 'income-statement', loadComponent: () => import('./pages/accounting/income-statement-report/income-statement-report.component').then(c => c.IncomeStatementReportComponent) },
          { path: 'general-ledger', loadComponent: () => import('./pages/accounting/general-ledger-report/general-ledger-report.component').then(c => c.GeneralLedgerReportComponent) },
        ],
      },
      {
        path: 'financial',
        loadComponent: () => import('./components/reports-shell/reports-shell.component').then(c => c.ReportsShellComponent),
        data: { categoryId: 'financial' },
        children: [
          {
            path: '',
            loadComponent: () => import('./pages/category-reports-catalog/category-reports-catalog.component').then(c => c.CategoryReportsCatalogComponent),
            data: { categoryId: 'financial' },
          },
          { path: 'tax-summary',         data: { reportId: 'tax-summary' },         loadComponent: () => import('./pages/generic-report-page/generic-report-page.component').then(c => c.GenericReportPageComponent) },
          { path: 'profit-loss',         data: { reportId: 'profit-loss' },         loadComponent: () => import('./pages/generic-report-page/generic-report-page.component').then(c => c.GenericReportPageComponent) },
          { path: 'financial-refunds',   data: { reportId: 'financial-refunds' },   loadComponent: () => import('./pages/generic-report-page/generic-report-page.component').then(c => c.GenericReportPageComponent) },
          { path: 'cash-sessions',       data: { reportId: 'cash-sessions' },       loadComponent: () => import('./pages/generic-report-page/generic-report-page.component').then(c => c.GenericReportPageComponent) },
        ],
      },
      {
        path: 'payroll',
        loadComponent: () => import('./components/reports-shell/reports-shell.component').then(c => c.ReportsShellComponent),
        data: { categoryId: 'payroll' },
        children: [
          { path: '', redirectTo: 'payroll-summary', pathMatch: 'full' },
          { path: 'payroll-summary', loadComponent: () => import('./pages/payroll/payroll-summary-report/payroll-summary-report.component').then(c => c.PayrollSummaryReportComponent) },
          { path: 'payroll-by-employee', loadComponent: () => import('./pages/payroll/payroll-by-employee-report/payroll-by-employee-report.component').then(c => c.PayrollByEmployeeReportComponent) },
          { path: 'payroll-provisions', loadComponent: () => import('./pages/payroll/payroll-provisions-report/payroll-provisions-report.component').then(c => c.PayrollProvisionsReportComponent) },
        ],
      },
    ],
  },
];
