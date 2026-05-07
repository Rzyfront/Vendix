import {Component, OnInit, OnDestroy, inject, signal,
  DestroyRef} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Store } from '@ngrx/store';
import { Observable, combineLatest } from 'rxjs';
import { toSignal , takeUntilDestroyed} from '@angular/core/rxjs-interop';

import { CardComponent } from '../../../../../../../shared/components/card/card.component';
import { StatsComponent } from '../../../../../../../shared/components/stats/stats.component';
import { ChartComponent } from '../../../../../../../shared/components/chart/chart.component';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import {
  CurrencyPipe,
  CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { ExportButtonComponent } from '../../../components/export-button/export-button.component';
import { DateRangeFilter } from '../../../interfaces/analytics.interface';
import {
  InventorySummary,
  MovementTrend,
  InventoryValuation } from '../../../interfaces/inventory-analytics.interface';

import * as InventoryActions from './state/inventory-overview.actions';
import * as InventorySelectors from './state/inventory-overview.selectors';

import { EChartsOption } from 'echarts';
import { getDefaultStartDate, getDefaultEndDate, formatChartPeriod } from '../../../../../../../shared/utils/date.util';
import { AnalyticsCardComponent } from '../../../components/analytics-card/analytics-card.component';
import { getViewsByCategory, AnalyticsView } from '../../../config/analytics-registry';

@Component({
  selector: 'vendix-inventory-overview',
  standalone: true,
  imports: [
    CommonModule,
    CardComponent,
    StatsComponent,
    ChartComponent,
    IconComponent,
    ExportButtonComponent,
    CurrencyPipe,
    AnalyticsCardComponent,
  ],
  templateUrl: './inventory-overview.component.html',
  styleUrls: ['./inventory-overview.component.scss'] })
export class InventoryOverviewComponent implements OnInit, OnDestroy {
  private destroyRef = inject(DestroyRef);
  private store = inject(Store);
  private currencyService = inject(CurrencyFormatService);
// Observables from store
  summary$: Observable<InventorySummary | null> = this.store.select(
    InventorySelectors.selectSummary,
  );
  movementTrends$: Observable<MovementTrend[]> = this.store.select(
    InventorySelectors.selectMovementTrends,
  );
  valuations$: Observable<InventoryValuation[]> = this.store.select(
    InventorySelectors.selectValuations,
  );
  loading$: Observable<boolean> = this.store.select(
    InventorySelectors.selectLoading,
  );
  loadingTrends$: Observable<boolean> = this.store.select(
    InventorySelectors.selectLoadingTrends,
  );
  loadingValuation$: Observable<boolean> = this.store.select(
    InventorySelectors.selectLoadingValuation,
  );
  exporting$: Observable<boolean> = this.store.select(
    InventorySelectors.selectExporting,
  );
  dateRange$: Observable<DateRangeFilter> = this.store.select(
    InventorySelectors.selectDateRange,
  );
  granularity$: Observable<string> = this.store.select(
    InventorySelectors.selectGranularity,
  );
  lowStockPct$: Observable<string> = this.store.select(
    InventorySelectors.selectLowStockPercentage,
  );
  outOfStockPct$: Observable<string> = this.store.select(
    InventorySelectors.selectOutOfStockPercentage,
  );

  readonly summary = toSignal(this.summary$, { initialValue: null });
  readonly loading = toSignal(this.loading$, { initialValue: false });
  readonly loadingTrends = toSignal(this.loadingTrends$, { initialValue: false });
  readonly loadingValuation = toSignal(this.loadingValuation$, { initialValue: false });
  readonly exporting = toSignal(this.exporting$, { initialValue: false });
  readonly lowStockPct = toSignal(this.lowStockPct$, { initialValue: '0' });
  readonly outOfStockPct = toSignal(this.outOfStockPct$, { initialValue: '0' });

  // Chart options
  movementTrendChartOptions = signal<EChartsOption>({});
  valuationChartOptions = signal<EChartsOption>({});
  quantityChartOptions = signal<EChartsOption>({});

  readonly inventoryViews: AnalyticsView[] = getViewsByCategory('inventory');

  ngOnInit(): void {
    this.currencyService.loadCurrency();

    // Dispatch initial loads
    this.store.dispatch(InventoryActions.loadInventorySummary());
    this.store.dispatch(InventoryActions.loadMovementTrends());
    this.store.dispatch(InventoryActions.loadValuations());

    // Subscribe to movement trends to build trend chart
    combineLatest([this.movementTrends$, this.granularity$])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([trends, granularity]) => {
        this.updateMovementTrendChart(trends, granularity);
      });

    // Subscribe to valuations for both rose charts (value + quantity)
    this.valuations$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((valuations) => {
      this.updateValuationChart(valuations);
      this.updateQuantityChart(valuations);
    });
  }

  ngOnDestroy(): void {

this.store.dispatch(InventoryActions.clearInventoryOverviewState());
  }

  exportReport(): void {
    this.store.dispatch(InventoryActions.exportInventoryReport());
  }

  private getThemeColors() {
    const style = getComputedStyle(document.documentElement);
    return {
      border: style.getPropertyValue('--color-border').trim() || '#e5e7eb',
      textSecondary:
        style.getPropertyValue('--color-text-secondary').trim() || '#6b7280' };
  }

  // ─── Movement Trend Chart (Line + Area) ───

  private updateMovementTrendChart(
    trends: MovementTrend[],
    granularity: string,
  ): void {

    const { border, textSecondary } = this.getThemeColors();
    const labels = trends.map((t) =>
      formatChartPeriod(t.period, granularity),
    );

    const colors = {
      in: '#22c55e',
      out: '#ef4444',
      adjustments: '#f59e0b',
      transfers: '#3b82f6' };

    this.movementTrendChartOptions.set({
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          let html = `${params[0].name}<br/>`;
          for (const p of params) {
            html += `${p.marker} ${p.seriesName}: <b>${p.value}</b><br/>`;
          }
          return html;
        } },
      legend: {
        data: ['Entradas', 'Salidas', 'Ajustes', 'Transferencias'],
        bottom: 30,
        textStyle: { color: textSecondary, fontSize: 12 } },
      grid: { left: '3%', right: '4%', bottom: '20%', containLabel: true },
      xAxis: {
        type: 'category',
        data: labels,
        axisLine: { lineStyle: { color: border } },
        axisLabel: { color: textSecondary } },
      yAxis: {
        type: 'value',
        min: 0,
        max: 100,
        splitNumber: 5,
        axisLine: { show: false },
        axisLabel: { color: textSecondary },
        splitLine: { lineStyle: { color: border } } },
      series: [
        this.buildLineSeries(
          'Entradas',
          trends.map((t) => t.stock_in),
          colors.in,
        ),
        this.buildLineSeries(
          'Salidas',
          trends.map((t) => t.stock_out),
          colors.out,
        ),
        this.buildLineSeries(
          'Ajustes',
          trends.map((t) => t.adjustments),
          colors.adjustments,
        ),
        this.buildLineSeries(
          'Transferencias',
          trends.map((t) => t.transfers),
          colors.transfers,
        ),
      ] });
  }

