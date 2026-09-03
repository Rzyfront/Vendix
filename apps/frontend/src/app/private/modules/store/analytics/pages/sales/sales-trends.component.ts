import { Component, OnInit, inject, computed, signal,
  DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { RouterModule, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';


import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { ChartComponent } from '../../../../../../shared/components/chart/chart.component';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import {
  SelectorOption} from '../../../../../../shared/components/selector/selector.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';

import { AnalyticsService } from '../../services/analytics.service';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import { DateRangeFilter } from '../../interfaces/analytics.interface';
import {
  getDefaultStartDate,
  getDefaultEndDate,
  formatChartPeriod} from '../../../../../../shared/utils/date.util';
import { queryParamsToDateRange } from '../../../shared/utils/date-range-params.util';
import { compactCountAxis } from '../../../../../../shared/utils/chart-labels.util';
import {
  OptionsDropdownComponent } from '../../../../../../shared/components/options-dropdown/options-dropdown.component';
import {
  DropdownAction,
  FilterConfig,
  FilterValues } from '../../../../../../shared/components/options-dropdown/options-dropdown.interfaces';
import {
  SalesTrend,
  SalesAnalyticsQueryDto} from '../../interfaces/sales-analytics.interface';

import { EChartsOption } from 'echarts';
import { getViewsByCategory, AnalyticsView } from '../../config/analytics-registry';
import { AnalyticsCardComponent } from '../../components/analytics-card/analytics-card.component';

@Component({
  selector: 'vendix-sales-trends',
  standalone: true,
  imports: [
    RouterModule,
    FormsModule,
    CardComponent,
    ChartComponent,
    StatsComponent,
    IconComponent,
    AnalyticsCardComponent,

    OptionsDropdownComponent,],
  styles: [
    `
      :host {
        display: block;
        margin: -16px;
        @media (min-width: 768px) { margin: -24px; }
      }
      :host ::ng-deep .stats-container { padding: 0; margin: 0; margin-bottom: 0; }
      :host ::ng-deep .results-header { padding: 0.75rem 1rem; }
    `,
  ],
  template: `
    <div class="space-y-6 w-full max-w-[1600px] mx-auto py-4">
      <!-- Stats Cards -->
      <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Período"
          [value]="periodLabel()"
          iconName="calendar"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>

        <app-stats
          title="Total Órdenes"
          [value]="getTotalOrders()"
          iconName="shopping-cart"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        ></app-stats>

        <app-stats
          title="Ingresos Total"
          [value]="getTotalRevenue()"
          iconName="dollar-sign"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>

        <app-stats
          title="Ticket Promedio"
          [value]="getAvgOrder()"
          iconName=" receipt"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
        ></app-stats>
      </div>

          <app-card shadow="none" [padding]="false" overflow="hidden" [showHeader]="true">
      <div slot="header" class="results-header flex items-center justify-between gap-3 flex-wrap">
        <div class="flex items-center gap-2 min-w-0">
          <app-icon name="trending-up" [size]="20" class="shrink-0 text-[var(--color-primary)]"></app-icon>
          <span class="results-header__title text-base md:text-lg font-bold text-[var(--color-text-primary)] leading-tight whitespace-nowrap">Tendencias de Ventas</span>
        </div>
        <div class="flex items-end gap-2 flex-wrap shrink-0">
        <app-options-dropdown
                    class="shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                    [filters]="filterConfigs()"
                    [filterValues]="dropdownFilterValues()"
                    [actions]="dropdownActions()"
                    [showActions]="true"
                    triggerLabel="Acciones"
                    triggerIcon="plus"
                    [debounceMs]="350"
                    [isLoading]="exporting()"
                    (filterChange)="onFiltersDropdownChange($event)"
                    (clearAllFilters)="onClearAllFilters()"
                    (actionClick)="onActionsDropdownClick($event)"
                  ></app-options-dropdown>
        </div>
      </div>
      <div class="p-4 space-y-6">


      <!-- Charts -->
      <div class="grid grid-cols-1 gap-6">
        <!-- Combined Chart -->
        <app-card
          shadow="none"
          [padding]="false"
          overflow="hidden"
          [showHeader]="true"
        >
          <div slot="header" class="results-header flex flex-col">
            <span class="text-sm font-bold text-[var(--color-text-primary)]"
              >Ingresos vs Órdenes</span
            >
            <span class="text-xs text-[var(--color-text-secondary)]"
              >Comparación de tendencias</span
            >
          </div>
          <div class="p-4">
            @if (loading()) {
              <div class="h-80 flex items-center justify-center">
                <div
                  class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
                ></div>
              </div>
            } @else if (data().length === 0) {
              <div class="h-80 flex flex-col items-center justify-center text-text-secondary">
                <app-icon name="bar-chart-2" [size]="48" class="mb-2 opacity-50"></app-icon>
                <p>No hay datos para el período seleccionado</p>
              </div>
            } @else {
              @defer (on viewport) {
                <app-chart
                  [options]="combinedChartOptions()"
                  size="large"
                ></app-chart>
              } @placeholder {
                <div
                  class="h-80 bg-surface-secondary animate-pulse rounded-xl"
                ></div>
              }
            }
          </div>
        </app-card>

        <!-- AOV Chart -->
        <app-card
          shadow="none"
          [padding]="false"
          overflow="hidden"
          [showHeader]="true"
        >
          <div slot="header" class="results-header flex flex-col">
            <span class="text-sm font-bold text-[var(--color-text-primary)]"
              >Ticket Promedio</span
            >
            <span class="text-xs text-[var(--color-text-secondary)]">
              Evolución del valor promedio de orden
            </span>
          </div>
          <div class="p-4">
            @if (loading()) {
              <div class="h-64 flex items-center justify-center">
                <div
                  class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
                ></div>
              </div>
            } @else if (data().length === 0) {
              <div class="h-64 flex flex-col items-center justify-center text-text-secondary">
                <app-icon name="bar-chart-2" [size]="48" class="mb-2 opacity-50"></app-icon>
                <p>No hay datos para el período seleccionado</p>
              </div>
            } @else {
              @defer (on viewport) {
                <app-chart
                  [options]="aovChartOptions()"
                  size="large"
                ></app-chart>
              } @placeholder {
                <div
                  class="h-64 bg-surface-secondary animate-pulse rounded-xl"
                ></div>
              }
            }
          </div>
        </app-card>
      </div>

      <!-- Quick Links -->
      <app-card shadow="none" [responsivePadding]="true" class="md:mt-4">
        <span class="text-sm font-bold text-[var(--color-text-primary)]">Vistas de Ventas</span>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
          @for (view of salesViews; track view.key) {
            <app-analytics-card [view]="view"></app-analytics-card>
          }
        </div>
      </app-card>
          </div>
    </app-card>
</div>

`})
export class SalesTrendsComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private analyticsService = inject(AnalyticsService);
  private toastService = inject(ToastService);
  private currencyService = inject(CurrencyFormatService);
  private readonly route = inject(ActivatedRoute);
loading = signal(true);
  exporting = signal(false);
  data = signal<SalesTrend[]>([]);
  periodLabel = signal<string>('Este Mes');
  granularity = signal<'day' | 'week' | 'month'>('day');
  combinedChartOptions = signal<EChartsOption>({});
  aovChartOptions = signal<EChartsOption>({});
  dateRange = signal<DateRangeFilter>({
    start_date: getDefaultStartDate(),
    end_date: getDefaultEndDate(),
    preset: 'thisMonth'});

  granularityOptions: SelectorOption[] = [
    { value: 'day', label: 'Diario' },
    { value: 'week', label: 'Semanal' },
    { value: 'month', label: 'Mensual' },
  ];

  readonly salesViews: AnalyticsView[] = getViewsByCategory('sales').filter(
    (v) => v.key !== 'sales_trends'
  );

  ngOnInit(): void {
    this.currencyService.loadCurrency();

    // Read date range from URL query params (e.g. when navigating from Reports)
    const urlRange = queryParamsToDateRange(this.route.snapshot.queryParamMap);
    const initial: DateRangeFilter = urlRange ?? {
      start_date: getDefaultStartDate(),
      end_date: getDefaultEndDate(),
      preset: 'thisMonth',
    };
    this.dateRange.set(initial);
    this.dropdownFilterValues.set({
      date_range_start: initial.start_date,
      date_range_end: initial.end_date,
      date_range_preset: initial.preset ?? null,
      granularity: this.granularity(),
    });

    this.loadData();
  }

  /**
   * Filters surfaced via the unified `<app-options-dropdown>`.
   * Período (date-range) + Granularidad (select). Granularidad vivía INLINE
   * en el header antes de esta migración; ahora vive dentro del dropdown
   * junto al rango para mantener una única superficie de filtros.
   */
  readonly filterConfigs = computed<FilterConfig[]>(() => [
    { key: 'date_range', type: 'date-range', label: 'Período' },
    {
      key: 'granularity',
      label: 'Granularidad',
      type: 'select',
      options: this.granularityOptions,
      placeholder: 'Granularidad',
      defaultValue: 'day',
    },
  ]);

  /**
   * Mirror state exposed back to the dropdown so its internal `localFilterValues`
   * stays in sync with the canonical `dateRange` + `granularity` signals —
   * including resets via "Limpiar".
   */
  readonly dropdownFilterValues = signal<FilterValues>({});

  onFiltersDropdownChange(values: FilterValues): void {
    const start = values['date_range_start'] as string | null;
    const end = values['date_range_end'] as string | null;
    const preset = values['date_range_preset'] as string | null;
    const nextGranularity = (values['granularity'] as 'day' | 'week' | 'month') || 'day';

    const current = this.dateRange();
    const currentGranularity = this.granularity();

    const dateChanged =
      !!start &&
      !!end &&
      (start !== current.start_date ||
        end !== current.end_date ||
        (preset || 'custom') !== current.preset);
    const granularityChanged = nextGranularity !== currentGranularity;

    if (!dateChanged && !granularityChanged) {
      return;
    }

    if (dateChanged && start && end) {
      const next: DateRangeFilter = {
        start_date: start,
        end_date: end,
        preset: (preset || 'custom') as DateRangeFilter['preset'],
      };
      this.dateRange.set(next);
      this.dropdownFilterValues.update((prev) => ({
        ...prev,
        date_range_start: next.start_date,
        date_range_end: next.end_date,
        date_range_preset: next.preset ?? null,
      }));
    }

    if (granularityChanged) {
      this.granularity.set(nextGranularity);
      this.dropdownFilterValues.update((prev) => ({
        ...prev,
        granularity: nextGranularity,
      }));
    }

    this.loadData();
  }

  onClearAllFilters(): void {
    const defaults: DateRangeFilter = {
      start_date: getDefaultStartDate(),
      end_date: getDefaultEndDate(),
      preset: 'thisMonth',
    };
    this.dateRange.set(defaults);
    this.granularity.set('day');
    this.dropdownFilterValues.set({
      date_range_start: defaults.start_date,
      date_range_end: defaults.end_date,
      date_range_preset: defaults.preset ?? null,
      granularity: 'day',
    });
    this.loadData();
  }

  loadData(): void {
    this.loading.set(true);
    const query: SalesAnalyticsQueryDto = {
      date_range: this.dateRange(),
      granularity: this.granularity()};

    this.analyticsService
      .getSalesTrends(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.data.set(response.data);
          this.updateCharts(response.data);
          this.loading.set(false);
        },
        error: () => {
          this.toastService.error('Error al cargar tendencias');
          this.loading.set(false);
        }});
  }

  private updateCharts(data: SalesTrend[]): void {
    const labels = data.map((t) =>
      formatChartPeriod(t.period, this.granularity()),
    );
    const revenues = data.map((t) => t.revenue);
    const orders = data.map((t) => t.orders);
    const aov = data.map((t) => t.average_order_value);

    // Combined Chart
    this.combinedChartOptions.set({
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' }},
      legend: {
        data: ['Ingresos', 'Órdenes'],
        bottom: 30,
        textStyle: { color: '#6b7280' }},
      grid: {
        left: '3%',
        right: '4%',
        bottom: '15%',
        top: '15%',
        containLabel: true},
      xAxis: {
        type: 'category',
        data: labels,
        axisLine: { lineStyle: { color: '#e5e7eb' } },
        axisLabel: { color: '#6b7280' }},
      yAxis: [
        {
          type: 'value',
          name: 'Ingresos',
          position: 'left',
          min: 0,
          splitNumber: 5,
          axisLine: { show: false },
          axisLabel: {
            color: '#6b7280',
            formatter: (value: number) =>
              this.currencyService.formatChartAxis(value)},
          splitLine: { lineStyle: { color: '#f3f4f6' } }},
        {
          type: 'value',
          name: 'Órdenes',
          position: 'right',
          min: 0,
          splitNumber: 5,
          axisLine: { show: false },
          axisLabel: { color: '#6b7280', formatter: (v: number) => compactCountAxis(v) },
          splitLine: { show: false }},
      ],
      series: [
        {
          name: 'Ingresos',
          type: 'line',
          smooth: true,
          symbol: 'circle',
          data: revenues,
          yAxisIndex: 0,
          itemStyle: { color: '#22c55e' },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(34, 197, 94, 0.2)' },
                { offset: 1, color: 'rgba(34, 197, 94, 0)' },
              ] }},
        },
        {
          name: 'Órdenes',
          type: 'line',
          smooth: true,
          symbol: 'circle',
          data: orders,
          yAxisIndex: 1,
          itemStyle: { color: '#3b82f6' },
        },
      ]});

    // AOV Chart
    this.aovChartOptions.set({
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          const d = params[0];
          return `${d.name}<br/>Ticket Promedio: ${this.formatCurrency(d.value)}`;
        }},
      legend: {
        data: ['Ticket Promedio'],
        bottom: 30,
        textStyle: { color: '#6b7280' },
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '15%',
        containLabel: true},
      xAxis: {
        type: 'category',
        data: labels,
        axisLine: { lineStyle: { color: '#e5e7eb' } },
        axisLabel: { color: '#6b7280' }},
      yAxis: {
        type: 'value',
        min: 0,
        axisLine: { show: false },
        axisLabel: {
          color: '#6b7280',
          formatter: (value: number) =>
            this.currencyService.formatChartAxis(value)},
        splitLine: { lineStyle: { color: '#f3f4f6' } }},
      series: [
        {
          name: 'Ticket Promedio',
          type: 'line',
          data: aov,
          itemStyle: { color: '#8b5cf6' },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(139, 92, 246, 0.2)' },
                { offset: 1, color: 'rgba(139, 92, 246, 0)' },
              ] }},
        },
      ]});
  }

  exportReport(): void {
    this.exporting.set(true);
    this.analyticsService
      .exportSalesAnalytics({
        date_range: this.dateRange(),
        granularity: this.granularity()})
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `tendencias_ventas_${new Date().toISOString().split('T')[0]}.csv`;
          a.click();
          window.URL.revokeObjectURL(url);
          this.exporting.set(false);
        },
        error: () => {
          this.toastService.error('Error al exportar');
          this.exporting.set(false);
        }});
  }
  readonly dropdownActions = computed<DropdownAction[]>(() => [
    {
      action: 'export-xlsx',
      label: 'Exportar XLSX',
      icon: 'download',
    },
  ]);

  onActionsDropdownClick(action: string): void {
    if (action === 'export-xlsx') {
      this.exportReport();
    }
  }


  formatCurrency(value: number): string {
    return this.currencyService.format(value, 0);
  }

  getTotalOrders(): number {
    return this.data().reduce((sum, d) => sum + (d.orders || 0), 0);
  }

  getTotalRevenue(): string {
    const total = this.data().reduce((sum, d) => sum + (d.revenue || 0), 0);
    return this.currencyService.format(total, 0);
  }

  getAvgOrder(): string {
    const total = this.data().reduce((sum, d) => sum + (d.revenue || 0), 0);
    const orders = this.getTotalOrders();
    return orders ? this.currencyService.format(total / orders, 0) : '$0';
  }
}
