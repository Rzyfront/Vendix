import { Component, OnInit, OnDestroy, signal, inject, effect, untracked, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { EChartsOption } from 'echarts';

import { AuthFacade } from '../../../../core/store/auth/auth.facade';
import { StatsComponent } from '../../../../shared/components/stats/stats.component';
import { ChartComponent } from '../../../../shared/components/chart/chart.component';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { ToastService } from '../../../../shared/components/toast/toast.service';
import { CurrencyFormatService } from '../../../../shared/pipes/currency';
import { OptionsDropdownComponent } from '../../../../shared/components/options-dropdown/options-dropdown.component';
import { FilterConfig, FilterValues } from '../../../../shared/components/options-dropdown/options-dropdown.interfaces';

import { AnalyticsService } from '../analytics/services/analytics.service';
import { DateRangeFilter } from '../analytics/interfaces/analytics.interface';
import {
  SalesSummary,
  SalesTrend,
  SalesByChannel,
  SalesAnalyticsQueryDto,
} from '../analytics/interfaces/sales-analytics.interface';
import { StoreDashboardService } from './services/store-dashboard.service';

// Channel colors for the pie chart
const CHANNEL_CONFIG: Record<string, { color: string }> = {
  pos: { color: '#3b82f6' },
  ecommerce: { color: '#10b981' },
  whatsapp: { color: '#22c55e' },
  agent: { color: '#8b5cf6' },
  marketplace: { color: '#f59e0b' },
  default: { color: '#6b7280' },
};

// Quick-access links configuration
interface QuickLink {
  icon: string;
  label: string;
  route: string;
}

const QUICK_LINKS: QuickLink[] = [
  { icon: 'trending-up', label: 'Resumen de Ventas', route: '/admin/analytics/sales/summary' },
  { icon: 'package', label: 'Ventas por Producto', route: '/admin/analytics/sales/by-product' },
  { icon: 'shopping-cart', label: 'Órdenes', route: '/admin/orders/sales' },
  { icon: 'layers', label: 'Stock', route: '/admin/analytics/inventory/stock-levels' },
  { icon: 'alert-triangle', label: 'Bajo Stock', route: '/admin/analytics/inventory/low-stock' },
  { icon: 'credit-card', label: 'Gastos', route: '/admin/expenses' },
  { icon: 'users', label: 'Clientes', route: '/admin/analytics/customers/summary' },
  { icon: 'shopping-bag', label: 'Compras', route: '/admin/inventory/pop' },
];

@Component({
  selector: 'app-store-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    StatsComponent,
    ChartComponent,
    IconComponent,
    OptionsDropdownComponent,
  ],
  template: `
    <div class="w-full space-y-4 md:space-y-6">
      <!-- 4 Stats Cards -->
      @if (loading()) {
        <div class="stats-container !mb-0">
          @for (i of [1, 2, 3, 4]; track i) {
            <div class="bg-surface rounded-xl p-4 animate-pulse shadow-[0_2px_8px_rgba(0,0,0,0.07)]">
              <div class="h-3 bg-gray-200 rounded w-1/2 mb-3"></div>
              <div class="h-7 bg-gray-200 rounded w-3/4"></div>
            </div>
          }
        </div>
      } @else {
        <div class="stats-container !mb-0">
          <app-stats
            title="Ingresos"
            [value]="formatCurrency(summary()?.total_revenue || 0)"
            [smallText]="getGrowthText(summary()?.revenue_growth)"
            iconName="dollar-sign"
            iconBgColor="bg-emerald-100"
            iconColor="text-emerald-500"
          />
          <app-stats
            title="Órdenes"
            [value]="summary()?.total_orders || 0"
            [smallText]="getGrowthText(summary()?.orders_growth)"
            iconName="shopping-cart"
            iconBgColor="bg-blue-100"
            iconColor="text-blue-500"
          />
          <app-stats
            title="Ticket Prom."
            [value]="formatCurrency(summary()?.average_order_value || 0)"
            [smallText]="(summary()?.total_units_sold || 0) + ' uds. vendidas'"
            iconName="receipt"
            iconBgColor="bg-purple-100"
            iconColor="text-purple-500"
          />
          <app-stats
            title="Clientes"
            [value]="summary()?.total_customers || 0"
            smallText="clientes únicos"
            iconName="users"
            iconBgColor="bg-amber-100"
            iconColor="text-amber-500"
          />
        </div>
      }

      <!-- Charts: Trend (2/3) + Channels (1/3) -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <!-- Sales Trend Chart -->
        <div class="lg:col-span-2 bg-surface rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:border md:border-border overflow-hidden">
          <div class="p-4 border-b border-border flex items-center justify-between gap-2">
            <div>
              <h3 class="font-semibold text-text-primary text-sm">Tendencia de Ventas</h3>
              <p class="text-xs text-text-secondary">{{ dateRangeLabel() }}</p>
            </div>
            <app-options-dropdown
              [filters]="dateFilters()"
              [filterValues]="dateFilterValues()"
              title="Período"
              triggerLabel="Período"
              [debounceMs]="0"
              (filterChange)="onDateFilterChange($event)"
            />
          </div>
          <div class="p-4">
            @if (loadingTrends()) {
              <div class="h-56 flex items-center justify-center">
                <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            } @else if (trends().length === 0) {
              <div class="h-56 flex flex-col items-center justify-center text-text-secondary">
                <app-icon name="bar-chart-2" [size]="40" class="mb-2 opacity-30"></app-icon>
                <p class="text-sm">No hay datos de ventas</p>
              </div>
            } @else {
              <app-chart [options]="trendChartOptions()" size="large"></app-chart>
            }
          </div>
        </div>

        <!-- Sales by Channel Chart -->
        <div class="bg-surface rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:border md:border-border overflow-hidden">
          <div class="p-4 border-b border-border">
            <h3 class="font-semibold text-text-primary text-sm">Ventas por Canal</h3>
            <p class="text-xs text-text-secondary">Distribución del período</p>
          </div>
          <div class="p-4">
            @if (loadingChannels()) {
              <div class="h-56 flex items-center justify-center">
                <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            } @else if (channels().length === 0) {
              <div class="h-56 flex flex-col items-center justify-center text-text-secondary">
                <app-icon name="pie-chart" [size]="40" class="mb-2 opacity-30"></app-icon>
                <p class="text-sm">No hay datos de canales</p>
              </div>
            } @else {
              <app-chart [options]="channelChartOptions()" size="large"></app-chart>
            }
          </div>
        </div>
      </div>

      <!-- Alerts (1/2) + Quick Links (1/2) -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <!-- Alerts Panel -->
        <div class="bg-surface rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:border md:border-border overflow-hidden">
          <div class="px-4 py-3 border-b border-border">
            <h3 class="font-semibold text-text-primary text-sm">Alertas Operativas</h3>
          </div>
          <div class="p-3 space-y-2">
            @if (loadingAlerts()) {
              <div class="py-4 flex items-center justify-center">
                <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
              </div>
            } @else {
              @if (lowStockCount() > 0) {
                <div
                  class="flex items-center gap-3 p-3 bg-amber-50 rounded-lg cursor-pointer hover:bg-amber-100 transition-colors"
                  (click)="navigateTo('/admin/analytics/inventory/low-stock')"
                >
                  <div class="flex-shrink-0 w-7 h-7 bg-amber-100 rounded-full flex items-center justify-center">
                    <app-icon name="alert-triangle" [size]="14" class="text-amber-600"></app-icon>
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium text-amber-800">{{ lowStockCount() }} bajo stock</p>
                  </div>
                  <app-icon name="chevron-right" [size]="14" class="text-amber-400"></app-icon>
                </div>
              }

              @if (outOfStockCount() > 0) {
                <div
                  class="flex items-center gap-3 p-3 bg-red-50 rounded-lg cursor-pointer hover:bg-red-100 transition-colors"
                  (click)="navigateTo('/admin/analytics/inventory/stock-levels')"
                >
                  <div class="flex-shrink-0 w-7 h-7 bg-red-100 rounded-full flex items-center justify-center">
                    <app-icon name="x-circle" [size]="14" class="text-red-600"></app-icon>
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium text-red-800">{{ outOfStockCount() }} agotados</p>
                  </div>
                  <app-icon name="chevron-right" [size]="14" class="text-red-400"></app-icon>
                </div>
              }

              @if (dispatchPendingCount() > 0) {
                <div
                  class="flex items-center gap-3 p-3 bg-blue-50 rounded-lg cursor-pointer hover:bg-blue-100 transition-colors"
                  (click)="navigateTo('/admin/orders/sales?status=processing&delivery=home_delivery')"
                >
                  <div class="flex-shrink-0 w-7 h-7 bg-blue-100 rounded-full flex items-center justify-center">
                    <app-icon name="truck" [size]="14" class="text-blue-600"></app-icon>
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium text-blue-800">{{ dispatchPendingCount() }} listas para despachar</p>
                  </div>
                  <app-icon name="chevron-right" [size]="14" class="text-blue-400"></app-icon>
                </div>
              }

              @if (refundPendingCount() > 0) {
                <div
                  class="flex items-center gap-3 p-3 bg-purple-50 rounded-lg cursor-pointer hover:bg-purple-100 transition-colors"
                  (click)="navigateTo('/admin/orders/sales?status=refunded')"
                >
                  <div class="flex-shrink-0 w-7 h-7 bg-purple-100 rounded-full flex items-center justify-center">
                    <app-icon name="rotate-ccw" [size]="14" class="text-purple-600"></app-icon>
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium text-purple-800">{{ refundPendingCount() }} reembolsos pendientes</p>
                  </div>
                  <app-icon name="chevron-right" [size]="14" class="text-purple-400"></app-icon>
                </div>
              }

              @if (lowStockCount() === 0 && outOfStockCount() === 0 && dispatchPendingCount() === 0 && refundPendingCount() === 0) {
                <div class="py-4 text-center">
                  <div class="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-2">
                    <app-icon name="check-circle" [size]="20" class="text-emerald-600"></app-icon>
                  </div>
                  <p class="text-sm font-medium text-gray-700">Todo en orden</p>
                  <p class="text-xs text-gray-500">Sin alertas pendientes</p>
                </div>
              }
            }
          </div>
        </div>

        <!-- Quick Links -->
        <div class="bg-surface rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:border md:border-border overflow-hidden">
          <div class="px-4 py-3 border-b border-border">
            <h3 class="font-semibold text-text-primary text-sm">Accesos Rápidos</h3>
          </div>
          <div class="p-3 grid grid-cols-2 gap-1">
            @for (link of quickLinks; track link.route) {
              <button
                class="flex items-center gap-2 px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50 rounded-lg transition-colors text-left"
                (click)="navigateTo(link.route)"
              >
                <app-icon [name]="link.icon" [size]="15" class="text-gray-400"></app-icon>
                <span class="truncate">{{ link.label }}</span>
              </button>
            }
          </div>
        </div>
      </div>
    </div>
  `,
})
export class DashboardComponent implements OnInit, OnDestroy {
  private readonly authFacade = inject(AuthFacade);
  private readonly analyticsService = inject(AnalyticsService);
  private readonly dashboardService = inject(StoreDashboardService);
  private readonly currencyService = inject(CurrencyFormatService);
  private readonly toastService = inject(ToastService);
  private readonly router = inject(Router);
  private readonly destroy$ = new Subject<void>();

