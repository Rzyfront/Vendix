import {Component, OnInit, OnDestroy, inject,
  DestroyRef, signal, computed} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Store } from '@ngrx/store';
import { Observable, combineLatest, fromEvent, debounceTime } from 'rxjs';
import { toSignal , takeUntilDestroyed} from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';

import { CardComponent } from '../../../../../../../shared/components/card/card.component';
import { ChartComponent } from '../../../../../../../shared/components/chart/chart.component';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { InputsearchComponent } from '../../../../../../../shared/components/inputsearch/inputsearch.component';
import {
  OptionsDropdownComponent } from '../../../../../../../shared/components/options-dropdown/options-dropdown.component';
import {
  DropdownAction } from '../../../../../../../shared/components/options-dropdown/options-dropdown.interfaces';
import {
  CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';

import { DateRangeFilter } from '../../../interfaces/analytics.interface';
import {
  OverviewSummary,
  OverviewTrend } from '../../../interfaces/overview-analytics.interface';
import {
  AnalyticsCardComponent
} from '../../../components/analytics-card/analytics-card.component';
import {
  AnalyticsCategoryChipsComponent
} from '../../../components/analytics-category-chips/analytics-category-chips.component';
import {
  DateRangeFilterComponent
} from '../../../components/date-range-filter/date-range-filter.component';
import {
  BreakEvenGaugeComponent
} from '../../../components/break-even-gauge/break-even-gauge.component';
import {
  StickyHeaderComponent,
  StickyHeaderTab,
  StickyHeaderActionButton,
} from '../../../../../../../shared/components/sticky-header/sticky-header.component';
import {
  ANALYTICS_CATEGORIES,
  ANALYTICS_VIEWS,
  AnalyticsCategoryId,
  AnalyticsView,
} from '../../../config/analytics-registry';

import * as OverviewActions from '../state/overview-summary.actions';
import * as OverviewSelectors from '../state/overview-summary.selectors';

import { EChartsOption } from 'echarts';
import { formatChartPeriod, getDefaultStartDate, getDefaultEndDate } from '../../../../../../../shared/utils/date.util';
import { queryParamsToDateRange } from '../../../../shared/utils/date-range-params.util';

@Component({
  selector: 'app-overview-summary',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardComponent,
    ChartComponent,
    IconComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    AnalyticsCardComponent,
    AnalyticsCategoryChipsComponent,
    DateRangeFilterComponent,
    BreakEvenGaugeComponent,
    StickyHeaderComponent,
  ],
  templateUrl: './overview-summary.component.html',
  styleUrls: ['./overview-summary.component.scss'] })
