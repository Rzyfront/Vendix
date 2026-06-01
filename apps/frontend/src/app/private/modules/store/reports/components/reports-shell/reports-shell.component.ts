import { Component, computed, inject } from '@angular/core';
import { RouterOutlet, ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { ReportCategoryId } from '../../interfaces/report.interface';
import {
  getCategoryById,
  getReportsByCategory,
} from '../../config/report-registry';
import { selectDateRange } from '../../state/reports.selectors';
import { ReportsActions } from '../../state/reports.actions';
import { dateRangeToQueryParams, queryParamsToDateRange } from '../../../shared/utils/date-range-params.util';
import { getDefaultDateRange } from '../../state/reports.state';
import { DateRangeSyncService } from '../../../shared/services/date-range-sync.service';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
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
  private readonly store = inject(Store);
  private readonly authFacade = inject(AuthFacade);
  private readonly toast = inject(ToastService);
  private readonly dateRangeSync = inject(DateRangeSyncService);

  private readonly dateRange = toSignal(this.store.select(selectDateRange), { initialValue: getDefaultDateRange() });

  constructor() {
    const urlRange = queryParamsToDateRange(this.route.snapshot.queryParamMap);
    if (urlRange) {
      this.store.dispatch(ReportsActions.setDateRange({ dateRange: urlRange }));
    } else {
      // Fallback: sync from analytics via shared service
      const syncedRange = this.dateRangeSync.dateRange();
      if (syncedRange) {
        this.store.dispatch(ReportsActions.setDateRange({ dateRange: syncedRange }));
      }
    }
  }

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

  private readonly categoryActionConfig: Record<string, { id: string; label: string; icon: string; route: string; moduleKey?: string }> = {
    accounting: { id: 'view-module', label: 'Ver Contabilidad', icon: 'scale', route: '/admin/accounting', moduleKey: 'accounting' },
    payroll: { id: 'view-module', label: 'Ver Nomina', icon: 'banknote', route: '/admin/payroll', moduleKey: 'payroll' },
  };

  readonly headerActions = computed<StickyHeaderActionButton[]>(() => {
    const categoryId = this.categoryId();
    const config = categoryId ? this.categoryActionConfig[categoryId] : undefined;

    if (config?.moduleKey && !this.authFacade.isModuleVisible(config.moduleKey)) {
      return [];
    }

    return [
      {
        id: config?.id || 'view-analytics',
        label: config?.label || 'Ver Analitica',
        icon: config?.icon || 'bar-chart-3',
        variant: 'outline',
      },
    ];
  });

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
    'inventory-overview': '/admin/analytics/inventory/overview',
    'inventory-stock-info': '/admin/analytics/inventory/stock-info',
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
    'customer-acquisition': '/admin/analytics/customers/acquisition',
    'customer-abandoned-carts': '/admin/analytics/customers/abandoned-carts',
    // Purchases
    'purchase-summary': '/admin/analytics/purchases/summary',
    'purchase-by-supplier': '/admin/analytics/purchases/by-supplier',
    // Reviews
    'reviews-summary': '/admin/analytics/reviews/summary',
    // Financial
    'financial-refunds': '/admin/analytics/financial/refunds',
    'profit-loss': '/admin/analytics/financial/profit-loss',
    'tax-summary': '/admin/analytics/financial/tax-summary',
  };

  onActionClick(actionId: string): void {
    if (actionId === 'view-module') {
      const categoryId = this.categoryId();
      const config = categoryId ? this.categoryActionConfig[categoryId] : undefined;
      if (config) {
        this.router.navigateByUrl(config.route);
      }
      return;
    }

    if (actionId === 'view-analytics') {
      const currentUrl = this.router.url;
      const reportId = this.extractReportId(currentUrl);
      const analyticsRoute = this.reportToAnalyticsRoute[reportId || '']
        || `/admin/analytics/${this.categoryId() || 'overview'}`;
      this.router.navigate([analyticsRoute], {
        queryParams: dateRangeToQueryParams(this.dateRange()),
      });
    }
  }

  private extractReportId(url: string): string | null {
    // URL pattern: /admin/reports/{category}/{report-slug}
    const match = url.match(/\/admin\/reports\/[^/]+\/(.+)/);
    return match ? match[1] : null;
  }
}
