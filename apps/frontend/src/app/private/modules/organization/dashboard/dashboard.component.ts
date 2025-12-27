import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ChartComponent,
  IconComponent,
  CHART_THEMES,
} from '../../../../shared/components';
import { EChartsOption } from 'echarts';
import { OrganizationDashboardService } from './services/organization-dashboard.service';
import { ActivatedRoute } from '@angular/router';
import { GlobalFacade } from '../../../../core/store/global.facade';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

@Component({
  selector: 'app-organization-dashboard',
  standalone: true,
  imports: [CommonModule, ChartComponent, IconComponent],
  template: `
    <div
      class="p-6 space-y-6"
      style="background-color: var(--color-background); min-height: 100vh;"
    >
      <!-- Stats Cards -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div
          class="rounded-xl shadow-sm p-6 border border-border hover:shadow-md transition-shadow"
          style="background-color: var(--color-surface);"
        >
          <div class="flex items-center justify-between mb-4">
            <div
              class="w-12 h-12 rounded-xl flex items-center justify-center"
              style="background-color: var(--primary-light);"
            >
              <app-icon
                name="store"
                [size]="24"
                style="color: var(--primary);"
              ></app-icon>
            </div>
            <!-- Placeholder for percentage if needed, or remove -->
          </div>
          <h3
            class="text-sm font-medium mb-1"
            style="color: var(--muted-foreground);"
          >
            Total de Tiendas
          </h3>
          <p class="text-3xl font-bold" style="color: var(--text);">
            {{ dashboardStats?.stats?.total_stores?.value || 0 }}
          </p>
          <p class="text-xs mt-2" style="color: var(--muted-foreground);">
            {{ dashboardStats?.stats?.total_stores?.sub_value || 0 }} nuevas
            este mes
          </p>
        </div>

        <div
          class="rounded-xl shadow-sm p-6 border border-border hover:shadow-md transition-shadow"
          style="background-color: var(--color-surface);"
        >
          <div class="flex items-center justify-between mb-4">
            <div
              class="w-12 h-12 rounded-xl flex items-center justify-center"
              style="background-color: var(--accent-light);"
            >
              <app-icon
                name="users"
                [size]="24"
                style="color: var(--accent);"
              ></app-icon>
            </div>
          </div>
          <h3
            class="text-sm font-medium mb-1"
            style="color: var(--muted-foreground);"
          >
            Usuarios Activos
          </h3>
          <p class="text-3xl font-bold" style="color: var(--text);">
            {{ dashboardStats?.stats?.active_users?.value || 0 }}
          </p>
          <p class="text-xs mt-2" style="color: var(--muted-foreground);">
            {{ dashboardStats?.stats?.active_users?.sub_value || 0 }} en línea
            ahora
          </p>
        </div>

        <div
          class="rounded-xl shadow-sm p-6 border border-border hover:shadow-md transition-shadow"
          style="background-color: var(--color-surface);"
        >
          <div class="flex items-center justify-between mb-4">
            <div
              class="w-12 h-12 rounded-xl flex items-center justify-center"
              style="background-color: rgba(251, 146, 60, 0.2);"
            >
              <app-icon
                name="shopping-cart"
                [size]="24"
                style="color: var(--warning);"
              ></app-icon>
            </div>
          </div>
          <h3
            class="text-sm font-medium mb-1"
            style="color: var(--muted-foreground);"
          >
            Pedidos Mensuales
          </h3>
          <p class="text-3xl font-bold" style="color: var(--text);">
            {{ dashboardStats?.stats?.monthly_orders?.value || 0 }}
          </p>
          <p class="text-xs mt-2" style="color: var(--muted-foreground);">
            {{ dashboardStats?.stats?.monthly_orders?.sub_value || 0 }} pedidos
            hoy
          </p>
        </div>

        <div
          class="rounded-xl shadow-sm p-6 border border-border hover:shadow-md transition-shadow"
          style="background-color: var(--color-surface);"
        >
          <div class="flex items-center justify-between mb-4">
            <div
              class="w-12 h-12 rounded-xl flex items-center justify-center"
              style="background-color: rgba(34, 197, 94, 0.2);"
            >
              <app-icon
                name="dollar-sign"
                [size]="24"
                style="color: var(--success);"
              ></app-icon>
            </div>
          </div>
          <h3
            class="text-sm font-medium mb-1"
            style="color: var(--muted-foreground);"
          >
            Ganancia
          </h3>
          <p class="text-3xl font-bold" style="color: var(--text);">
            {{ dashboardStats?.stats?.revenue?.value || 0 | currency }}
          </p>
          <p class="text-xs mt-2" style="color: var(--muted-foreground);">
            <span
              [class.text-green-500]="
                (dashboardStats?.stats?.revenue?.sub_value || 0) >= 0
              "
              [class.text-red-500]="
                (dashboardStats?.stats?.revenue?.sub_value || 0) < 0
              "
            >
              {{
                (dashboardStats?.stats?.revenue?.sub_value || 0) > 0 ? '+' : ''
              }}{{ dashboardStats?.stats?.revenue?.sub_value || 0 | currency }}
            </span>
            vs mes pasado
          </p>
        </div>
      </div>

      <!-- Charts Section -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Revenue Chart -->
        <div
          class="lg:col-span-2 rounded-xl shadow-sm border border-border"
          style="background-color: var(--color-surface);"
        >
          <div class="p-6 border-b border-border">
            <div class="flex items-center justify-between">
              <div>
                <h2 class="text-lg font-semibold" style="color: var(--text);">
                  Resumen de ganancias
                </h2>
                <p class="text-sm" style="color: var(--muted-foreground);">
                  Tendencias de ganancias mensuales
                </p>
              </div>
              <div class="flex gap-2">
                <button
                  class="px-3 py-1 text-sm rounded-lg transition-colors"
                  [style.background-color]="
                    selectedPeriod === '6m' ? 'var(--primary)' : 'var(--muted)'
                  "
                  [style.color]="
                    selectedPeriod === '6m'
                      ? 'white'
                      : 'var(--muted-foreground)'
                  "
                  (click)="onPeriodChange('6m')"
                >
                  6M
                </button>
                <button
                  class="px-3 py-1 text-sm rounded-lg transition-colors"
                  [style.background-color]="
                    selectedPeriod === '1y' ? 'var(--primary)' : 'var(--muted)'
                  "
                  [style.color]="
                    selectedPeriod === '1y'
                      ? 'white'
                      : 'var(--muted-foreground)'
                  "
                  (click)="onPeriodChange('1y')"
                >
                  1Y
                </button>
                <button
                  class="px-3 py-1 text-sm rounded-lg transition-colors"
                  [style.background-color]="
                    selectedPeriod === 'all' ? 'var(--primary)' : 'var(--muted)'
                  "
                  [style.color]="
                    selectedPeriod === 'all'
                      ? 'white'
                      : 'var(--muted-foreground)'
                  "
                  (click)="onPeriodChange('all')"
                >
                  All
                </button>
              </div>
            </div>
          </div>
          <div class="p-6">
            <app-chart
              [options]="revenueChartData"
              size="medium"
              [theme]="CHART_THEMES['corporate']"
              [animated]="true"
            >
            </app-chart>
          </div>
        </div>

        <!-- Store Distribution Pie Chart -->
        <div
          class="rounded-xl shadow-sm border border-border"
          style="background-color: var(--color-surface);"
        >
          <div class="p-6 border-b border-border">
            <h2 class="text-lg font-semibold" style="color: var(--text);">
              Distribución de ventas
            </h2>
            <p class="text-sm" style="color: var(--muted-foreground);">
              Por tipo de venta (Físico vs En línea)
            </p>
          </div>
          <div class="p-6">
            <div class="relative h-64">
              <app-chart
                [options]="storeDistributionData"
                size="small"
                [theme]="CHART_THEMES['vibrant']"
                [animated]="true"
              >
              </app-chart>
              <!-- Center Text Overlay -->
              <div
                class="absolute inset-0 flex flex-col items-center justify-center pointer-events-none"
              >
                <span class="text-3xl font-bold" style="color: var(--text);">
                  {{ storeDistributionLegend.length }}
                </span>
                <span class="text-sm" style="color: var(--muted-foreground);">
                  Types
                </span>
              </div>
            </div>

            <div class="mt-6 space-y-3">
              <div
                *ngFor="let item of storeDistributionLegend; let i = index"
                class="flex items-center justify-between p-2 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <div class="flex items-center gap-3">
                  <div
                    class="w-4 h-4 rounded-full shadow-sm"
                    [style.background-color]="
                      storeDistributionColors[
                        i % storeDistributionColors.length
                      ]
                    "
                    [style.box-shadow]="
                      '0 2px 4px ' +
                      storeDistributionColors[
                        i % storeDistributionColors.length
                      ] +
                      '4d'
                    "
                  ></div>
                  <div>
                    <span class="font-medium text-gray-700">{{
                      item.type
                    }}</span>
                    <div class="text-xs text-gray-500">
                      {{ item.percentage }}%
                    </div>
                  </div>
                </div>
                <div class="text-right">
                  <span class="font-bold text-gray-900">{{ item.value }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Recent Activity & Top Performers -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Recent Activity -->
        <div
          class="rounded-xl shadow-sm border border-border"
          style="background-color: var(--color-surface);"
        >
          <div class="p-6 border-b border-border">
            <h2 class="text-lg font-semibold" style="color: var(--text);">
              Actividad reciente
            </h2>
            <p class="text-sm" style="color: var(--muted-foreground);">
              Últimas actualizaciones en toda su organización
            </p>
          </div>
          <div class="p-6">
            <div class="space-y-4">
              <div
                class="flex items-start gap-4 p-3 rounded-lg"
                style="background-color: var(--muted);"
              >
                <div
                  class="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                  style="background-color: var(--primary-light);"
                >
                  <app-icon
                    name="store"
                    [size]="16"
                    style="color: var(--primary);"
                  ></app-icon>
                </div>
                <div class="flex-1">
                  <p class="text-sm font-medium" style="color: var(--text);">
                    Lanzamiento de nueva tienda
                  </p>
                  <p class="text-sm" style="color: var(--muted-foreground);">
                    La ubicación del centro ya está activa
                  </p>
                  <p
                    class="text-xs mt-1"
                    style="color: var(--muted-foreground);"
                  >
                    hace 2 horas
                  </p>
                </div>
              </div>

              <div
                class="flex items-start gap-4 p-3 rounded-lg"
                style="background-color: var(--muted);"
              >
                <div
                  class="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                  style="background-color: var(--success-light);"
                >
                  <app-icon
                    name="user-plus"
                    [size]="16"
                    style="color: var(--success);"
                  ></app-icon>
                </div>
                <div class="flex-1">
                  <p class="text-sm font-medium" style="color: var(--text);">
                    Nuevo miembro del equipo
                  </p>
                  <p class="text-sm" style="color: var(--muted-foreground);">
                    Sarah Johnson se unió como gerente de tienda
                  </p>
                  <p
                    class="text-xs mt-1"
                    style="color: var(--muted-foreground);"
                  >
                    hace 5 horas
                  </p>
                </div>
              </div>

              <div
                class="flex items-start gap-4 p-3 rounded-lg"
                style="background-color: var(--muted);"
              >
                <div
                  class="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                  style="background-color: var(--accent-light);"
                >
                  <app-icon
                    name="trending-up"
                    [size]="16"
                    style="color: var(--accent);"
                  ></app-icon>
                </div>
                <div class="flex-1">
                  <p class="text-sm font-medium" style="color: var(--text);">
                    Hito de ingresos
                  </p>
                  <p class="text-sm" style="color: var(--muted-foreground);">
                    Superó el objetivo mensual de $100.000
                  </p>
                  <p
                    class="text-xs mt-1"
                    style="color: var(--muted-foreground);"
                  >
                    Hace 1 día
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Top Performing Stores -->
        <div
          class="rounded-xl shadow-sm border border-border"
          style="background-color: var(--color-surface);"
        >
          <div class="p-6 border-b border-border">
            <h2 class="text-lg font-semibold" style="color: var(--text);">
              Tiendas con mejor rendimiento
            </h2>
            <p class="text-sm" style="color: var(--muted-foreground);">
              Las líderes de este mes
            </p>
          </div>
          <div class="p-6">
            <div class="space-y-4">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <div
                    class="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold text-white"
                    style="background-color: var(--warning);"
                  >
                    1
                  </div>
                  <div>
                    <p class="text-sm font-medium" style="color: var(--text);">
                      Tienda del centro
                    </p>
                    <p class="text-xs" style="color: var(--muted-foreground);">
                      Minorista
                    </p>
                  </div>
                </div>
                <div class="text-right">
                  <p class="text-sm font-bold" style="color: var(--text);">
                    $42,180
                  </p>
                  <p class="text-xs" style="color: var(--success);">+18%</p>
                </div>
              </div>

              <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <div
                    class="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold text-white"
                    style="background-color: var(--muted);"
                  >
                    2
                  </div>
                  <div>
                    <p class="text-sm font-medium" style="color: var(--text);">
                      Ubicación del centro comercial
                    </p>
                    <p class="text-xs" style="color: var(--muted-foreground);">
                      Alimentos y bebidas
                    </p>
                  </div>
                </div>
                <div class="text-right">
                  <p class="text-sm font-bold" style="color: var(--text);">
                    $38,420
                  </p>
                  <p class="text-xs" style="color: var(--success);">+12%</p>
                </div>
              </div>

              <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <div
                    class="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold text-white"
                    style="background-color: var(--muted);"
                  >
                    3
                  </div>
                  <div>
                    <p class="text-sm font-medium" style="color: var(--text);">
                      Sucursal del aeropuerto
                    </p>
                    <p class="text-xs" style="color: var(--muted-foreground);">
                      Servicios
                    </p>
                  </div>
                </div>
                <div class="text-right">
                  <p class="text-sm font-bold" style="color: var(--text);">
                    $31,980
                  </p>
                  <p class="text-xs" style="color: var(--error);">-5%</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }
    `,
  ],
})
export class DashboardComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  isLoading = false;
  organizationId: string = '';
  dashboardStats: any | null = null; // Using any to avoid strict type issues if interface isn't fully aligned yet, or use OrganizationDashboardStats
  selectedPeriod: string = '6m';
  storeDistributionColors = [
    '#7ed7a5',
    '#06b6d4',
    '#fb923c',
    '#a855f7',
    '#ec4899',
  ];
  storeDistributionLegend: any[] = [];
  CHART_THEMES = CHART_THEMES;

  // Revenue Chart Data - Stacked Line Chart
  revenueChartData: EChartsOption = {};

  constructor(
    private organizationDashboardService: OrganizationDashboardService,
    private route: ActivatedRoute,
    private globalFacade: GlobalFacade,
  ) { }

  ngOnInit(): void {
    // First check route param
    const routeId = this.route.snapshot.paramMap.get('id');
    if (routeId) {
      this.organizationId = routeId;
      this.loadDashboardData();
    } else {
      // Fallback to user context
      this.globalFacade.userContext$
        .pipe(takeUntil(this.destroy$))
        .subscribe((context) => {
          if (context?.organization?.id) {
            this.organizationId = context.organization.id;
            this.loadDashboardData();
          }
        });
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadDashboardData(): void {
    if (!this.organizationId) {
      console.warn('No organization ID available for dashboard stats');
      return;
    }

    this.isLoading = true;

    this.organizationDashboardService
      .getDashboardStats(this.organizationId, this.selectedPeriod)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data) => {
          this.dashboardStats = data;
          this.updateRevenueChart(data);
          this.updateStoreDistributionChart(data);
          this.isLoading = false;
        },
        error: (error) => {
          console.error('Error loading organization dashboard data:', error);
          this.isLoading = false;
        },
      });
  }

  onPeriodChange(period: string): void {
    this.selectedPeriod = period;
    this.loadDashboardData();
  }

  private formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  }

  private updateRevenueChart(data: any): void {

    if (data.profit_trend) {
      const labels = data.profit_trend.map(
        (item: any) => `${item.month} ${item.year}`,
      );
      const revenue = data.profit_trend.map((item: any) => item.revenue || 0);
      const costs = data.profit_trend.map((item: any) => item.costs || 0);
      const profit = data.profit_trend.map((item: any) => item.amount || 0);

      this.revenueChartData = {
        tooltip: {
          trigger: 'axis',
          axisPointer: {
            type: 'cross',
            label: {
              backgroundColor: '#6a7985'
            }
          }
        },
        legend: {
          data: ['Ganancia', 'Costos', 'Ganancia Neta'],
          bottom: 0
        },
        grid: {
          left: '3%',
          right: '4%',
          bottom: '10%',
          containLabel: true
        },
        xAxis: [
          {
            type: 'category',
            boundaryGap: false,
            data: labels
          }
        ],
        yAxis: [
          {
            type: 'value',
            axisLabel: {
              formatter: (value: any) => '$' + value / 1000 + 'K'
            }
          }
        ],
        series: [
          {
            name: 'Ganancia',
            type: 'line',
            stack: 'Total',
            areaStyle: { opacity: 0.1 },
            emphasis: { focus: 'series' },
            data: revenue,
            itemStyle: { color: '#3b82f6' }
          },
          {
            name: 'Costos',
            type: 'line',
            stack: 'Total',
            areaStyle: { opacity: 0.1 },
            emphasis: { focus: 'series' },
            data: costs,
            itemStyle: { color: '#ef4444' }
          },
          {
            name: 'Ganancia Neta',
            type: 'line',
            stack: 'Total',
            areaStyle: { opacity: 0.1 },
            emphasis: { focus: 'series' },
            data: profit,
            itemStyle: { color: '#22c55e' },
            label: { show: true, position: 'top' }
          }
        ]
      };
    }
  }
  private updateStoreDistributionChart(data: any): void {
    if (data.store_distribution) {
      const labels = data.store_distribution.map(
        (item: any) => item.type.charAt(0).toUpperCase() + item.type.slice(1),
      );
      const values = data.store_distribution.map(
        (item: any) => item.revenue || 0,
      );

      // Calculate total for percentage
      const total = values.reduce((sum: number, val: number) => sum + val, 0);

      this.storeDistributionData = {
        tooltip: {
          trigger: 'item',
          formatter: '{b}: {c} ({d}%)' // Name: Value (Percent)
        },
        legend: {
          show: false
        },
        series: [
          {
            name: 'Distribución de ventas',
            type: 'pie',
            radius: ['50%', '70%'], // Doughnut style
            avoidLabelOverlap: false,
            itemStyle: {
              borderRadius: 10,
              borderColor: '#fff',
              borderWidth: 2
            },
            label: {
              show: false,
              position: 'center'
            },
            emphasis: {
              label: {
                show: true,
                fontSize: 20,
                fontWeight: 'bold'
              }
            },
            labelLine: {
              show: false
            },
            data: data.store_distribution.map((item: any, index: number) => ({
              value: item.revenue || 0,
              name: item.type.charAt(0).toUpperCase() + item.type.slice(1),
              itemStyle: {
                color: this.storeDistributionColors[index % this.storeDistributionColors.length]
              }
            }))
          }
        ]
      };

      // Update the display values in the legend
      this.storeDistributionLegend = data.store_distribution.map(
        (item: any) => ({
          type: item.type.charAt(0).toUpperCase() + item.type.slice(1),
          value: this.formatCurrency(item.revenue || 0),
          percentage:
            total > 0 ? (((item.revenue || 0) / total) * 100).toFixed(1) : '0',
        }),
      );
    }
  }

  // Store Distribution Data - Enhanced Doughnut Chart
  storeDistributionData: EChartsOption = {};
}
