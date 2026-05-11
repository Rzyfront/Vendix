import {Component, OnInit, inject, signal, computed,
  DestroyRef} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';
import { toSignal , takeUntilDestroyed} from '@angular/core/rxjs-interop';

import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { ChartComponent } from '../../../../../../shared/components/chart/chart.component';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { ResponsiveDataViewComponent } from '../../../../../../shared/components/responsive-data-view/responsive-data-view.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { TableColumn } from '../../../../../../shared/components/table/table.component';
import { ItemListCardConfig } from '../../../../../../shared/components/item-list/item-list.interfaces';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import { DateRangeFilterComponent } from '../../components/date-range-filter/date-range-filter.component';
import { ExportButtonComponent } from '../../components/export-button/export-button.component';

import { DateRangeFilter } from '../../interfaces/analytics.interface';
import { TopSellingProduct } from '../../interfaces/products-analytics.interface';

import * as ProductsActions from './state/products-analytics.actions';
import * as ProductsSelectors from './state/products-analytics.selectors';

import { EChartsOption } from 'echarts';
import { getViewsByCategory, AnalyticsView } from '../../config/analytics-registry';
import { AnalyticsCardComponent } from '../../components/analytics-card/analytics-card.component';

@Component({
  selector: 'vendix-top-sellers',
  standalone: true,
  imports: [
    CommonModule,
    CardComponent,
    ChartComponent,
    StatsComponent,
    ResponsiveDataViewComponent,
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
  readonly dateRange = toSignal(this.dateRange$);

  topSellersChartOptions= signal<EChartsOption>({});
  activeView = signal<'chart' | 'table'>('chart');
  exporting = signal(false);

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

  tableColumns: TableColumn[] = [
    { key: 'product_name', label: 'Producto' },
    { key: 'sku', label: 'SKU', width: '100px' },
    { key: 'units_sold', label: 'Unidades', align: 'right' },
    {
      key: 'revenue',
      label: 'Ingresos',
      align: 'right',
      transform: (v) => this.currencyService.format(v)},
    {
      key: 'average_price',
      label: 'Precio Promedio',
      align: 'right',
      transform: (v) => this.currencyService.format(v)},
    {
      key: 'profit_margin',
      label: 'Margen',
      align: 'right',
      transform: (v) => (v !== null ? `${v.toFixed(1)}%` : '-')},
  ];

  cardConfig: ItemListCardConfig = {
    titleKey: 'product_name',
    subtitleKey: 'sku',
    avatarFallbackIcon: 'package',
    detailKeys: [
      { key: 'units_sold', label: 'Unidades' },
      {
        key: 'average_price',
        label: 'Precio Prom.',
        transform: (v) => this.currencyService.format(v)},
      {
        key: 'profit_margin',
        label: 'Margen',
        transform: (v) => (v !== null ? `${v.toFixed(1)}%` : '-')},
    ],
    footerKey: 'revenue',
    footerLabel: 'Ingresos',
    footerTransform: (v) => this.currencyService.format(v)};

  ngOnInit(): void {
    this.currencyService.loadCurrency();

    this.store.dispatch(ProductsActions.loadTopSellers());

    this.topSellers$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((topSellers) => {
      this.updateChart(topSellers);
    });
  }
onDateRangeChange(range: DateRangeFilter): void {
    this.store.dispatch(ProductsActions.setDateRange({ dateRange: range }));
  }

  private updateChart(topSellers: TopSellingProduct[]): void {

    const style = getComputedStyle(document.documentElement);
    const borderColor =
      style.getPropertyValue('--color-border').trim() || '#e5e7eb';
    const textSecondary =
      style.getPropertyValue('--color-text-secondary').trim() || '#6b7280';

    const reversed = [...topSellers].reverse();
    const names = reversed.map((p) =>
      p.product_name.length > 25
        ? p.product_name.substring(0, 25) + '...'
        : p.product_name,
    );
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
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        min: 0,
        axisLine: { show: false },
        axisLabel: {
          color: textSecondary,
          formatter: (value: number) => this.currencyService.format(value, 0),
        },
        splitLine: { lineStyle: { color: borderColor } },
      },
      series: [{
        name: 'Top Vendedores',
        type: 'bar' as const,
        data: revenues.map((r, i) => ({
          value: r,
          itemStyle: { color: colors[i % colors.length] }
        })),
        barMaxWidth: 50,
      }],
    });
  }

  exportReport(): void {
    this.exporting.set(true);
    setTimeout(() => this.exporting.set(false), 1000);
  }
}
