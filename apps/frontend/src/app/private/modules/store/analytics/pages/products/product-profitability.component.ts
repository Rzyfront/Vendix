import { Component, OnInit, OnDestroy, inject, signal, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Store } from '@ngrx/store';
import { Observable, combineLatest } from 'rxjs';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';

import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { ChartComponent } from '../../../../../../shared/components/chart/chart.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { OptionsDropdownComponent } from '../../../../../../shared/components/options-dropdown/options-dropdown.component';
import {
  FilterConfig,
  FilterValues,
} from '../../../../../../shared/components/options-dropdown/options-dropdown.interfaces';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import { ExportButtonComponent } from '../../components/export-button/export-button.component';

import { DateRangeFilter } from '../../interfaces/analytics.interface';
import {
  ProductProfitability,
  ProfitabilitySummary,
} from '../../interfaces/products-analytics.interface';

import * as ProfitabilityActions from './state/profitability-analytics.actions';
import * as ProfitabilitySelectors from './state/profitability-analytics.selectors';

import { EChartsOption } from 'echarts';
import { getDefaultStartDate, getDefaultEndDate } from '../../../../../../shared/utils/date.util';
import { AnalyticsCardComponent } from '../../components/analytics-card/analytics-card.component';
import { getViewsByCategory, AnalyticsView } from '../../config/analytics-registry';

@Component({
  selector: 'vendix-product-profitability',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    CardComponent,
    StatsComponent,
    ChartComponent,
    IconComponent,
    OptionsDropdownComponent,
    ExportButtonComponent,
    AnalyticsCardComponent,
  ],
  templateUrl: './product-profitability.component.html',
  styleUrls: ['./product-profitability.component.scss'],
})
export class ProductProfitabilityComponent implements OnInit, OnDestroy {
  private destroyRef = inject(DestroyRef);
  private store = inject(Store);
  private currencyService = inject(CurrencyFormatService);

  summary$: Observable<ProfitabilitySummary | null> = this.store.select(
    ProfitabilitySelectors.selectProfitabilitySummary,
  );
  products$: Observable<ProductProfitability[]> = this.store.select(
    ProfitabilitySelectors.selectProfitabilityProducts,
  );
  loading$: Observable<boolean> = this.store.select(
    ProfitabilitySelectors.selectProfitabilityLoading,
  );
  exporting$: Observable<boolean> = this.store.select(
    ProfitabilitySelectors.selectProfitabilityExporting,
  );
  dateRange$: Observable<DateRangeFilter> = this.store.select(
    ProfitabilitySelectors.selectProfitabilityDateRange,
  );
  granularity$: Observable<string> = this.store.select(
    ProfitabilitySelectors.selectProfitabilityGranularity,
  );
  profitableProducts$: Observable<ProductProfitability[]> = this.store.select(
    ProfitabilitySelectors.selectProfitableProducts,
  );
  unprofitableProducts$: Observable<ProductProfitability[]> = this.store.select(
    ProfitabilitySelectors.selectUnprofitableProducts,
  );
  topProfitable$: Observable<ProductProfitability[]> = this.store.select(
    ProfitabilitySelectors.selectTopProfitableProducts,
  );
  mostProfitable$: Observable<ProductProfitability | null> = this.store.select(
    ProfitabilitySelectors.selectMostProfitableByMargin,
  );

  readonly summary = toSignal(this.summary$, { initialValue: null });
  readonly loading = toSignal(this.loading$, { initialValue: false });
  readonly exporting = toSignal(this.exporting$, { initialValue: false });
  readonly products = toSignal(this.products$, { initialValue: [] });
  readonly profitableProducts = toSignal(this.profitableProducts$, { initialValue: [] });
  readonly unprofitableProducts = toSignal(this.unprofitableProducts$, { initialValue: [] });
  readonly topProfitable = toSignal(this.topProfitable$, { initialValue: [] });
  readonly mostProfitable = toSignal(this.mostProfitable$, { initialValue: null });

  marginDistributionChartOptions= signal<EChartsOption>({});
  topProfitChartOptions= signal<EChartsOption>({});
  comparativeChartOptions= signal<EChartsOption>({});

  filterConfigs: FilterConfig[] = [
    {
      key: 'date_from',
      label: 'Desde',
      type: 'date',
      defaultValue: getDefaultStartDate(),
    },
    {
      key: 'date_to',
      label: 'Hasta',
      type: 'date',
      defaultValue: getDefaultEndDate(),
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

  readonly productsViews: AnalyticsView[] = getViewsByCategory('products');

  ngOnInit(): void {
    this.currencyService.loadCurrency();

    this.store.dispatch(ProfitabilityActions.loadProfitability());

    combineLatest([this.dateRange$, this.granularity$])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([dateRange, granularity]) => {
        this.filterValues = {
          date_from: dateRange.start_date || null,
          date_to: dateRange.end_date || null,
          granularity: granularity || 'day',
        };
      });

    combineLatest([this.products$, this.summary$])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([products, summary]) => {
        this.buildCharts(products, summary);
      });
  }

