import {Component, OnInit, OnDestroy, inject, signal,
  DestroyRef} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Store } from '@ngrx/store';
import { Observable, combineLatest } from 'rxjs';
import { toSignal , takeUntilDestroyed} from '@angular/core/rxjs-interop';

import { CardComponent } from '../../../../../../../shared/components/card/card.component';
import { StatsComponent } from '../../../../../../../shared/components/stats/stats.component';
import { ChartComponent } from '../../../../../../../shared/components/chart/chart.component';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import {
  CurrencyPipe,
  CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { ExportButtonComponent } from '../../../components/export-button/export-button.component';
import { DateRangeFilterComponent } from '../../../components/date-range-filter/date-range-filter.component';

import { DateRangeFilter } from '../../../interfaces/analytics.interface';
import {
  SalesSummary,
  SalesTrend } from '../../../interfaces/sales-analytics.interface';

import * as SalesActions from '../state/sales-summary.actions';
import * as SalesSelectors from '../state/sales-summary.selectors';

import { EChartsOption } from 'echarts';
import { getDefaultStartDate, getDefaultEndDate, formatChartPeriod } from '../../../../../../../shared/utils/date.util';
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
    ExportButtonComponent,
    DateRangeFilterComponent,
    CurrencyPipe,
    AnalyticsCardComponent,
  ],
  templateUrl: './sales-summary.component.html',
  styleUrls: ['./sales-summary.component.scss'] })
export class SalesSummaryComponent implements OnInit, OnDestroy {
  private destroyRef = inject(DestroyRef);
  private store = inject(Store);
  private currencyService = inject(CurrencyFormatService);
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

  ngOnInit(): void {
    this.currencyService.loadCurrency();

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

  onDateRangeChange(range: DateRangeFilter): void {
    this.dateRange.set(range);
    this.store.dispatch(SalesActions.setDateRange({ dateRange: range }));
  }

  getGrowthText(growth?: number): string {
    if (growth === undefined || growth === null) return '';
    const sign = growth >= 0 ? '+' : '';
    return `${sign}${growth.toFixed(1)}% vs período anterior`;
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
          formatter: (value: number) => this.currencyService.format(Math.round(value), 0) },
        splitLine: { lineStyle: { color: borderColor } } },
      series: [
        {
          name: 'Ingresos',
          type: 'line',
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
