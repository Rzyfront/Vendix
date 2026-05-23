import { Component, computed, inject } from '@angular/core';
import { RouterOutlet, ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { ReportCategoryId } from '../../interfaces/report.interface';
import {
  getCategoryById,
  getReportsByCategory,
} from '../../config/report-registry';
import {
  StickyHeaderComponent,
  StickyHeaderTab,
  StickyHeaderActionButton,
} from '../../../../../../shared/components/sticky-header/sticky-header.component';

@Component({
  selector: 'app-reports-shell',
  standalone: true,
  imports: [RouterOutlet, StickyHeaderComponent],
  templateUrl: './reports-shell.component.html',
  styleUrls: ['./reports-shell.component.scss'],
})
export class ReportsShellComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly categoryId = toSignal(
    this.route.data.pipe(map((data) => data['categoryId'] as ReportCategoryId)),
  );

  readonly category = computed(() => {
    const categoryId = this.categoryId();
    return categoryId ? getCategoryById(categoryId) : undefined;
  });

  readonly tabs = computed<StickyHeaderTab[]>(() => {
    const categoryId = this.categoryId();
    if (!categoryId) return [];

    return getReportsByCategory(categoryId).map((report) => ({
      id: report.id,
      label: report.title,
      icon: report.icon,
      route: report.route,
    }));
  });

  readonly headerActions = computed<StickyHeaderActionButton[]>(() => [
    {
      id: 'view-analytics',
      label: 'Ver Analitica',
      icon: 'bar-chart-3',
      variant: 'outline',
    },
  ]);

  private readonly reportToAnalyticsRoute: Record<string, string> = {
    // Overview
    'overview-summary': '/admin/analytics/overview',
    // Sales
    'sales-summary': '/admin/analytics/sales/summary',
    'sales-by-product': '/admin/analytics/sales/by-product',
    'sales-by-category': '/admin/analytics/sales/by-category',
    'sales-by-customer': '/admin/analytics/sales/by-customer',
    'sales-by-payment': '/admin/analytics/sales/by-payment',
    'sales-trends': '/admin/analytics/sales/trends',
    // Inventory
    'inventory-valuation': '/admin/analytics/inventory/valuation',
    'inventory-stock-levels': '/admin/analytics/inventory/overview',
    'inventory-low-stock': '/admin/analytics/inventory/overview',
    'inventory-movements': '/admin/analytics/inventory/movements',
    'inventory-movement-analysis': '/admin/analytics/inventory/movement-analysis',
    // Products
    'product-performance': '/admin/analytics/products/performance',
    'product-top-sellers': '/admin/analytics/products/top-sellers',
    'product-profitability': '/admin/analytics/products/profitability',
    // Customers
    'customer-summary': '/admin/analytics/customers/summary',
    'customer-top': '/admin/analytics/customers/acquisition',
    'customer-receivables': '/admin/analytics/customers/summary',
    'customer-aging': '/admin/analytics/customers/summary',
    // Purchases
    'purchase-summary': '/admin/analytics/purchases/summary',
    'purchase-by-supplier': '/admin/analytics/purchases/by-supplier',
    'purchase-trends': '/admin/analytics/purchases/summary',
    // Reviews
    'reviews-summary': '/admin/analytics/reviews/summary',
    'reviews-by-product': '/admin/analytics/reviews/summary',
    // Accounting → financial
    'trial-balance': '/admin/analytics/financial/profit-loss',
    'balance-sheet': '/admin/analytics/financial/profit-loss',
    'income-statement': '/admin/analytics/financial/profit-loss',
    'general-ledger': '/admin/analytics/financial/profit-loss',
    'tax-summary': '/admin/analytics/financial/tax-summary',
    // Payroll → financial
    'payroll-summary': '/admin/analytics/financial/profit-loss',
    'payroll-by-employee': '/admin/analytics/financial/profit-loss',
    'payroll-provisions': '/admin/analytics/financial/profit-loss',
    // Financial
    'expense-summary': '/admin/analytics/expenses/summary',
    'profit-loss': '/admin/analytics/financial/profit-loss',
    'cash-register-report': '/admin/analytics/financial/profit-loss',
    'accounts-payable-aging': '/admin/analytics/financial/profit-loss',
  };

  onActionClick(actionId: string): void {
    if (actionId === 'view-analytics') {
      // Find which report tab is currently active from the URL
      const currentUrl = this.router.url;
      const reportId = this.extractReportId(currentUrl);
      const analyticsRoute = this.reportToAnalyticsRoute[reportId || '']
        || `/admin/analytics/${this.categoryId() || 'overview'}`;
      this.router.navigateByUrl(analyticsRoute);
    }
  }

  private extractReportId(url: string): string | null {
    // URL pattern: /admin/reports/{category}/{report-slug}
    const match = url.match(/\/admin\/reports\/[^/]+\/(.+)/);
    return match ? match[1] : null;
  }
}
