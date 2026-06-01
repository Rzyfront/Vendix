import { Component, computed, inject } from '@angular/core';
import { RouterOutlet, ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import {
  AnalyticsCategoryId,
  getCategoryById,
  getViewsByCategory,
} from '../../config/analytics-registry';
import {
  StickyHeaderComponent,
  StickyHeaderTab,
  StickyHeaderActionButton,
} from '../../../../../../shared/components/sticky-header/sticky-header.component';
import { DateRangeSyncService } from '../../../shared/services/date-range-sync.service';
import { dateRangeToQueryParams } from '../../../shared/utils/date-range-params.util';

@Component({
  selector: 'app-analytics-shell',
  standalone: true,
  imports: [RouterOutlet, StickyHeaderComponent],
  templateUrl: './analytics-shell.component.html',
  styleUrls: ['./analytics-shell.component.scss'],
})
export class AnalyticsShellComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dateRangeSync = inject(DateRangeSyncService);

  private readonly categoryId = toSignal(
    this.route.data.pipe(map((data) => data['categoryId'] as AnalyticsCategoryId)),
  );

  readonly category = computed(() => {
    const categoryId = this.categoryId();
    return categoryId ? getCategoryById(categoryId) : undefined;
  });

  readonly tabs = computed<StickyHeaderTab[]>(() => {
    const categoryId = this.categoryId();
    if (!categoryId) return [];

    return getViewsByCategory(categoryId).map((view) => ({
      id: view.key,
      label: view.title,
      icon: view.icon,
      route: view.route,
    }));
  });

  readonly headerActions = computed<StickyHeaderActionButton[]>(() => [
    { id: 'view-reports', label: 'Ver Reportes', icon: 'file-text', variant: 'outline' },
  ]);

  private readonly analyticsToReportRoute: Record<string, string> = {
    // Sales
    '/admin/analytics/sales/summary': '/admin/reports/sales/sales-summary',
    '/admin/analytics/sales/by-product': '/admin/reports/sales/sales-by-product',
    '/admin/analytics/sales/by-category': '/admin/reports/sales/sales-by-category',
    '/admin/analytics/sales/by-customer': '/admin/reports/sales/sales-by-customer',
    '/admin/analytics/sales/by-payment': '/admin/reports/sales/sales-by-payment',
    '/admin/analytics/sales/trends': '/admin/reports/sales/sales-trends',
    // Inventory
    '/admin/analytics/inventory/overview': '/admin/reports/inventory/inventory-overview',
    '/admin/analytics/inventory/stock-info': '/admin/reports/inventory/inventory-stock-info',
    '/admin/analytics/inventory/valuation': '/admin/reports/inventory/inventory-valuation',
    '/admin/analytics/inventory/movements': '/admin/reports/inventory/inventory-movements',
    '/admin/analytics/inventory/movement-analysis': '/admin/reports/inventory/inventory-movement-analysis',
    // Products
    '/admin/analytics/products/performance': '/admin/reports/products/product-performance',
    '/admin/analytics/products/top-sellers': '/admin/reports/products/product-top-sellers',
    '/admin/analytics/products/profitability': '/admin/reports/products/product-profitability',
    // Customers
    '/admin/analytics/customers/summary': '/admin/reports/customers/customer-summary',
    '/admin/analytics/customers/acquisition': '/admin/reports/customers/customer-acquisition',
    '/admin/analytics/customers/abandoned-carts': '/admin/reports/customers/customer-abandoned-carts',
    // Purchases
    '/admin/analytics/purchases/summary': '/admin/reports/purchases/purchase-summary',
    '/admin/analytics/purchases/by-supplier': '/admin/reports/purchases/purchase-by-supplier',
    // Reviews
    '/admin/analytics/reviews/summary': '/admin/reports/reviews/reviews-summary',
    // Financial
    '/admin/analytics/financial/profit-loss': '/admin/reports/financial/profit-loss',
    '/admin/analytics/financial/tax-summary': '/admin/reports/financial/tax-summary',
    '/admin/analytics/financial/refunds': '/admin/reports/financial/financial-refunds',
  };

  onActionClick(actionId: string): void {
    if (actionId === 'view-reports') {
      const currentUrl = this.router.url.split('?')[0];
      const reportRoute = this.analyticsToReportRoute[currentUrl]
        || `/admin/reports/${this.categoryId() || 'overview'}`;
      this.router.navigate([reportRoute], {
        queryParams: dateRangeToQueryParams(this.dateRangeSync.dateRange()),
      });
    }
  }
}