  // Quick links config
  readonly quickLinks = QUICK_LINKS;

  // Preset options for the date filter
  private readonly presetOptions = [
    { value: 'today', label: 'Hoy' },
    { value: 'yesterday', label: 'Ayer' },
    { value: 'thisWeek', label: 'Esta Semana' },
    { value: 'lastWeek', label: 'Semana Pasada' },
    { value: 'thisMonth', label: 'Este Mes' },
    { value: 'lastMonth', label: 'Mes Pasado' },
    { value: 'thisYear', label: 'Este Año' },
    { value: 'lastYear', label: 'Año Pasado' },
    { value: 'custom', label: 'Personalizado' },
  ];

  // Store
  storeId = signal<string | null>(null);

  // Date range
  selectedPreset = signal<string>('thisMonth');
  customStartDate = signal<string>('');
  customEndDate = signal<string>('');

  // Dynamic filters: show date inputs when preset is 'custom'
  dateFilters = computed<FilterConfig[]>(() => {
    const filters: FilterConfig[] = [
      {
        key: 'preset',
        label: 'Período',
        type: 'select',
        options: this.presetOptions,
        placeholder: 'Seleccionar período',
      },
    ];
    if (this.selectedPreset() === 'custom') {
      filters.push(
        { key: 'start_date', label: 'Fecha inicio', type: 'date' },
        { key: 'end_date', label: 'Fecha fin', type: 'date' },
      );
    }
    return filters;
  });

