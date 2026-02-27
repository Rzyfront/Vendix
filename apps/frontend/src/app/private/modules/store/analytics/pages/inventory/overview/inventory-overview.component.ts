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
import {
  InventorySummary,
  MovementTrend,
  InventoryValuation,
} from '../../../interfaces/inventory-analytics.interface';

import * as InventoryActions from './state/inventory-overview.actions';
import * as InventorySelectors from './state/inventory-overview.selectors';

import { EChartsOption } from 'echarts';

@Component({
  selector: 'vendix-inventory-overview',
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
  templateUrl: './inventory-overview.component.html',
  styleUrls: ['./inventory-overview.component.scss'],
})
export class InventoryOverviewComponent implements OnInit, OnDestroy {
  private store = inject(Store);
  private currencyService = inject(CurrencyFormatService);
  private destroy$ = new Subject<void>();

  // Observables from store
  summary$: Observable<InventorySummary | null> = this.store.select(InventorySelectors.selectSummary);
  movementTrends$: Observable<MovementTrend[]> = this.store.select(InventorySelectors.selectMovementTrends);
  valuations$: Observable<InventoryValuation[]> = this.store.select(InventorySelectors.selectValuations);
  loading$: Observable<boolean> = this.store.select(InventorySelectors.selectLoading);
  loadingTrends$: Observable<boolean> = this.store.select(InventorySelectors.selectLoadingTrends);
  loadingValuation$: Observable<boolean> = this.store.select(InventorySelectors.selectLoadingValuation);
  exporting$: Observable<boolean> = this.store.select(InventorySelectors.selectExporting);
  dateRange$: Observable<DateRangeFilter> = this.store.select(InventorySelectors.selectDateRange);
  granularity$: Observable<string> = this.store.select(InventorySelectors.selectGranularity);
  lowStockPct$: Observable<string> = this.store.select(InventorySelectors.selectLowStockPercentage);
  outOfStockPct$: Observable<string> = this.store.select(InventorySelectors.selectOutOfStockPercentage);

  // Chart options
  movementTrendChartOptions: EChartsOption = {};
  valuationChartOptions: EChartsOption = {};
  quantityChartOptions: EChartsOption = {};

  // Filter configs
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
    this.store.dispatch(InventoryActions.loadInventorySummary());
    this.store.dispatch(InventoryActions.loadMovementTrends());
    this.store.dispatch(InventoryActions.loadValuations());

    // Sync store state → filterValues
    combineLatest([this.dateRange$, this.granularity$])
      .pipe(takeUntil(this.destroy$))
      .subscribe(([dateRange, granularity]) => {
        this.filterValues = {
          date_from: dateRange.start_date || null,
          date_to: dateRange.end_date || null,
          granularity: granularity || 'day',
        };
      });

    // Subscribe to movement trends to build trend chart
    combineLatest([this.movementTrends$, this.granularity$])
      .pipe(takeUntil(this.destroy$))
      .subscribe(([trends, granularity]) => {
        this.updateMovementTrendChart(trends, granularity);
      });

