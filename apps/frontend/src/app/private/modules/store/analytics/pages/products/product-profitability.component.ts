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
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import { ExportButtonComponent } from '../../components/export-button/export-button.component';
import { DateRangeFilterComponent } from '../../components/date-range-filter/date-range-filter.component';
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
    ExportButtonComponent,
    DateRangeFilterComponent,
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
  dateRange = signal<DateRangeFilter>({
    start_date: getDefaultStartDate(),
    end_date: getDefaultEndDate(),
    preset: 'thisMonth'});

  readonly productsViews: AnalyticsView[] = getViewsByCategory('products');

  ngOnInit(): void {
    this.currencyService.loadCurrency();

    this.store.dispatch(ProfitabilityActions.loadProfitability());

    combineLatest([this.products$, this.summary$])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([products, summary]) => {
        this.buildCharts(products, summary);
      });
  }

  ngOnDestroy(): void {
    this.store.dispatch(ProfitabilityActions.clearProfitabilityAnalyticsState());
  }

  exportReport(): void {
    this.store.dispatch(ProfitabilityActions.exportProfitabilityReport());
  }

  onDateRangeChange(range: DateRangeFilter): void {
    this.dateRange.set(range);
    this.store.dispatch(ProfitabilityActions.setProfitabilityDateRange({ dateRange: range }));
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
    const colors = ['#22c55e', '#ef4444', '#f59e0b'];

    this.marginDistributionChartOptions.set({
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          const data = params[0];
          return `${data.name}: <b>${data.value}</b> productos`;
        },
      },
      legend: {
        data: ['Margen'],
        selectedMode: true,
        bottom: 30,
        left: 'center',
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
        name: 'Margen',
        type: 'bar',
        data: [
          { value: profitable, itemStyle: { color: colors[0] } },
          { value: unprofitable, itemStyle: { color: colors[1] } },
          { value: zeroMargin, itemStyle: { color: colors[2] } },
        ],
        barMaxWidth: 60,
      }],
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
        data: ['Top Ganancia'],
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
        axisLabel: { color: textSecondary, fontSize: 11, formatter: (value: number) => this.currencyService.format(Math.round(value), 0) },
        splitLine: { lineStyle: { color: borderColor, type: 'dashed' } },
      },
      series: [{
        name: 'Top Ganancia',
        type: 'bar' as const,
        data: profits.map((p, i) => ({
          value: p,
          itemStyle: { color: ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'][i % 6] }
        })),
        barMaxWidth: 50,
      }],
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
    const colors = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6'];

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
                <div style="display:flex;justify-content:space-between;gap:16px;align-items:center">
                  <span style="display:flex;align-items:center;gap:6px">
                    <span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${params[0].color}"></span>
                    Ingresos:
                  </span>
                  <strong style="font-size:12px">${this.currencyService.format(params[0].value)}</strong>
                </div>
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
        data: ['Comparativa'],
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
        data: productNames,
        axisLine: { lineStyle: { color: borderColor } },
        axisLabel: { color: textSecondary, fontSize: 10 },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        min: 0,
        axisLine: { show: false },
        axisLabel: { color: textSecondary, fontSize: 11, formatter: (value: number) => this.currencyService.format(Math.round(value), 0) },
        splitLine: { lineStyle: { color: borderColor, type: 'dashed' } },
      },
      series: [{
        name: 'Ingresos',
        type: 'bar',
        data: revenues.map((v, i) => ({
          value: v,
          itemStyle: { color: colors[i % colors.length] }
        })),
        barMaxWidth: 50,
      }],
    });
  }
}
