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

import { DateRangeFilter } from '../../../interfaces/analytics.interface';
import { OverviewSummary, OverviewTrend } from '../../../interfaces/overview-analytics.interface';

import * as OverviewActions from '../state/overview-summary.actions';
import * as OverviewSelectors from '../state/overview-summary.selectors';

import { EChartsOption } from 'echarts';

@Component({
  selector: 'vendix-overview-summary',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    StatsComponent,
    ChartComponent,
    IconComponent,
    OptionsDropdownComponent,
    CurrencyPipe,
  ],
  templateUrl: './overview-summary.component.html',
  styleUrls: ['./overview-summary.component.scss'],
})
export class OverviewSummaryComponent implements OnInit, OnDestroy {
  private store = inject(Store);
  private currencyService = inject(CurrencyFormatService);
  private destroy$ = new Subject<void>();

  // Observables from store
  summary$: Observable<OverviewSummary | null> = this.store.select(OverviewSelectors.selectSummary);
  trends$: Observable<OverviewTrend[]> = this.store.select(OverviewSelectors.selectTrends);
  loading$: Observable<boolean> = this.store.select(OverviewSelectors.selectLoading);
  loadingTrends$: Observable<boolean> = this.store.select(OverviewSelectors.selectLoadingTrends);
  dateRange$: Observable<DateRangeFilter> = this.store.select(OverviewSelectors.selectDateRange);
  granularity$: Observable<string> = this.store.select(OverviewSelectors.selectGranularity);

  // Chart options
  gaugeChartOptions: EChartsOption = {};
  comparativeChartOptions: EChartsOption = {};

  // Cached summary for template helper methods
  private currentSummary: OverviewSummary | null = null;

  // Filter config (no channel — overview is cross-channel)
  filterConfigs: FilterConfig[] = [
    {
      key: 'date_from',
      label: 'Desde',
      type: 'date',
    },
    {
      key: 'date_to',
      label: 'Hasta',
      type: 'date',
    },
    {
      key: 'granularity',
      label: 'Granularidad',
      type: 'select',
      options: [
        { value: 'hour', label: 'Por Hora' },
        { value: 'day', label: 'Por Dia' },
        { value: 'week', label: 'Por Semana' },
        { value: 'month', label: 'Por Mes' },
        { value: 'year', label: 'Por Ano' },
      ],
      placeholder: 'Seleccionar',
    },
  ];

  filterValues: FilterValues = {};

