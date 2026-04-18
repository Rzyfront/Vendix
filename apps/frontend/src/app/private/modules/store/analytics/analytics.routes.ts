import { Routes } from '@angular/router';
import { provideState } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import { overviewSummaryReducer } from './pages/overview/state/overview-summary.reducer';
import { OverviewSummaryEffects } from './pages/overview/state/overview-summary.effects';
import { salesSummaryReducer } from './pages/sales/state/sales-summary.reducer';
import { SalesSummaryEffects } from './pages/sales/state/sales-summary.effects';
import { productsAnalyticsReducer } from './pages/products/state/products-analytics.reducer';
import { ProductsAnalyticsEffects } from './pages/products/state/products-analytics.effects';
import { inventoryOverviewReducer } from './pages/inventory/overview/state/inventory-overview.reducer';
import { InventoryOverviewEffects } from './pages/inventory/overview/state/inventory-overview.effects';
import { customersAnalyticsReducer } from './pages/customers/state/customers-analytics.reducer';
import { CustomersAnalyticsEffects } from './pages/customers/state/customers-analytics.effects';
import { AnalyticsCategoryId } from './config/analytics-registry';

export const analyticsRoutes: Routes = [
  {
    path: '',
    children: [
      {
        path: '',
        pathMatch: 'full',
        redirectTo: 'overview',
      },
      // Overview Analytics (standalone - no shell)
      {
        path: 'overview',
        providers: [
          provideState({ name: 'overviewSummary', reducer: overviewSummaryReducer }),
          provideEffects(OverviewSummaryEffects),
        ],
        loadComponent: () =>
          import('./pages/overview/overview-summary/overview-summary.component').then(
            (c) => c.OverviewSummaryComponent,
          ),
      },
      // Sales Analytics (shell)
      {
        path: 'sales',
        loadComponent: () =>
          import('./components/analytics-shell/analytics-shell.component').then(
            (c) => c.AnalyticsShellComponent,
          ),
        providers: [
          provideState({ name: 'salesSummary', reducer: salesSummaryReducer }),
          provideEffects(SalesSummaryEffects),
        ],
        data: { categoryId: 'sales' as AnalyticsCategoryId },
        children: [
          {
            path: '',
            pathMatch: 'full',
            redirectTo: 'summary',
          },
          {
            path: 'summary',
            loadComponent: () =>
              import('./pages/sales/sales-summary/sales-summary.component').then(
                (c) => c.SalesSummaryComponent,
              ),
          },
          {
            path: 'by-product',
            loadComponent: () =>
              import('./pages/sales/sales-by-product.component').then(
                (c) => c.SalesByProductComponent,
              ),
          },
          {
            path: 'by-category',
            loadComponent: () =>
              import('./pages/sales/sales-by-category.component').then(
                (c) => c.SalesByCategoryComponent,
              ),
          },
          {
            path: 'trends',
            loadComponent: () =>
              import('./pages/sales/sales-trends.component').then(
                (c) => c.SalesTrendsComponent,
              ),
          },
          {
            path: 'by-customer',
            loadComponent: () =>
              import('./pages/sales/sales-by-customer.component').then(
                (c) => c.SalesByCustomerComponent,
              ),
          },
          {
            path: 'by-payment',
            loadComponent: () =>
              import('./pages/sales/sales-by-payment.component').then(
                (c) => c.SalesByPaymentComponent,
              ),
          },
        ],
      },
      // Inventory Analytics (shell)
      {
        path: 'inventory',
        loadComponent: () =>
          import('./components/analytics-shell/analytics-shell.component').then(
            (c) => c.AnalyticsShellComponent,
          ),
        data: { categoryId: 'inventory' as AnalyticsCategoryId },
        children: [
          {
            path: '',
            pathMatch: 'full',
            redirectTo: 'overview',
          },
          {
            path: 'overview',
            providers: [
              provideState({ name: 'inventoryOverview', reducer: inventoryOverviewReducer }),
              provideEffects(InventoryOverviewEffects),
            ],
            loadComponent: () =>
              import('./pages/inventory/overview/inventory-overview.component').then(
                (c) => c.InventoryOverviewComponent,
              ),
          },
          {
            path: 'stock-info',
            loadComponent: () =>
              import('./pages/inventory/low-stock.component').then(
                (c) => c.LowStockComponent,
              ),
          },
          {
            path: 'movements',
            loadComponent: () =>
              import('./pages/inventory/stock-movements.component').then(
                (c) => c.StockMovementsComponent,
              ),
          },
          {
            path: 'valuation',
            loadComponent: () =>
              import('./pages/inventory/inventory-valuation.component').then(
                (c) => c.InventoryValuationComponent,
              ),
          },
          {
            path: 'movement-analysis',
            loadComponent: () =>
              import('./pages/inventory/movement-analysis.component').then(
                (c) => c.MovementAnalysisComponent,
              ),
          },
        ],
      },
      // Products Analytics (shell)
      {
        path: 'products',
        loadComponent: () =>
          import('./components/analytics-shell/analytics-shell.component').then(
            (c) => c.AnalyticsShellComponent,
          ),
        providers: [
          provideState({ name: 'productsAnalytics', reducer: productsAnalyticsReducer }),
          provideEffects(ProductsAnalyticsEffects),
        ],
        data: { categoryId: 'products' as AnalyticsCategoryId },
        children: [
          {
            path: '',
            pathMatch: 'full',
            redirectTo: 'performance',
          },
          {
            path: 'performance',
            loadComponent: () =>
              import('./pages/products/product-performance.component').then(
                (c) => c.ProductPerformanceComponent,
              ),
          },
          {
            path: 'top-sellers',
            loadComponent: () =>
              import('./pages/products/top-sellers.component').then(
                (c) => c.TopSellersComponent,
              ),
          },
          {
            path: 'profitability',
            loadComponent: () =>
              import('./pages/products/product-profitability.component').then(
                (c) => c.ProductProfitabilityComponent,
              ),
          },
        ],
      },
      // Purchases Analytics (shell)
      {
        path: 'purchases',
        loadComponent: () =>
          import('./components/analytics-shell/analytics-shell.component').then(
            (c) => c.AnalyticsShellComponent,
          ),
        data: { categoryId: 'purchases' as AnalyticsCategoryId },
        children: [
          {
            path: '',
            pathMatch: 'full',
            redirectTo: 'summary',
          },
          {
            path: 'summary',
            loadComponent: () =>
              import('./pages/purchases/purchase-summary.component').then(
                (c) => c.PurchaseSummaryComponent,
              ),
          },
          {
            path: 'by-supplier',
            loadComponent: () =>
              import('./pages/purchases/purchases-by-supplier.component').then(
                (c) => c.PurchasesBySupplierComponent,
              ),
          },
        ],
      },
      // Customers Analytics (shell)
      {
        path: 'customers',
        loadComponent: () =>
          import('./components/analytics-shell/analytics-shell.component').then(
            (c) => c.AnalyticsShellComponent,
          ),
        providers: [
          provideState({ name: 'customersAnalytics', reducer: customersAnalyticsReducer }),
          provideEffects(CustomersAnalyticsEffects),
        ],
        data: { categoryId: 'customers' as AnalyticsCategoryId },
        children: [
          {
            path: '',
            pathMatch: 'full',
            redirectTo: 'summary',
          },
          {
            path: 'summary',
            loadComponent: () =>
              import('./pages/customers/customer-summary.component').then(
                (c) => c.CustomerSummaryComponent,
              ),
          },
          {
            path: 'acquisition',
            loadComponent: () =>
              import('./pages/customers/customer-acquisition.component').then(
                (c) => c.CustomerAcquisitionComponent,
              ),
          },
          {
            path: 'abandoned-carts',
            loadComponent: () =>
              import('./pages/customers/abandoned-carts.component').then(
                (c) => c.AbandonedCartsComponent,
              ),
          },
        ],
      },
      // Reviews Analytics (shell)
      {
        path: 'reviews',
        loadComponent: () =>
          import('./components/analytics-shell/analytics-shell.component').then(
            (c) => c.AnalyticsShellComponent,
          ),
        data: { categoryId: 'reviews' as AnalyticsCategoryId },
        children: [
          {
            path: '',
            pathMatch: 'full',
            redirectTo: 'summary',
          },
          {
            path: 'summary',
            loadComponent: () =>
              import('./pages/reviews/review-summary.component').then(
                (c) => c.ReviewSummaryComponent,
              ),
          },
        ],
      },
      // Expenses Analytics (NO shell - discarded from sidebar per issue, routes kept for backward compatibility)
      {
        path: 'expenses',
        children: [
          {
            path: '',
            pathMatch: 'full',
            redirectTo: 'summary',
          },
          {
            path: 'summary',
            loadComponent: () =>
              import('./pages/expenses/expense-summary.component').then(
                (c) => c.ExpenseSummaryComponent,
              ),
          },
          {
            path: 'by-category',
            loadComponent: () =>
              import('./pages/expenses/expenses-by-category.component').then(
                (c) => c.ExpensesByCategoryComponent,
              ),
          },
        ],
      },
      // Financial Analytics (shell)
      {
        path: 'financial',
        loadComponent: () =>
          import('./components/analytics-shell/analytics-shell.component').then(
            (c) => c.AnalyticsShellComponent,
          ),
        data: { categoryId: 'financial' as AnalyticsCategoryId },
        children: [
          {
            path: '',
            pathMatch: 'full',
            redirectTo: 'profit-loss',
          },
          {
            path: 'profit-loss',
            loadComponent: () =>
              import('./pages/financial/profit-loss.component').then(
                (c) => c.ProfitLossComponent,
              ),
          },
          {
            path: 'tax-summary',
            loadComponent: () =>
              import('./pages/financial/tax-summary.component').then(
                (c) => c.TaxSummaryComponent,
              ),
          },
          {
            path: 'refunds',
            loadComponent: () =>
              import('./pages/financial/refunds-summary.component').then(
                (c) => c.RefundsSummaryComponent,
              ),
          },
        ],
      },
    ],
  },
];
