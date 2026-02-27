import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Store } from '@ngrx/store';
import { Observable, Subject, combineLatest, takeUntil } from 'rxjs';

import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { ChartComponent } from '../../../../../../shared/components/chart/chart.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { OptionsDropdownComponent } from '../../../../../../shared/components/options-dropdown/options-dropdown.component';
import { FilterConfig, FilterValues } from '../../../../../../shared/components/options-dropdown/options-dropdown.interfaces';
import { CurrencyPipe, CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import { ExportButtonComponent } from '../../components/export-button/export-button.component';

import { DateRangeFilter } from '../../interfaces/analytics.interface';
import { ProductsSummary, TopSellingProduct, ProductTrend } from '../../interfaces/products-analytics.interface';

import * as ProductsActions from './state/products-analytics.actions';
import * as ProductsSelectors from './state/products-analytics.selectors';

import { EChartsOption } from 'echarts';

@Component({
  selector: 'vendix-product-performance',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    StatsComponent,
    ChartComponent,
    IconComponent,
    OptionsDropdownComponent,
    CurrencyPipe,
    ExportButtonComponent,
  ],
  templateUrl: './product-performance.component.html',
  styleUrls: ['./product-performance.component.scss'],
})
export class ProductPerformanceComponent implements OnInit, OnDestroy {
  private store = inject(Store);
  private currencyService = inject(CurrencyFormatService);
  private destroy$ = new Subject<void>();

  // Observables from store
  summary$: Observable<ProductsSummary | null> = this.store.select(ProductsSelectors.selectSummary);
  topSellers$: Observable<TopSellingProduct[]> = this.store.select(ProductsSelectors.selectTopSellers);
  trends$: Observable<ProductTrend[]> = this.store.select(ProductsSelectors.selectTrends);
  loading$: Observable<boolean> = this.store.select(ProductsSelectors.selectLoading);
  loadingTopSellers$: Observable<boolean> = this.store.select(ProductsSelectors.selectLoadingTopSellers);
  loadingTrends$: Observable<boolean> = this.store.select(ProductsSelectors.selectLoadingTrends);
  exporting$: Observable<boolean> = this.store.select(ProductsSelectors.selectExporting);
  dateRange$: Observable<DateRangeFilter> = this.store.select(ProductsSelectors.selectDateRange);
  granularity$: Observable<string> = this.store.select(ProductsSelectors.selectGranularity);

  // Chart options
  topSellersChartOptions: EChartsOption = {};
  unitsTrendChartOptions: EChartsOption = {};

