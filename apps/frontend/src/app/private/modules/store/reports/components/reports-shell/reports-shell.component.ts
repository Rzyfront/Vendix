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
import { ReportsDataService } from '../../services/reports-data.service';
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
  private readonly reportsDataService = inject(ReportsDataService);

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

  /** Maps report IDs to their corresponding module view routes. */
  private readonly reportToModuleRoute: Record<string, string> = {
    // Accounting → /admin/accounting/*
    'trial-balance': '/admin/accounting/reports/trial-balance',
    'balance-sheet': '/admin/accounting/reports/balance-sheet',
    'income-statement': '/admin/accounting/reports/income-statement',
    'general-ledger': '/admin/accounting/reports/general-ledger',
    'chart-of-accounts': '/admin/accounting/chart-of-accounts',
    'journal-entries': '/admin/accounting/journal-entries',
    'fixed-assets': '/admin/accounting/fixed-assets',
    'receivables': '/admin/accounting/cartera/receivables',
    'payables': '/admin/accounting/cartera/payables',
    'aging-report': '/admin/accounting/cartera/aging',
    // Payroll → /admin/payroll/*
    'payroll-employees': '/admin/payroll/employees',
    'payroll-runs': '/admin/payroll/runs',
    'payroll-settlements': '/admin/payroll/settlements',
    'payroll-advances': '/admin/payroll/advances',
    // Financial / Expenses / Cash
    'expenses-summary': '/admin/expenses',
    'cash-sessions': '/admin/cash-registers',
  };

  /** Reports that have a corresponding module view route. */
  private readonly reportsWithModuleView = new Set(Object.keys(this.reportToModuleRoute));

  readonly tabs = computed<StickyHeaderTab[]>(() => {
    const categoryId = this.categoryId();
    if (!categoryId) return [];

    const isModuleCategory = categoryId === 'accounting';

    return getReportsByCategory(categoryId)
      .filter(report => !isModuleCategory || this.reportsWithModuleView.has(report.id))
      .map((report) => ({
        id: report.id,
        label: report.title,
        icon: report.icon,
        route: report.route,
      }));
  });

  /** Report-specific module action overrides (e.g. expenses-summary -> Ver Gastos). */
  private readonly REPORT_ACTION_OVERRIDES: Record<string, { id: string; label: string; icon: string; moduleKey?: string; route?: string }> = {
    'expenses-summary': {
      id: 'view-module',
      label: 'Ver Gastos',
      icon: 'receipt',
      moduleKey: 'expenses',
      route: '/admin/expenses',
    },
    'cash-sessions': {
      id: 'view-module',
      label: 'Ver Cajas',
      icon: 'calculator',
      moduleKey: 'cash-registers',
      route: '/admin/cash-registers',
    },
  };

  /** Category-level default actions. */
  private readonly CATEGORY_ACTION_DEFAULTS: Record<string, { id: string; label: string; icon: string; moduleKey?: string; route?: string }> = {
    accounting: { id: 'view-module', label: 'Ver Contabilidad', icon: 'scale', moduleKey: 'accounting', route: '/admin/accounting' },
    payroll: { id: 'view-module', label: 'Ver Nomina', icon: 'banknote', moduleKey: 'payroll', route: '/admin/payroll' },
  };

  private resolveNavigationAction(
    reportId: string | null,
    categoryId?: string,
  ): StickyHeaderActionButton | null {
    // 1. Report-level override
    if (reportId && this.REPORT_ACTION_OVERRIDES[reportId]) {
      const config = this.REPORT_ACTION_OVERRIDES[reportId];
      if (config.moduleKey && !this.authFacade.isModuleVisible(config.moduleKey)) {
        return null;
      }
      return { id: config.id, label: config.label, icon: config.icon, variant: 'outline' };
    }

    // 2. Category-level default
    if (categoryId && this.CATEGORY_ACTION_DEFAULTS[categoryId]) {
      const config = this.CATEGORY_ACTION_DEFAULTS[categoryId];
      if (config.moduleKey && !this.authFacade.isModuleVisible(config.moduleKey)) {
        return null;
      }
      return { id: config.id, label: config.label, icon: config.icon, variant: 'outline' };
    }

    // 3. Fallback: Ver Analítica
    return {
      id: 'view-analytics',
      label: 'Ver Analitica',
      icon: 'bar-chart-3',
      variant: 'outline',
    };
  }

  readonly headerActions = computed<StickyHeaderActionButton[]>(() => {
    const actions: StickyHeaderActionButton[] = [
      {
        id: 'refresh',
        label: 'Actualizar',
        icon: 'refresh-cw',
        variant: 'outline',
      },
    ];

    const navAction = this.resolveNavigationAction(
      this.extractReportId(this.router.url),
      this.categoryId(),
    );
    if (navAction) {
      actions.push(navAction);
    }

    return actions;
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
    if (actionId === 'refresh') {
      const reportId = this.extractReportId(this.router.url);
      this.reportsDataService.clearCache(reportId || undefined);
      this.store.dispatch(ReportsActions.loadReportData());
      this.toast.info('Datos del reporte actualizados');
      return;
    }

    if (actionId === 'view-module') {
      const reportId = this.extractReportId(this.router.url);
      const categoryId = this.categoryId();
      const target =
        (reportId && this.REPORT_ACTION_OVERRIDES[reportId]?.route) ||
        (reportId && this.reportToModuleRoute[reportId]) ||
        (categoryId && this.CATEGORY_ACTION_DEFAULTS[categoryId]?.route) ||
        '/admin';
      this.router.navigateByUrl(target);
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
    // URL pattern: /admin/reports/{category}/{report-slug} (stripping query parameters)
    const cleanUrl = url.split('?')[0];
    const match = cleanUrl.match(/\/admin\/reports\/[^/]+\/(.+)/);
    return match ? match[1] : null;
  }
}