  dateFilterValues = computed<FilterValues>(() => ({
    preset: this.selectedPreset(),
    start_date: this.customStartDate() || null,
    end_date: this.customEndDate() || null,
  }));

  dateRangeLabel = computed(() => {
    const range = this.dateRange();
    const start = new Date(range.start_date + 'T12:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
    const end = new Date(range.end_date + 'T12:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
    return `${start} - ${end}`;
  });

  dateRange = signal<DateRangeFilter>({
    start_date: this.getMonthStartDate(),
    end_date: this.getMonthEndDate(),
    preset: 'thisMonth',
  });

  // Loading states
  loading = signal(true);
  loadingTrends = signal(true);
  loadingChannels = signal(true);
  loadingAlerts = signal(true);

  // Data
  summary = signal<SalesSummary | null>(null);
  trends = signal<SalesTrend[]>([]);
  channels = signal<SalesByChannel[]>([]);
  lowStockCount = signal(0);
  outOfStockCount = signal(0);
  dispatchPendingCount = signal(0);
  refundPendingCount = signal(0);

  // Charts
  trendChartOptions = signal<EChartsOption>({});
  channelChartOptions = signal<EChartsOption>({});

  constructor() {
    // React to date range changes (skip initial emission)
    let isFirst = true;
    effect(() => {
      this.dateRange();
      if (isFirst) { isFirst = false; return; }
      untracked(() => this.loadAllData());
    });
  }

  ngOnInit(): void {
    this.currencyService.loadCurrency();
    this.authFacade.userStore$
      .pipe(takeUntil(this.destroy$))
      .subscribe((store: any) => {
        const id = store?.id;
        if (id && !this.storeId()) {
          this.storeId.set(String(id));
          this.loadAllData();
        }
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onDateFilterChange(values: FilterValues): void {
    const preset = values['preset'] as string;
    if (!preset) return;

    this.selectedPreset.set(preset);

    if (preset === 'custom') {
      const start = values['start_date'] as string;
      const end = values['end_date'] as string;
      if (start) this.customStartDate.set(start);
      if (end) this.customEndDate.set(end);
      if (start && end) {
        this.dateRange.set({ start_date: start, end_date: end, preset: 'custom' });
      }
    } else {
      const range = this.getDateRangeFromPreset(preset);
      if (range) this.dateRange.set(range);
    }
  }

  // ── Data Loading ─────────────────────────────────────────

  private loadAllData(): void {
    const storeId = this.storeId();
    if (!storeId) return;

    const query: SalesAnalyticsQueryDto = { date_range: this.dateRange() };

    // Reset loading states
    this.loading.set(true);
    this.loadingTrends.set(true);
    this.loadingChannels.set(true);
    this.loadingAlerts.set(true);

    // 1. Sales summary → stats cards
    this.analyticsService
      .getSalesSummary(query)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.summary.set(response.data);
          this.loading.set(false);
        },
        error: () => {
          this.toastService.error('Error al cargar el resumen');
          this.loading.set(false);
        },
      });

    // 2. Sales trends → trend chart
    this.analyticsService
      .getSalesTrends({ ...query, granularity: 'day' })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.trends.set(response.data);
          this.updateTrendChart(response.data);
          this.loadingTrends.set(false);
        },
        error: () => this.loadingTrends.set(false),
      });

