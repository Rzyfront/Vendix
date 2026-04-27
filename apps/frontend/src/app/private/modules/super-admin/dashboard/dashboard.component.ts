import {
  Component,
  OnInit,
  signal,
  computed,
  DestroyRef,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { EChartsOption } from 'echarts';

import { SuperAdminDashboardService, SuperAdminStats } from './services/super-admin-dashboard.service';
import { StatsComponent } from '../../../../shared/components';
import { ChartComponent } from '../../../../shared/components/chart';
import { CurrencyFormatService } from '../../../../shared/pipes/currency/currency.pipe';

interface StatCard {
  title: string;
  value: string;
  change: number;
  icon: string;
  iconBgColor: string;
  iconColor: string;
  subtitle?: string;
}

interface ActivityItem {
  id: string;
  type: 'organization' | 'user' | 'subscription' | 'payment' | 'store';
  title: string;
  description: string;
  timestamp: string;
  icon: string;
  color: string;
}

@Component({
  selector: 'app-super-admin-dashboard',
  standalone: true,
  imports: [StatsComponent, ChartComponent],
  template: `
    <div class="w-full space-y-4 pb-6">
      <!-- Stats Cards -->
      <div class="stats-container">
        @for (stat of statsData(); track stat.title) {
          <app-stats
            [title]="stat.title"
            [value]="stat.value"
            [smallText]="getTrendText(stat.change)"
            [iconName]="stat.icon"
            [iconBgColor]="stat.iconBgColor"
            [iconColor]="stat.iconColor"
          ></app-stats>
        }
      </div>

      <!-- Charts Section -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <!-- Revenue & Subscriptions Chart -->
        <div class="lg:col-span-2 bg-surface rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:border md:border-border overflow-hidden flex flex-col">
          <div class="p-4 border-b border-border">
            <h3 class="font-semibold text-text-primary text-sm">Ingresos y Suscripciones</h3>
            <p class="text-xs text-text-secondary">Últimos 6 meses</p>
          </div>
          <div class="p-4 flex-1">
            @if (isLoading()) {
              <div class="h-56 flex items-center justify-center">
                <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            } @else {
              <app-chart [options]="revenueChartOptions()" size="large"></app-chart>
            }
          </div>
        </div>

        <!-- Distribution Chart (Rose Pie) -->
        <div class="bg-surface rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:border md:border-border overflow-hidden flex flex-col">
          <div class="p-4 border-b border-border">
            <h3 class="font-semibold text-text-primary text-sm">Distribución de la Plataforma</h3>
            <p class="text-xs text-text-secondary">Entidades activas</p>
          </div>
          <div class="p-4 flex-1">
            @if (isLoading()) {
              <div class="h-56 flex items-center justify-center">
                <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            } @else {
              <app-chart [options]="distributionChartOptions()" size="large"></app-chart>
            }
          </div>
        </div>
      </div>

      <!-- Activity & Top Organizations -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <!-- Recent Activity -->
        <div class="bg-surface rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:border md:border-border overflow-hidden">
          <div class="px-4 py-3 border-b border-border">
            <h3 class="font-semibold text-text-primary text-sm">Actividad Reciente</h3>
          </div>
          <div class="p-3 space-y-0">
            @for (activity of recentActivities().slice(0, 6); track activity.id) {
              <div
                class="flex gap-3 py-2.5 transition-colors rounded-lg"
                style="border-bottom: 1px solid var(--color-border);"
              >
                <div
                  class="w-7 h-7 rounded-full flex items-center justify-center text-xs flex-shrink-0"
                  [style.background]="activity.color + '1a'"
                  [style.color]="activity.color"
                >
                  <i class="fas {{ activity.icon }}"></i>
                </div>
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium truncate text-text-primary">
                    {{ activity.title }}
                  </p>
                  <p class="text-xs truncate text-text-secondary">
                    {{ activity.description }}
                  </p>
                </div>
                <p class="text-[11px] whitespace-nowrap flex-shrink-0 mt-0.5 text-text-secondary">
                  {{ activity.timestamp }}
                </p>
              </div>
            }
            @if (recentActivities().length === 0) {
              <p class="text-sm text-center py-8 text-text-secondary">
                No hay actividad reciente
              </p>
            }
          </div>
        </div>

        <!-- Top Organizations -->
        <div class="bg-surface rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:border md:border-border overflow-hidden">
          <div class="px-4 py-3 border-b border-border">
            <h3 class="font-semibold text-text-primary text-sm">Principales Organizaciones</h3>
          </div>
          <div class="p-3 space-y-0">
            @for (org of topOrganizations(); track org.id; let i = $index) {
              <div
                class="flex items-center gap-3 py-2.5 rounded-lg transition-colors"
                style="border-bottom: 1px solid var(--color-border);"
              >
                <span
                  class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 text-white"
                  [style.background]="org.isPartner
                    ? 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)'
                    : 'linear-gradient(135deg, rgba(59, 130, 246, 0.8) 0%, rgba(59, 130, 246, 0.6) 100%)'"
                >{{ i + 1 }}</span>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <p class="text-sm font-medium truncate text-text-primary">
                      {{ org.name }}
                    </p>
                    @if (org.isPartner) {
                      <span
                        class="text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
                        style="background: rgba(245, 158, 11, 0.15); color: #d97706;"
                      >
                        Partner
                      </span>
                    }
                  </div>
                  <div class="flex items-center gap-2 mt-0.5">
                    <p class="text-xs text-text-secondary">
                      {{ org.stores }} tiendas &middot; {{ org.users }} usuarios
                    </p>
                    <span class="text-xs font-medium text-text-secondary">
                      &middot; {{ currencyService.formatCompact(org.revenue) }}
                    </span>
                  </div>
                </div>
                <div class="flex items-center gap-1 flex-shrink-0">
                  <i
                    class="fas text-xs"
                    [class.fa-arrow-up]="org.growth > 0"
                    [class.fa-arrow-down]="org.growth < 0"
                    [style.color]="org.growth > 0 ? 'var(--color-primary)' : 'var(--color-destructive)'"
                  ></i>
                  <span
                    class="text-xs font-bold"
                    [style.color]="org.growth > 0 ? 'var(--color-primary)' : 'var(--color-destructive)'"
                  >
                    {{ getAbsValue(org.growth) }}%
                  </span>
                </div>
              </div>
            }
            @if (topOrganizations().length === 0) {
              <p class="text-sm text-center py-8 text-text-secondary">
                No hay organizaciones
              </p>
            }
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .stats-container {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 1rem;
      }

      @media (max-width: 1024px) {
        .stats-container {
          grid-template-columns: repeat(2, 1fr);
        }
      }

      @media (max-width: 640px) {
        .stats-container {
          grid-template-columns: 1fr;
        }
      }
    `,
  ],
})
export class DashboardComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  readonly currencyService = inject(CurrencyFormatService);
  private dashboardService = inject(SuperAdminDashboardService);

  readonly isLoading = signal(false);
  readonly statsData = signal<StatCard[]>([]);
  readonly recentActivities = signal<ActivityItem[]>([]);
  readonly topOrganizations = signal<any[]>([]);
  readonly rawData = signal<SuperAdminStats | null>(null);

  readonly revenueChartOptions = computed<EChartsOption>(() => {
    const data = this.rawData();
    if (!data?.monthlyTrend) return {};

    const style = getComputedStyle(document.documentElement);
    const primaryColor = style.getPropertyValue('--color-primary').trim() || '#3b82f6';
    const accentColor = style.getPropertyValue('--color-accent').trim() || '#06b6d4';
    const mutedColor = style.getPropertyValue('--color-muted-foreground').trim() || '#6b7280';
    const borderColor = style.getPropertyValue('--color-border').trim() || '#e5e7eb';

    const months = data.monthlyTrend.map((m) => m.month);
    const revenues = data.monthlyTrend.map((m) => m.revenue);
    const subscriptions = data.monthlyTrend.map((m) => m.newSubscriptions);

    return {
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          const rev = params[0];
          const sub = params[1];
          return `<strong>${rev.name}</strong><br/>Ingresos: ${this.currencyService.formatCompact(rev.value)}<br/>Suscripciones: ${sub?.value || 0}`;
        },
      },
      legend: {
        data: ['Ingresos', 'Suscripciones'],
        bottom: 0,
        textStyle: { color: mutedColor, fontSize: 11 },
      },
      grid: { left: '3%', right: '4%', bottom: '15%', top: '5%', containLabel: true },
      xAxis: {
        type: 'category',
        data: months,
        axisLine: { lineStyle: { color: borderColor } },
        axisLabel: { color: mutedColor, fontSize: 10 },
      },
      yAxis: [
        {
          type: 'value',
          position: 'left',
          axisLine: { show: false },
          axisLabel: {
            color: mutedColor,
            fontSize: 10,
            formatter: (value: number) => this.currencyService.formatChartAxis(value),
          },
          splitLine: { lineStyle: { color: borderColor } },
        },
        {
          type: 'value',
          position: 'right',
          axisLine: { show: false },
          axisLabel: { color: mutedColor, fontSize: 10 },
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
                { offset: 0, color: primaryColor + '4D' },
                { offset: 1, color: primaryColor + '0D' },
              ],
            },
          },
          lineStyle: { color: primaryColor, width: 2 },
          itemStyle: { color: primaryColor },
        },
        {
          name: 'Suscripciones',
          type: 'bar',
          data: subscriptions,
          yAxisIndex: 1,
          barMaxWidth: 16,
          itemStyle: { color: accentColor + '99', borderRadius: [2, 2, 0, 0] },
        },
      ],
    } as EChartsOption;
  });

  readonly distributionChartOptions = computed<EChartsOption>(() => {
    const data = this.rawData();
    if (!data) return {};

    const style = getComputedStyle(document.documentElement);
    const mutedColor = style.getPropertyValue('--color-muted-foreground').trim() || '#6b7280';
    const textColor = style.getPropertyValue('--color-text-primary').trim() || '#374151';
    const surfaceColor = style.getPropertyValue('--color-surface').trim() || '#fff';
    const primaryColor = style.getPropertyValue('--color-primary').trim() || '#3b82f6';
    const secondaryColor = style.getPropertyValue('--color-secondary').trim() || '#06b6d4';
    const accentColor = style.getPropertyValue('--color-accent').trim() || '#8b5cf6';
    const warningColor = style.getPropertyValue('--color-warning').trim() || '#f59e0b';

    const chartData = [
      { value: data.totalOrganizations || 0, name: 'Organizaciones', itemStyle: { color: primaryColor } },
      { value: data.activeStores || 0, name: 'Tiendas Activas', itemStyle: { color: secondaryColor } },
      { value: data.totalUsers || 0, name: 'Usuarios', itemStyle: { color: accentColor } },
      { value: data.activeSubscriptions || 0, name: 'Suscripciones', itemStyle: { color: warningColor } },
    ].filter((d) => d.value > 0);

    if (chartData.length === 0) return {};

    return {
      tooltip: {
        trigger: 'item',
        formatter: (params: any) =>
          `<strong>${params.name}</strong><br/>${params.value.toLocaleString()}<br/>${params.percent.toFixed(1)}%`,
      },
      legend: {
        bottom: 0,
        left: 'center',
        orient: 'horizontal',
        textStyle: { color: mutedColor, fontSize: 10 },
        itemWidth: 12,
        itemHeight: 12,
        itemGap: 10,
      },
      calculable: true,
      series: [
        {
          name: 'Distribución',
          type: 'pie',
          radius: [30, 110],
          center: ['50%', '45%'],
          roseType: 'area',
          itemStyle: { borderRadius: 4, borderColor: surfaceColor, borderWidth: 2 },
          label: {
            show: true,
            fontSize: 11,
            color: textColor,
          },
          labelLine: {
            show: true,
            length: 10,
            length2: 15,
            lineStyle: { color: mutedColor },
          },
          emphasis: {
            label: { show: true, fontSize: 13, fontWeight: 'bold' },
            itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0, 0, 0, 0.2)' },
          },
          data: chartData,
        },
      ],
    } as EChartsOption;
  });

  ngOnInit(): void {
    this.loadDashboardData();
  }

  private loadDashboardData(): void {
    this.isLoading.set(true);

    this.dashboardService
      .getDashboardStats()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.rawData.set(data);
          this.updateStatsData(data);
          this.updateRecentActivities(data);
          this.updateTopOrganizations(data);
          this.isLoading.set(false);
        },
        error: (error) => {
          console.error('Error loading dashboard data:', error);
          this.isLoading.set(false);
        },
      });
  }

  private updateStatsData(data: SuperAdminStats): void {
    this.statsData.set([
      {
        title: 'Ingresos del Mes',
        value: this.currencyService.formatCompact(data.currentMonthRevenue),
        change: data.revenueGrowth || 0,
        icon: 'dollar-sign',
        iconBgColor: 'bg-blue-100',
        iconColor: 'text-blue-600',
        subtitle: `vs ${this.currencyService.formatCompact(data.lastMonthRevenue)} mes anterior`,
      },
      {
        title: 'MRR',
        value: this.currencyService.formatCompact(data.mrr),
        change: data.activeSubscriptions > 0 ? Math.round((data.activeSubscriptions / Math.max(data.totalSubscriptions, 1)) * 100) : 0,
        icon: 'trending-up',
        iconBgColor: 'bg-emerald-100',
        iconColor: 'text-emerald-600',
        subtitle: `${data.activeSubscriptions} suscripciones activas`,
      },
      {
        title: 'Suscripciones',
        value: `${data.activeSubscriptions}`,
        change: data.pendingInvoices + data.overdueInvoices,
        icon: 'credit-card',
        iconBgColor: 'bg-purple-100',
        iconColor: 'text-purple-600',
        subtitle: `${data.pendingInvoices + data.overdueInvoices} pendientes &middot; ${data.churnRate}% churn`,
      },
      {
        title: 'Organizaciones',
        value: data.totalOrganizations?.toLocaleString() || '0',
        change: data.organizationGrowth || 0,
        icon: 'building',
        iconBgColor: 'bg-cyan-100',
        iconColor: 'text-cyan-600',
        subtitle: `${data.activeStores} tiendas activas`,
      },
    ]);
  }

  private updateRecentActivities(data: SuperAdminStats): void {
    this.recentActivities.set(
      data.recentActivities?.map((activity) => ({
        id: activity.id,
        type: activity.type,
        title: activity.description,
        description: activity.entityName,
        timestamp: this.formatTimestamp(activity.timestamp),
        icon: this.getActivityIcon(activity.type),
        color: this.getActivityColor(activity.type),
      })) || [],
    );
  }

  private updateTopOrganizations(data: SuperAdminStats): void {
    this.topOrganizations.set(data.topOrganizations || []);
  }

  private formatTimestamp(timestamp: Date | string): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMinutes = Math.floor(diffMs / (1000 * 60));

    if (diffMinutes < 1) return 'ahora';
    if (diffMinutes < 60) return `hace ${diffMinutes} min`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `hace ${diffHours}h`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `hace ${diffDays}d`;
    return date.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
  }

  private getActivityIcon(type: string): string {
    const icons: Record<string, string> = {
      organization: 'fa-building',
      user: 'fa-user',
      store: 'fa-store',
      subscription: 'fa-credit-card',
      payment: 'fa-receipt',
    };
    return icons[type] || 'fa-info-circle';
  }

  private getActivityColor(type: string): string {
    const colors: Record<string, string> = {
      organization: '#3b82f6',
      user: '#06b6d4',
      store: '#10b981',
      subscription: '#8b5cf6',
      payment: '#f59e0b',
    };
    return colors[type] || '#6b7280';
  }

  getTrendText(change: number): string {
    const icon = change >= 0 ? '↑' : '↓';
    const absValue = Math.abs(change);
    const sign = change >= 0 ? '+' : '';
    return `${icon} ${sign}${absValue}% vs mes anterior`;
  }

  getAbsValue(value: number): number {
    return Math.abs(value);
  }
}
