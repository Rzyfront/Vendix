import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';

import { ChartComponent } from '../../../../../../shared/components/chart/chart.component';
import { SelectorComponent, SelectorOption } from '../../../../../../shared/components/selector/selector.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { DateRangeFilterComponent } from '../../components/date-range-filter/date-range-filter.component';
import { ExportButtonComponent } from '../../components/export-button/export-button.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';

import { AnalyticsService } from '../../services/analytics.service';
import { DateRangeFilter } from '../../interfaces/analytics.interface';
import { SalesTrend, SalesAnalyticsQueryDto } from '../../interfaces/sales-analytics.interface';

import { EChartsOption } from 'echarts';

@Component({
  selector: 'vendix-sales-trends',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    ChartComponent,
    SelectorComponent,
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
            <a routerLink="/admin/reports/sales" class="hover:text-primary">Ventas</a>
            <app-icon name="chevron-right" [size]="14"></app-icon>
            <span>Tendencias</span>
          </div>
          <h1 class="text-2xl font-bold text-text-primary">Tendencias de Ventas</h1>
          <p class="text-text-secondary mt-1">Evolución de ventas en el tiempo</p>
        </div>
        <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <vendix-date-range-filter
            [value]="dateRange()"
            (valueChange)="onDateRangeChange($event)"
          ></vendix-date-range-filter>
          <div class="w-full sm:w-36">
            <app-selector
              [options]="granularityOptions"
              [ngModel]="granularity()"
              (ngModelChange)="onGranularityChange($event)"
              size="sm"
              placeholder="Granularidad"
            ></app-selector>
          </div>
          <vendix-export-button
            [loading]="exporting()"
            (export)="exportReport()"
          ></vendix-export-button>
        </div>
      </div>

      <!-- Charts -->
      <div class="grid grid-cols-1 gap-6">
        <!-- Combined Chart -->
        <div class="bg-surface border border-border rounded-xl overflow-hidden">
          <div class="p-4 border-b border-border">
            <h3 class="font-semibold text-text-primary">Ingresos vs Órdenes</h3>
            <p class="text-sm text-text-secondary">Comparación de tendencias</p>
          </div>
          <div class="p-4">
            @if (loading()) {
              <div class="h-80 flex items-center justify-center">
                <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            } @else {
              <app-chart
                [options]="combinedChartOptions()"
                size="large"
              ></app-chart>
            }
          </div>
        </div>

        <!-- AOV Chart -->
        <div class="bg-surface border border-border rounded-xl overflow-hidden">
          <div class="p-4 border-b border-border">
            <h3 class="font-semibold text-text-primary">Ticket Promedio</h3>
            <p class="text-sm text-text-secondary">Evolución del valor promedio de orden</p>
          </div>
          <div class="p-4">
            @if (loading()) {
              <div class="h-64 flex items-center justify-center">
                <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            } @else {
              <app-chart
                [options]="aovChartOptions()"
                size="large"
              ></app-chart>
            }
          </div>
        </div>
      </div>
    </div>
  `,
})
export class SalesTrendsComponent implements OnInit, OnDestroy {
  private analyticsService = inject(AnalyticsService);
  private toastService = inject(ToastService);
  private destroy$ = new Subject<void>();

  loading = signal(true);
  exporting = signal(false);
  data = signal<SalesTrend[]>([]);
  granularity = signal<'day' | 'week' | 'month'>('day');
  combinedChartOptions = signal<EChartsOption>({});
  aovChartOptions = signal<EChartsOption>({});
  dateRange = signal<DateRangeFilter>({
    start_date: this.getDefaultStartDate(),
    end_date: this.getDefaultEndDate(),
    preset: 'thisMonth',
  });

  granularityOptions: SelectorOption[] = [
    { value: 'day', label: 'Diario' },
    { value: 'week', label: 'Semanal' },
    { value: 'month', label: 'Mensual' },
  ];

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

  onGranularityChange(value: string): void {
    this.granularity.set(value as 'day' | 'week' | 'month');
    this.loadData();
  }

  loadData(): void {
    this.loading.set(true);
    const query: SalesAnalyticsQueryDto = {
      date_range: this.dateRange(),
      granularity: this.granularity(),
    };

    this.analyticsService
      .getSalesTrends(query)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.data.set(response.data);
          this.updateCharts(response.data);
          this.loading.set(false);
        },
        error: () => {
          this.toastService.error('Error al cargar tendencias');
          this.loading.set(false);
        },
      });
  }

  private updateCharts(data: SalesTrend[]): void {
    const labels = data.map((t) => this.formatLabel(t.period));
    const revenues = data.map((t) => t.revenue);
    const orders = data.map((t) => t.orders);
    const aov = data.map((t) => t.average_order_value);

    // Combined Chart
    this.combinedChartOptions.set({
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
      },
      legend: {
        data: ['Ingresos', 'Órdenes'],
        top: 0,
        textStyle: { color: '#6b7280' },
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '3%',
        top: '15%',
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: labels,
        axisLine: { lineStyle: { color: '#e5e7eb' } },
        axisLabel: { color: '#6b7280' },
      },
      yAxis: [
        {
          type: 'value',
          name: 'Ingresos',
          position: 'left',
          axisLine: { show: false },
          axisLabel: {
            color: '#6b7280',
            formatter: (value: number) => `$${value / 1000}K`,
          },
          splitLine: { lineStyle: { color: '#f3f4f6' } },
        },
        {
          type: 'value',
          name: 'Órdenes',
          position: 'right',
          axisLine: { show: false },
          axisLabel: { color: '#6b7280' },
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
          lineStyle: { color: '#22c55e', width: 2 },
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
              ],
            },
          },
        },
        {
          name: 'Órdenes',
          type: 'bar',
          data: orders,
          yAxisIndex: 1,
          itemStyle: {
            color: '#3b82f6',
            borderRadius: [4, 4, 0, 0],
          },
        },
      ],
    });

    // AOV Chart
    this.aovChartOptions.set({
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          const d = params[0];
          return `${d.name}<br/>Ticket Promedio: ${this.formatCurrency(d.value)}`;
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
          name: 'Ticket Promedio',
          type: 'line',
          smooth: true,
          data: aov,
          lineStyle: { color: '#8b5cf6', width: 2 },
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
              ],
            },
          },
        },
      ],
    });
  }

  private formatLabel(period: string): string {
    const date = new Date(period);
    if (this.granularity() === 'month') {
      return date.toLocaleDateString('es-CO', { month: 'short', year: '2-digit' });
    }
    return date.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
  }

  exportReport(): void {
    this.exporting.set(true);
    this.analyticsService
      .exportSalesAnalytics({ date_range: this.dateRange(), granularity: this.granularity() })
      .pipe(takeUntil(this.destroy$))
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
        },
      });
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 0,
    }).format(value);
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
