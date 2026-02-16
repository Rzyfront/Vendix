import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Store } from '@ngrx/store';
import { Observable, Subject, takeUntil } from 'rxjs';

import { ChartComponent } from '../../../../../../shared/components/chart/chart.component';
import { ResponsiveDataViewComponent } from '../../../../../../shared/components/responsive-data-view/responsive-data-view.component';
import { TableColumn } from '../../../../../../shared/components/table/table.component';
import { ItemListCardConfig } from '../../../../../../shared/components/item-list/item-list.interfaces';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import { DateRangeFilterComponent } from '../../components/date-range-filter/date-range-filter.component';

import { DateRangeFilter } from '../../interfaces/analytics.interface';
import { TopSellingProduct } from '../../interfaces/products-analytics.interface';

import * as ProductsActions from './state/products-analytics.actions';
import * as ProductsSelectors from './state/products-analytics.selectors';

import { EChartsOption } from 'echarts';

@Component({
  selector: 'vendix-top-sellers',
  standalone: true,
  imports: [
    CommonModule,
    ChartComponent,
    ResponsiveDataViewComponent,
    DateRangeFilterComponent,
  ],
  templateUrl: './top-sellers.component.html',
  styles: [`:host { display: block; width: 100%; }`],
})
export class TopSellersComponent implements OnInit, OnDestroy {
  private store = inject(Store);
  private currencyService = inject(CurrencyFormatService);
  private destroy$ = new Subject<void>();

  topSellers$: Observable<TopSellingProduct[]> = this.store.select(ProductsSelectors.selectTopSellers);
  loadingTopSellers$: Observable<boolean> = this.store.select(ProductsSelectors.selectLoadingTopSellers);
  dateRange$: Observable<DateRangeFilter> = this.store.select(ProductsSelectors.selectDateRange);

  topSellersChartOptions: EChartsOption = {};

  tableColumns: TableColumn[] = [
    { key: 'product_name', label: 'Producto' },
    { key: 'sku', label: 'SKU', width: '100px' },
    { key: 'units_sold', label: 'Unidades', align: 'right' },
    { key: 'revenue', label: 'Ingresos', align: 'right', transform: (v) => this.currencyService.format(v) },
    { key: 'average_price', label: 'Precio Promedio', align: 'right', transform: (v) => this.currencyService.format(v) },
    { key: 'profit_margin', label: 'Margen', align: 'right', transform: (v) => v !== null ? `${v.toFixed(1)}%` : '-' },
  ];

  cardConfig: ItemListCardConfig = {
    titleKey: 'product_name',
    subtitleKey: 'sku',
    avatarFallbackIcon: 'package',
    detailKeys: [
      { key: 'units_sold', label: 'Unidades' },
      { key: 'average_price', label: 'Precio Prom.', transform: (v) => this.currencyService.format(v) },
      { key: 'profit_margin', label: 'Margen', transform: (v) => v !== null ? `${v.toFixed(1)}%` : '-' },
    ],
    footerKey: 'revenue',
    footerLabel: 'Ingresos',
    footerTransform: (v) => this.currencyService.format(v),
  };

  ngOnInit(): void {
    this.currencyService.loadCurrency();

    this.store.dispatch(ProductsActions.loadTopSellers());

    this.topSellers$
      .pipe(takeUntil(this.destroy$))
      .subscribe((topSellers) => {
        this.updateChart(topSellers);
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onDateRangeChange(range: DateRangeFilter): void {
    this.store.dispatch(ProductsActions.setDateRange({ dateRange: range }));
  }

  private updateChart(topSellers: TopSellingProduct[]): void {
    if (!topSellers.length) return;

    const style = getComputedStyle(document.documentElement);
    const primaryColor = style.getPropertyValue('--color-primary').trim() || '#3b82f6';
    const borderColor = style.getPropertyValue('--color-border').trim() || '#e5e7eb';
    const textSecondary = style.getPropertyValue('--color-text-secondary').trim() || '#6b7280';

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
