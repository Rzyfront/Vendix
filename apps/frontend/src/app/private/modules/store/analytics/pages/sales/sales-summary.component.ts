import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';

import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { ChartComponent } from '../../../../../../shared/components/chart/chart.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { DateRangeFilterComponent } from '../../components/date-range-filter/date-range-filter.component';
import { ExportButtonComponent } from '../../components/export-button/export-button.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';

import { AnalyticsService } from '../../services/analytics.service';
import { DateRangeFilter } from '../../interfaces/analytics.interface';
import { SalesSummary, SalesTrend, SalesAnalyticsQueryDto } from '../../interfaces/sales-analytics.interface';

import { EChartsOption } from 'echarts';

@Component({
  selector: 'vendix-sales-summary',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    StatsComponent,
    ChartComponent,
    IconComponent,
    DateRangeFilterComponent,
    ExportButtonComponent,
  ],
  template: `
    <div class="space-y-6 w-full max-w-[1600px] mx-auto py-4">
      <!-- Header -->
      <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <div class="flex items-center gap-2 text-sm text-text-secondary mb-1">
            <a routerLink="/admin/reports" class="hover:text-primary">Reportes</a>
            <app-icon name="chevron-right" [size]="14"></app-icon>
            <span>Ventas</span>
          </div>
          <h1 class="text-2xl font-bold text-text-primary">Resumen de Ventas</h1>
          <p class="text-text-secondary mt-1">Análisis general del rendimiento de ventas</p>
        </div>
        <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <vendix-date-range-filter
            [value]="dateRange()"
            (valueChange)="onDateRangeChange($event)"
          ></vendix-date-range-filter>
          <vendix-export-button
            [loading]="exporting()"
            (export)="exportReport()"
          ></vendix-export-button>
        </div>
      </div>

      <!-- Stats Cards -->
      @if (loading()) {
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
          @for (i of [1, 2, 3, 4]; track i) {
            <div class="bg-surface border border-border rounded-xl p-4 animate-pulse">
              <div class="h-4 bg-gray-200 rounded w-1/2 mb-2"></div>
              <div class="h-8 bg-gray-200 rounded w-3/4"></div>
            </div>
          }
        </div>
      } @else {
        <div class="stats-container">
          <app-stats
            title="Ingresos Totales"
            [value]="formatCurrency(summary()?.total_revenue || 0)"
            [smallText]="getGrowthText(summary()?.revenue_growth)"
            iconName="dollar-sign"
            iconBgColor="bg-green-100"
            iconColor="text-green-600"
          ></app-stats>

          <app-stats
            title="Total Órdenes"
            [value]="summary()?.total_orders || 0"
            [smallText]="getGrowthText(summary()?.orders_growth)"
            iconName="shopping-cart"
            iconBgColor="bg-blue-100"
            iconColor="text-blue-600"
          ></app-stats>

          <app-stats
            title="Ticket Promedio"
            [value]="formatCurrency(summary()?.average_order_value || 0)"
            iconName="receipt"
            iconBgColor="bg-purple-100"
            iconColor="text-purple-600"
          ></app-stats>

          <app-stats
            title="Unidades Vendidas"
            [value]="summary()?.total_units_sold || 0"
            iconName="package"
            iconBgColor="bg-orange-100"
            iconColor="text-orange-600"
          ></app-stats>
        </div>
      }

      <!-- Charts Row -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Revenue Trend Chart -->
        <div class="bg-surface border border-border rounded-xl overflow-hidden">
          <div class="p-4 border-b border-border">
            <h3 class="font-semibold text-text-primary">Tendencia de Ingresos</h3>
            <p class="text-sm text-text-secondary">Evolución de ingresos en el período</p>
          </div>
          <div class="p-4">
            @if (loadingTrends()) {
              <div class="h-64 flex items-center justify-center">
                <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            } @else {
              <app-chart
                [options]="revenueChartOptions()"
                size="large"
              ></app-chart>
            }
          </div>
        </div>

        <!-- Orders Trend Chart -->
        <div class="bg-surface border border-border rounded-xl overflow-hidden">
          <div class="p-4 border-b border-border">
            <h3 class="font-semibold text-text-primary">Tendencia de Órdenes</h3>
            <p class="text-sm text-text-secondary">Número de órdenes en el período</p>
          </div>
          <div class="p-4">
            @if (loadingTrends()) {
              <div class="h-64 flex items-center justify-center">
                <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            } @else {
              <app-chart
                [options]="ordersChartOptions()"
                size="large"
              ></app-chart>
            }
          </div>
        </div>
      </div>

      <!-- Quick Links -->
      <div class="bg-surface border border-border rounded-xl p-4">
        <h3 class="font-semibold text-text-primary mb-4">Reportes Relacionados</h3>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
          <a
            routerLink="../by-product"
            class="flex items-center gap-2 p-3 rounded-lg hover:bg-background transition-colors text-sm"
          >
            <app-icon name="package" [size]="18" class="text-text-secondary"></app-icon>
            <span class="text-text-primary">Ventas por Producto</span>
          </a>
          <a
            routerLink="../by-category"
            class="flex items-center gap-2 p-3 rounded-lg hover:bg-background transition-colors text-sm"
          >
            <app-icon name="folder" [size]="18" class="text-text-secondary"></app-icon>
            <span class="text-text-primary">Ventas por Categoría</span>
          </a>
          <a
            routerLink="../trends"
            class="flex items-center gap-2 p-3 rounded-lg hover:bg-background transition-colors text-sm"
          >
            <app-icon name="trending-up" [size]="18" class="text-text-secondary"></app-icon>
            <span class="text-text-primary">Tendencias</span>
          </a>
          <a
            routerLink="../by-customer"
            class="flex items-center gap-2 p-3 rounded-lg hover:bg-background transition-colors text-sm"
          >
            <app-icon name="users" [size]="18" class="text-text-secondary"></app-icon>
            <span class="text-text-primary">Ventas por Cliente</span>
          </a>
        </div>
      </div>
    </div>
  `,
})
export class SalesSummaryComponent implements OnInit, OnDestroy {
  private analyticsService = inject(AnalyticsService);
  private toastService = inject(ToastService);
  private destroy$ = new Subject<void>();