    // Subscribe to valuations for both rose charts (value + quantity)
    this.valuations$
      .pipe(takeUntil(this.destroy$))
      .subscribe((valuations) => {
        this.updateValuationChart(valuations);
        this.updateQuantityChart(valuations);
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.store.dispatch(InventoryActions.clearInventoryOverviewState());
  }

  onFilterChange(values: FilterValues): void {
    const dateFrom = values['date_from'] as string;
    const dateTo = values['date_to'] as string;
    const granularity = values['granularity'] as string;

    const currentRange = this.filterValues;
    if (dateFrom !== currentRange['date_from'] || dateTo !== currentRange['date_to']) {
      this.store.dispatch(InventoryActions.setDateRange({
        dateRange: {
          start_date: dateFrom || '',
          end_date: dateTo || '',
          preset: 'custom',
        },
      }));
    }

    if (granularity !== currentRange['granularity']) {
      this.store.dispatch(InventoryActions.setGranularity({ granularity: granularity || 'day' }));
    }
  }

  onClearAllFilters(): void {
    this.store.dispatch(InventoryActions.setDateRange({
      dateRange: {
        start_date: this.getDefaultStartDate(),
        end_date: this.getDefaultEndDate(),
        preset: 'thisMonth',
      },
    }));
    this.store.dispatch(InventoryActions.setGranularity({ granularity: 'day' }));
  }

  exportReport(): void {
    this.store.dispatch(InventoryActions.exportInventoryReport());
  }

  private getDefaultStartDate(): string {
    const date = new Date();
    date.setDate(1);
    return date.toISOString().split('T')[0];
  }

  private getDefaultEndDate(): string {
    return new Date().toISOString().split('T')[0];
  }

  private getThemeColors() {
    const style = getComputedStyle(document.documentElement);
    return {
      border: style.getPropertyValue('--color-border').trim() || '#e5e7eb',
      textSecondary: style.getPropertyValue('--color-text-secondary').trim() || '#6b7280',
    };
  }

  // ─── Movement Trend Chart (Line + Area) ───

  private updateMovementTrendChart(trends: MovementTrend[], granularity: string): void {
    if (!trends.length) return;

    const { border, textSecondary } = this.getThemeColors();
    const labels = trends.map((t) => this.formatPeriodLabel(t.period, granularity));

    const colors = {
      in: '#22c55e',
      out: '#ef4444',
      adjustments: '#f59e0b',
      transfers: '#3b82f6',
    };

    this.movementTrendChartOptions = {
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          let html = `${params[0].name}<br/>`;
          for (const p of params) {
            html += `${p.marker} ${p.seriesName}: <b>${p.value}</b><br/>`;
          }
          return html;
        },
      },
      legend: {
        data: ['Entradas', 'Salidas', 'Ajustes', 'Transferencias'],
        bottom: 0,
        textStyle: { color: textSecondary, fontSize: 12 },
      },
      grid: { left: '3%', right: '4%', bottom: '15%', containLabel: true },
      xAxis: {
        type: 'category',
        data: labels,
        axisLine: { lineStyle: { color: border } },
        axisLabel: { color: textSecondary },
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisLabel: { color: textSecondary },
        splitLine: { lineStyle: { color: border } },
      },
      series: [
        this.buildLineSeries('Entradas', trends.map((t) => t.stock_in), colors.in),
        this.buildLineSeries('Salidas', trends.map((t) => t.stock_out), colors.out),
        this.buildLineSeries('Ajustes', trends.map((t) => t.adjustments), colors.adjustments),
        this.buildLineSeries('Transferencias', trends.map((t) => t.transfers), colors.transfers),
      ],
    };
  }

  private buildLineSeries(name: string, data: number[], color: string): any {
    return {
      name,
      type: 'line',
      smooth: true,
      data,
      areaStyle: {
        color: {
          type: 'linear',
          x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: `${color}33` },
            { offset: 1, color: `${color}05` },
          ],
        },
      },
      lineStyle: { color, width: 2 },
      itemStyle: { color },
    };
  }

  // ─── Valuation by Location Rose Chart ───

  private updateValuationChart(valuations: InventoryValuation[]): void {
    if (!valuations.length) return;

    const { textSecondary } = this.getThemeColors();
    const sorted = [...valuations].sort((a, b) => b.total_value - a.total_value).slice(0, 10);

    const locationColors = ['#3b82f6', '#8b5cf6', '#06b6d4', '#f59e0b', '#ec4899', '#10b981', '#f97316', '#6366f1', '#14b8a6', '#e11d48'];

    this.valuationChartOptions = {
      tooltip: {
        trigger: 'item',
        formatter: (params: any) =>
          `${params.name}<br/>Valor: <b>${this.currencyService.format(params.value)}</b> (${params.percent}%)`,
      },
      legend: {
        orient: 'vertical',
        right: 10,
        top: 'center',
        textStyle: { color: textSecondary, fontSize: 12 },
      },
      series: [
        {
          type: 'pie',
          roseType: 'area',
          radius: ['20%', '75%'],
          center: ['35%', '50%'],
          label: { show: false },
          data: sorted.map((v, i) => ({
            name: v.location_name,
            value: v.total_value,
            itemStyle: { color: locationColors[i % locationColors.length] },
          })),
        },
      ],
    };
  }

  // ─── Quantity by Location Rose Chart ───

  private updateQuantityChart(valuations: InventoryValuation[]): void {
    if (!valuations.length) return;

    const { textSecondary } = this.getThemeColors();
    const sorted = [...valuations].sort((a, b) => b.total_quantity - a.total_quantity).slice(0, 10);

    const locationColors = ['#3b82f6', '#8b5cf6', '#06b6d4', '#f59e0b', '#ec4899', '#10b981', '#f97316', '#6366f1', '#14b8a6', '#e11d48'];

    this.quantityChartOptions = {
      tooltip: {
        trigger: 'item',
        formatter: (params: any) =>
          `${params.name}<br/>Cantidad: <b>${params.value.toLocaleString('es-CO')}</b> uds (${params.percent}%)`,
      },
      legend: {
        orient: 'vertical',
        right: 10,
        top: 'center',
        textStyle: { color: textSecondary, fontSize: 12 },
      },
      series: [
        {
          type: 'pie',
          roseType: 'area',
          radius: ['20%', '75%'],
          center: ['35%', '50%'],
          label: { show: false },
          data: sorted.map((v, i) => ({
            name: v.location_name,
            value: v.total_quantity,
            itemStyle: { color: locationColors[i % locationColors.length] },
          })),
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
    try {
      const date = new Date(period);
      return date.toLocaleDateString('es', { day: '2-digit', month: 'short' });
    } catch {
      return period;
    }
  }
}
