import { Component, OnInit, OnDestroy, inject, signal, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { EChartsOption } from 'echarts';

import { StatsComponent } from '../../../../../shared/components/stats/stats.component';
import { ChartComponent } from '../../../../../shared/components/chart/chart.component';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { DashboardTabsComponent, DashboardTab } from './dashboard-tabs.component';

import { AnalyticsService } from '../../analytics/services/analytics.service';
import { StoreDashboardService, RecentOrder } from '../services/store-dashboard.service';
import {
  SalesSummary,
  SalesTrend,
  SalesByChannel,
  SalesAnalyticsQueryDto,
} from '../../analytics/interfaces/sales-analytics.interface';
import { DateRangeFilter } from '../../analytics/interfaces/analytics.interface';

// Channel configuration for colors
const CHANNEL_CONFIG: Record<string, { color: string }> = {
  pos: { color: '#3b82f6' },
  ecommerce: { color: '#10b981' },
  whatsapp: { color: '#22c55e' },
  agent: { color: '#8b5cf6' },
  marketplace: { color: '#f59e0b' },
  default: { color: '#6b7280' },
};

@Component({
  selector: 'app-dashboard-overview',
  standalone: true,
  imports: [CommonModule, StatsComponent, ChartComponent, IconComponent, DashboardTabsComponent],
  template: `
    <div class="space-y-4">
      <!-- Stats Cards - Sticky on mobile, static on desktop -->
      @if (loading()) {
        <div class="stats-container !mb-0 md:!mb-8 ">
          @for (i of [1, 2, 3, 4]; track i) {
            <div class="bg-surface rounded-xl p-4 animate-pulse shadow-[0_2px_8px_rgba(0,0,0,0.07)]">
              <div class="h-3 bg-gray-200 rounded w-1/2 mb-3"></div>
              <div class="h-7 bg-gray-200 rounded w-3/4"></div>
            </div>
          }
        </div>
      } @else {
        <div class="stats-container !mb-0 md:!mb-8 ">
          <app-stats
            title="Ingresos"
            [value]="formatCurrency(summary()?.total_revenue || 0)"
            [smallText]="getGrowthText(summary()?.revenue_growth)"
            iconName="dollar-sign"
            iconBgColor="bg-emerald-100"
            iconColor="text-emerald-500"
          ></app-stats>

          <app-stats
            title="Órdenes"
            [value]="summary()?.total_orders || 0"
            [smallText]="getGrowthText(summary()?.orders_growth)"
            iconName="shopping-cart"
            iconBgColor="bg-blue-100"
            iconColor="text-blue-500"
          ></app-stats>

          <app-stats
            title="Ticket Prom."
            [value]="formatCurrency(summary()?.average_order_value || 0)"
            iconName="receipt"
            iconBgColor="bg-purple-100"
            iconColor="text-purple-500"
          ></app-stats>

          <app-stats
            title="Clientes"
            [value]="summary()?.total_customers || 0"
            iconName="users"
            iconBgColor="bg-amber-100"
            iconColor="text-amber-500"
          ></app-stats>
        </div>
      }

      <!-- Tab Navigation (after stats) -->
      <app-dashboard-tabs
        [tabs]="tabs()"
        [activeTab]="activeTab()"
        (tabChange)="tabChange.emit($event)"
      ></app-dashboard-tabs>

      <!-- Charts Row -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <!-- Sales Trend Chart -->
        <div class="bg-surface rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:border md:border-border overflow-hidden">
          <div class="p-4 border-b border-border">
            <h3 class="font-semibold text-text-primary text-sm">Tendencia de Ventas</h3>
            <p class="text-xs text-text-secondary">Últimos 30 días</p>
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
            <p class="text-xs text-text-secondary">Distribución del mes</p>
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

      <!-- Bottom Section: Recent Orders + Alerts -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <!-- Recent Orders -->
        <div class="lg:col-span-2 bg-surface rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:border md:border-border overflow-hidden">
          <div class="px-4 py-3 border-b border-border flex justify-between items-center">
            <h3 class="font-semibold text-text-primary text-sm">Órdenes Recientes</h3>
            <button
              class="text-xs text-primary hover:text-primary/80 font-medium"
              (click)="viewAllOrders()"
            >
              Ver todas →
            </button>
          </div>

          @if (loadingOrders()) {
            <div class="p-8 flex items-center justify-center">
              <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
            </div>
          } @else if (!hasRecentOrders()) {
            <div class="p-6 text-center">
              <app-icon name="shopping-cart" [size]="36" class="text-gray-300 mx-auto mb-2"></app-icon>
              <p class="text-text-secondary text-sm">No hay órdenes recientes</p>
            </div>
          } @else {
            <div class="divide-y divide-gray-100">
              @for (order of recentOrders().slice(0, 5); track order.id) {
                <div
                  class="p-3 hover:bg-gray-50 transition-colors cursor-pointer flex items-center gap-3"
                  (click)="viewOrder(order.id)"
                >
                  <div class="flex-shrink-0">
                    <div
                      class="w-8 h-8 rounded-full flex items-center justify-center"
                      [ngClass]="getStatusIconBg(order.status)"
                    >
                      <app-icon
                        [name]="getStatusIcon(order.status)"
                        [size]="14"
                        [ngClass]="getStatusIconColor(order.status)"
                      ></app-icon>
                    </div>
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center justify-between mb-0.5">
                      <h4 class="text-sm font-medium text-gray-900 truncate">
                        {{ order.customerName || 'Consumidor Final' }}
                      </h4>
                      <span
                        class="text-[10px] font-medium px-2 py-0.5 rounded-full ml-2"
                        [ngClass]="getStatusBadgeClass(order.status)"
                      >
                        {{ getStatusLabel(order.status) }}
                      </span>
                    </div>
                    <div class="flex items-center gap-2 text-xs text-gray-500">
                      <span>{{ formatRelativeTime(order.timestamp) }}</span>
                      <span>•</span>
                      <span>{{ order.items }} items</span>
                    </div>
                  </div>
                  <div class="flex-shrink-0">
                    <div class="text-sm font-semibold text-gray-900">
                      {{ formatCurrency(order.amount) }}
                    </div>
                  </div>
                </div>
              }
            </div>
          }
        </div>

        <!-- Alerts Panel -->
        <div class="bg-surface rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:border md:border-border overflow-hidden">
          <div class="px-4 py-3 border-b border-border">
            <h3 class="font-semibold text-text-primary text-sm">Alertas</h3>
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
                  (click)="navigateTo('/admin/reports/inventory/low-stock')"
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
                  (click)="navigateTo('/admin/reports/inventory/stock-levels')"
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

              @if (lowStockCount() === 0 && outOfStockCount() === 0) {
                <div class="py-4 text-center">
                  <div class="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-2">
                    <app-icon name="check-circle" [size]="20" class="text-emerald-600"></app-icon>
                  </div>
                  <p class="text-sm font-medium text-gray-700">Todo en orden</p>
                  <p class="text-xs text-gray-500">Sin alertas pendientes</p>
                </div>
              }

              <!-- Quick Links -->
              <div class="pt-2 border-t border-gray-100 mt-2">
                <div class="space-y-1">
                  <button
                    class="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg transition-colors text-left"
                    (click)="navigateTo('/admin/reports/sales/summary')"
                  >
                    <app-icon name="trending-up" [size]="14" class="text-gray-400"></app-icon>
                    Reportes de ventas
                  </button>
                  <button
                    class="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg transition-colors text-left"
                    (click)="navigateTo('/admin/reports/inventory/summary')"
                  >
                    <app-icon name="package" [size]="14" class="text-gray-400"></app-icon>
                    Ver inventario
                  </button>
                </div>
              </div>
            }
          </div>
        </div>
      </div>
    </div>
  `,
})
export class DashboardOverviewComponent implements OnInit, OnDestroy {
  private analyticsService = inject(AnalyticsService);
  private dashboardService = inject(StoreDashboardService);
  private toastService = inject(ToastService);
  private router = inject(Router);
  private destroy$ = new Subject<void>();

  storeId = input.required<string>();
  tabs = input.required<DashboardTab[]>();
  activeTab = input.required<string>();
  tabChange = output<string>();

  loading = signal(true);
  loadingTrends = signal(true);
  loadingChannels = signal(true);
  loadingOrders = signal(true);
  loadingAlerts = signal(true);

  summary = signal<SalesSummary | null>(null);
  trends = signal<SalesTrend[]>([]);
  channels = signal<SalesByChannel[]>([]);
  recentOrders = signal<RecentOrder[]>([]);
  lowStockCount = signal(0);
  outOfStockCount = signal(0);

  trendChartOptions = signal<EChartsOption>({});
  channelChartOptions = signal<EChartsOption>({});

  private dateRange: DateRangeFilter = {
    start_date: this.getMonthStartDate(),
    end_date: this.getMonthEndDate(),
    preset: 'thisMonth',
  };

  ngOnInit(): void {
    this.loadAllData();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadAllData(): void {
    const query: SalesAnalyticsQueryDto = { date_range: this.dateRange };

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

    this.dashboardService
      .getDashboardStats(this.storeId())
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (stats) => {
          this.recentOrders.set(stats.recentOrders || []);
          this.loadingOrders.set(false);
        },
        error: () => this.loadingOrders.set(false),
      });

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
          const data = params[0];
          const ordersData = params[1];
          return `<strong>${data.name}</strong><br/>Ingresos: $${data.value.toLocaleString()}<br/>Órdenes: ${ordersData?.value || 0}`;
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
            formatter: (value: number) => value >= 1000 ? `$${(value / 1000).toFixed(0)}K` : `$${value}`,
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
        formatter: (params: any) => `<strong>${params.name}</strong><br/>$${params.value.toLocaleString()}<br/>${params.percent.toFixed(1)}%`,
      },
      legend: {
        orient: 'vertical',
        right: '5%',
        top: 'center',
        textStyle: { color: '#6b7280', fontSize: 11 },
      },
      series: [
        {
          name: 'Ventas por Canal',
          type: 'pie',
          radius: ['40%', '65%'],
          center: ['35%', '50%'],
          avoidLabelOverlap: true,
          itemStyle: { borderRadius: 4, borderColor: '#fff', borderWidth: 2 },
          label: { show: false },
          emphasis: { label: { show: true, fontSize: 12, fontWeight: 'bold' } },
          labelLine: { show: false },
          data: channels.map((c, i) => ({
            value: c.revenue,
            name: c.display_name || c.channel,
            itemStyle: { color: channelColors[i] },
          })),
        },
      ],
    });
  }

  hasRecentOrders(): boolean {
    return this.recentOrders().length > 0;
  }

  formatCurrency(value: number): string {
    if (value >= 1000000) return '$' + (value / 1000000).toFixed(1) + 'M';
    if (value >= 1000) return '$' + (value / 1000).toFixed(1) + 'K';
    return '$' + value.toFixed(0);
  }

  getGrowthText(growth?: number): string {
    if (growth === undefined || growth === null) return '';
    const sign = growth >= 0 ? '+' : '';
    return `${sign}${growth.toFixed(1)}% vs mes ant.`;
  }

  formatRelativeTime(timestamp: Date): string {
    const now = new Date();
    const date = new Date(timestamp);
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Ahora';
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;
    return date.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
  }

  getStatusIconBg(status: string): string {
    const bgMap: Record<string, string> = {
      pending: 'bg-yellow-100', processing: 'bg-blue-100', shipped: 'bg-indigo-100',
      delivered: 'bg-emerald-100', finished: 'bg-emerald-100', cancelled: 'bg-red-100',
    };
    return bgMap[status] || 'bg-gray-100';
  }

  getStatusIconColor(status: string): string {
    const colorMap: Record<string, string> = {
      pending: 'text-yellow-600', processing: 'text-blue-600', shipped: 'text-indigo-600',
      delivered: 'text-emerald-600', finished: 'text-emerald-600', cancelled: 'text-red-600',
    };
    return colorMap[status] || 'text-gray-600';
  }

  getStatusIcon(status: string): string {
    const iconMap: Record<string, string> = {
      pending: 'clock', processing: 'refresh-cw', shipped: 'truck',
      delivered: 'check-circle', finished: 'check-circle', cancelled: 'x-circle',
    };
    return iconMap[status] || 'package';
  }

  getStatusBadgeClass(status: string): string {
    const classMap: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-800', processing: 'bg-blue-100 text-blue-800',
      shipped: 'bg-indigo-100 text-indigo-800', delivered: 'bg-emerald-100 text-emerald-800',
      finished: 'bg-emerald-100 text-emerald-800', cancelled: 'bg-red-100 text-red-800',
    };
    return classMap[status] || 'bg-gray-100 text-gray-800';
  }

  getStatusLabel(status: string): string {
    const labelMap: Record<string, string> = {
      pending: 'Pendiente', processing: 'Procesando', shipped: 'Enviado',
      delivered: 'Entregado', finished: 'Completado', cancelled: 'Cancelado',
    };
    return labelMap[status] || status;
  }

  viewOrder(orderId: string): void {
    this.router.navigate(['/admin/orders/sales', orderId]);
  }

  viewAllOrders(): void {
    this.router.navigate(['/admin/orders/sales']);
  }

  navigateTo(path: string): void {
    this.router.navigate([path]);
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
