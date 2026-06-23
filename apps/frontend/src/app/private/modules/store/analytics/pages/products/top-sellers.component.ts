import {Component, OnInit, inject, signal, computed,
  DestroyRef} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';
import { toSignal , takeUntilDestroyed} from '@angular/core/rxjs-interop';

import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { ChartComponent } from '../../../../../../shared/components/chart/chart.component';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import { DateRangeFilterComponent } from '../../components/date-range-filter/date-range-filter.component';
import { ExportButtonComponent } from '../../components/export-button/export-button.component';

import { DateRangeFilter } from '../../interfaces/analytics.interface';
import { TopSellingProduct } from '../../interfaces/products-analytics.interface';
import { getDefaultStartDate, getDefaultEndDate } from '../../../../../../shared/utils/date.util';

import * as ProductsActions from './state/products-analytics.actions';
import * as ProductsSelectors from './state/products-analytics.selectors';

import { EChartsOption } from 'echarts';
import { getViewsByCategory, AnalyticsView } from '../../config/analytics-registry';
import { AnalyticsCardComponent } from '../../components/analytics-card/analytics-card.component';
import { queryParamsToDateRange } from '../../../shared/utils/date-range-params.util';
import { truncateLabel } from '../../../../../../shared/utils/chart-labels.util';

@Component({
  selector: 'vendix-top-sellers',
  standalone: true,
  imports: [
    CommonModule,
    CardComponent,
    ChartComponent,
    StatsComponent,
    IconComponent,
    DateRangeFilterComponent,
    ExportButtonComponent,
    AnalyticsCardComponent,
  ],
  templateUrl: './top-sellers.component.html',
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }
    `,
  ]})
export class TopSellersComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private store = inject(Store);
  private currencyService = inject(CurrencyFormatService);
  private readonly route = inject(ActivatedRoute);
topSellers$: Observable<TopSellingProduct[]> = this.store.select(
    ProductsSelectors.selectTopSellers,
  );
  loadingTopSellers$: Observable<boolean> = this.store.select(
    ProductsSelectors.selectLoadingTopSellers,
  );
  dateRange$: Observable<DateRangeFilter> = this.store.select(
    ProductsSelectors.selectDateRange,
  );

  readonly topSellers = toSignal(this.topSellers$, { initialValue: [] as TopSellingProduct[] });
  readonly loadingTopSellers = toSignal(this.loadingTopSellers$, { initialValue: false });

  dateRange = signal<DateRangeFilter>({
    start_date: getDefaultStartDate(),
    end_date: getDefaultEndDate(),
    preset: 'thisMonth',
  });

  topSellersChartOptions= signal<EChartsOption>({});
  exporting = signal(false);
  private chartLoaded = signal(false);

  readonly productsViews: AnalyticsView[] = getViewsByCategory('products').filter(
    (v) => v.key !== 'products_top_sellers'
  );

  readonly totalProducts = computed(() => this.topSellers().length);
  readonly totalUnits = computed(() => this.topSellers().reduce((sum, p) => sum + (p.units_sold || 0), 0));
  readonly totalRevenue = computed(() => this.topSellers().reduce((sum, p) => sum + (p.revenue || 0), 0));
  readonly topProductName = computed(() => {
    const sorted = [...this.topSellers()].sort((a, b) => b.units_sold - a.units_sold);
    return sorted[0]?.product_name?.substring(0, 15) || '-';
  });

  ngOnInit(): void {
    this.currencyService.loadCurrency();

    const urlRange = queryParamsToDateRange(this.route.snapshot.queryParamMap);
    if (urlRange) {
      this.dateRange.set(urlRange);
      this.store.dispatch(ProductsActions.setDateRange({ dateRange: urlRange, reload: false }));
    }

    this.loadChartData();

    this.topSellers$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((topSellers) => {
      this.updateChart(topSellers);
    });
  }
onDateRangeChange(range: DateRangeFilter): void {
    this.dateRange.set(range);
    this.chartLoaded.set(false);
    this.store.dispatch(ProductsActions.setDateRange({ dateRange: range, reload: false }));
    this.loadChartData();
  }

  private loadChartData(): void {
    if (!this.chartLoaded()) {
      this.store.dispatch(ProductsActions.loadTopSellers({ limit: 10 }));
      this.chartLoaded.set(true);
    }
  }

  private updateChart(topSellers: TopSellingProduct[]): void {
    const style = getComputedStyle(document.documentElement);
    const borderColor = style.getPropertyValue('--color-border').trim() || '#e5e7eb';
    const textSecondary = style.getPropertyValue('--color-text-secondary').trim() || '#6b7280';

    if (!topSellers || topSellers.length === 0) {
      this.topSellersChartOptions.set({
        graphic: [{ type: 'text', left: 'center', top: 'middle', style: { text: 'Sin datos disponibles', fill: '#9ca3af', fontSize: 14 } }],
      });
      return;
    }

    const reversed = [...topSellers].slice(0, 10).reverse();
    const names = reversed.map((p) => p.product_name);
    const revenues = reversed.map((p) => p.revenue);
    const colors = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

    this.topSellersChartOptions.set({
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          const data = params[0];
          const product = reversed[data.dataIndex];
          return `<strong>${product.product_name}</strong><br/>Ingresos: ${this.currencyService.format(data.value)}<br/>Unidades: ${product.units_sold}`;
        },
      },
      legend: {
        data: ['Top Vendedores'],
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
        axisLabel: { color: textSecondary, fontSize: 11, formatter: (val: string) => truncateLabel(val, 14) },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        min: 0,
        axisLine: { show: false },
        axisLabel: {
          color: textSecondary,
          formatter: (value: number) => this.currencyService.formatChartAxis(value),
        },
        splitLine: { lineStyle: { color: borderColor } },
      },
      series: [{
        name: 'Top Vendedores',
        type: 'bar' as const,
        data: revenues.map((r, i) => ({ value: r, itemStyle: { color: colors[i % colors.length] } })),
        barMaxWidth: 40,
      }],
    });
  }

  exportReport(): void {
    this.exporting.set(true);
    setTimeout(() => this.exporting.set(false), 1000);
  }
}
