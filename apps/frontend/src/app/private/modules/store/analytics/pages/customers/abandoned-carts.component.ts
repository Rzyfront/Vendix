import { Component, OnInit, OnDestroy, inject, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Store } from '@ngrx/store';
import { Observable, combineLatest } from 'rxjs';
import { toSignal, takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { ChartComponent } from '../../../../../../shared/components/chart/chart.component';
import { OptionsDropdownComponent } from '../../../../../../shared/components/options-dropdown/options-dropdown.component';
import {
  FilterConfig,
  FilterValues,
} from '../../../../../../shared/components/options-dropdown/options-dropdown.interfaces';
import {
  CurrencyPipe,
  CurrencyFormatService,
} from '../../../../../../shared/pipes/currency/currency.pipe';
import { ExportButtonComponent } from '../../components/export-button/export-button.component';

import { DateRangeFilter } from '../../interfaces/analytics.interface';
import {
  AbandonedCartsSummary,
  AbandonedCartTrend,
  AbandonedCartByReason,
} from '../../interfaces/abandoned-carts-analytics.interface';

import * as AbandonedCartsActions from './state/abandoned-carts-analytics.actions';
import * as AbandonedCartsSelectors from './state/abandoned-carts-analytics.selectors';

import { EChartsOption } from 'echarts';
import {
  getDefaultStartDate,
  getDefaultEndDate,
  formatChartPeriod,
} from '../../../../../../shared/utils/date.util';
import { AnalyticsCardComponent } from '../../components/analytics-card/analytics-card.component';
import { getViewsByCategory, AnalyticsView } from '../../config/analytics-registry';

@Component({
  selector: 'vendix-abandoned-carts',
  standalone: true,
  imports: [
    CommonModule,
    CardComponent,
    StatsComponent,
    ChartComponent,
    OptionsDropdownComponent,
    ExportButtonComponent,
    CurrencyPipe,
    AnalyticsCardComponent,
  ],
  templateUrl: './abandoned-carts.component.html',
  styleUrls: ['./abandoned-carts.component.scss'],
})
export class AbandonedCartsComponent implements OnInit, OnDestroy {
  private destroyRef = inject(DestroyRef);
  private store = inject(Store);
  private currencyService = inject(CurrencyFormatService);

  summary$: Observable<AbandonedCartsSummary | null> = this.store.select(
    AbandonedCartsSelectors.selectSummary,
  );
  trends$: Observable<AbandonedCartTrend[]> = this.store.select(
    AbandonedCartsSelectors.selectTrends,
  );
  byReason$: Observable<AbandonedCartByReason[]> = this.store.select(
    AbandonedCartsSelectors.selectByReason,
  );
  loading$: Observable<boolean> = this.store.select(
    AbandonedCartsSelectors.selectLoading,
  );
  loadingTrends$: Observable<boolean> = this.store.select(
    AbandonedCartsSelectors.selectLoadingTrends,
  );
  exporting$: Observable<boolean> = this.store.select(
    AbandonedCartsSelectors.selectExporting,
  );
  dateRange$: Observable<DateRangeFilter> = this.store.select(
    AbandonedCartsSelectors.selectDateRange,
  );
  granularity$: Observable<string> = this.store.select(
    AbandonedCartsSelectors.selectGranularity,
  );

  readonly summary = toSignal(this.summary$, { initialValue: null });
  readonly loading = toSignal(this.loading$, { initialValue: false });
  readonly loadingTrends = toSignal(this.loadingTrends$, { initialValue: false });
  readonly exporting = toSignal(this.exporting$, { initialValue: false });

  trendsChartOptions: EChartsOption = {};
  byReasonChartOptions: EChartsOption = {};
  recoveryRateChartOptions: EChartsOption = {};

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

  readonly customersViews: AnalyticsView[] = getViewsByCategory('customers');

  ngOnInit(): void {
    this.currencyService.loadCurrency();

    this.store.dispatch(AbandonedCartsActions.loadAbandonedCartsSummary());
    this.store.dispatch(AbandonedCartsActions.loadAbandonedCartsTrends());
    this.store.dispatch(AbandonedCartsActions.loadAbandonedCartsByReason());

    combineLatest([this.dateRange$, this.granularity$])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([dateRange, granularity]) => {
        this.filterValues = {
          date_from: dateRange.start_date || null,
          date_to: dateRange.end_date || null,
          granularity: granularity || 'day',
        };
      });

    combineLatest([this.trends$, this.granularity$])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([trends, granularity]) => {
        this.updateTrendsChart(trends, granularity);
        this.updateRecoveryRateChart(trends, granularity);
      });

    this.byReason$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((byReason) => {
        this.updateByReasonChart(byReason);
      });
  }

  ngOnDestroy(): void {
    this.store.dispatch(AbandonedCartsActions.clearAbandonedCartsAnalyticsState());
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
        AbandonedCartsActions.setDateRange({
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
        AbandonedCartsActions.setGranularity({ granularity: granularity || 'day' }),
      );
    }
  }

  onClearAllFilters(): void {
    this.store.dispatch(
      AbandonedCartsActions.setDateRange({
        dateRange: {
          start_date: getDefaultStartDate(),
          end_date: getDefaultEndDate(),
          preset: 'thisMonth',
        },
      }),
    );
    this.store.dispatch(
      AbandonedCartsActions.setGranularity({ granularity: 'day' }),
    );
  }

  exportReport(): void {
    this.store.dispatch(AbandonedCartsActions.exportAbandonedCartsReport());
  }

  getGrowthText(growth?: number): string {
    if (growth === undefined || growth === null) return '';
    const sign = growth >= 0 ? '+' : '';
    return `${sign}${growth.toFixed(1)}% vs período anterior`;
  }

  getAbandonmentRate(): string {
    if (!this.summary()) return '0%';
    return `${this.summary()!.abandonment_rate.toFixed(1)}%`;
  }

  getRecoveryRate(): string {
    if (!this.summary()) return '0%';
    return `${this.summary()!.recovery_rate.toFixed(1)}%`;
  }

  private updateTrendsChart(trends: AbandonedCartTrend[], granularity: string): void {
    if (!trends.length) return;

    const style = getComputedStyle(document.documentElement);
    const primaryColor = '#ef4444';
    const secondaryColor = '#22c55e';
    const borderColor = style.getPropertyValue('--color-border').trim() || '#e5e7eb';
    const textSecondary = style.getPropertyValue('--color-text-secondary').trim() || '#6b7280';

    const labels = trends.map((t) => formatChartPeriod(t.period, granularity));
    const abandonedCarts = trends.map((t) => t.abandoned_carts);
    const recoveredCarts = trends.map((t) => t.recovered_carts);

    this.trendsChartOptions = {
      tooltip: {
        trigger: 'axis',
        confine: true,
        backgroundColor: 'rgba(255,255,255,0.98)',
        borderColor,
        borderWidth: 1,
        textStyle: { color: textSecondary, fontSize: 12 },
        formatter: (params: any) => {
          const abandoned = params[0];
          const recovered = params[1];
          const total = abandoned.value + (recovered?.value || 0);
          const recoveryPct = total > 0 ? ((recovered?.value || 0) / total * 100).toFixed(1) : '0';
          return `
            <div style="padding:8px">
              <strong style="font-size:13px">${abandoned.name}</strong>
              <div style="margin-top:8px;display:flex;flex-direction:column;gap:6px">
                <div style="display:flex;align-items:center;gap:8px">
                  <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${primaryColor}"></span>
                  <span style="flex:1">Abandonados:</span>
                  <strong style="color:${primaryColor}">${abandoned.value}</strong>
                </div>
                <div style="display:flex;align-items:center;gap:8px">
                  <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${secondaryColor}"></span>
                  <span style="flex:1">Recuperados:</span>
                  <strong style="color:${secondaryColor}">${recovered?.value || 0}</strong>
                </div>
                <div style="border-top:1px solid ${borderColor};margin-top:4px;padding-top:6px;display:flex;justify-content:space-between">
                  <span style="color:#6b7280;font-size:11px">Tasa Recuperación:</span>
                  <strong style="font-size:12px">${recoveryPct}%</strong>
                </div>
              </div>
            </div>
          `;
        },
      },
      legend: {
        data: ['Abandonados', 'Recuperados'],
        bottom: 0,
        textStyle: { color: textSecondary, fontSize: 11 },
        icon: 'roundRect',
        itemWidth: 14,
        itemHeight: 8,
      },
      dataZoom: [
        { type: 'inside', start: 0, end: 100, zoomOnMouseWheel: true, moveOnMouseMove: true },
        {
          type: 'slider',
          show: true,
          bottom: 32,
          height: 25,
          borderColor: 'transparent',
          backgroundColor: 'rgba(0,0,0,0.03)',
          handleStyle: { color: primaryColor, borderColor: primaryColor },
          textStyle: { color: textSecondary, fontSize: 10 },
        },
      ],
      grid: {
        left: '3%',
        right: '4%',
        bottom: '18%',
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: labels,
        axisLine: { lineStyle: { color: borderColor } },
        axisLabel: { color: textSecondary, fontSize: 11 },
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisLabel: { color: textSecondary, fontSize: 11 },
        splitLine: { lineStyle: { color: borderColor, type: 'dashed' } },
      },
      series: [
        {
          name: 'Abandonados',
          type: 'line',
          smooth: 0.4,
          data: abandonedCarts,
          symbol: 'circle',
          symbolSize: 5,
          showSymbol: false,
          emphasis: { scale: true },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: `${primaryColor}50` },
                { offset: 1, color: `${primaryColor}05` },
              ],
            },
          },
          lineStyle: { color: primaryColor, width: 2.5 },
          itemStyle: { color: primaryColor },
        },
        {
          name: 'Recuperados',
          type: 'line',
          smooth: 0.4,
          data: recoveredCarts,
          symbol: 'circle',
          symbolSize: 5,
          showSymbol: false,
          emphasis: { scale: true },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: `${secondaryColor}50` },
                { offset: 1, color: `${secondaryColor}05` },
              ],
            },
          },
          lineStyle: { color: secondaryColor, width: 2.5 },
          itemStyle: { color: secondaryColor },
        },
      ],
    };
  }

  private updateByReasonChart(byReason: AbandonedCartByReason[]): void {
    if (!byReason.length) return;

    const style = getComputedStyle(document.documentElement);
    const borderColor = style.getPropertyValue('--color-border').trim() || '#e5e7eb';
    const textSecondary = style.getPropertyValue('--color-text-secondary').trim() || '#6b7280';
    const primaryColor = '#f59e0b';

    const reasons = byReason.map((r) => r.reason);
    const counts = byReason.map((r) => r.count);

    this.byReasonChartOptions = {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        confine: true,
        backgroundColor: 'rgba(255,255,255,0.98)',
        borderColor,
        borderWidth: 1,
        textStyle: { color: textSecondary, fontSize: 12 },
        formatter: (params: any) => {
          const data = params[0];
          const reason = byReason[data.dataIndex];
          return `
            <div style="padding:8px">
              <strong style="font-size:13px">${data.name}</strong>
              <div style="margin-top:8px;display:flex;flex-direction:column;gap:4px">
                <div style="display:flex;justify-content:space-between;gap:16px">
                  <span>Cantidad:</span>
                  <strong>${data.value}</strong>
                </div>
                <div style="display:flex;justify-content:space-between;gap:16px">
                  <span>Valor Total:</span>
                  <strong>${this.currencyService.format(reason.total_value)}</strong>
                </div>
                <div style="display:flex;justify-content:space-between;gap:16px">
                  <span>Porcentaje:</span>
                  <strong>${reason.percentage.toFixed(1)}%</strong>
                </div>
              </div>
            </div>
          `;
        },
      },
      grid: {
        left: '3%',
        right: '6%',
        bottom: '15%',
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: reasons,
        axisLine: { lineStyle: { color: borderColor } },
        axisLabel: {
          color: textSecondary,
          fontSize: 11,
          rotate: 0,
          interval: 0,
        },
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisLabel: { color: textSecondary, fontSize: 11 },
        splitLine: { lineStyle: { color: borderColor, type: 'dashed' } },
      },
      series: [
        {
          name: 'Cantidad',
          type: 'bar',
          data: counts,
          itemStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: primaryColor },
                { offset: 1, color: `${primaryColor}60` },
              ],
            },
            borderRadius: [4, 4, 0, 0],
          },
          barMaxWidth: 50,
          emphasis: {
            itemStyle: {
              shadowBlur: 8,
              shadowColor: `${primaryColor}40`,
            },
          },
        },
      ],
    };
  }

  private updateRecoveryRateChart(trends: AbandonedCartTrend[], granularity: string): void {
    if (!trends.length) return;

    const style = getComputedStyle(document.documentElement);
    const primaryColor = '#22c55e';
    const borderColor = style.getPropertyValue('--color-border').trim() || '#e5e7eb';
    const textSecondary = style.getPropertyValue('--color-text-secondary').trim() || '#6b7280';

    const labels = trends.map((t) => formatChartPeriod(t.period, granularity));
    const recoveryRates = trends.map((t) => t.recovery_rate);

    this.recoveryRateChartOptions = {
      tooltip: {
        trigger: 'axis',
        confine: true,
        backgroundColor: 'rgba(255,255,255,0.98)',
        borderColor,
        borderWidth: 1,
        textStyle: { color: textSecondary, fontSize: 12 },
        formatter: (params: any) => {
          const data = params[0];
          return `
            <div style="padding:8px">
              <strong style="font-size:13px">${data.name}</strong>
              <div style="margin-top:8px;display:flex;align-items:center;gap:8px">
                <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${primaryColor}"></span>
                <span>Tasa Recuperación:</span>
                <strong style="color:${primaryColor};font-size:15px">${data.value.toFixed(1)}%</strong>
              </div>
            </div>
          `;
        },
      },
      dataZoom: [
        { type: 'inside', start: 0, end: 100, zoomOnMouseWheel: true, moveOnMouseMove: true },
      ],
      grid: {
        left: '3%',
        right: '4%',
        bottom: '18%',
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: labels,
        axisLine: { lineStyle: { color: borderColor } },
        axisLabel: { color: textSecondary, fontSize: 11 },
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisLabel: {
          color: textSecondary,
          fontSize: 11,
          formatter: (value: number) => `${value}%`,
        },
        splitLine: { lineStyle: { color: borderColor, type: 'dashed' } },
        max: 100,
      },
      series: [
        {
          name: 'Tasa Recuperación',
          type: 'line',
          smooth: 0.4,
          data: recoveryRates,
          symbol: 'circle',
          symbolSize: 5,
          showSymbol: false,
          emphasis: { scale: true },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: `${primaryColor}50` },
                { offset: 1, color: `${primaryColor}05` },
              ],
            },
          },
          lineStyle: { color: primaryColor, width: 2.5 },
          itemStyle: { color: primaryColor },
        },
      ],
    };
  }
}