    // 3. Sales by channel → pie chart
    this.analyticsService
      .getSalesByChannel(query)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.channels.set(response.data);
          this.updateChannelChart(response.data);
          this.loadingChannels.set(false);
        },
        error: () => this.loadingChannels.set(false),
      });

    // 4. Dashboard stats → dispatch/refund alerts
    this.dashboardService
      .getDashboardStats(storeId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (stats) => {
          this.dispatchPendingCount.set(stats.dispatchPendingCount || 0);
          this.refundPendingCount.set(stats.refundPendingCount || 0);
        },
        error: () => { /* alerts are non-critical */ },
      });

    // 5. Inventory summary → low stock/out of stock alerts
    this.analyticsService
      .getInventorySummary({})
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.lowStockCount.set(response.data.low_stock_count || 0);
          this.outOfStockCount.set(response.data.out_of_stock_count || 0);
          this.loadingAlerts.set(false);
        },
        error: () => this.loadingAlerts.set(false),
      });
  }

  // ── Chart Builders ───────────────────────────────────────

  private updateTrendChart(trends: SalesTrend[]): void {
    if (!trends.length) return;

    const labels = trends.map((t) =>
      new Date(t.period).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' }),
    );
    const revenues = trends.map((t) => t.revenue);
    const orders = trends.map((t) => t.orders);

    this.trendChartOptions.set({
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          const rev = params[0];
          const ord = params[1];
          return `<strong>${rev.name}</strong><br/>Ingresos: ${this.currencyService.formatCompact(rev.value)}<br/>Órdenes: ${ord?.value || 0}`;
        },
      },
      legend: {
        data: ['Ingresos', 'Órdenes'],
        bottom: 0,
        textStyle: { color: '#6b7280', fontSize: 11 },
      },
      grid: { left: '3%', right: '4%', bottom: '15%', top: '5%', containLabel: true },
      xAxis: {
        type: 'category',
        data: labels,
        axisLine: { lineStyle: { color: '#e5e7eb' } },
        axisLabel: { color: '#6b7280', fontSize: 10 },
      },
      yAxis: [
        {
          type: 'value',
          position: 'left',
          axisLine: { show: false },
          axisLabel: {
            color: '#6b7280',
            fontSize: 10,
            formatter: (value: number) => this.currencyService.formatChartAxis(value),
          },
          splitLine: { lineStyle: { color: '#f3f4f6' } },
        },
        {
          type: 'value',
          position: 'right',
          axisLine: { show: false },
          axisLabel: { color: '#6b7280', fontSize: 10 },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: 'Ingresos',
          type: 'line',
          smooth: true,
          data: revenues,
          yAxisIndex: 0,
          areaStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(16, 185, 129, 0.3)' },
                { offset: 1, color: 'rgba(16, 185, 129, 0.05)' },
              ],
            },
          },
          lineStyle: { color: '#10b981', width: 2 },
          itemStyle: { color: '#10b981' },
        },
        {
          name: 'Órdenes',
          type: 'bar',
          data: orders,
          yAxisIndex: 1,
          itemStyle: { color: 'rgba(59, 130, 246, 0.6)', borderRadius: [2, 2, 0, 0] },
          barMaxWidth: 16,
        },
      ],
    });
  }

  private updateChannelChart(channels: SalesByChannel[]): void {
    if (!channels.length) return;

    const channelColors = channels.map((c) => {
      const config = CHANNEL_CONFIG[c.channel.toLowerCase()] || CHANNEL_CONFIG['default'];
      return config.color;
    });

    this.channelChartOptions.set({
      tooltip: {
        trigger: 'item',
        formatter: (params: any) =>
          `<strong>${params.name}</strong><br/>${this.currencyService.formatCompact(params.value)}<br/>${params.percent.toFixed(1)}%`,
      },
      legend: {
        bottom: 0,
        left: 'center',
        orient: 'horizontal',
        textStyle: { color: '#6b7280', fontSize: 10 },
        itemWidth: 12,
        itemHeight: 12,
        itemGap: 10,
      },
      calculable: true,
      series: [
        {
          name: 'Ventas por Canal',
          type: 'pie',
          radius: [30, 110],
          center: ['50%', '45%'],
          roseType: 'area',
          itemStyle: { borderRadius: 4, borderColor: '#fff', borderWidth: 2 },
          label: {
            show: true,
            fontSize: 11,
            color: '#374151',
          },
          labelLine: {
            show: true,
            length: 10,
            length2: 15,
            lineStyle: { color: '#9ca3af' },
          },
          emphasis: {
            label: { show: true, fontSize: 13, fontWeight: 'bold' },
            itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0, 0, 0, 0.2)' },
          },
          data: channels.map((c, i) => ({
            value: c.revenue,
            name: c.display_name || c.channel,
            itemStyle: { color: channelColors[i] },
          })),
        },
      ],
    });
  }

  // ── Helpers ──────────────────────────────────────────────

  formatCurrency(value: number): string {
    return this.currencyService.formatCompact(value);
  }

  getGrowthText(growth?: number): string {
    if (growth === undefined || growth === null) return '';
    const sign = growth >= 0 ? '+' : '';
    return `${sign}${growth.toFixed(1)}% vs mes ant.`;
  }

  navigateTo(path: string): void {
    // Handle paths with query params
    const [route, queryString] = path.split('?');
    if (queryString) {
      const params: Record<string, string> = {};
      queryString.split('&').forEach((pair) => {
        const [key, val] = pair.split('=');
        params[key] = val;
      });
      this.router.navigate([route], { queryParams: params });
    } else {
      this.router.navigate([route]);
    }
  }

  private getDateRangeFromPreset(preset: string): DateRangeFilter | null {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let start: Date;
    let end: Date;

    switch (preset) {
      case 'today':
        start = today; end = today; break;
      case 'yesterday':
        start = new Date(today); start.setDate(start.getDate() - 1); end = start; break;
      case 'thisWeek':
        start = new Date(today); start.setDate(start.getDate() - start.getDay()); end = today; break;
      case 'lastWeek':
        start = new Date(today); start.setDate(start.getDate() - start.getDay() - 7);
        end = new Date(start); end.setDate(end.getDate() + 6); break;
      case 'thisMonth':
        start = new Date(today.getFullYear(), today.getMonth(), 1); end = today; break;
      case 'lastMonth':
        start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        end = new Date(today.getFullYear(), today.getMonth(), 0); break;
      case 'thisYear':
        start = new Date(today.getFullYear(), 0, 1); end = today; break;
      case 'lastYear':
        start = new Date(today.getFullYear() - 1, 0, 1);
        end = new Date(today.getFullYear() - 1, 11, 31); break;
      default:
        return null;
    }
    return {
      start_date: start.toISOString().split('T')[0],
      end_date: end.toISOString().split('T')[0],
      preset: preset as any,
    };
  }

  private getMonthStartDate(): string {
    const date = new Date();
    date.setDate(1);
    return date.toISOString().split('T')[0];
  }

  private getMonthEndDate(): string {
    return new Date().toISOString().split('T')[0];
  }
}
