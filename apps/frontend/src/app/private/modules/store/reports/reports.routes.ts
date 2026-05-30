import { Routes } from '@angular/router';
import { provideState } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import { reportsReducer } from './state/reports.reducer';
import { ReportsEffects } from './state/reports.effects';
import { accountingReducer } from '../accounting/state/reducers/accounting.reducer';
import { AccountingEffects } from '../accounting/state/effects/accounting.effects';

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
          { path: '', redirectTo: 'sales-summary', pathMatch: 'full' },
          { path: 'sales-summary', loadComponent: () => import('./pages/sales/sales-summary-report/sales-summary-report.component').then(c => c.SalesSummaryReportComponent) },
          { path: 'sales-by-product', loadComponent: () => import('./pages/sales/sales-by-product-report/sales-by-product-report.component').then(c => c.SalesByProductReportComponent) },
          { path: 'sales-by-category', loadComponent: () => import('./pages/sales/sales-by-category-report/sales-by-category-report.component').then(c => c.SalesByCategoryReportComponent) },
          { path: 'sales-by-customer', loadComponent: () => import('./pages/sales/sales-by-customer-report/sales-by-customer-report.component').then(c => c.SalesByCustomerReportComponent) },
          { path: 'sales-by-payment', loadComponent: () => import('./pages/sales/sales-by-payment-report/sales-by-payment-report.component').then(c => c.SalesByPaymentReportComponent) },
          { path: 'sales-trends', loadComponent: () => import('./pages/sales/sales-trends-report/sales-trends-report.component').then(c => c.SalesTrendsReportComponent) },
        ],
      },
      {
        path: 'inventory',
        loadComponent: () => import('./components/reports-shell/reports-shell.component').then(c => c.ReportsShellComponent),
        data: { categoryId: 'inventory' },
        children: [
          { path: '', redirectTo: 'inventory-overview', pathMatch: 'full' },
          { path: 'inventory-overview', loadComponent: () => import('./pages/generic-report-page/generic-report-page.component').then(c => c.GenericReportPageComponent), data: { reportId: 'inventory-overview' } },
          { path: 'inventory-stock-info', loadComponent: () => import('./pages/generic-report-page/generic-report-page.component').then(c => c.GenericReportPageComponent), data: { reportId: 'inventory-stock-info' } },
          { path: 'inventory-valuation', loadComponent: () => import('./pages/inventory/inventory-valuation-report/inventory-valuation-report.component').then(c => c.InventoryValuationReportComponent) },
          { path: 'inventory-movements', loadComponent: () => import('./pages/inventory/inventory-movements-report/inventory-movements-report.component').then(c => c.InventoryMovementsReportComponent) },
          { path: 'inventory-movement-analysis', loadComponent: () => import('./pages/inventory/inventory-movement-analysis-report/inventory-movement-analysis-report.component').then(c => c.InventoryMovementAnalysisReportComponent) },
        ],
      },
      {
        path: 'products',
        loadComponent: () => import('./components/reports-shell/reports-shell.component').then(c => c.ReportsShellComponent),
        data: { categoryId: 'products' },
        children: [
          { path: '', redirectTo: 'product-performance', pathMatch: 'full' },
          { path: 'product-performance', loadComponent: () => import('./pages/products/product-performance-report/product-performance-report.component').then(c => c.ProductPerformanceReportComponent) },
          { path: 'product-top-sellers', loadComponent: () => import('./pages/products/product-top-sellers-report/product-top-sellers-report.component').then(c => c.ProductTopSellersReportComponent) },
          { path: 'product-profitability', loadComponent: () => import('./pages/products/product-profitability-report/product-profitability-report.component').then(c => c.ProductProfitabilityReportComponent) },
        ],
      },
      {
        path: 'customers',
        loadComponent: () => import('./components/reports-shell/reports-shell.component').then(c => c.ReportsShellComponent),
        data: { categoryId: 'customers' },
        children: [
          { path: '', redirectTo: 'customer-summary', pathMatch: 'full' },
          { path: 'customer-summary', loadComponent: () => import('./pages/customers/customer-summary-report/customer-summary-report.component').then(c => c.CustomerSummaryReportComponent) },
          { path: 'customer-acquisition', loadComponent: () => import('./pages/generic-report-page/generic-report-page.component').then(c => c.GenericReportPageComponent), data: { reportId: 'customer-acquisition' } },
          { path: 'customer-abandoned-carts', loadComponent: () => import('./pages/generic-report-page/generic-report-page.component').then(c => c.GenericReportPageComponent), data: { reportId: 'customer-abandoned-carts' } },
        ],
      },
      {
        path: 'purchases',
        loadComponent: () => import('./components/reports-shell/reports-shell.component').then(c => c.ReportsShellComponent),
        data: { categoryId: 'purchases' },
        children: [
          { path: '', redirectTo: 'purchase-summary', pathMatch: 'full' },
          { path: 'purchase-summary', loadComponent: () => import('./pages/purchases/purchase-summary-report/purchase-summary-report.component').then(c => c.PurchaseSummaryReportComponent) },
          { path: 'purchase-by-supplier', loadComponent: () => import('./pages/purchases/purchase-by-supplier-report/purchase-by-supplier-report.component').then(c => c.PurchaseBySupplierReportComponent) },
        ],
      },
      {
        path: 'reviews',
        loadComponent: () => import('./components/reports-shell/reports-shell.component').then(c => c.ReportsShellComponent),
        data: { categoryId: 'reviews' },
        children: [
          { path: '', redirectTo: 'reviews-summary', pathMatch: 'full' },
          { path: 'reviews-summary', loadComponent: () => import('./pages/reviews/reviews-summary-report/reviews-summary-report.component').then(c => c.ReviewsSummaryReportComponent) },
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
          { path: 'chart-of-accounts', loadComponent: () => import('./pages/generic-report-page/generic-report-page.component').then(c => c.GenericReportPageComponent), data: { reportId: 'chart-of-accounts' } },
          { path: 'journal-entries', loadComponent: () => import('./pages/generic-report-page/generic-report-page.component').then(c => c.GenericReportPageComponent), data: { reportId: 'journal-entries' } },
          { path: 'fixed-assets', loadComponent: () => import('./pages/generic-report-page/generic-report-page.component').then(c => c.GenericReportPageComponent), data: { reportId: 'fixed-assets' } },
          { path: 'receivables', loadComponent: () => import('./pages/generic-report-page/generic-report-page.component').then(c => c.GenericReportPageComponent), data: { reportId: 'receivables' } },
          { path: 'payables', loadComponent: () => import('./pages/generic-report-page/generic-report-page.component').then(c => c.GenericReportPageComponent), data: { reportId: 'payables' } },
          { path: 'aging-report', loadComponent: () => import('./pages/generic-report-page/generic-report-page.component').then(c => c.GenericReportPageComponent), data: { reportId: 'aging-report' } },
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
          { path: 'payroll-employees', loadComponent: () => import('./pages/generic-report-page/generic-report-page.component').then(c => c.GenericReportPageComponent), data: { reportId: 'payroll-employees' } },
          { path: 'payroll-runs', loadComponent: () => import('./pages/generic-report-page/generic-report-page.component').then(c => c.GenericReportPageComponent), data: { reportId: 'payroll-runs' } },
          { path: 'payroll-settlements', loadComponent: () => import('./pages/generic-report-page/generic-report-page.component').then(c => c.GenericReportPageComponent), data: { reportId: 'payroll-settlements' } },
          { path: 'payroll-advances', loadComponent: () => import('./pages/generic-report-page/generic-report-page.component').then(c => c.GenericReportPageComponent), data: { reportId: 'payroll-advances' } },
        ],
      },
      {
        path: 'financial',
        loadComponent: () => import('./components/reports-shell/reports-shell.component').then(c => c.ReportsShellComponent),
        data: { categoryId: 'financial' },
        children: [
          { path: '', redirectTo: 'tax-summary', pathMatch: 'full' },
          { path: 'tax-summary', loadComponent: () => import('./pages/accounting/tax-summary-report/tax-summary-report.component').then(c => c.TaxSummaryReportComponent) },
          { path: 'profit-loss', loadComponent: () => import('./pages/financial/profit-loss-report/profit-loss-report.component').then(c => c.ProfitLossReportComponent) },
          { path: 'financial-refunds', loadComponent: () => import('./pages/generic-report-page/generic-report-page.component').then(c => c.GenericReportPageComponent), data: { reportId: 'financial-refunds' } },
        ],
      },
    ],
  },
];
