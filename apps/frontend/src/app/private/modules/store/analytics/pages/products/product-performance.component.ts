import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Store } from '@ngrx/store';
import { Observable, Subject, takeUntil } from 'rxjs';

import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { ChartComponent } from '../../../../../../shared/components/chart/chart.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { InputsearchComponent } from '../../../../../../shared/components/inputsearch/inputsearch.component';
import { ResponsiveDataViewComponent } from '../../../../../../shared/components/responsive-data-view/responsive-data-view.component';
import { TableColumn, SortDirection } from '../../../../../../shared/components/table/table.component';
import { ItemListCardConfig } from '../../../../../../shared/components/item-list/item-list.interfaces';
import { CurrencyPipe, CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import { DateRangeFilterComponent } from '../../components/date-range-filter/date-range-filter.component';
import { ExportButtonComponent } from '../../components/export-button/export-button.component';

import { DateRangeFilter } from '../../interfaces/analytics.interface';
import { ProductsSummary, TopSellingProduct, ProductAnalyticsRow } from '../../interfaces/products-analytics.interface';

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
    InputsearchComponent,
    ResponsiveDataViewComponent,
    CurrencyPipe,
    DateRangeFilterComponent,
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
  products$: Observable<ProductAnalyticsRow[]> = this.store.select(ProductsSelectors.selectProducts);
  totalProducts$: Observable<number> = this.store.select(ProductsSelectors.selectTotalProducts);
  loading$: Observable<boolean> = this.store.select(ProductsSelectors.selectLoading);
  loadingTopSellers$: Observable<boolean> = this.store.select(ProductsSelectors.selectLoadingTopSellers);
  loadingTable$: Observable<boolean> = this.store.select(ProductsSelectors.selectLoadingTable);
  exporting$: Observable<boolean> = this.store.select(ProductsSelectors.selectExporting);
  dateRange$: Observable<DateRangeFilter> = this.store.select(ProductsSelectors.selectDateRange);
  page$: Observable<number> = this.store.select(ProductsSelectors.selectPage);
  limit$: Observable<number> = this.store.select(ProductsSelectors.selectLimit);

  // Local state for pagination (avoids async pipe in event handlers)
  currentPage = 1;
  currentLimit = 20;

  // Chart options
  topSellersChartOptions: EChartsOption = {};

  // Table columns
  tableColumns: TableColumn[] = [
    { key: 'name', label: 'Producto', sortable: true },
    { key: 'sku', label: 'SKU', width: '100px' },
    { key: 'base_price', label: 'Precio', sortable: true, align: 'right', transform: (v) => this.currencyService.format(v) },
    { key: 'stock_quantity', label: 'Stock', sortable: true, align: 'right' },
    { key: 'units_sold', label: 'Vendidas', sortable: true, align: 'right' },
    { key: 'revenue', label: 'Ingresos', sortable: true, align: 'right', transform: (v) => this.currencyService.format(v) },
    { key: 'profit_margin', label: 'Margen', align: 'right', transform: (v) => v !== null ? `${v.toFixed(1)}%` : '-' },
  ];

  // Card config for mobile
  cardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'sku',
    avatarFallbackIcon: 'package',
    detailKeys: [
      { key: 'stock_quantity', label: 'Stock' },
      { key: 'units_sold', label: 'Vendidas' },
      { key: 'base_price', label: 'Precio', transform: (v) => this.currencyService.format(v) },
      { key: 'profit_margin', label: 'Margen', transform: (v) => v !== null ? `${v.toFixed(1)}%` : '-' },
    ],
    footerKey: 'revenue',
    footerLabel: 'Ingresos',
    footerTransform: (v) => this.currencyService.format(v),
  };

  ngOnInit(): void {
    this.currencyService.loadCurrency();

    // Dispatch initial loads
    this.store.dispatch(ProductsActions.loadProductsSummary());
    this.store.dispatch(ProductsActions.loadTopSellers());
    this.store.dispatch(ProductsActions.loadProductsTable());

    // Sync page/limit to local state for template bindings
    this.page$.pipe(takeUntil(this.destroy$)).subscribe((p) => this.currentPage = p);
    this.limit$.pipe(takeUntil(this.destroy$)).subscribe((l) => this.currentLimit = l);

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

  onDateRangeChange(range: DateRangeFilter): void {
    this.store.dispatch(ProductsActions.setDateRange({ dateRange: range }));
  }

  onSearchChange(search: string): void {
    this.store.dispatch(ProductsActions.setSearch({ search }));
  }

  onPageChange(page: number): void {
    this.store.dispatch(ProductsActions.setPage({ page }));
  }

  onSort(event: { column: string; direction: SortDirection }): void {
    this.store.dispatch(ProductsActions.setSort({
      sortBy: event.column,
      sortOrder: (event.direction || 'desc') as 'asc' | 'desc',
    }));
  }

  exportReport(): void {
    this.store.dispatch(ProductsActions.exportProductsReport());
  }

  getGrowthText(growth?: number): string {
    if (growth === undefined || growth === null) return '';
    const sign = growth >= 0 ? '+' : '';
    return `${sign}${growth.toFixed(1)}% vs período anterior`;
  }

  min(a: number, b: number): number {
    return Math.min(a, b);
  }

  private updateTopSellersChart(topSellers: TopSellingProduct[]): void {
    if (!topSellers.length) return;

    const style = getComputedStyle(document.documentElement);
    const primaryColor = style.getPropertyValue('--color-primary').trim() || '#3b82f6';
    const borderColor = style.getPropertyValue('--color-border').trim() || '#e5e7eb';
    const textSecondary = style.getPropertyValue('--color-text-secondary').trim() || '#6b7280';

    // Reverse for horizontal bar chart (top item at top)
    const reversed = [...topSellers].reverse();
    const names = reversed.map((p) => p.product_name.length > 25 ? p.product_name.substring(0, 25) + '...' : p.product_name);
    const revenues = reversed.map((p) => p.revenue);

    this.topSellersChartOptions = {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          const data = params[0];
          const product = reversed[data.dataIndex];
          return `<strong>${product.product_name}</strong><br/>Ingresos: ${this.currencyService.format(data.value)}<br/>Unidades: ${product.units_sold}`;
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
        axisLabel: {
          color: textSecondary,
          formatter: (value: number) => this.currencyService.format(value, 0),
        },
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
          name: 'Ingresos',
          type: 'bar',
          data: revenues,
          itemStyle: {
            color: primaryColor,
            borderRadius: [0, 4, 4, 0],
          },
          barMaxWidth: 30,
        },
      ],
    };
  }
}
