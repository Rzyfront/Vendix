import {
  Component,
  OnInit,
  inject,
  computed,
  signal,
  effect,
  untracked,
  DestroyRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { EChartsOption } from 'echarts';

import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { ChartComponent } from '../../../../../../shared/components/chart/chart.component';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { CurrencyFormatService, CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';
import { ResponsiveDataViewComponent } from '../../../../../../shared/components';
import type { TableColumn, ItemListCardConfig } from '../../../../../../shared/components';
import { OptionsDropdownComponent } from '../../../../../../shared/components/options-dropdown/options-dropdown.component';
import {
  DropdownAction,
  FilterConfig,
  FilterValues,
} from '../../../../../../shared/components/options-dropdown/options-dropdown.interfaces';
import { SelectorOption } from '../../../../../../shared/components/selector/selector.component';

import {
  AnalyticsService,
  PurchaseTrendItem,
  PurchaseTrendsSummary,
} from '../../services/analytics.service';
import { AnalyticsRefreshService, Refreshable } from '../../../shared/services/analytics-refresh.service';
import { DateRangeSyncService } from '../../../shared/services/date-range-sync.service';
import { DateRangeFilter } from '../../interfaces/analytics.interface';
import {
  getDefaultStartDate,
  getDefaultEndDate,
  formatChartPeriod,
} from '../../../../../../shared/utils/date.util';
import { queryParamsToDateRange } from '../../../shared/utils/date-range-params.util';
import { compactCountAxis } from '../../../../../../shared/utils/chart-labels.util';
import { getViewsByCategory, AnalyticsView } from '../../config/analytics-registry';
import { AnalyticsCardComponent } from '../../components/analytics-card/analytics-card.component';

@Component({
  selector: 'vendix-purchase-trends',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    CardComponent,
    ChartComponent,
    StatsComponent,
    IconComponent,
    CurrencyPipe,
    ResponsiveDataViewComponent,
    OptionsDropdownComponent,
    AnalyticsCardComponent,
  ],
  styles: [
    `
      :host {
        display: block;
        margin: -16px;
        @media (min-width: 768px) {
          margin: -24px;
        }
      }
      :host ::ng-deep .stats-container {
        padding: 0;
        margin: 0;
        margin-bottom: 0;
      }
      :host ::ng-deep .results-header {
        padding: 0.75rem 1rem;
      }
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
          [value]="totalOrders()"
          iconName="file-text"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        ></app-stats>

        <app-stats
          title="Total Comprado"
          [value]="totalSpent()"
          iconName="dollar-sign"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>

        <app-stats
          title="Ticket Promedio"
          [value]="avgPurchase()"
          iconName="trending-up"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
        ></app-stats>

        <app-stats
          title="Unidades Recibidas"
          [value]="totalItemsReceived()"
          iconName="package"
          iconBgColor="bg-indigo-100"
          iconColor="text-indigo-600"
        ></app-stats>
      </div>

      <!-- Main Container Card -->
      <app-card shadow="none" [padding]="false" overflow="hidden" [showHeader]="true">
        <div slot="header" class="results-header flex items-center justify-between gap-3 flex-wrap">
          <div class="flex items-center gap-2 min-w-0">
            <app-icon name="trending-up" [size]="20" class="shrink-0 text-[var(--color-primary)]"></app-icon>
            <span class="results-header__title text-base md:text-lg font-bold text-[var(--color-text-primary)] leading-tight whitespace-nowrap">
              Tendencias de Compra
            </span>
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
            <!-- Combined Chart: Total Comprado vs Unidades / Órdenes -->
            <app-card shadow="none" [padding]="false" overflow="hidden" [showHeader]="true">
              <div slot="header" class="results-header flex flex-col">
                <span class="text-sm font-bold text-[var(--color-text-primary)]">
                  Compras vs Unidades Recibidas
                </span>
                <span class="text-xs text-[var(--color-text-secondary)]">
                  Evolución del monto comprado, unidades recibidas y volumen de órdenes
                </span>
              </div>
              <div class="p-4">
                @if (loading()) {
                  <div class="h-80 flex items-center justify-center">
                    <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                  </div>
                } @else if (data().length === 0) {
                  <div class="h-80 flex flex-col items-center justify-center text-text-secondary">
                    <app-icon name="bar-chart-2" [size]="48" class="mb-2 opacity-50"></app-icon>
                    <p>No hay compras para el período seleccionado</p>
                  </div>
                } @else {
                  @defer (on viewport) {
                    <app-chart [options]="combinedChartOptions()" size="large"></app-chart>
                  } @placeholder {
                    <div class="h-80 bg-surface-secondary animate-pulse rounded-xl"></div>
                  }
                }
              </div>
            </app-card>

            <!-- AOV Chart: Ticket Promedio -->
            <app-card shadow="none" [padding]="false" overflow="hidden" [showHeader]="true">
              <div slot="header" class="results-header flex flex-col">
                <span class="text-sm font-bold text-[var(--color-text-primary)]">
                  Ticket Promedio de Compra
                </span>
                <span class="text-xs text-[var(--color-text-secondary)]">
                  Evolución del valor promedio invertido por orden de compra
                </span>
              </div>
              <div class="p-4">
                @if (loading()) {
                  <div class="h-64 flex items-center justify-center">
                    <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                  </div>
                } @else if (data().length === 0) {
                  <div class="h-64 flex flex-col items-center justify-center text-text-secondary">
                    <app-icon name="bar-chart-2" [size]="48" class="mb-2 opacity-50"></app-icon>
                    <p>No hay compras para el período seleccionado</p>
                  </div>
                } @else {
                  @defer (on viewport) {
                    <app-chart [options]="aovChartOptions()" size="large"></app-chart>
                  } @placeholder {
                    <div class="h-64 bg-surface-secondary animate-pulse rounded-xl"></div>
                  }
                }
              </div>
            </app-card>
          </div>

          <!-- Detalle Tabular / Mobile Cards -->
          <app-card shadow="none" [padding]="false" overflow="hidden" [showHeader]="true">
            <div slot="header" class="results-header flex flex-col">
              <span class="text-sm font-bold text-[var(--color-text-primary)]">
                Detalle por Período y Proveedor
              </span>
              <span class="text-xs text-[var(--color-text-secondary)]">
                Desglose cronológico de órdenes emitidas a proveedores
              </span>
            </div>
            <div class="p-4">
              <app-responsive-data-view
                [data]="data()"
                [columns]="columns"
                [cardConfig]="cardConfig"
                [loading]="loading()"
                [hoverable]="true"
                emptyTitle="Sin datos de compras"
                emptyMessage="No se registraron órdenes de compra en el período seleccionado."
                (rowClick)="onRowClick($event)"
              ></app-responsive-data-view>

              @if (data().length > 0) {
                <div class="mt-3 pt-3 border-t-2 border-border flex flex-wrap gap-x-6 gap-y-1 text-sm font-bold">
                  <span class="text-[var(--color-text-primary)]">Total</span>
                  <span>{{ totalOrders() }} órdenes</span>
                  <span>{{ totalSpent() }}</span>
                  <span class="text-[var(--color-text-secondary)]">Prom. {{ avgPurchase() }}</span>
                  <span>{{ totalItemsReceived() }} unidades recibidas</span>
                </div>
              }
            </div>
          </app-card>

          <!-- Quick Links to other Purchase Views -->
          @if (purchaseViews.length > 0) {
            <app-card shadow="none" [responsivePadding]="true" class="md:mt-4">
              <span class="text-sm font-bold text-[var(--color-text-primary)]">Vistas de Compras</span>
              <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 mt-3">
                @for (view of purchaseViews; track view.key) {
                  <app-analytics-card [view]="view"></app-analytics-card>
                }
              </div>
            </app-card>
          }
        </div>
      </app-card>
    </div>
  `,
})
export class PurchaseTrendsComponent implements OnInit, Refreshable {
  private destroyRef = inject(DestroyRef);
  private analyticsService = inject(AnalyticsService);
  private analyticsRefresh = inject(AnalyticsRefreshService);
  private dateRangeSync = inject(DateRangeSyncService);
  private toastService = inject(ToastService);
  private currencyService = inject(CurrencyFormatService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  loading = signal(true);
  exporting = signal(false);
  data = signal<PurchaseTrendItem[]>([]);
  summary = signal<PurchaseTrendsSummary | null>(null);
  granularity = signal<'day' | 'week' | 'month'>('day');
  combinedChartOptions = signal<EChartsOption>({});
  aovChartOptions = signal<EChartsOption>({});
  dateRange = signal<DateRangeFilter>({
    start_date: getDefaultStartDate(),
    end_date: getDefaultEndDate(),
    preset: 'thisMonth',
  });

  granularityOptions: SelectorOption[] = [
    { value: 'day', label: 'Diario' },
    { value: 'week', label: 'Semanal' },
    { value: 'month', label: 'Mensual' },
  ];

  readonly purchaseViews: AnalyticsView[] = getViewsByCategory('purchases').filter(
    (v) => v.key !== 'purchases_trends',
  );

  constructor() {
    effect(() => {
      const count = this.analyticsRefresh.refreshSignal();
      if (count > 0) {
        untracked(() => this.loadData());
      }
    });
  }

  ngOnInit(): void {
    this.currencyService.loadCurrency();

    // Read date range from URL query params (e.g. when navigating from Reports)
    const urlRange = queryParamsToDateRange(this.route.snapshot.queryParamMap);
    const initial: DateRangeFilter =
      urlRange ??
      this.dateRangeSync.dateRange() ?? {
        start_date: getDefaultStartDate(),
        end_date: getDefaultEndDate(),
        preset: 'thisMonth',
      };

    this.dateRange.set(initial);
    this.dateRangeSync.setDateRange(initial);
    this.dropdownFilterValues.set({
      date_range_start: initial.start_date,
      date_range_end: initial.end_date,
      date_range_preset: initial.preset ?? null,
      granularity: this.granularity(),
    });

    this.loadData();
  }

  refresh(): void {
    this.loadData();
  }

  readonly periodLabel = computed(() => {
    const range = this.dateRange();
    const presetLabels: Record<string, string> = {
      today: 'Hoy',
      yesterday: 'Ayer',
      last7Days: 'Últimos 7 días',
      last30Days: 'Últimos 30 días',
      thisWeek: 'Esta semana',
      lastWeek: 'Semana pasada',
      thisMonth: 'Este mes',
      lastMonth: 'Mes pasado',
      thisYear: 'Este año',
      lastYear: 'Año pasado',
    };
    if (range.preset && presetLabels[range.preset]) {
      return presetLabels[range.preset];
    }
    if (range.start_date && range.end_date) {
      return `${range.start_date} - ${range.end_date}`;
    }
    return 'Personalizado';
  });

  readonly totalOrders = computed(() => {
    if (this.summary()?.purchase_count != null) {
      return this.summary()!.purchase_count;
    }
    return this.data().reduce((sum, d) => sum + (d.purchase_count || 0), 0);
  });

  readonly totalSpent = computed(() => {
    if (this.summary()?.total_amount != null) {
      return this.currencyService.format(this.summary()!.total_amount);
    }
    const total = this.data().reduce((sum, d) => sum + (d.total_amount || 0), 0);
    return this.currencyService.format(total);
  });

  readonly avgPurchase = computed(() => {
    if (this.summary()?.avg_purchase != null) {
      return this.currencyService.format(this.summary()!.avg_purchase);
    }
    const total = this.data().reduce((sum, d) => sum + (d.total_amount || 0), 0);
    const count = this.totalOrders();
    return count > 0 ? this.currencyService.format(total / count) : '$0';
  });

  readonly totalItemsReceived = computed(() => {
    if (this.summary()?.items_received != null) {
      return this.summary()!.items_received;
    }
    return this.data().reduce((sum, d) => sum + (d.items_received || 0), 0);
  });

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

  readonly dropdownFilterValues = signal<FilterValues>({});

  readonly dropdownActions = computed<DropdownAction[]>(() => [
    {
      action: 'export-xlsx',
      label: 'Exportar XLSX',
      icon: 'download',
    },
  ]);

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
      this.dateRangeSync.setDateRange(next);
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
    this.dateRangeSync.setDateRange(defaults);
    this.granularity.set('day');
    this.dropdownFilterValues.set({
      date_range_start: defaults.start_date,
      date_range_end: defaults.end_date,
      date_range_preset: defaults.preset ?? null,
      granularity: 'day',
    });
    this.loadData();
  }

  onActionsDropdownClick(action: string): void {
    if (action === 'export-xlsx') {
      this.exportReport();
    }
  }

  loadData(): void {
    this.loading.set(true);
    const query = {
      date_range: this.dateRange(),
      granularity: this.granularity(),
      limit: 100,
    };

    this.analyticsService
      .getPurchaseTrends(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const rows = Array.isArray(response.data) ? response.data : [];
          this.data.set(rows);
          if (response.summary) {
            this.summary.set(response.summary);
          } else {
            this.summary.set(null);
          }
          this.updateCharts(rows);
          this.loading.set(false);
        },
        error: () => {
          this.toastService.error('Error al cargar tendencias de compra');
          this.data.set([]);
          this.summary.set(null);
          this.updateCharts([]);
          this.loading.set(false);
        },
      });
  }

  private updateCharts(data: PurchaseTrendItem[]): void {
    // Group rows by period for time-series charts
    const periodMap = new Map<
      string,
      { total_amount: number; items_received: number; purchase_count: number }
    >();

    for (const item of data) {
      const existing = periodMap.get(item.period) || {
        total_amount: 0,
        items_received: 0,
        purchase_count: 0,
      };
      existing.total_amount += Number(item.total_amount) || 0;
      existing.items_received += Number(item.items_received) || 0;
      existing.purchase_count += Number(item.purchase_count) || 0;
      periodMap.set(item.period, existing);
    }

    // Sort periods chronologically (ascending) for left-to-right chart progression
    const sortedPeriods = Array.from(periodMap.keys()).sort((a, b) => a.localeCompare(b));

    const labels = sortedPeriods.map((p) => formatChartPeriod(p, this.granularity()));
    const totalAmounts = sortedPeriods.map((p) => periodMap.get(p)!.total_amount);
    const unitsReceived = sortedPeriods.map((p) => periodMap.get(p)!.items_received);
    const orderCounts = sortedPeriods.map((p) => periodMap.get(p)!.purchase_count);
    const aovValues = sortedPeriods.map((p) => {
      const pData = periodMap.get(p)!;
      return pData.purchase_count > 0
        ? Math.round((pData.total_amount / pData.purchase_count) * 100) / 100
        : 0;
    });

    const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
    const textSecondary = isDark ? '#9ca3af' : '#6b7280';
    const gridLineColor = isDark ? '#374151' : '#f3f4f6';

    // 1. Combined Chart: Total Comprado vs Unidades Recibidas / Nº Órdenes
    this.combinedChartOptions.set({
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
        formatter: (params: any) => {
          if (!Array.isArray(params) || params.length === 0) return '';
          let tip = `<strong>${params[0].axisValue}</strong><br/>`;
          for (const p of params) {
            if (p.seriesName === 'Total Comprado') {
              tip += `${p.marker} ${p.seriesName}: <b>${this.currencyService.format(p.value)}</b><br/>`;
            } else {
              tip += `${p.marker} ${p.seriesName}: <b>${Number(p.value).toLocaleString('es-CO')}</b><br/>`;
            }
          }
          return tip;
        },
      },
      legend: {
        data: ['Total Comprado', 'Unidades Recibidas', 'Nº Órdenes'],
        bottom: 10,
        textStyle: { color: textSecondary },
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '15%',
        top: '12%',
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: labels,
        axisLine: { lineStyle: { color: '#e5e7eb' } },
        axisLabel: { color: textSecondary },
      },
      yAxis: [
        {
          type: 'value',
          name: 'Comprado',
          position: 'left',
          min: 0,
          axisLine: { show: false },
          axisLabel: {
            color: textSecondary,
            formatter: (val: number) => this.currencyService.formatChartAxis(val),
          },
          splitLine: { lineStyle: { color: gridLineColor } },
        },
        {
          type: 'value',
          name: 'Unidades / Órdenes',
          position: 'right',
          min: 0,
          axisLine: { show: false },
          axisLabel: {
            color: textSecondary,
            formatter: (val: number) => compactCountAxis(val),
          },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: 'Total Comprado',
          type: 'bar',
          data: totalAmounts,
          yAxisIndex: 0,
          itemStyle: { color: '#10b981', borderRadius: [4, 4, 0, 0] },
          barMaxWidth: 35,
        },
        {
          name: 'Unidades Recibidas',
          type: 'line',
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          data: unitsReceived,
          yAxisIndex: 1,
          itemStyle: { color: '#3b82f6' },
        },
        {
          name: 'Nº Órdenes',
          type: 'line',
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          data: orderCounts,
          yAxisIndex: 1,
          itemStyle: { color: '#8b5cf6' },
          lineStyle: { type: 'dashed' },
        },
      ],
    });

    // 2. AOV Chart: Ticket Promedio
    this.aovChartOptions.set({
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          const d = params[0];
          return `<strong>${d.name}</strong><br/>Ticket Promedio: <b>${this.currencyService.format(d.value)}</b>`;
        },
      },
      legend: {
        data: ['Ticket Promedio'],
        bottom: 10,
        textStyle: { color: textSecondary },
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '15%',
        top: '12%',
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: labels,
        axisLine: { lineStyle: { color: '#e5e7eb' } },
        axisLabel: { color: textSecondary },
      },
      yAxis: {
        type: 'value',
        min: 0,
        axisLine: { show: false },
        axisLabel: {
          color: textSecondary,
          formatter: (value: number) => this.currencyService.formatChartAxis(value),
        },
        splitLine: { lineStyle: { color: gridLineColor } },
      },
      series: [
        {
          name: 'Ticket Promedio',
          type: 'line',
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          data: aovValues,
          itemStyle: { color: '#f59e0b' },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(245, 158, 11, 0.25)' },
                { offset: 1, color: 'rgba(245, 158, 11, 0.01)' },
              ],
            },
          },
        },
      ],
    });
  }

  readonly columns: TableColumn[] = [
    {
      key: 'period',
      label: 'Período',
      priority: 1,
      transform: (value: any) => formatChartPeriod(String(value), this.granularity()),
    },
    {
      key: 'supplier_name',
      label: 'Proveedor',
      priority: 1,
    },
    {
      key: 'purchase_count',
      label: 'Nº OC',
      align: 'right',
      priority: 2,
    },
    {
      key: 'total_amount',
      label: 'Total Comprado',
      align: 'right',
      priority: 1,
      transform: (value: any) => this.currencyService.format(Number(value)),
    },
    {
      key: 'avg_purchase',
      label: 'Ticket Promedio',
      align: 'right',
      priority: 2,
      transform: (value: any) => this.currencyService.format(Number(value)),
    },
    {
      key: 'items_received',
      label: 'Unidades Recibidas',
      align: 'right',
      priority: 2,
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'supplier_name',
    subtitleKey: 'period',
    subtitleTransform: (value: any) => formatChartPeriod(String(value), this.granularity()),
    footerKey: 'total_amount',
    footerLabel: 'Total Comprado',
    footerStyle: 'prominent',
    footerTransform: (value: any) => this.currencyService.format(Number(value)),
    detailKeys: [
      { key: 'purchase_count', label: 'Nº OC', icon: 'file-text' },
      {
        key: 'avg_purchase',
        label: 'Ticket Prom.',
        icon: 'calculator',
        transform: (value: any) => this.currencyService.format(Number(value)),
      },
      { key: 'items_received', label: 'Unidades', icon: 'package' },
    ],
  };

  onRowClick(row: PurchaseTrendItem): void {
    if (row.supplier_id && row.supplier_id > 0) {
      this.router.navigate(['/admin/inventory/suppliers', row.supplier_id]);
    }
  }

  exportReport(): void {
    this.exporting.set(true);
    const query = {
      date_range: this.dateRange(),
      granularity: this.granularity(),
    };

    this.analyticsService
      .exportPurchaseTrends(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `tendencias_compra_${new Date().toISOString().split('T')[0]}.xlsx`;
          a.click();
          window.URL.revokeObjectURL(url);
          this.exporting.set(false);
          this.toastService.success('Reporte exportado correctamente');
        },
        error: () => {
          this.toastService.error('Error al exportar reporte');
          this.exporting.set(false);
        },
      });
  }
}
