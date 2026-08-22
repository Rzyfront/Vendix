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
 * Architectural note (Fix 5 — `overview-summary` is the only summary):
 *
 *   - `/admin/reports/overview/overview-summary` is the single consolidated
 *     dashboard with stat cards + the full catalog. Every other category
 *     collapses into `/admin/reports/{category}/`, which renders
 *     `<app-category-reports-catalog>` filtered to that category.
 *   - Legacy sub-routes (e.g. `/admin/reports/sales/sales-summary`) are
 *     kept as `redirectTo: ''` so existing deep links, browser history and
 *     catalog cards continue to land on the catalog instead of erroring.
 *   - `accounting` and `payroll` keep their custom report pages because
 *     those flows route into the dedicated accounting/payroll modules via
 *     `fullViewRoute`; refactoring them is out of scope for Fix 5.
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
          { path: 'sales-summary', redirectTo: '', pathMatch: 'full' },
          { path: 'sales-by-product', redirectTo: '', pathMatch: 'full' },
          { path: 'sales-by-category', redirectTo: '', pathMatch: 'full' },
          { path: 'sales-by-customer', redirectTo: '', pathMatch: 'full' },
          { path: 'sales-by-payment', redirectTo: '', pathMatch: 'full' },
          { path: 'sales-by-channel', redirectTo: '', pathMatch: 'full' },
          { path: 'sales-trends', redirectTo: '', pathMatch: 'full' },
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
          { path: 'inventory-overview', redirectTo: '', pathMatch: 'full' },
          { path: 'inventory-stock-info', redirectTo: '', pathMatch: 'full' },
          { path: 'inventory-low-stock', redirectTo: '', pathMatch: 'full' },
          // CP-low-stock-by-supplier — custom page (not the generic viewer)
          // because it needs a searchable supplier dropdown + a status
          // filter that the viewer doesn't expose. KEPT as a real route
          // because it has its own bespoke UI; the catalog card points
          // directly at it.
          {
            path: 'inventory-low-stock-by-supplier',
            loadComponent: () => import('./pages/inventory-low-stock-by-supplier/inventory-low-stock-by-supplier.component').then(c => c.InventoryLowStockBySupplierComponent),
          },
          { path: 'inventory-valuation', redirectTo: '', pathMatch: 'full' },
          { path: 'inventory-movements', redirectTo: '', pathMatch: 'full' },
          { path: 'inventory-movement-analysis', redirectTo: '', pathMatch: 'full' },
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
          { path: 'product-performance', redirectTo: '', pathMatch: 'full' },
          { path: 'product-top-sellers', redirectTo: '', pathMatch: 'full' },
          { path: 'product-profitability', redirectTo: '', pathMatch: 'full' },
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
          { path: 'customer-summary', redirectTo: '', pathMatch: 'full' },
          { path: 'customer-acquisition', redirectTo: '', pathMatch: 'full' },
          { path: 'customer-abandoned-carts', redirectTo: '', pathMatch: 'full' },
          { path: 'customers-top', redirectTo: '', pathMatch: 'full' },
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
          { path: 'purchase-summary', redirectTo: '', pathMatch: 'full' },
          { path: 'purchase-by-supplier', redirectTo: '', pathMatch: 'full' },
          { path: 'purchase-trends', redirectTo: '', pathMatch: 'full' },
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
          { path: 'reviews-summary', redirectTo: '', pathMatch: 'full' },
          { path: 'reviews-by-product', redirectTo: '', pathMatch: 'full' },
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
          // tax-summary component lived in pages/accounting/ but its
          // registry category is `financial`. Collapsed into the same
          // catalog redirect as the other financial sub-pages; the
          // `tax-summary-report.component.ts` file becomes dead code
          // and is deleted alongside the others.
          { path: 'tax-summary', redirectTo: '', pathMatch: 'full' },
          { path: 'profit-loss', redirectTo: '', pathMatch: 'full' },
          { path: 'financial-refunds', redirectTo: '', pathMatch: 'full' },
          { path: 'cash-sessions', redirectTo: '', pathMatch: 'full' },
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