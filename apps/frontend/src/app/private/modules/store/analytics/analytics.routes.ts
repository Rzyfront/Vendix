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

export const analyticsRoutes: Routes = [
  {
    path: '',
    children: [
      {
        path: '',
        pathMatch: 'full',
        loadComponent: () =>
          import('./analytics.component').then((c) => c.AnalyticsComponent),
      },
      // Overview Analytics
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
      // Sales Analytics
      {
        path: 'sales',
        providers: [
          provideState({ name: 'salesSummary', reducer: salesSummaryReducer }),
          provideEffects(SalesSummaryEffects),
        ],
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
      // Inventory Analytics
      {
        path: 'inventory',
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
            path: 'stock-levels',
            loadComponent: () =>
              import('./pages/inventory/stock-levels.component').then(
                (c) => c.StockLevelsComponent,
              ),
          },
          {
            path: 'low-stock',
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
      // Products Analytics
      {
        path: 'products',
        providers: [
          provideState({ name: 'productsAnalytics', reducer: productsAnalyticsReducer }),
          provideEffects(ProductsAnalyticsEffects),
        ],
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
      // Purchases Analytics
      {
        path: 'purchases',
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
      // Customers Analytics
      {
        path: 'customers',
        providers: [
          provideState({ name: 'customersAnalytics', reducer: customersAnalyticsReducer }),
          provideEffects(CustomersAnalyticsEffects),
        ],
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
      // Reviews Analytics
      {
        path: 'reviews',
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
      // Expenses Analytics
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
      // Financial Analytics
      {
        path: 'financial',
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