  // State
  loading = signal(true);
  loadingTrends = signal(true);
  exporting = signal(false);
  summary = signal<SalesSummary | null>(null);
  trends = signal<SalesTrend[]>([]);
  dateRange = signal<DateRangeFilter>({
    start_date: this.getDefaultStartDate(),
    end_date: this.getDefaultEndDate(),
    preset: 'thisMonth',
  });

  // Chart Options
  revenueChartOptions = signal<EChartsOption>({});
  ordersChartOptions = signal<EChartsOption>({});

  ngOnInit(): void {
    this.loadData();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onDateRangeChange(range: DateRangeFilter): void {
    this.dateRange.set(range);
    this.loadData();
  }

  loadData(): void {
    const query: SalesAnalyticsQueryDto = {
      date_range: this.dateRange(),
    };

    // Load Summary
    this.loading.set(true);
    this.analyticsService
      .getSalesSummary(query)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.summary.set(response.data);
          this.loading.set(false);
        },
        error: () => {
          this.toastService.error('Error al cargar el resumen de ventas');
          this.loading.set(false);
        },
      });

    // Load Trends
    this.loadingTrends.set(true);
    this.analyticsService
      .getSalesTrends({ ...query, granularity: 'day' })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.trends.set(response.data);
          this.updateCharts(response.data);
          this.loadingTrends.set(false);
        },
        error: () => {
          this.toastService.error('Error al cargar las tendencias');
          this.loadingTrends.set(false);
        },
      });
  }

  exportReport(): void {
    this.exporting.set(true);
    this.analyticsService
      .exportSalesAnalytics({ date_range: this.dateRange() })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (blob) => {
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `ventas_${new Date().toISOString().split('T')[0]}.csv`;
          a.click();
          window.URL.revokeObjectURL(url);
          this.exporting.set(false);
          this.toastService.success('Reporte exportado correctamente');
        },
        error: () => {
          this.toastService.error('Error al exportar el reporte');
          this.exporting.set(false);
        },
      });
  }

  private updateCharts(trends: SalesTrend[]): void {
    const labels = trends.map((t) =>
      new Date(t.period).toLocaleDateString('es-CO', {
        day: '2-digit',
        month: 'short',
      }),
    );
    const revenues = trends.map((t) => t.revenue);
    const orders = trends.map((t) => t.orders);

    // Revenue Chart
    this.revenueChartOptions.set({
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          const data = params[0];
          return `${data.name}<br/>Ingresos: $${data.value.toLocaleString()}`;
        },
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '3%',
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: labels,
        axisLine: { lineStyle: { color: '#e5e7eb' } },
        axisLabel: { color: '#6b7280' },
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisLabel: {
          color: '#6b7280',
          formatter: (value: number) => `$${value / 1000}K`,
        },
        splitLine: { lineStyle: { color: '#f3f4f6' } },
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
                { offset: 0, color: 'rgba(34, 197, 94, 0.3)' },
                { offset: 1, color: 'rgba(34, 197, 94, 0.05)' },
              ],
            },
          },
          lineStyle: { color: '#22c55e', width: 2 },
          itemStyle: { color: '#22c55e' },
        },
      ],
    });

    // Orders Chart
    this.ordersChartOptions.set({
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          const data = params[0];
          return `${data.name}<br/>Órdenes: ${data.value}`;
        },
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '3%',
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: labels,
        axisLine: { lineStyle: { color: '#e5e7eb' } },
        axisLabel: { color: '#6b7280' },
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisLabel: { color: '#6b7280' },
        splitLine: { lineStyle: { color: '#f3f4f6' } },
      },
      series: [
        {
          name: 'Órdenes',
          type: 'bar',
          data: orders,
          itemStyle: {
            color: '#3b82f6',
            borderRadius: [4, 4, 0, 0],
          },
        },
      ],
    });
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 0,
    }).format(value);
  }

  getGrowthText(growth?: number): string {
    if (growth === undefined || growth === null) return '';
    const sign = growth >= 0 ? '+' : '';
    return `${sign}${growth.toFixed(1)}% vs período anterior`;
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
