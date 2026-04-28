import {Component, OnInit, OnDestroy, inject,
  DestroyRef} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Store } from '@ngrx/store';
import { Observable, combineLatest } from 'rxjs';
import { toSignal , takeUntilDestroyed} from '@angular/core/rxjs-interop';

import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { ChartComponent } from '../../../../../../shared/components/chart/chart.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { OptionsDropdownComponent } from '../../../../../../shared/components/options-dropdown/options-dropdown.component';
import {
  FilterConfig,
  FilterValues } from '../../../../../../shared/components/options-dropdown/options-dropdown.interfaces';
import {
  CurrencyPipe,
  CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import { ExportButtonComponent } from '../../components/export-button/export-button.component';

import { DateRangeFilter } from '../../interfaces/analytics.interface';
import {
  ProductsSummary,
  TopSellingProduct,
  ProductTrend } from '../../interfaces/products-analytics.interface';

import * as ProductsActions from './state/products-analytics.actions';
import * as ProductsSelectors from './state/products-analytics.selectors';

import { EChartsOption } from 'echarts';
import { getDefaultStartDate, getDefaultEndDate, formatChartPeriod } from '../../../../../../shared/utils/date.util';
import { AnalyticsCardComponent } from '../../components/analytics-card/analytics-card.component';
import { getViewsByCategory, AnalyticsView } from '../../config/analytics-registry';

@Component({
  selector: 'vendix-product-performance',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    CardComponent,
    StatsComponent,
    ChartComponent,
    OptionsDropdownComponent,
    CurrencyPipe,
    ExportButtonComponent,
    AnalyticsCardComponent,
  ],
  templateUrl: './product-performance.component.html',
  styleUrls: ['./product-performance.component.scss'] })
export class ProductPerformanceComponent implements OnInit, OnDestroy {
  private destroyRef = inject(DestroyRef);
  private store = inject(Store);
  private currencyService = inject(CurrencyFormatService);
// Observables from store
  summary$: Observable<ProductsSummary | null> = this.store.select(
    ProductsSelectors.selectSummary,
  );
  topSellers$: Observable<TopSellingProduct[]> = this.store.select(
    ProductsSelectors.selectTopSellers,
  );
  trends$: Observable<ProductTrend[]> = this.store.select(
    ProductsSelectors.selectTrends,
  );
  loading$: Observable<boolean> = this.store.select(
    ProductsSelectors.selectLoading,
  );
  loadingTopSellers$: Observable<boolean> = this.store.select(
    ProductsSelectors.selectLoadingTopSellers,
  );
  loadingTrends$: Observable<boolean> = this.store.select(
    ProductsSelectors.selectLoadingTrends,
  );
  exporting$: Observable<boolean> = this.store.select(
    ProductsSelectors.selectExporting,
  );
  dateRange$: Observable<DateRangeFilter> = this.store.select(
    ProductsSelectors.selectDateRange,
  );
  granularity$: Observable<string> = this.store.select(
    ProductsSelectors.selectGranularity,
  );

  readonly summary = toSignal(this.summary$, { initialValue: null });
  readonly loading = toSignal(this.loading$, { initialValue: false });
  readonly loadingTopSellers = toSignal(this.loadingTopSellers$, { initialValue: false });
  readonly loadingTrends = toSignal(this.loadingTrends$, { initialValue: false });
  readonly exporting = toSignal(this.exporting$, { initialValue: false });

  // Chart options
  topSellersChartOptions: EChartsOption = {};
  unitsTrendChartOptions: EChartsOption = {};

  // Options dropdown config
  filterConfigs: FilterConfig[] = [
    {
      key: 'date_from',
      label: 'Desde',
      type: 'date',
      defaultValue: getDefaultStartDate() },
    {
      key: 'date_to',
      label: 'Hasta',
      type: 'date',
      defaultValue: getDefaultEndDate() },
    {
      key: 'granularity',
      label: 'Granularidad',
      type: 'select',
      options: [
        { value: 'hour', label: 'Por Hora' },
        { value: 'day', label: 'Por Día' },
        { value: 'week', label: 'Por Semana' },
        { value: 'month', label: 'Por Mes' },
        { value: 'year', label: 'Por Año' },
      ],
      placeholder: 'Seleccionar',
      defaultValue: 'day' },
  ];

  filterValues: FilterValues = {};

  readonly productsViews: AnalyticsView[] = getViewsByCategory('products');

  ngOnInit(): void {
    this.currencyService.loadCurrency();

    // Dispatch initial loads
    this.store.dispatch(ProductsActions.loadProductsSummary());
    this.store.dispatch(ProductsActions.loadTopSellers());
    this.store.dispatch(ProductsActions.loadProductsTrends());

    // Sync store state → filterValues for the options dropdown
    combineLatest([this.dateRange$, this.granularity$])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([dateRange, granularity]) => {
        this.filterValues = {
          date_from: dateRange.start_date || null,
          date_to: dateRange.end_date || null,
          granularity: granularity || 'day' };
      });