  ngOnInit(): void {
    this.currencyService.loadCurrency();

    // Dispatch initial loads
    this.store.dispatch(OverviewActions.loadOverviewSummary());
    this.store.dispatch(OverviewActions.loadOverviewTrends());

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

    // Cache summary for template helpers
    this.summary$
      .pipe(takeUntil(this.destroy$))
      .subscribe((summary) => {
        this.currentSummary = summary;
        if (summary) {
          this.updateGaugeChart(summary.breakeven_ratio);
        }
      });

    // Subscribe to trends to build comparative chart
    combineLatest([this.trends$, this.granularity$])
      .pipe(takeUntil(this.destroy$))
      .subscribe(([trends, granularity]) => {
        this.updateComparativeChart(trends, granularity);
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.store.dispatch(OverviewActions.clearOverviewSummaryState());
  }

  onFilterChange(values: FilterValues): void {
    const dateFrom = values['date_from'] as string;
    const dateTo = values['date_to'] as string;
    const granularity = values['granularity'] as string;

    const currentRange = this.filterValues;
    if (dateFrom !== currentRange['date_from'] || dateTo !== currentRange['date_to']) {
      this.store.dispatch(OverviewActions.setDateRange({
        dateRange: {
          start_date: dateFrom || '',
          end_date: dateTo || '',
          preset: 'custom',
        },
      }));
    }

    if (granularity !== currentRange['granularity']) {
      this.store.dispatch(OverviewActions.setGranularity({ granularity: granularity || 'day' }));
    }
  }

  onClearAllFilters(): void {
    this.store.dispatch(OverviewActions.setDateRange({
      dateRange: {
        start_date: this.getDefaultStartDate(),
        end_date: this.getDefaultEndDate(),
        preset: 'thisMonth',
      },
    }));
    this.store.dispatch(OverviewActions.setGranularity({ granularity: 'day' }));
  }

  // Template helpers
  getGrowthText(growth?: number): string {
    if (growth === undefined || growth === null) return '';
    const sign = growth >= 0 ? '+' : '';
    return `${sign}${growth.toFixed(1)}% vs periodo anterior`;
  }

  formatBreakevenRatio(ratio?: number): string {
    if (ratio === undefined || ratio === null) return '0%';
    return `${ratio.toFixed(1)}%`;
  }

  getBreakevenLabel(ratio?: number): string {
    if (!ratio) return 'Sin datos';
    if (ratio < 70) return 'Margen saludable';
    if (ratio < 90) return 'Margen ajustado';
    return 'Margen critico';
  }

  getBreakevenBgColor(ratio?: number): string {
    if (!ratio || ratio < 70) return 'bg-green-100';
    if (ratio < 90) return 'bg-yellow-100';
    return 'bg-red-100';
  }

  getBreakevenTextColor(ratio?: number): string {
    if (!ratio || ratio < 70) return 'text-green-600';
    if (ratio < 90) return 'text-yellow-600';
    return 'text-red-600';
  }

  getBreakevenStatusText(ratio?: number): string {
    if (!ratio) return 'Registra ingresos y gastos para ver el estado de tu negocio.';
    if (ratio < 70) {
      return `Tu negocio opera con un margen saludable. Solo el ${ratio.toFixed(1)}% de tus ingresos se destina a cubrir gastos.`;
    }
    if (ratio < 90) {
      return `Tus gastos representan el ${ratio.toFixed(1)}% de tus ingresos. Considera optimizar costos para mejorar el margen.`;
    }
    return `Atención: tus gastos representan el ${ratio.toFixed(1)}% de tus ingresos. Revisa tu estructura de costos.`;
  }

  // Chart builders
  private updateGaugeChart(ratio: number): void {
    this.gaugeChartOptions = {
      series: [
        {
          type: 'gauge',
          center: ['50%', '65%'],
          radius: '90%',
          startAngle: 180,
          endAngle: 0,
          min: 0,
          max: 150,
          splitNumber: 3,
          pointer: {
            show: true,
            length: '60%',
            width: 6,
            itemStyle: {
              color: 'auto',
            },
          },
          axisLine: {
            lineStyle: {
              width: 20,
              color: [
                [0.467, '#22c55e'],  // 0-70%: green
                [0.6, '#eab308'],    // 70-90%: yellow
                [1, '#ef4444'],      // 90-150%: red
              ],
            },
          },
          axisTick: { show: false },
          splitLine: {
            length: 12,
            lineStyle: { width: 2, color: '#999' },
          },
          axisLabel: {
            distance: 25,
            fontSize: 11,
            formatter: (value: number) => `${value}%`,
          },
          detail: {
            valueAnimation: true,
            formatter: (value: number) => `${value.toFixed(1)}%`,
            fontSize: 20,
            fontWeight: 'bold',
            offsetCenter: [0, '20%'],
            color: ratio < 70 ? '#22c55e' : ratio < 90 ? '#eab308' : '#ef4444',
          },
          data: [{ value: Math.min(ratio, 150) }],
        },
      ],
    };
  }

  private updateComparativeChart(trends: OverviewTrend[], granularity: string): void {
    if (!trends.length) return;

    const style = getComputedStyle(document.documentElement);
    const borderColor = style.getPropertyValue('--color-border').trim() || '#e5e7eb';
    const textSecondary = style.getPropertyValue('--color-text-secondary').trim() || '#6b7280';

    const labels = trends.map((t) => this.formatPeriodLabel(t.period, granularity));

    this.comparativeChartOptions = {
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          let html = `<strong>${params[0].name}</strong><br/>`;
          for (const p of params) {
            html += `${p.marker} ${p.seriesName}: ${this.currencyService.format(p.value)}<br/>`;
          }
          return html;
        },
      },
      legend: {
        data: ['Ventas', 'Gastos', 'Impuestos', 'Rend. Bruto', 'Rend. Neto'],
        bottom: 0,
        textStyle: { color: textSecondary },
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '15%',
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
          name: 'Ventas',
          type: 'line',
          smooth: true,
          data: trends.map((t) => t.sales),
          lineStyle: { color: '#22c55e', width: 2 },
          itemStyle: { color: '#22c55e' },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: '#22c55e4D' },
                { offset: 1, color: '#22c55e0D' },
              ],
            },
          },
        },
        {
          name: 'Gastos',
          type: 'line',
          smooth: true,
          data: trends.map((t) => t.expenses),
          lineStyle: { color: '#ef4444', width: 2 },
          itemStyle: { color: '#ef4444' },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: '#ef44444D' },
                { offset: 1, color: '#ef44440D' },
              ],
            },
          },
        },
        {
          name: 'Impuestos',
          type: 'line',
          smooth: true,
          data: trends.map((t) => t.taxes),
          lineStyle: { color: '#f59e0b', width: 2 },
          itemStyle: { color: '#f59e0b' },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: '#f59e0b4D' },
                { offset: 1, color: '#f59e0b0D' },
              ],
            },
          },
        },
        {
          name: 'Rend. Bruto',
          type: 'line',
          smooth: true,
          data: trends.map((t) => t.gross_profit),
          lineStyle: { color: '#3b82f6', width: 2 },
          itemStyle: { color: '#3b82f6' },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: '#3b82f64D' },
                { offset: 1, color: '#3b82f60D' },
              ],
            },
          },
        },
        {
          name: 'Rend. Neto',
          type: 'line',
          smooth: true,
          data: trends.map((t) => t.net_profit),
          lineStyle: { color: '#8b5cf6', width: 2 },
          itemStyle: { color: '#8b5cf6' },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: '#8b5cf64D' },
                { offset: 1, color: '#8b5cf60D' },
              ],
            },
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
    try {
      const date = new Date(period);
      return date.toLocaleDateString('es', { day: '2-digit', month: 'short' });
    } catch {
      return period;
    }
  }

  private getDefaultStartDate(): string {
    const date = new Date();
    date.setDate(1);
    return date.toISOString().split('T')[0];
  }

  private getDefaultEndDate(): string {
    return new Date().toISOString().split('T')[0];
  }
}