  ngOnDestroy(): void {
    this.store.dispatch(ProfitabilityActions.clearProfitabilityAnalyticsState());
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
        ProfitabilityActions.setProfitabilityDateRange({
          dateRange: {
            start_date: dateFrom || '',
            end_date: dateTo || '',
            preset: 'custom',
          },
        }),
      );
    }

    if (granularity !== currentRange['granularity']) {
      this.store.dispatch(
        ProfitabilityActions.setProfitabilityGranularity({
          granularity: granularity || 'day',
        }),
      );
    }
  }

  onClearAllFilters(): void {
    this.store.dispatch(
      ProfitabilityActions.setProfitabilityDateRange({
        dateRange: {
          start_date: getDefaultStartDate(),
          end_date: getDefaultEndDate(),
          preset: 'thisMonth',
        },
      }),
    );
    this.store.dispatch(
      ProfitabilityActions.setProfitabilityGranularity({ granularity: 'day' }),
    );
  }

  exportReport(): void {
    this.store.dispatch(ProfitabilityActions.exportProfitabilityReport());
  }

  getProfitableCount(): number {
    return this.profitableProducts().length;
  }

  getUnprofitableCount(): number {
    return this.unprofitableProducts().length;
  }

  getMostProfitableName(): string {
    const top = this.topProfitable()[0];
    return top ? top.product_name : '-';
  }

  private buildCharts(
    products: ProductProfitability[],
    summary: ProfitabilitySummary | null,
  ): void {
    if (!products.length || !summary) return;

    this.buildMarginDistributionChart(products);
    this.buildTopProfitChart(products);
    this.buildComparativeChart(products, summary);
  }

  private buildMarginDistributionChart(products: ProductProfitability[]): void {
    const style = getComputedStyle(document.documentElement);
    const borderColor = style.getPropertyValue('--color-border').trim() || '#e5e7eb';
    const textSecondary = style.getPropertyValue('--color-text-secondary').trim() || '#6b7280';

    const profitable = products.filter((p) => p.margin > 0).length;
    const unprofitable = products.filter((p) => p.margin <= 0).length;
    const zeroMargin = products.filter((p) => p.margin === 0).length;

    this.marginDistributionChartOptions.set({
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          const data = params[0];
          return `${data.name}: ${data.value} productos`;
        },
      },
      legend: {
        data: ['Distribución'],
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
        data: ['Rentables', 'No Rentables', 'Sin Margen'],
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
          name: 'Distribución',
          type: 'bar',
          data: [
            { value: profitable, itemStyle: { color: '#22c55e' } },
            { value: unprofitable, itemStyle: { color: '#ef4444' } },
            { value: zeroMargin, itemStyle: { color: '#f59e0b' } },
          ],
          barMaxWidth: 40,
        },
      ],
    });
  }

  private buildTopProfitChart(products: ProductProfitability[]): void {
    const style = getComputedStyle(document.documentElement);
    const primaryColor = style.getPropertyValue('--color-primary').trim() || '#3b82f6';
    const borderColor = style.getPropertyValue('--color-border').trim() || '#e5e7eb';
    const textSecondary = style.getPropertyValue('--color-text-secondary').trim() || '#6b7280';

    const top5 = [...products]
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 5)
      .reverse();

    const names = top5.map((p) =>
      p.product_name.length > 20 ? p.product_name.substring(0, 20) + '...' : p.product_name,
    );
    const profits = top5.map((p) => p.profit);

    this.topProfitChartOptions.set({
      tooltip: {
        trigger: 'axis',
        confine: true,
        backgroundColor: 'rgba(255,255,255,0.98)',
        borderColor,
        borderWidth: 1,
        textStyle: { color: textSecondary, fontSize: 12 },
        formatter: (params: any) => {
          const data = params[0];
          const product = top5[data.dataIndex];
          return `
            <div style="padding:8px">
              <strong style="font-size:13px">${product.product_name}</strong>
              <div style="margin-top:8px;display:flex;flex-direction:column;gap:4px">
                <div style="display:flex;justify-content:space-between;gap:16px">
                  <span>Ganancia:</span>
                  <strong style="color:${primaryColor}">${this.currencyService.format(product.profit)}</strong>
                </div>
                <div style="display:flex;justify-content:space-between;gap:16px">
                  <span>Margen:</span>
                  <strong>${product.margin}%</strong>
                </div>
                <div style="display:flex;justify-content:space-between;gap:16px">
                  <span>Ingresos:</span>
                  <strong>${this.currencyService.format(product.revenue)}</strong>
                </div>
              </div>
            </div>
          `;
        },
      },
      legend: {
        data: ['Ganancia'],
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
        axisLabel: { color: textSecondary, fontSize: 11, formatter: (value: number) => this.currencyService.format(value, 0) },
        splitLine: { lineStyle: { color: borderColor, type: 'dashed' } },
      },
      series: [
        {
          name: 'Ganancia',
          type: 'bar',
          data: profits,
          itemStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: primaryColor },
                { offset: 1, color: primaryColor + '80' },
              ],
            },
            borderRadius: [4, 4, 0, 0],
          },
          barMaxWidth: 40,
        },
      ],
    });
  }

  private buildComparativeChart(
    products: ProductProfitability[],
    summary: ProfitabilitySummary,
  ): void {
    const style = getComputedStyle(document.documentElement);
    const greenColor = '#22c55e';
    const redColor = '#ef4444';
    const borderColor = style.getPropertyValue('--color-border').trim() || '#e5e7eb';
    const textSecondary = style.getPropertyValue('--color-text-secondary').trim() || '#6b7280';

    const top5 = [...products].sort((a, b) => b.profit - a.profit).slice(0, 5);
    const productNames = top5.map((p) =>
      p.product_name.length > 15 ? p.product_name.substring(0, 15) + '...' : p.product_name,
    );
    const revenues = top5.map((p) => p.revenue);
    const profits = top5.map((p) => p.profit);
    const costs = top5.map((p) => p.total_cost);

    this.comparativeChartOptions.set({
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        confine: true,
        backgroundColor: 'rgba(255,255,255,0.98)',
        borderColor,
        borderWidth: 1,
        textStyle: { color: textSecondary, fontSize: 12 },
        formatter: (params: any) => {
          const product = top5.find((p) => p.product_name.substring(0, 15) === params[0].name || p.product_name === params[0].name);
          return `
            <div style="padding:8px">
              <strong style="font-size:13px">${params[0].name}</strong>
              <div style="margin-top:8px;display:flex;flex-direction:column;gap:4px">
                ${params.map((p: any) => `
                  <div style="display:flex;justify-content:space-between;gap:16px;align-items:center">
                    <span style="display:flex;align-items:center;gap:6px">
                      <span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${p.color}"></span>
                      ${p.seriesName}:
                    </span>
                    <strong style="font-size:12px">${this.currencyService.format(p.value)}</strong>
                  </div>
                `).join('')}
                ${product ? `
                  <div style="border-top:1px solid ${borderColor};margin-top:4px;padding-top:6px">
                    <div style="display:flex;justify-content:space-between;gap:16px">
                      <span style="color:#6b7280">Margen:</span>
                      <strong style="color:${product.margin > 0 ? greenColor : redColor}">${product.margin}%</strong>
                    </div>
                  </div>
                ` : ''}
              </div>
            </div>
          `;
        },
      },
      legend: {
        data: ['Ingresos', 'Costo', 'Ganancia'],
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
        data: productNames,
        axisLine: { lineStyle: { color: borderColor } },
        axisLabel: { color: textSecondary, fontSize: 10 },
      },
      yAxis: [
        {
          type: 'value',
          name: 'Ingresos',
          position: 'left',
          axisLine: { show: false },
          axisLabel: { color: textSecondary, fontSize: 11, formatter: (value: number) => this.currencyService.format(value, 0) },
          splitLine: { lineStyle: { color: borderColor, type: 'dashed' } },
        },
        {
          type: 'value',
          name: 'Costo',
          position: 'right',
          axisLine: { show: false },
          axisLabel: { color: textSecondary, fontSize: 11, formatter: (value: number) => this.currencyService.format(value, 0) },
          splitLine: { show: false },
        },
        {
          type: 'value',
          name: 'Ganancia',
          position: 'right',
          axisLine: { show: false },
          axisLabel: { color: textSecondary, fontSize: 11, formatter: (value: number) => this.currencyService.format(value, 0) },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: 'Ingresos',
          type: 'bar',
          data: revenues,
          yAxisIndex: 0,
          itemStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: '#3b82f6' },
                { offset: 1, color: '#3b82f680' },
              ],
            },
            borderRadius: [4, 4, 0, 0],
          },
          barMaxWidth: 40,
        },
        {
          name: 'Costo',
          type: 'bar',
          data: costs,
          yAxisIndex: 1,
          itemStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: redColor },
                { offset: 1, color: `${redColor}80` },
              ],
            },
            borderRadius: [4, 4, 0, 0],
          },
          barMaxWidth: 40,
        },
        {
          name: 'Ganancia',
          type: 'bar',
          data: profits,
          yAxisIndex: 2,
          itemStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: greenColor },
                { offset: 1, color: `${greenColor}80` },
              ],
            },
            borderRadius: [4, 4, 0, 0],
          },
          barMaxWidth: 40,
        },
      ],
    });
  }
}
