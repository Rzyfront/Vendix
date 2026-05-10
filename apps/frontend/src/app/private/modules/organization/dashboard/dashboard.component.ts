import {
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { EChartsOption } from 'echarts';

import {
  ChartComponent,
  EmptyStateComponent,
  IconComponent,
  StatsComponent,
} from '../../../../shared/components';
import type { IconName } from '../../../../shared/components/icon/icons.registry';
import { CurrencyFormatService } from '../../../../shared/pipes/currency/currency.pipe';
import { GlobalFacade } from '../../../../core/store/global.facade';
import { OrganizationDashboardService } from './services/organization-dashboard.service';
import type {
  OrganizationActivityRecord,
  OrganizationDashboardStats,
  StoreDistributionPoint,
} from './services/organization-dashboard.service';

type DashboardPeriod = '6m' | '1y' | 'all';
type Tone =
  | 'primary'
  | 'secondary'
  | 'accent'
  | 'success'
  | 'warning'
  | 'error';

interface PeriodOption {
  value: DashboardPeriod;
  label: string;
}

interface StatCard {
  title: string;
  value: string | number;
  smallText: string;
  icon: IconName;
  iconBgColor: string;
  iconColor: string;
}

interface ActivityItem {
  id: string;
  title: string;
  description: string;
  timestamp: string;
  icon: IconName;
  tone: Tone;
  sortTime: number;
}

interface DistributionRow {
  label: string;
  value: number;
  valueLabel: string;
  percentageLabel: string;
  percent: number;
  color: string;
}

const PERIOD_OPTIONS: PeriodOption[] = [
  { value: '6m', label: '6M' },
  { value: '1y', label: '1A' },
  { value: 'all', label: 'Todo' },
];

@Component({
  selector: 'app-organization-dashboard',
  standalone: true,
  imports: [ChartComponent, EmptyStateComponent, IconComponent, StatsComponent],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
})
export class DashboardComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly currencyService = inject(CurrencyFormatService);
  private readonly organizationDashboardService = inject(
    OrganizationDashboardService,
  );
  private readonly route = inject(ActivatedRoute);
  private readonly globalFacade = inject(GlobalFacade);

  readonly isLoading = signal(false);
  readonly organizationId = signal<string>('');
  readonly dashboardStats = signal<OrganizationDashboardStats | null>(null);
  readonly selectedPeriod = signal<DashboardPeriod>('6m');
  readonly periodOptions = PERIOD_OPTIONS;

  readonly statsData = computed<StatCard[]>(() => {
    const stats = this.dashboardStats()?.stats;
    const revenueDiff = Number(stats?.revenue?.sub_value || 0);

    return [
      {
        title: 'Total de Tiendas',
        value: this.formatInteger(stats?.total_stores?.value),
        smallText: `${this.formatInteger(stats?.total_stores?.sub_value)} nuevas este mes`,
        icon: 'store',
        iconBgColor: 'bg-primary/10',
        iconColor: 'text-primary',
      },
      {
        title: 'Usuarios Activos',
        value: this.formatInteger(stats?.active_users?.value),
        smallText: `${this.formatInteger(stats?.active_users?.sub_value)} en línea ahora`,
        icon: 'users',
        iconBgColor: 'bg-secondary/10',
        iconColor: 'text-secondary',
      },
      {
        title: 'Pedidos Mensuales',
        value: this.formatInteger(stats?.monthly_orders?.value),
        smallText: `${this.formatInteger(stats?.monthly_orders?.sub_value)} pedidos hoy`,
        icon: 'shopping-cart',
        iconBgColor: 'bg-warning/10',
        iconColor: 'text-warning',
      },
      {
        title: 'Ganancia',
        value: this.formatCurrency(stats?.revenue?.value || 0),
        smallText: `${this.formatSignedCurrency(revenueDiff)} vs mes anterior`,
        icon: 'dollar-sign',
        iconBgColor: revenueDiff >= 0 ? 'bg-success/10' : 'bg-error/10',
        iconColor: revenueDiff >= 0 ? 'text-success' : 'text-error',
      },
    ];
  });

  readonly revenueTrend = computed(
    () => this.dashboardStats()?.profit_trend || [],
  );
  readonly hasRevenueTrend = computed(() => this.revenueTrend().length > 0);

  readonly storeDistribution = computed(
    () => this.dashboardStats()?.store_distribution || [],
  );

  readonly distributionUsesRevenue = computed(() =>
    this.storeDistribution().some((item) => Number(item.revenue || 0) > 0),
  );

  readonly distributionMetricLabel = computed(() =>
    this.distributionUsesRevenue() ? 'Ingresos' : 'Tiendas',
  );

  readonly distributionRows = computed<DistributionRow[]>(() => {
    const colors = this.getDistributionColors();
    const rows = this.storeDistribution()
      .map((item, index) => {
        const value = this.getDistributionValue(item);

        return {
          label: this.getStoreTypeLabel(item.type),
          value,
          valueLabel: this.formatDistributionValue(value),
          percentageLabel: '0%',
          percent: 0,
          color: colors[index % colors.length],
        };
      })
      .filter((row) => row.value > 0);

    const total = rows.reduce((sum, row) => sum + row.value, 0);

    return rows.map((row) => {
      const percent = total > 0 ? (row.value / total) * 100 : 0;

      return {
        ...row,
        percent,
        percentageLabel: `${percent.toFixed(1)}%`,
      };
    });
  });

  readonly distributionTotalLabel = computed(() => {
    const total = this.distributionRows().reduce(
      (sum, row) => sum + row.value,
      0,
    );
    return this.formatDistributionValue(total);
  });

  readonly activityItems = computed<ActivityItem[]>(() => {
    const data = this.dashboardStats();
    const audit = this.normalizeActivityCollection(
      data?.recent_audit || [],
      'audit',
    );
    const store = this.normalizeActivityCollection(
      data?.store_activity || [],
      'store',
    );

    return [...audit, ...store]
      .sort((a, b) => b.sortTime - a.sortTime)
      .slice(0, 6);
  });

  readonly revenueChartOptions = computed<EChartsOption>(() => {
    const trend = this.revenueTrend();
    if (!trend.length) return {};

    const primaryColor = this.getCssVar('--color-primary', '#2ecc71');
    const successColor = this.getCssVar('--color-success', '#22c55e');
    const errorColor = this.getCssVar('--color-error', '#ef4444');
    const mutedColor = this.getCssVar('--color-text-muted', '#94a3b8');
    const borderColor = this.getCssVar('--color-border', '#e6edf3');

    const labels = trend.map(
      (item) => `${item.month} ${String(item.year).slice(-2)}`,
    );
    const revenues = trend.map((item) => Number(item.revenue || 0));
    const costs = trend.map((item) => Number(item.costs || 0));
    const profits = trend.map((item) => Number(item.amount || 0));

    return {
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => this.formatRevenueTooltip(params),
      },
      legend: {
        data: ['Ingresos', 'Costos', 'Ganancia neta'],
        bottom: 0,
        textStyle: { color: mutedColor, fontSize: 11 },
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '15%',
        top: '5%',
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: labels,
        axisLine: { lineStyle: { color: borderColor } },
        axisLabel: { color: mutedColor, fontSize: 10 },
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisLabel: {
          color: mutedColor,
          fontSize: 10,
          formatter: (value: number) =>
            this.currencyService.formatChartAxis(value),
        },
        splitLine: { lineStyle: { color: borderColor } },
      },
      series: [
        {
          name: 'Ingresos',
          type: 'line',
          smooth: true,
          data: revenues,
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: `${primaryColor}4D` },
                { offset: 1, color: `${primaryColor}0D` },
              ],
            },
          },
          lineStyle: { color: primaryColor, width: 2 },
          itemStyle: { color: primaryColor },
        },
        {
          name: 'Costos',
          type: 'bar',
          data: costs,
          barMaxWidth: 16,
          itemStyle: { color: `${errorColor}99`, borderRadius: [2, 2, 0, 0] },
        },
        {
          name: 'Ganancia neta',
          type: 'line',
          smooth: true,
          data: profits,
          symbolSize: 6,
          lineStyle: { color: successColor, width: 2 },
          itemStyle: { color: successColor },
        },
      ],
    } as EChartsOption;
  });

  readonly storeDistributionChartOptions = computed<EChartsOption>(() => {
    const rows = this.distributionRows();
    if (!rows.length) return {};

    const mutedColor = this.getCssVar('--color-text-muted', '#94a3b8');
    const textColor = this.getCssVar('--color-text-primary', '#0f172a');
    const surfaceColor = this.getCssVar('--color-surface', '#ffffff');

    return {
      tooltip: {
        trigger: 'item',
        formatter: (params: any) => {
          const value = Number(params.value || 0);
          return `<strong>${params.name}</strong><br/>${this.formatDistributionValue(value)}<br/>${params.percent.toFixed(1)}%`;
        },
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
          name: 'Distribución de ventas',
          type: 'pie',
          radius: [30, 110],
          center: ['50%', '45%'],
          roseType: 'area',
          itemStyle: {
            borderRadius: 4,
            borderColor: surfaceColor,
            borderWidth: 2,
          },
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
            itemStyle: {
              shadowBlur: 10,
              shadowOffsetX: 0,
              shadowColor: 'rgba(0, 0, 0, 0.2)',
            },
          },
          data: rows.map((row) => ({
            value: row.value,
            name: row.label,
            itemStyle: { color: row.color },
          })),
        },
      ],
    } as EChartsOption;
  });

  ngOnInit(): void {
    this.currencyService.loadCurrency();
    this.resolveOrganizationId();
  }

  onPeriodChange(period: DashboardPeriod): void {
    if (this.selectedPeriod() === period) return;

    this.selectedPeriod.set(period);
    this.loadDashboardData();
  }

  getPeriodButtonClass(period: DashboardPeriod): string {
    const base =
      'min-w-11 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';

    return this.selectedPeriod() === period
      ? `${base} bg-primary text-white shadow-sm`
      : `${base} text-text-secondary hover:bg-surface hover:text-text-primary`;
  }

  getActivityIconContainerClass(tone: Tone): string {
    const toneClass = {
      primary: 'bg-primary/10',
      secondary: 'bg-secondary/10',
      accent: 'bg-accent/10',
      success: 'bg-success/10',
      warning: 'bg-warning/10',
      error: 'bg-error/10',
    }[tone];

    return `w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${toneClass}`;
  }

  getActivityIconClass(tone: Tone): string {
    return {
      primary: 'text-primary',
      secondary: 'text-secondary',
      accent: 'text-accent',
      success: 'text-success',
      warning: 'text-warning',
      error: 'text-error',
    }[tone];
  }

  private resolveOrganizationId(): void {
    const context = this.globalFacade.getUserContext();
    const orgIdFromContext = context?.organization?.id;
    const orgIdFromUser = context?.user?.organization_id;
    const routeId = this.route.snapshot.paramMap.get('id');
    const resolvedId = orgIdFromContext || orgIdFromUser || routeId;

    if (resolvedId) {
      this.organizationId.set(String(resolvedId));
      this.loadDashboardData();
      return;
    }

    this.globalFacade.userContext$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((userContext) => {
        const orgId =
          userContext?.organization?.id || userContext?.user?.organization_id;
        if (!orgId || this.organizationId() === String(orgId)) return;

        this.organizationId.set(String(orgId));
        this.loadDashboardData();
      });
  }

  private loadDashboardData(): void {
    const organizationId = this.organizationId();
    if (!organizationId) return;

    this.isLoading.set(true);

    this.organizationDashboardService
      .getDashboardStats(organizationId, this.selectedPeriod())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.dashboardStats.set(data);
          this.isLoading.set(false);
        },
        error: (error) => {
          console.error('Error loading organization dashboard data:', error);
          this.isLoading.set(false);
        },
      });
  }

  private normalizeActivityCollection(
    records: OrganizationActivityRecord[],
    source: string,
  ): ActivityItem[] {
    return records.map((record, index) =>
      this.normalizeActivity(record, source, index),
    );
  }

  private normalizeActivity(
    record: OrganizationActivityRecord,
    source: string,
    index: number,
  ): ActivityItem {
    const type =
      this.readString(record.type) || this.readString(record.action) || source;
    const rawTimestamp =
      record.timestamp ||
      record.created_at ||
      record.createdAt ||
      record.updated_at ||
      record.updatedAt;
    const timestamp = rawTimestamp ? new Date(rawTimestamp) : null;

    return {
      id: String(record.id || `${source}-${index}`),
      title:
        this.readString(record.title) ||
        this.readString(record.action) ||
        this.getActivityFallbackTitle(type),
      description:
        this.readString(record.description) ||
        this.readString(record.entity_name) ||
        this.readString(record.entityName) ||
        this.readString(record.store_name) ||
        this.readString(record.storeName) ||
        this.readString(record.user_name) ||
        this.readString(record.userName) ||
        'Actualización registrada en la organización',
      timestamp: timestamp ? this.formatTimestamp(timestamp) : 'reciente',
      icon: this.getActivityIcon(type),
      tone: this.getActivityTone(type),
      sortTime:
        timestamp && !Number.isNaN(timestamp.getTime())
          ? timestamp.getTime()
          : 0,
    };
  }

  private getActivityFallbackTitle(type: string): string {
    const normalized = type.toLowerCase();

    if (normalized.includes('store') || normalized.includes('tienda')) {
      return 'Actividad de tienda';
    }
    if (normalized.includes('user') || normalized.includes('usuario')) {
      return 'Actividad de usuario';
    }
    if (normalized.includes('order') || normalized.includes('pedido')) {
      return 'Pedido actualizado';
    }
    if (normalized.includes('payment') || normalized.includes('revenue')) {
      return 'Actividad financiera';
    }

    return 'Actividad registrada';
  }

  private getActivityIcon(type: string): IconName {
    const normalized = type.toLowerCase();

    if (normalized.includes('store') || normalized.includes('tienda'))
      return 'store';
    if (normalized.includes('user') || normalized.includes('usuario'))
      return 'user';
    if (normalized.includes('order') || normalized.includes('pedido'))
      return 'shopping-cart';
    if (normalized.includes('payment') || normalized.includes('revenue'))
      return 'receipt';
    if (normalized.includes('audit')) return 'shield';

    return 'activity';
  }

  private getActivityTone(type: string): Tone {
    const normalized = type.toLowerCase();

    if (normalized.includes('store') || normalized.includes('tienda'))
      return 'primary';
    if (normalized.includes('user') || normalized.includes('usuario'))
      return 'secondary';
    if (normalized.includes('order') || normalized.includes('pedido'))
      return 'warning';
    if (normalized.includes('payment') || normalized.includes('revenue'))
      return 'success';
    if (normalized.includes('error') || normalized.includes('delete'))
      return 'error';

    return 'accent';
  }

  private getStoreTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      online: 'En línea',
      offline: 'Física',
      physical: 'Física',
      hybrid: 'Híbrida',
      popup: 'Pop-up',
      kiosko: 'Kiosko',
      kiosk: 'Kiosko',
    };

    return labels[type?.toLowerCase()] || this.capitalize(type || 'Sin tipo');
  }

  private getDistributionValue(item: StoreDistributionPoint): number {
    return this.distributionUsesRevenue()
      ? Number(item.revenue || 0)
      : Number(item.count || 0);
  }

  private formatDistributionValue(value: number): string {
    if (this.distributionUsesRevenue()) {
      return this.currencyService.formatCompact(value || 0);
    }

    return `${this.formatInteger(value)} tiendas`;
  }

  private formatRevenueTooltip(params: any): string {
    const rows = Array.isArray(params) ? params : [params];
    const title = rows[0]?.axisValueLabel || rows[0]?.name || '';
    const body = rows
      .map(
        (item: any) =>
          `${item.marker}${item.seriesName}: ${this.currencyService.formatCompact(Number(item.value) || 0)}`,
      )
      .join('<br/>');

    return `<strong>${title}</strong><br/>${body}`;
  }

  private formatTimestamp(date: Date): string {
    if (Number.isNaN(date.getTime())) return 'reciente';

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMinutes = Math.floor(diffMs / (1000 * 60));

    if (diffMinutes < 1) return 'ahora';
    if (diffMinutes < 60) return `hace ${diffMinutes} min`;

    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `hace ${diffHours}h`;

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `hace ${diffDays}d`;

    return date.toLocaleDateString('es-CO', {
      day: 'numeric',
      month: 'short',
    });
  }

  private formatCurrency(value: number): string {
    return this.currencyService.format(value || 0, 0);
  }

  private formatSignedCurrency(value: number): string {
    if (value === 0) return this.formatCurrency(0);

    const sign = value > 0 ? '+' : '-';
    return `${sign}${this.formatCurrency(Math.abs(value))}`;
  }

  private formatInteger(value?: number): string {
    return Number(value || 0).toLocaleString('es-CO');
  }

  private readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : null;
  }

  private capitalize(value: string): string {
    if (!value) return value;

    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  private getDistributionColors(): string[] {
    return [
      this.getCssVar('--color-primary', '#2ecc71'),
      this.getCssVar('--color-secondary', '#162b21'),
      this.getCssVar('--color-accent', '#06b6d4'),
      this.getCssVar('--color-warning', '#fb923c'),
      this.getCssVar('--color-info', '#3b82f6'),
      this.getCssVar('--color-gaming', '#8b5cf6'),
    ];
  }

  private getCssVar(name: string, fallback: string): string {
    if (typeof document === 'undefined') return fallback;

    return (
      getComputedStyle(document.documentElement)
        .getPropertyValue(name)
        .trim() || fallback
    );
  }
}