export class OverviewSummaryComponent implements OnInit, OnDestroy {
  private destroyRef = inject(DestroyRef);
  private store = inject(Store);
  private currencyService = inject(CurrencyFormatService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
// Observables from store
  summary$: Observable<OverviewSummary | null> = this.store.select(
    OverviewSelectors.selectSummary,
  );
  trends$: Observable<OverviewTrend[]> = this.store.select(
    OverviewSelectors.selectTrends,
  );
  loading$: Observable<boolean> = this.store.select(
    OverviewSelectors.selectLoading,
  );
  loadingTrends$: Observable<boolean> = this.store.select(
    OverviewSelectors.selectLoadingTrends,
  );
  dateRange$: Observable<DateRangeFilter> = this.store.select(
    OverviewSelectors.selectDateRange,
  );
  granularity$: Observable<string> = this.store.select(
    OverviewSelectors.selectGranularity,
  );

  readonly summary = toSignal(this.summary$, { initialValue: null });
  readonly loading = toSignal(this.loading$, { initialValue: false });
  readonly loadingTrends = toSignal(this.loadingTrends$, { initialValue: false });

  // Analytics Catalog signals
  readonly selectedCategory = signal<AnalyticsCategoryId | null>(null);
  readonly searchTerm = signal<string>('');

  readonly categories = ANALYTICS_CATEGORIES;

  readonly overviewTabs: StickyHeaderTab[] = [
    { id: 'summary', label: 'Resumen General', icon: 'layout-dashboard', route: '/admin/analytics/overview' },
  ];

  readonly overviewActions: StickyHeaderActionButton[] = [
    { id: 'view-reports', label: 'Ver Reportes', icon: 'file-text', variant: 'outline' },
  ];

  private readonly categoryById = computed(() =>
    new Map(ANALYTICS_CATEGORIES.map((c) => [c.id, c])),
  );

  readonly filteredViews = computed(() => {
    const category = this.selectedCategory();
    const search = this.searchTerm().toLowerCase().trim();

    let views = ANALYTICS_VIEWS.filter((v) => v.category !== 'overview');

    if (category) {
      views = views.filter((v) => v.category === category);
    }

    if (search) {
      views = views.filter(
        (v) =>
          v.title.toLowerCase().includes(search) ||
          v.description.toLowerCase().includes(search),
      );
    }

    return views;
  });

  readonly viewsByCategory = computed(() => {
    const views = this.filteredViews();
    const grouped = new Map<AnalyticsCategoryId, AnalyticsView[]>();

    for (const view of views) {
      if (!grouped.has(view.category)) {
        grouped.set(view.category, []);
      }
      grouped.get(view.category)!.push(view);
    }

    return grouped;
  });

// Chart options
  comparativeChartOptions= signal<EChartsOption>({});
  dateRange = signal<DateRangeFilter>({
    start_date: getDefaultStartDate(),
    end_date: getDefaultEndDate(),
    preset: 'thisMonth'});

  // Cached trends so charts can be rebuilt on viewport changes without refetch
  private currentTrends: OverviewTrend[] = [];
  private currentGranularity = 'day';

  // Viewport-based responsive flag for chart density (device, not container, width)
  private static readonly MOBILE_BREAKPOINT = 768;
  readonly isMobile = signal<boolean>(this.computeIsMobile());

  private computeIsMobile(): boolean {
    return (
      typeof window !== 'undefined' &&
      window.innerWidth < OverviewSummaryComponent.MOBILE_BREAKPOINT
    );
  }

  ngOnInit(): void {
    this.currencyService.loadCurrency();

    // Read date range from URL query params (e.g. when navigating from reports)
    const urlRange = queryParamsToDateRange(this.route.snapshot.queryParamMap);
    if (urlRange) {
      this.dateRange.set(urlRange);
      this.store.dispatch(OverviewActions.setDateRange({ dateRange: urlRange }));
    }

    // Dispatch initial loads
    this.store.dispatch(OverviewActions.loadOverviewSummary());
    this.store.dispatch(OverviewActions.loadOverviewTrends());

    // Subscribe to summary so the signal stays hot for the template.
    this.summary$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe();

    // Subscribe to trends to build comparative chart
    combineLatest([this.trends$, this.granularity$])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([trends, granularity]) => {
        this.currentTrends = trends;
        this.currentGranularity = granularity;
        this.updateComparativeChart(trends, granularity);
      });

    // Rebuild charts with mobile/desktop density when crossing the breakpoint.
    fromEvent(window, 'resize')
      .pipe(debounceTime(150), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        const mobile = this.computeIsMobile();
        if (mobile === this.isMobile()) return;
        this.isMobile.set(mobile);
        this.updateComparativeChart(this.currentTrends, this.currentGranularity);
      });
  }

  ngOnDestroy(): void {

this.store.dispatch(OverviewActions.clearOverviewSummaryState());
  }

  onCategoryChange(categoryId: AnalyticsCategoryId | null): void {
    this.selectedCategory.set(categoryId);
  }

  onDateRangeChange(range: DateRangeFilter): void {
    this.dateRange.set(range);
    this.store.dispatch(OverviewActions.setDateRange({ dateRange: range }));
  }

  onSearchChange(term: string): void {
    this.searchTerm.set(term);
  }

  exportReport(): void {
  }

  /**
   * Actions exposed via the `<app-options-dropdown>` in the card header.
   * Single action today (Export XLSX); kept as a `DropdownAction[]` computed
   * so future actions slot in without changing the template.
   */
  dropdownActions = computed<DropdownAction[]>(() => [
    {
      action: 'export-xlsx',
      label: 'Exportar XLSX',
      icon: 'download',
    },
  ]);

  onActionsDropdownClick(action: string): void {
    if (action === 'export-xlsx') {
      this.exportReport();
    }
  }

  goToReports(): void {
    this.router.navigateByUrl('/admin/reports/overview/overview-summary');
  }

  onHeaderAction(actionId: string): void {
    if (actionId === 'view-reports') {
      this.goToReports();
    }
  }

  getCategoryLabel = (categoryId: AnalyticsCategoryId): string => {
    return this.categoryById().get(categoryId)?.label ?? categoryId;
  };

  getCategoryIcon = (categoryId: AnalyticsCategoryId): string => {
    return this.categoryById().get(categoryId)?.icon ?? 'folder';
  };

  getCategoryColor = (categoryId: AnalyticsCategoryId): string => {
    return this.categoryById().get(categoryId)?.color ?? 'var(--color-primary)';
  };

  // Template helpers

  /**
   * `null` means the previous period had no base to compare against. Saying
   * "0 %" there asserts "no change" about a period that had nothing — it read as
   * a flat business instead of a new one.
   */
  getGrowthText(growth?: number | null): string {
    if (growth === undefined || growth === null) {
      return 'sin base de comparación';
    }
    const sign = growth >= 0 ? '+' : '';
    return `${sign}${growth.toFixed(1)}% vs periodo anterior`;
  }

  /** True when some sold units have no cost snapshot, so profit is overstated. */
  readonly hasIncompleteCost = computed(() => {
    const coverage = this.summary()?.cost_coverage;
    return !!coverage && coverage.units_without_cost > 0;
  });

  /** Human sentence for the incomplete-cost warning. */
  readonly incompleteCostText = computed(() => {
    const coverage = this.summary()?.cost_coverage;
    if (!coverage || coverage.units_without_cost === 0) return '';
    const pct = (coverage.coverage_ratio * 100).toFixed(0);
    return `${coverage.units_without_cost} de ${coverage.units_total} unidades vendidas no tienen costo registrado (cobertura ${pct} %). El costo de ventas y la ganancia están sobreestimados hasta que se registre ese costo.`;
  });

  formatBreakevenRatio(ratio?: number): string {
    if (ratio === undefined || ratio === null) return '0%';
    return `${ratio.toFixed(1)}%`;
  }

  getBreakevenLabel(ratio?: number): string {
    if (!ratio) return 'Sin datos';
    if (ratio < 70) return 'Margen saludable';
    if (ratio < 90) return 'Margen ajustado';
    return 'Margen critico';
  }

  getBreakevenBgColor(ratio?: number): string {
    if (!ratio || ratio < 70) return 'bg-green-100';
    if (ratio < 90) return 'bg-yellow-100';
    return 'bg-red-100';
  }

  getBreakevenTextColor(ratio?: number): string {
    if (!ratio || ratio < 70) return 'text-green-600';
    if (ratio < 90) return 'text-yellow-600';
    return 'text-red-600';
  }

  /**
   * The ratio now measures ALL costs (cost of goods + operating expenses) against
   * revenue, so the wording says "costos totales" — before it said "gastos" while
   * the number omitted the cost of goods entirely.
   */
  getBreakevenStatusText(ratio?: number): string {
    if (!ratio)
      return 'Registra ingresos, costos y gastos para ver el estado de tu negocio.';
    if (ratio < 70) {
      return `Tu negocio opera con un margen saludable. El ${ratio.toFixed(1)}% de tus ingresos se destina a cubrir el costo de la mercancía y los gastos.`;
    }
    if (ratio < 90) {
      return `Tus costos totales (mercancía + gastos) representan el ${ratio.toFixed(1)}% de tus ingresos. Considera optimizarlos para mejorar el margen.`;
    }
    return `Atención: tus costos totales (mercancía + gastos) representan el ${ratio.toFixed(1)}% de tus ingresos. Revisa tu estructura de costos.`;
  }

  // Chart builders
  private updateComparativeChart(
    trends: OverviewTrend[],
    granularity: string,
  ): void {
    const m = this.isMobile();

    const style = getComputedStyle(document.documentElement);
    const borderColor =
      style.getPropertyValue('--color-border').trim() || '#e5e7eb';
    const textSecondary =
      style.getPropertyValue('--color-text-secondary').trim() || '#6b7280';

    const labels = trends.map((t) =>
      formatChartPeriod(t.period, granularity),
    );

    // Series config — avoids repeating the gradient area style for each line.
    // `Costo de Ventas` is plotted explicitly: without it on the chart, the drop
    // from Ventas to Rend. Bruto had no visible cause, and Rend. Neto used to be
    // computed WITHOUT it — which let the net line sit ABOVE the gross line.
    const seriesConfig: { name: string; color: string; values: number[] }[] = [
      { name: 'Ventas', color: '#22c55e', values: trends.map((t) => t.sales) },
      { name: 'Costo de Ventas', color: '#f97316', values: trends.map((t) => t.cost_of_goods) },
      { name: 'Gastos', color: '#ef4444', values: trends.map((t) => t.expenses) },
      { name: 'Impuestos', color: '#f59e0b', values: trends.map((t) => t.taxes) },
      { name: 'Rend. Bruto', color: '#3b82f6', values: trends.map((t) => t.gross_profit) },
      { name: 'Rend. Neto', color: '#8b5cf6', values: trends.map((t) => t.net_profit) },
    ];

    this.comparativeChartOptions.set({
      tooltip: {
        trigger: 'axis',
        confine: true,
        textStyle: { fontSize: m ? 11 : 12 },
        formatter: (params: any) => {
          let html = `<strong>${params[0].name}</strong><br/>`;
          for (const p of params) {
            html += `${p.marker} ${p.seriesName}: ${this.currencyService.format(p.value)}<br/>`;
          }
          return html;
        } },
      legend: {
        data: seriesConfig.map((s) => s.name),
        type: m ? 'scroll' : 'plain',
        bottom: m ? 0 : 30,
        itemWidth: m ? 12 : 25,
        itemHeight: m ? 8 : 14,
        itemGap: m ? 8 : 10,
        textStyle: { color: textSecondary, fontSize: m ? 10 : 12 } },
      grid: {
        left: m ? '1%' : '3%',
        right: m ? '2%' : '4%',
        top: m ? '6%' : '8%',
        bottom: m ? '20%' : '18%',
        containLabel: true },
      xAxis: {
        type: 'category',
        data: labels,
        axisLine: { lineStyle: { color: borderColor } },
        axisLabel: {
          color: textSecondary,
          fontSize: m ? 9 : 12,
          hideOverlap: true } },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisLabel: {
          color: textSecondary,
          fontSize: m ? 9 : 12,
          formatter: (value: number) => this.formatAxisCurrency(value, m) },
        splitLine: { lineStyle: { color: borderColor } } },
      series: seriesConfig.map((s) => ({
        name: s.name,
        type: 'line' as const,
        smooth: true,
        showSymbol: !m,
        symbol: 'circle',
        symbolSize: m ? 0 : 6,
        data: s.values,
        lineStyle: { width: m ? 1.5 : 2 },
        itemStyle: { color: s.color },
        areaStyle: {
          color: {
            type: 'linear' as const,
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: `${s.color}4D` },
              { offset: 1, color: `${s.color}0D` },
            ] } },
      })) });
  }

  /** Y-axis currency formatter: compact (k/M) on mobile to save horizontal space. */
  private formatAxisCurrency(value: number, mobile: boolean): string {
    if (!mobile) return this.currencyService.format(Math.round(value), 0);
    const abs = Math.abs(value);
    if (abs >= 1_000_000) {
      return `${this.currencyService.format(Math.round(value / 1_000_000), 0)}M`;
    }
    if (abs >= 1_000) {
      return `${this.currencyService.format(Math.round(value / 1_000), 0)}k`;
    }
    return this.currencyService.format(Math.round(value), 0);
  }

}