    // Subscribe to trends to build chart
    combineLatest([this.trends$, this.granularity$])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([trends, granularity]) => {
        this.updateTrendsChart(trends, granularity);
      });

    // Subscribe to top sellers to build chart
    this.topSellers$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((topSellers) => {
      this.updateTopSellersChart(topSellers);
    });
  }

  ngOnDestroy(): void {

this.store.dispatch(ProductsActions.clearProductsAnalyticsState());
  }

  onFilterChange(values: FilterValues): void {
    const dateFrom = values['date_from'] as string;
    const dateTo = values['date_to'] as string;
    const granularity = values['granularity'] as string;

    const currentRange = this.filterValues;
    if (
      dateFrom !== currentRange['date_from'] ||
      dateTo !== currentRange['date_to']
    ) {
      this.store.dispatch(
        ProductsActions.setDateRange({
          dateRange: {
            start_date: dateFrom || '',
            end_date: dateTo || '',
            preset: 'custom' } }),
      );
    }

    if (granularity !== currentRange['granularity']) {
      this.store.dispatch(
        ProductsActions.setGranularity({ granularity: granularity || 'day' }),
      );
    }
  }

  onClearAllFilters(): void {
    this.store.dispatch(
      ProductsActions.setDateRange({
        dateRange: {
          start_date: getDefaultStartDate(),
          end_date: getDefaultEndDate(),
          preset: 'thisMonth' } }),
    );
    this.store.dispatch(ProductsActions.setGranularity({ granularity: 'day' }));
  }

  exportReport(): void {
    this.store.dispatch(ProductsActions.exportProductsReport());
  }

  getGrowthText(growth?: number): string {
    if (growth === undefined || growth === null) return '';
    const sign = growth >= 0 ? '+' : '';
    return `${sign}${growth.toFixed(1)}% vs período anterior`;
  }

  private updateTrendsChart(trends: ProductTrend[], granularity: string): void {
    if (!trends.length) return;

    const style = getComputedStyle(document.documentElement);
    const purpleColor = '#8b5cf6';
    const borderColor =
      style.getPropertyValue('--color-border').trim() || '#e5e7eb';
    const textSecondary =
      style.getPropertyValue('--color-text-secondary').trim() || '#6b7280';

    const labels = trends.map((t) =>
      formatChartPeriod(t.period, granularity),
    );
    const units = trends.map((t) => t.units_sold);

    this.unitsTrendChartOptions = {
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          const data = params[0];
          const trend = trends[data.dataIndex];
          return `${data.name}<br/>Unidades: ${data.value}<br/>Ingresos: ${this.currencyService.format(trend.revenue)}`;
        },
      },
      legend: {
        data: ['Unidades'],
        bottom: 30,
        textStyle: { color: textSecondary },
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '20%',
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: labels,
        axisLine: { lineStyle: { color: borderColor } },
        axisLabel: { color: textSecondary } },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisLabel: { color: textSecondary },
        splitLine: { lineStyle: { color: borderColor } } },
      series: [
        {
          name: 'Unidades',
          type: 'line',
          smooth: true,
          data: units,
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: `${purpleColor}4D` },
                { offset: 1, color: `${purpleColor}0D` },
              ] } },
          lineStyle: { color: purpleColor, width: 2 },
          itemStyle: { color: purpleColor } },
      ] };
  }

  private updateTopSellersChart(topSellers: TopSellingProduct[]): void {
    if (!topSellers.length) return;

    const style = getComputedStyle(document.documentElement);
    const primaryColor =
      style.getPropertyValue('--color-primary').trim() || '#3b82f6';
    const borderColor =
      style.getPropertyValue('--color-border').trim() || '#e5e7eb';
    const textSecondary =
      style.getPropertyValue('--color-text-secondary').trim() || '#6b7280';

    // Top 5 by units
    const top5 = topSellers.slice(0, 5);
    const names = top5.map((p) =>
      p.product_name.length > 25
        ? p.product_name.substring(0, 25) + '...'
        : p.product_name,
    );
    const units = top5.map((p) => p.units_sold);

    this.topSellersChartOptions = {
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          const data = params[0];
          const product = top5[data.dataIndex];
          return `<strong>${product.product_name}</strong><br/>Unidades: ${data.value}<br/>Ingresos: ${this.currencyService.format(product.revenue)}`;
        },
      },
      legend: {
        data: ['Unidades'],
        bottom: 30,
        textStyle: { color: textSecondary },
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '20%',
        top: '3%',
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: names,
        axisLine: { lineStyle: { color: borderColor } },
        axisLabel: { color: textSecondary, fontSize: 11 },
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisLabel: { color: textSecondary },
        splitLine: { lineStyle: { color: borderColor } },
      },
      series: [
        {
          name: 'Unidades',
          type: 'line',
          data: units,
          itemStyle: { color: primaryColor },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: `${primaryColor}4D` },
                { offset: 1, color: `${primaryColor}0D` },
              ],
            },
          },
        },
      ],
    };
  }
}
