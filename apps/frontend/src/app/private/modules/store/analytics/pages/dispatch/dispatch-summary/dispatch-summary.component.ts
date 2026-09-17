import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { forkJoin } from 'rxjs';
import type { EChartsOption } from 'echarts';

import {
  CardComponent,
  ChartComponent,
  IconComponent,
  StatsComponent,
} from '../../../../../../../shared/components';
import { CurrencyPipe, CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';
import { OptionsDropdownComponent } from '../../../../../../../shared/components/options-dropdown/options-dropdown.component';
import {
  DropdownAction,
  FilterConfig,
  FilterValues,
} from '../../../../../../../shared/components/options-dropdown/options-dropdown.interfaces';
import {
  getDefaultStartDate,
  getDefaultEndDate,
  formatChartPeriod,
} from '../../../../../../../shared/utils/date.util';
import { truncateLabel } from '../../../../../../../shared/utils/chart-labels.util';

import { AnalyticsService } from '../../../services/analytics.service';
import {
  DispatchSummary,
  DispatchTrends,
  DispatchRouteType,
} from '../../../interfaces/dispatch-analytics.interface';
import { DateRangeFilter } from '../../../interfaces/analytics.interface';
import { getViewsByCategory, AnalyticsView } from '../../../config/analytics-registry';
import { AnalyticsCardComponent } from '../../../components/analytics-card/analytics-card.component';
import { queryParamsToDateRange } from '../../../../shared/utils/date-range-params.util';

const ROUTE_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'dsd', label: 'Planillas DSD' },
  { value: 'carrier', label: 'Repartidor' },
];

/**
 * "Resumen de Despachos" — vista 1 de la categoría Despachos
 * (PLAN-analytics-despachos-2026-09-12, paso 5). Molde:
 * `inventory-low-stock-by-supplier` (signals puros, OnPush, sin NgRx,
 * `takeUntilDestroyed`, `toastService.error()` en el error).
 *
 * Combina DOS endpoints (`dispatch/summary` para los KPIs, `dispatch/trends`
 * para las series) porque son dos concerns reales del mismo tablero — no
 * confundir con el "envelope único" del molde, que se refiere a no repartir
 * el estado entre reducers NgRx.
 */
