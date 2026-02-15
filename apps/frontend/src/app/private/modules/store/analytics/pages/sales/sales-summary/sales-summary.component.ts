import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Store } from '@ngrx/store';
import { Observable, Subject, combineLatest, takeUntil } from 'rxjs';

import { StatsComponent } from '../../../../../../../shared/components/stats/stats.component';
import { ChartComponent } from '../../../../../../../shared/components/chart/chart.component';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { SelectorComponent, SelectorOption } from '../../../../../../../shared/components/selector/selector.component';
import { CurrencyPipe, CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { DateRangeFilterComponent } from '../../../components/date-range-filter/date-range-filter.component';
import { ExportButtonComponent } from '../../../components/export-button/export-button.component';

import { DateRangeFilter } from '../../../interfaces/analytics.interface';
import { SalesSummary, SalesTrend } from '../../../interfaces/sales-analytics.interface';

import * as SalesActions from '../state/sales-summary.actions';
import * as SalesSelectors from '../state/sales-summary.selectors';

import { EChartsOption } from 'echarts';

@Component({
  selector: 'vendix-sales-summary',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    StatsComponent,
    ChartComponent,
    IconComponent,
    SelectorComponent,
    CurrencyPipe,
    DateRangeFilterComponent,
    ExportButtonComponent,
  ],
  templateUrl: './sales-summary.component.html',
  styleUrls: ['./sales-summary.component.scss'],
})
export class SalesSummaryComponent implements OnInit, OnDestroy {
  private store = inject(Store);
  private currencyService = inject(CurrencyFormatService);
  private destroy$ = new Subject<void>();

  // Observables from store
  summary$: Observable<SalesSummary | null> = this.store.select(SalesSelectors.selectSummary);
  trends$: Observable<SalesTrend[]> = this.store.select(SalesSelectors.selectTrends);
  loading$: Observable<boolean> = this.store.select(SalesSelectors.selectLoading);
  loadingTrends$: Observable<boolean> = this.store.select(SalesSelectors.selectLoadingTrends);
  exporting$: Observable<boolean> = this.store.select(SalesSelectors.selectExporting);
  dateRange$: Observable<DateRangeFilter> = this.store.select(SalesSelectors.selectDateRange);
  granularity$: Observable<string> = this.store.select(SalesSelectors.selectGranularity);
  channel$: Observable<string> = this.store.select(SalesSelectors.selectChannel);

  // Chart options (updated when trends change)
  revenueChartOptions: EChartsOption = {};
  ordersChartOptions: EChartsOption = {};

  // Dropdown options
  granularityOptions: SelectorOption[] = [
    { value: 'hour', label: 'Por Hora' },
    { value: 'day', label: 'Por Día' },
    { value: 'week', label: 'Por Semana' },
    { value: 'month', label: 'Por Mes' },
    { value: 'year', label: 'Por Año' },
  ];

  channelOptions: SelectorOption[] = [
    { value: '', label: 'Todos los Canales' },
    { value: 'pos', label: 'Punto de Venta' },
    { value: 'ecommerce', label: 'Tienda Online' },
    { value: 'agent', label: 'Agente IA' },
    { value: 'whatsapp', label: 'WhatsApp' },
    { value: 'marketplace', label: 'Marketplace' },
  ];

  ngOnInit(): void {
    this.currencyService.loadCurrency();

    // Dispatch initial loads
    this.store.dispatch(SalesActions.loadSalesSummary());
    this.store.dispatch(SalesActions.loadSalesTrends());

    // Subscribe to trends to build chart options
    combineLatest([this.trends$, this.granularity$])
      .pipe(takeUntil(this.destroy$))
      .subscribe(([trends, granularity]) => {
        this.updateCharts(trends, granularity);
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.store.dispatch(SalesActions.clearSalesSummaryState());
  }

  onDateRangeChange(range: DateRangeFilter): void {
    this.store.dispatch(SalesActions.setDateRange({ dateRange: range }));
  }

  onGranularityChange(granularity: string): void {
    this.store.dispatch(SalesActions.setGranularity({ granularity }));
  }

  onChannelChange(channel: string): void {
    this.store.dispatch(SalesActions.setChannel({ channel }));
  }

  exportReport(): void {
    this.store.dispatch(SalesActions.exportSalesReport());
  }

  getGrowthText(growth?: number): string {
    if (growth === undefined || growth === null) return '';
    const sign = growth >= 0 ? '+' : '';
    return `${sign}${growth.toFixed(1)}% vs período anterior`;
  }

  private updateCharts(trends: SalesTrend[], granularity: string): void {
    if (!trends.length) return;

    // Read theme-aware colors from CSS custom properties
    const style = getComputedStyle(document.documentElement);
    const primaryColor = style.getPropertyValue('--color-primary').trim() || '#3b82f6';
    const successColor = '#22c55e';
    const borderColor = style.getPropertyValue('--color-border').trim() || '#e5e7eb';
    const textSecondary = style.getPropertyValue('--color-text-secondary').trim() || '#6b7280';

    const labels = trends.map((t) => this.formatPeriodLabel(t.period, granularity));
    const revenues = trends.map((t) => t.revenue);
    const orders = trends.map((t) => t.orders);

    this.revenueChartOptions = {
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          const data = params[0];
          return `${data.name}<br/>Ingresos: ${this.currencyService.format(data.value)}`;
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
        axisLabel: {
          color: textSecondary,
          formatter: (value: number) => this.currencyService.format(value, 0),
        },
        splitLine: { lineStyle: { color: borderColor } },
      },
      series: [
        {
          name: 'Ingresos',
          type: 'line',
          smooth: true,
          data: revenues,
          areaStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: `${successColor}4D` },
                { offset: 1, color: `${successColor}0D` },
              ],
            },
          },
          lineStyle: { color: successColor, width: 2 },
          itemStyle: { color: successColor },
        },
      ],
    };

    this.ordersChartOptions = {
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          const data = params[0];
          return `${data.name}<br/>Órdenes: ${data.value}`;
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
          name: 'Órdenes',
          type: 'bar',
          data: orders,
          itemStyle: {
            color: primaryColor,
            borderRadius: [4, 4, 0, 0],
          },
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
    // day or week
    try {
      const date = new Date(period);
      return date.toLocaleDateString('es', { day: '2-digit', month: 'short' });
    } catch {
      return period;
    }
  }
}