  // Options dropdown config
  filterConfigs: FilterConfig[] = [
    {
      key: 'date_from',
      label: 'Desde',
      type: 'date',
      defaultValue: this.getDefaultStartDate(),
    },
    {
      key: 'date_to',
      label: 'Hasta',
      type: 'date',
      defaultValue: this.getDefaultEndDate(),
    },
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
      defaultValue: 'day',
    },
  ];

  filterValues: FilterValues = {};

  ngOnInit(): void {
    this.currencyService.loadCurrency();

    // Dispatch initial loads
    this.store.dispatch(ProductsActions.loadProductsSummary());
    this.store.dispatch(ProductsActions.loadTopSellers());
    this.store.dispatch(ProductsActions.loadProductsTrends());

    // Sync store state → filterValues for the options dropdown
    combineLatest([this.dateRange$, this.granularity$])
      .pipe(takeUntil(this.destroy$))
      .subscribe(([dateRange, granularity]) => {
        this.filterValues = {
          date_from: dateRange.start_date || null,
          date_to: dateRange.end_date || null,
          granularity: granularity || 'day',
        };
      });

    // Subscribe to trends to build chart
    combineLatest([this.trends$, this.granularity$])
      .pipe(takeUntil(this.destroy$))
      .subscribe(([trends, granularity]) => {
        this.updateTrendsChart(trends, granularity);
      });

    // Subscribe to top sellers to build chart
    this.topSellers$
      .pipe(takeUntil(this.destroy$))
      .subscribe((topSellers) => {
        this.updateTopSellersChart(topSellers);
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.store.dispatch(ProductsActions.clearProductsAnalyticsState());
  }

  onFilterChange(values: FilterValues): void {
    const dateFrom = values['date_from'] as string;
    const dateTo = values['date_to'] as string;
    const granularity = values['granularity'] as string;

    const currentRange = this.filterValues;
    if (dateFrom !== currentRange['date_from'] || dateTo !== currentRange['date_to']) {
      this.store.dispatch(ProductsActions.setDateRange({
        dateRange: {
          start_date: dateFrom || '',
          end_date: dateTo || '',
          preset: 'custom',
        },
      }));
    }

    if (granularity !== currentRange['granularity']) {
      this.store.dispatch(ProductsActions.setGranularity({ granularity: granularity || 'day' }));
    }
  }

  onClearAllFilters(): void {
    this.store.dispatch(ProductsActions.setDateRange({
      dateRange: {
        start_date: this.getDefaultStartDate(),
        end_date: this.getDefaultEndDate(),
        preset: 'thisMonth',
      },
    }));
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

  private getDefaultStartDate(): string {
    const date = new Date();
    date.setDate(1);
    return date.toISOString().split('T')[0];
  }

  private getDefaultEndDate(): string {
    return new Date().toISOString().split('T')[0];
  }

  private updateTrendsChart(trends: ProductTrend[], granularity: string): void {
    if (!trends.length) return;

    const style = getComputedStyle(document.documentElement);
    const purpleColor = '#8b5cf6';
    const borderColor = style.getPropertyValue('--color-border').trim() || '#e5e7eb';
    const textSecondary = style.getPropertyValue('--color-text-secondary').trim() || '#6b7280';

    const labels = trends.map((t) => this.formatPeriodLabel(t.period, granularity));
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
      grid: {
        left: '3%',
        right: '4%',
        bottom: '3%',
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: labels,
        axisLine: { lineStyle: { color: borderColor } },
        axisLabel: { color: textSecondary },
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
          smooth: true,
          data: units,
          areaStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: `${purpleColor}4D` },
                { offset: 1, color: `${purpleColor}0D` },
              ],
            },
          },
          lineStyle: { color: purpleColor, width: 2 },
          itemStyle: { color: purpleColor },
        },
      ],
    };
  }

  private updateTopSellersChart(topSellers: TopSellingProduct[]): void {
    if (!topSellers.length) return;

    const style = getComputedStyle(document.documentElement);
    const primaryColor = style.getPropertyValue('--color-primary').trim() || '#3b82f6';
    const borderColor = style.getPropertyValue('--color-border').trim() || '#e5e7eb';
    const textSecondary = style.getPropertyValue('--color-text-secondary').trim() || '#6b7280';

    // Top 5 by units (reversed for horizontal bar chart — top item at top)
    const top5 = topSellers.slice(0, 5);
    const reversed = [...top5].reverse();
    const names = reversed.map((p) => p.product_name.length > 25 ? p.product_name.substring(0, 25) + '...' : p.product_name);
    const units = reversed.map((p) => p.units_sold);

    this.topSellersChartOptions = {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          const data = params[0];
          const product = reversed[data.dataIndex];
          return `<strong>${product.product_name}</strong><br/>Unidades: ${data.value}<br/>Ingresos: ${this.currencyService.format(product.revenue)}`;
        },
      },
      grid: {
        left: '3%',
        right: '6%',
        bottom: '3%',
        top: '3%',
        containLabel: true,
      },
      xAxis: {
        type: 'value',
        axisLine: { show: false },
        axisLabel: { color: textSecondary },
        splitLine: { lineStyle: { color: borderColor } },
      },
      yAxis: {
        type: 'category',
        data: names,
        axisLine: { lineStyle: { color: borderColor } },
        axisLabel: { color: textSecondary, fontSize: 11 },
      },
      series: [
        {
          name: 'Unidades',
          type: 'bar',
          data: units,
          itemStyle: {
            color: primaryColor,
            borderRadius: [0, 4, 4, 0],
          },
          barMaxWidth: 30,
        },
      ],
    };
  }

  private formatPeriodLabel(period: string, granularity: string): string {
    if (granularity === 'year') return period;
    if (granularity === 'month') {
      const [year, month] = period.split('-');
      const date = new Date(Number(year), Number(month) - 1);
      return date.toLocaleDateString('es', { month: 'short', year: '2-digit' });
    }
    if (granularity === 'hour') {
      const parts = period.split('T');
      return parts[1] || period;
    }
    try {
      const date = new Date(period);
      return date.toLocaleDateString('es', { day: '2-digit', month: 'short' });
    } catch {
      return period;
    }
  }
}
