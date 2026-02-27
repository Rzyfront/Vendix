import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Store } from '@ngrx/store';
import { Observable, Subject, combineLatest, takeUntil } from 'rxjs';

import { StatsComponent } from '../../../../../../../shared/components/stats/stats.component';
import { ChartComponent } from '../../../../../../../shared/components/chart/chart.component';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { OptionsDropdownComponent } from '../../../../../../../shared/components/options-dropdown/options-dropdown.component';
import { FilterConfig, FilterValues } from '../../../../../../../shared/components/options-dropdown/options-dropdown.interfaces';
import { CurrencyPipe, CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
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
    RouterLink,
    StatsComponent,
    ChartComponent,
    IconComponent,
    OptionsDropdownComponent,
    ExportButtonComponent,
    CurrencyPipe,
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
    {
      key: 'channel',
      label: 'Canal',
      type: 'select',
      options: [
        { value: '', label: 'Todos los Canales' },
        { value: 'pos', label: 'Punto de Venta' },
        { value: 'ecommerce', label: 'Tienda Online' },
        { value: 'agent', label: 'Agente IA' },
        { value: 'whatsapp', label: 'WhatsApp' },
        { value: 'marketplace', label: 'Marketplace' },
      ],
      placeholder: 'Todos los Canales',
    },
  ];

  filterValues: FilterValues = {};

  ngOnInit(): void {
    this.currencyService.loadCurrency();

    // Dispatch initial loads
    this.store.dispatch(SalesActions.loadSalesSummary());
    this.store.dispatch(SalesActions.loadSalesTrends());

    // Sync store state → filterValues for the options dropdown
    combineLatest([this.dateRange$, this.granularity$, this.channel$])
      .pipe(takeUntil(this.destroy$))
      .subscribe(([dateRange, granularity, channel]) => {
        this.filterValues = {
          date_from: dateRange.start_date || null,
          date_to: dateRange.end_date || null,
          granularity: granularity || 'day',
          channel: channel || null,
        };
      });

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

  onFilterChange(values: FilterValues): void {
    const dateFrom = values['date_from'] as string;
    const dateTo = values['date_to'] as string;
    const granularity = values['granularity'] as string;
    const channel = values['channel'] as string;

    // Update date range if changed
    const currentRange = this.filterValues;
    if (dateFrom !== currentRange['date_from'] || dateTo !== currentRange['date_to']) {
      this.store.dispatch(SalesActions.setDateRange({
        dateRange: {
          start_date: dateFrom || '',
          end_date: dateTo || '',
          preset: 'custom',
        },
      }));
    }

    // Update granularity if changed
    if (granularity !== currentRange['granularity']) {
      this.store.dispatch(SalesActions.setGranularity({ granularity: granularity || 'day' }));
    }

    // Update channel if changed
    if (channel !== currentRange['channel']) {
      this.store.dispatch(SalesActions.setChannel({ channel: channel || '' }));
    }
  }

  onClearAllFilters(): void {
    this.store.dispatch(SalesActions.setDateRange({
      dateRange: {
        start_date: this.getDefaultStartDate(),
        end_date: this.getDefaultEndDate(),
        preset: 'thisMonth',
      },
    }));
    this.store.dispatch(SalesActions.setGranularity({ granularity: 'day' }));
    this.store.dispatch(SalesActions.setChannel({ channel: '' }));
  }

  exportReport(): void {
    this.store.dispatch(SalesActions.exportSalesReport());
  }

  private getDefaultStartDate(): string {
    const date = new Date();
    date.setDate(1);
    return date.toISOString().split('T')[0];
  }

  private getDefaultEndDate(): string {
    return new Date().toISOString().split('T')[0];
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
    const successColor = '#22c55e';
    const borderColor = style.getPropertyValue('--color-border').trim() || '#e5e7eb';
    const textSecondary = style.getPropertyValue('--color-text-secondary').trim() || '#6b7280';

    const labels = trends.map((t) => this.formatPeriodLabel(t.period, granularity));
    const revenues = trends.map((t) => t.revenue);

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
