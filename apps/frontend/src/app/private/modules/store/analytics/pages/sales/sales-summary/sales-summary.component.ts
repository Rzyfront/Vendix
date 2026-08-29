import {Component, OnInit, OnDestroy, inject, signal, computed,
  DestroyRef} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { Store } from '@ngrx/store';
import { Observable, combineLatest } from 'rxjs';
import { toSignal , takeUntilDestroyed} from '@angular/core/rxjs-interop';

import { CardComponent } from '../../../../../../../shared/components/card/card.component';
import { StatsComponent } from '../../../../../../../shared/components/stats/stats.component';
import { ChartComponent } from '../../../../../../../shared/components/chart/chart.component';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import {
  OptionsDropdownComponent } from '../../../../../../../shared/components/options-dropdown/options-dropdown.component';
import {
  DropdownAction,
  FilterConfig,
  FilterValues } from '../../../../../../../shared/components/options-dropdown/options-dropdown.interfaces';
import {
  CurrencyPipe,
  CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { ExportButtonComponent } from '../../../components/export-button/export-button.component';

import { DateRangeFilter } from '../../../interfaces/analytics.interface';
import {
  SalesSummary,
  SalesTrend } from '../../../interfaces/sales-analytics.interface';

import * as SalesActions from '../state/sales-summary.actions';
import * as SalesSelectors from '../state/sales-summary.selectors';

import { EChartsOption } from 'echarts';
import { getDefaultStartDate, getDefaultEndDate, formatChartPeriod } from '../../../../../../../shared/utils/date.util';
import { queryParamsToDateRange } from '../../../../shared/utils/date-range-params.util';
import { truncateLabel, compactCountAxis } from '../../../../../../../shared/utils/chart-labels.util';
import { comparisonLabelFor } from '../../../utils/comparison-label.util';
import { AnalyticsCardComponent } from '../../../components/analytics-card/analytics-card.component';
import { getViewsByCategory, AnalyticsView } from '../../../config/analytics-registry';

@Component({
  selector: 'vendix-sales-summary',
  standalone: true,
  imports: [
    CommonModule,
    CardComponent,
    StatsComponent,
    ChartComponent,
    IconComponent,
    OptionsDropdownComponent,
    ExportButtonComponent,
    CurrencyPipe,
    AnalyticsCardComponent,
  ],
  templateUrl: './sales-summary.component.html',
  styleUrls: ['./sales-summary.component.scss'] })
export class SalesSummaryComponent implements OnInit, OnDestroy {
  private destroyRef = inject(DestroyRef);
  private store = inject(Store);
  private currencyService = inject(CurrencyFormatService);
  private readonly route = inject(ActivatedRoute);
// Observables from store
  summary$: Observable<SalesSummary | null> = this.store.select(
    SalesSelectors.selectSummary,
  );
  trends$: Observable<SalesTrend[]> = this.store.select(
    SalesSelectors.selectTrends,
  );
  loading$: Observable<boolean> = this.store.select(
    SalesSelectors.selectLoading,
  );
  loadingTrends$: Observable<boolean> = this.store.select(
    SalesSelectors.selectLoadingTrends,
  );
  exporting$: Observable<boolean> = this.store.select(
    SalesSelectors.selectExporting,
  );
  dateRange$: Observable<DateRangeFilter> = this.store.select(
    SalesSelectors.selectDateRange,
  );
  granularity$: Observable<string> = this.store.select(
    SalesSelectors.selectGranularity,
  );
  channel$: Observable<string> = this.store.select(
    SalesSelectors.selectChannel,
  );

  readonly summary = toSignal(this.summary$, { initialValue: null });
  readonly loading = toSignal(this.loading$, { initialValue: false });
  readonly loadingTrends = toSignal(this.loadingTrends$, { initialValue: false });
  readonly exporting = toSignal(this.exporting$, { initialValue: false });

  // Chart options (updated when trends change)
  revenueChartOptions= signal<EChartsOption>({});
  dateRange = signal<DateRangeFilter>({
    start_date: getDefaultStartDate(),
    end_date: getDefaultEndDate(),
    preset: 'thisMonth'});

  readonly salesViews: AnalyticsView[] = getViewsByCategory('sales');

  /**
   * Filters surfaced via the unified `<app-options-dropdown>`.
   * Always starts with `date-range` (Período) and grows from there.
   */
  readonly filterConfigs = computed<FilterConfig[]>(() => [
    { key: 'date_range', type: 'date-range', label: 'Período' },
  ]);

  /**
   * Mirror state exposed back to the dropdown so its internal `localFilterValues`
   * stays in sync with the canonical dateRange — including resets via "Limpiar".
   * The `thisMonth` defaults match what `dateRange` is initialised with.
   */
  readonly dropdownFilterValues = signal<FilterValues>({
    date_range_start: this.dateRange().start_date,
    date_range_end: this.dateRange().end_date,
    date_range_preset: this.dateRange().preset ?? null,
  });

  ngOnInit(): void {
    this.currencyService.loadCurrency();

    // Read date range from URL query params (e.g. when navigating from Reports)
    const urlRange = queryParamsToDateRange(this.route.snapshot.queryParamMap);
    if (urlRange) {
      this.store.dispatch(SalesActions.setDateRange({ dateRange: urlRange }));
      this.dateRange.set(urlRange);
      this.dropdownFilterValues.set({
        date_range_start: urlRange.start_date,
        date_range_end: urlRange.end_date,
        date_range_preset: urlRange.preset ?? null,
      });
    }

    // Dispatch initial loads
    this.store.dispatch(SalesActions.loadSalesSummary());
    this.store.dispatch(SalesActions.loadSalesTrends());

    // Subscribe to trends to build chart options
    combineLatest([this.trends$, this.granularity$])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([trends, granularity]) => {
        this.updateCharts(trends, granularity);
      });
  }

  ngOnDestroy(): void {

this.store.dispatch(SalesActions.clearSalesSummaryState());
  }

  exportReport(): void {
    this.store.dispatch(SalesActions.exportSalesReport());
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

  onFiltersDropdownChange(values: FilterValues): void {
    const start = values['date_range_start'] as string | null;
    const end = values['date_range_end'] as string | null;
    const preset = values['date_range_preset'] as string | null;
    if (!start || !end) {
      return;
    }

    const next: DateRangeFilter = {
      start_date: start,
      end_date: end,
      preset: (preset || 'custom') as DateRangeFilter['preset'],
    };

    const current = this.dateRange();
    if (
      next.start_date === current.start_date &&
      next.end_date === current.end_date &&
      next.preset === current.preset
    ) {
      return;
    }

    this.dateRange.set(next);
    this.dropdownFilterValues.set({
      date_range_start: next.start_date,
      date_range_end: next.end_date,
      date_range_preset: next.preset ?? null,
    });
    this.store.dispatch(SalesActions.setDateRange({ dateRange: next }));
  }

  onClearAllFilters(): void {
    const defaults: DateRangeFilter = {
      start_date: getDefaultStartDate(),
      end_date: getDefaultEndDate(),
      preset: 'thisMonth',
    };
    this.dateRange.set(defaults);
    this.dropdownFilterValues.set({
      date_range_start: defaults.start_date,
      date_range_end: defaults.end_date,
      date_range_preset: defaults.preset ?? null,
    });
    this.store.dispatch(SalesActions.setDateRange({ dateRange: defaults }));
  }

  getGrowthText(growth?: number | null): string {
    if (growth === undefined || growth === null) return '';
    const sign = growth >= 0 ? '+' : '';
    // QUI-609: derive the comparison label from the active preset (was the
    // hardcoded "vs período anterior" — defect C9 in the ticket catalog).
    // QUI-610 widened the type to `number | null`: `computeGrowth` returns
    // null when the previous period is 0, and the contract renders null as
    // "—" by NOT printing "+0%" (which would be a fake "sin cambio").
    return `${sign}${growth.toFixed(1)}% vs ${comparisonLabelFor(this.dateRange().preset)}`;
  }

  private updateCharts(trends: SalesTrend[], granularity: string): void {

    // Read theme-aware colors from CSS custom properties
    const style = getComputedStyle(document.documentElement);
    const successColor = '#22c55e';
    const borderColor =
      style.getPropertyValue('--color-border').trim() || '#e5e7eb';
    const textSecondary =
      style.getPropertyValue('--color-text-secondary').trim() || '#6b7280';

    const labels = trends.map((t) =>
      formatChartPeriod(t.period, granularity),
    );
    const revenues = trends.map((t) => t.revenue);

    this.revenueChartOptions.set({
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          const data = params[0];
          return `${data.name}<br/>Ingresos: ${this.currencyService.format(data.value)}`;
        } },
      legend: {
        data: ['Ingresos'],
        bottom: 30,
        textStyle: { color: textSecondary },
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '20%',
        containLabel: true },
      xAxis: {
        type: 'category',
        data: labels,
        axisLine: { lineStyle: { color: borderColor } },
        axisLabel: { color: textSecondary } },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisLabel: {
          color: textSecondary,
          formatter: (value: number) => this.currencyService.formatChartAxis(value) },
        splitLine: { lineStyle: { color: borderColor } } },
      series: [
        {
          name: 'Ingresos',
          type: 'line',
          smooth: true,
          symbol: 'circle',
          data: revenues,
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: `${successColor}4D` },
                { offset: 1, color: `${successColor}0D` },
              ] } },
          itemStyle: { color: successColor } },
      ] });
  }

}
