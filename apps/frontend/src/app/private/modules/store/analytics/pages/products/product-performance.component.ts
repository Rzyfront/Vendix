import {Component, OnInit, OnDestroy, inject, signal,
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
import {
  CurrencyPipe,
  CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import { ExportButtonComponent } from '../../components/export-button/export-button.component';
import { DateRangeFilterComponent } from '../../components/date-range-filter/date-range-filter.component';
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
    IconComponent,
    CurrencyPipe,
    ExportButtonComponent,
    DateRangeFilterComponent,
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
  topSellersChartOptions= signal<EChartsOption>({});
  unitsTrendChartOptions= signal<EChartsOption>({});
  dateRange = signal<DateRangeFilter>({
    start_date: getDefaultStartDate(),
    end_date: getDefaultEndDate(),
    preset: 'thisMonth'});

  readonly productsViews: AnalyticsView[] = getViewsByCategory('products');

  ngOnInit(): void {
    this.currencyService.loadCurrency();

    // Dispatch initial loads
    this.store.dispatch(ProductsActions.loadProductsSummary());
    this.store.dispatch(ProductsActions.loadTopSellers());
    this.store.dispatch(ProductsActions.loadProductsTrends());

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

  exportReport(): void {
    this.store.dispatch(ProductsActions.exportProductsReport());
  }

  onDateRangeChange(range: DateRangeFilter): void {
    this.dateRange.set(range);
    this.store.dispatch(ProductsActions.setDateRange({ dateRange: range }));
  }

  getGrowthText(growth?: number): string {
    if (growth === undefined || growth === null) return '';
    const sign = growth >= 0 ? '+' : '';
    return `${sign}${growth.toFixed(1)}% vs período anterior`;
  }

  private updateTrendsChart(trends: ProductTrend[], granularity: string): void {

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
    const colors = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

    this.unitsTrendChartOptions.set({
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
        selectedMode: true,
        bottom: 30,
        left: 'center',
        itemWidth: 14,
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
        data: labels,
        axisLine: { lineStyle: { color: borderColor } },
        axisLabel: { color: textSecondary },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        min: 0,
        axisLine: { show: false },
        axisLabel: { color: textSecondary },
        splitLine: { lineStyle: { color: borderColor } },
      },
      series: [{
        name: 'Unidades',
        type: 'bar' as const,
        data: units.map((u, i) => ({
          value: u,
          itemStyle: { color: colors[i % colors.length] }
        })),
        barMaxWidth: 50,
      }],
    });
  }

  private updateTopSellersChart(topSellers: TopSellingProduct[]): void {
    const style = getComputedStyle(document.documentElement);
    const primaryColor = style.getPropertyValue('--color-primary').trim() || '#3b82f6';
    const borderColor = style.getPropertyValue('--color-border').trim() || '#e5e7eb';
    const textSecondary = style.getPropertyValue('--color-text-secondary').trim() || '#6b7280';

    if (!topSellers || topSellers.length === 0) {
      this.topSellersChartOptions.set({
        graphic: [{ type: 'text', left: 'center', top: 'middle', style: { text: 'Sin datos disponibles', fill: '#9ca3af', fontSize: 14 } }],
      });
      return;
    }

    // Top 5 by units
    const top5 = topSellers.slice(0, 5);
    const names = top5.map((p) =>
      p.product_name.length > 25
        ? p.product_name.substring(0, 25) + '...'
        : p.product_name,
    );
    const units = top5.map((p) => p.units_sold);

this.topSellersChartOptions.set({
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          const data = params[0];
          const product = top5[data.dataIndex];
          return `<strong>${product.product_name}</strong><br/>Unidades: ${data.value}<br/>Ingresos: ${this.currencyService.format(product.revenue)}`;
        },
      },
      legend: {
        data: ['Top 5 Productos'],
        selectedMode: true,
        bottom: 30,
        left: 'center',
        itemWidth: 14,
        itemHeight: 14,
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
        axisLabel: { color: textSecondary, fontSize: 10 },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        min: 0,
        axisLine: { show: false },
        axisLabel: { color: textSecondary },
        splitLine: { lineStyle: { color: borderColor } },
      },
      series: [{
        name: 'Top 5 Productos',
        type: 'bar' as const,
        data: units.map((u, i) => ({ value: u, itemStyle: { color: ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'][i % 6] } })),
        barMaxWidth: 40,
      }],
    });
  }
}