@Component({
  selector: 'vendix-dispatch-summary',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    CardComponent,
    ChartComponent,
    CurrencyPipe,
    IconComponent,
    StatsComponent,
    AnalyticsCardComponent,
    OptionsDropdownComponent,
  ],
  templateUrl: './dispatch-summary.component.html',
  styles: [
    `
      :host {
        display: block;
        margin: -16px;
        @media (min-width: 768px) { margin: -24px; }
      }
      :host ::ng-deep .stats-container { padding: 0; margin: 0; margin-bottom: 0; }
    `,
  ],
})
export class DispatchSummaryComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly analyticsService = inject(AnalyticsService);
  private readonly toastService = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly currencyService = inject(CurrencyFormatService);

  readonly dateRange = signal<DateRangeFilter>({
    start_date: getDefaultStartDate(),
    end_date: getDefaultEndDate(),
    preset: 'thisMonth',
  });
  readonly routeType = signal<DispatchRouteType>('all');

  readonly summary = signal<DispatchSummary | null>(null);
  readonly trends = signal<DispatchTrends | null>(null);
  readonly loading = signal<boolean>(false);

  readonly deliveriesChartOptions = signal<EChartsOption>({});
  readonly deliveredValueChartOptions = signal<EChartsOption>({});

  readonly dispatchViews: AnalyticsView[] = getViewsByCategory('dispatch').filter(
    (v) => v.key !== 'dispatch_summary',
  );

  constructor() {
    const urlRange = queryParamsToDateRange(this.route.snapshot.queryParamMap);
    if (urlRange) {
      this.dateRange.set(urlRange);
    }
    this.refresh();
  }

  refresh(): void {
    const query = {
      date_range: this.dateRange(),
      route_type: this.routeType(),
    };

    this.loading.set(true);
    forkJoin({
      summary: this.analyticsService.getDispatchSummary(query),
      trends: this.analyticsService.getDispatchTrends(query),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ summary, trends }) => {
          this.summary.set(summary.data ?? null);
          this.trends.set(trends.data ?? null);
          if (trends.data) {
            this.updateCharts(trends.data);
          }
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.toastService.error('No se pudo cargar el resumen de despachos.');
        },
      });
  }

  // ─── Filters ───────────────────────────────────────────────────────────────

  readonly filterConfigs: FilterConfig[] = [
    { key: 'date_range', type: 'date-range', label: 'Período' },
    {
      key: 'route_type',
      type: 'select',
      label: 'Tipo de ruta',
      options: ROUTE_TYPE_OPTIONS,
      placeholder: 'Todas',
    },
  ];

  readonly filterValues = computed<FilterValues>(() => {
    const range = this.dateRange();
    return {
      date_range_start: range.start_date || null,
      date_range_end: range.end_date || null,
      date_range_preset: range.preset || null,
      route_type: this.routeType(),
    };
  });

  readonly dropdownActions: DropdownAction[] = [];

  onFilterChange(values: FilterValues): void {
    const start = values['date_range_start'] as string;
    const end = values['date_range_end'] as string;
    const preset = values['date_range_preset'] as string;
    if (start && end) {
      this.dateRange.set({
        start_date: start,
        end_date: end,
        preset: (preset || 'custom') as DateRangeFilter['preset'],
      });
    }
    const routeType = values['route_type'] as DispatchRouteType | null;
    this.routeType.set(routeType || 'all');
    this.refresh();
  }

  onClearAllFilters(): void {
    this.dateRange.set({
      start_date: getDefaultStartDate(),
      end_date: getDefaultEndDate(),
      preset: 'thisMonth',
    });
    this.routeType.set('all');
    this.refresh();
  }

  // ─── Display helpers ───────────────────────────────────────────────────────

  /**
   * `null` means the previous period had no base to compare against. "0%"
   * there would assert "no change" about a period that had nothing.
   */
  getGrowthText(growth: number | null | undefined): string {
    if (growth === undefined || growth === null) {
      return 'sin base de comparación';
    }
    const sign = growth >= 0 ? '+' : '';
    return `${sign}${growth.toFixed(1)}% vs periodo anterior`;
  }

  formatRate(rate: number | null | undefined): string {
    return `${Number(rate ?? 0).toFixed(1)}%`;
  }

  formatCycleHours(): string {
    const hours = this.summary()?.avg_cycle_hours;
    return hours === null || hours === undefined ? 'Ciclo sin datos' : `Ciclo prom. ${hours.toFixed(1)} h`;
  }

  formatAvgStops(): string {
    const stops = this.summary()?.avg_stops_per_route ?? 0;
    return `${stops.toFixed(1)} paradas/ruta`;
  }

  // ─── Charts ────────────────────────────────────────────────────────────────

  private getThemeColors() {
    const style =
      typeof document !== 'undefined'
        ? getComputedStyle(document.documentElement)
        : null;
    return {
      border: style?.getPropertyValue('--color-border').trim() || '#e5e7eb',
      textSecondary:
        style?.getPropertyValue('--color-text-secondary').trim() || '#6b7280',
    };
  }

  private updateCharts(trends: DispatchTrends): void {
    const { border, textSecondary } = this.getThemeColors();
    const points = trends.points ?? [];
    const labels = points.map((p) => truncateLabel(formatChartPeriod(p.period, trends.granularity), 12));

    this.deliveriesChartOptions.set({
      tooltip: { trigger: 'axis' },
      legend: {
        bottom: 0,
        data: ['Entregas', 'Rechazadas'],
        textStyle: { color: textSecondary },
      },
      grid: { left: '3%', right: '4%', bottom: '16%', top: '8%', containLabel: true },
      xAxis: {
        type: 'category',
        data: labels,
        axisLine: { lineStyle: { color: border } },
        axisLabel: { color: textSecondary },
      },
      yAxis: {
        type: 'value',
        min: 0,
        axisLine: { show: false },
        axisLabel: { color: textSecondary },
        splitLine: { lineStyle: { color: border } },
      },
      series: [
        {
          name: 'Entregas',
          type: 'line',
          smooth: true,
          symbol: 'circle',
          data: points.map((p) => p.deliveries),
          lineStyle: { color: '#22c55e' },
          itemStyle: { color: '#22c55e' },
        },
        {
          name: 'Rechazadas',
          type: 'line',
          smooth: true,
          symbol: 'circle',
          data: points.map((p) => p.rejected),
          lineStyle: { color: '#ef4444' },
          itemStyle: { color: '#ef4444' },
        },
      ],
    });

    this.deliveredValueChartOptions.set({
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          const p = params[0];
          return `${p.name}<br/>Valor entregado: <b>${this.currencyService.format(p.value)}</b>`;
        },
      },
      grid: { left: '3%', right: '4%', bottom: '16%', top: '8%', containLabel: true },
      xAxis: {
        type: 'category',
        data: labels,
        axisLine: { lineStyle: { color: border } },
        axisLabel: { color: textSecondary },
      },
      yAxis: {
        type: 'value',
        min: 0,
        axisLine: { show: false },
        axisLabel: {
          color: textSecondary,
          formatter: (v: number) => this.currencyService.formatChartAxis(v),
        },
        splitLine: { lineStyle: { color: border } },
      },
      series: [
        {
          name: 'Valor entregado',
          type: 'bar',
          data: points.map((p) => p.delivered_value),
          itemStyle: { color: '#3b82f6' },
          barMaxWidth: 32,
        },
      ],
    });
  }
}