private buildLineSeries(name: string, data: number[], color: string): any {
    return {
      name,
      type: 'line',
      data,
      areaStyle: {
        color: {
          type: 'linear',
          x: 0,
          y: 0,
          x2: 0,
          y2: 1,
          colorStops: [
            { offset: 0, color: `${color}4D` },
            { offset: 1, color: `${color}0D` },
          ],
        },
      },
      lineStyle: { color, width: 2 },
      itemStyle: { color },
    };
  }

  // ─── Valuation by Location Rose Chart ───

  private updateValuationChart(valuations: InventoryValuation[]): void {

    const { textSecondary, border } = this.getThemeColors();
    const sorted = [...valuations]
      .sort((a, b) => b.total_value - a.total_value)
      .slice(0, 10);

    const locationColors = [
      '#3b82f6',
      '#8b5cf6',
      '#06b6d4',
      '#f59e0b',
      '#ec4899',
      '#10b981',
      '#f97316',
      '#6366f1',
      '#14b8a6',
      '#e11d48',
    ];

    this.valuationChartOptions.set({
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          const p = params[0];
          return `${p.name}<br/>Valor: <b>${this.currencyService.format(p.value)}</b>`;
        },
      },
      legend: {
        data: ['Valor'],
        bottom: 30,
        textStyle: { color: textSecondary },
      },
      grid: { left: '3%', right: '4%', bottom: '20%', top: '3%', containLabel: true },
      xAxis: {
        type: 'category',
        data: sorted.map((v) => v.location_name),
        axisLine: { lineStyle: { color: border } },
        axisLabel: { color: textSecondary, fontSize: 11 },
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: 1000000,
        splitNumber: 5,
        axisLine: { show: false },
        axisLabel: { color: textSecondary, fontSize: 11, formatter: (v: number) => this.currencyService.format(Math.round(v), 0) },
        splitLine: { lineStyle: { color: border } },
      },
      series: [
        {
          name: 'Valor',
          type: 'line',
          data: sorted.map((v) => v.total_value),
          itemStyle: { color: '#3b82f6' },
          lineStyle: { color: '#3b82f6', width: 2 },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: '#3b82f64D' },
                { offset: 1, color: '#3b82f60D' },
              ],
            },
          },
        },
      ],
    });
  }

  // ─── Quantity by Location Bar Chart ───

  private updateQuantityChart(valuations: InventoryValuation[]): void {

    const { textSecondary, border } = this.getThemeColors();
    const sorted = [...valuations]
      .sort((a, b) => b.total_quantity - a.total_quantity)
      .slice(0, 10);

    const locationColors = [
      '#3b82f6',
      '#8b5cf6',
      '#06b6d4',
      '#f59e0b',
      '#ec4899',
      '#10b981',
      '#f97316',
      '#6366f1',
      '#14b8a6',
      '#e11d48',
    ];

    this.quantityChartOptions.set({
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          const p = params[0];
          return `${p.name}<br/>Cantidad: <b>${p.value.toLocaleString('es-CO')}</b> uds`;
        },
      },
      legend: {
        data: ['Cantidad'],
        bottom: 30,
        textStyle: { color: textSecondary },
      },
      grid: { left: '3%', right: '4%', bottom: '20%', top: '3%', containLabel: true },
      xAxis: {
        type: 'category',
        data: sorted.map((v) => v.location_name),
        axisLine: { lineStyle: { color: border } },
        axisLabel: { color: textSecondary, fontSize: 11 },
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: 100,
        splitNumber: 5,
        axisLine: { show: false },
        axisLabel: { color: textSecondary, fontSize: 11 },
        splitLine: { lineStyle: { color: border } },
      },
      series: [
        {
          name: 'Cantidad',
          type: 'line',
          data: sorted.map((v) => v.total_quantity),
          itemStyle: { color: '#8b5cf6' },
          lineStyle: { color: '#8b5cf6', width: 2 },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: '#8b5cf64D' },
                { offset: 1, color: '#8b5cf60D' },
              ],
            },
          },
        },
      ],
    });
  }
}
