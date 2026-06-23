import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { RouterModule } from '@angular/router';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { ChartComponent } from '../../../../../../shared/components/chart/chart.component';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { AnalyticsService, PurchasesBySupplier } from '../../services/analytics.service';
import { EChartsOption } from 'echarts';
import { DateRangeFilter } from '../../interfaces/analytics.interface';
import { getDefaultStartDate, getDefaultEndDate } from '../../../../../../shared/utils/date.util';
import { queryParamsToDateRange } from '../../../shared/utils/date-range-params.util';
import { DateRangeFilterComponent } from '../../components/date-range-filter/date-range-filter.component';
import { ExportButtonComponent } from '../../components/export-button/export-button.component';

@Component({
  selector: 'vendix-purchases-by-supplier',
  standalone: true,
  imports: [CommonModule, RouterModule, CardComponent, ChartComponent, StatsComponent, IconComponent, DateRangeFilterComponent, ExportButtonComponent],
  template: `
    <div class="space-y-6 w-full max-w-[1600px] mx-auto py-4" style="display:block;width:100%">
      <!-- Stats Cards -->
      <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Proveedores"
          [value]="chartData().length"
          smallText=" proveedores"
          iconName="truck"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>

        <app-stats
          title="Total Ordenes"
          [value]="getTotalOrders()"
          iconName="file-text"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        ></app-stats>

        <app-stats
          title="Total Gastado"
          [value]="getTotalSpent()"
          iconName="dollar-sign"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>

        <app-stats
          title="Proveedor Top"
          [value]="getTopSupplier()"
          iconName="trophy"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
        ></app-stats>
      </div>

      <!-- Header -->
      <div class="flex items-center justify-between gap-3 sticky top-0 z-10 bg-white px-4 py-3 border-b border-border rounded-lg mx-1 mb-4">
        <div class="flex items-center gap-2.5 min-w-0">
          <div class="hidden md:flex w-10 h-10 rounded-lg bg-[var(--color-background)] items-center justify-center border border-[var(--color-border)] shadow-sm shrink-0">
            <app-icon name="truck" class="text-[var(--color-primary)]"></app-icon>
          </div>
          <div class="min-w-0">
            <h1 class="text-base md:text-lg font-bold text-[var(--color-text-primary)] leading-tight truncate">Compras por Proveedor</h1>
            <p class="hidden sm:block text-xs text-[var(--color-text-secondary)] font-medium truncate">
              Análisis de compras por proveedor
            </p>
          </div>
        </div>

        <div class="flex items-end gap-2 md:gap-3 shrink-0">
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

      <!-- Content Grid -->
      <div class="grid grid-cols-1 gap-6">
      @if (chartLoading()) {
        <app-card shadow="none" [responsivePadding]="true" customClasses="text-center py-8">
          <app-icon name="loader-2" [size]="32" class="animate-spin text-text-tertiary mx-auto"></app-icon>
          <span class="text-sm text-text-secondary mt-2 block">Cargando...</span>
        </app-card>
      } @else {

        <app-card shadow="none" [padding]="false" overflow="hidden" [showHeader]="true">
          <div slot="header" class="flex flex-col">
            <span class="text-sm font-bold text-[var(--color-text-primary)]">Gasto por Proveedor</span>
          </div>
          <div class="p-4">
            <app-chart [options]="chartOptions()" size="large"></app-chart>
          </div>
        </app-card>
      }
      </div>
    </div>

  `,
})
export class PurchasesBySupplierComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private analyticsService = inject(AnalyticsService);
  private readonly route = inject(ActivatedRoute);

  chartLoading = signal(false);
  chartData = signal<PurchasesBySupplier[]>([]);
  chartOptions = signal<EChartsOption>({});
  exporting = signal(false);
  private chartQueryKey = signal<string | null>(null);
  dateRange = signal<DateRangeFilter>({
    start_date: getDefaultStartDate(),
    end_date: getDefaultEndDate(),
    preset: 'thisMonth'
  });

  ngOnInit(): void {
    const urlRange = queryParamsToDateRange(this.route.snapshot.queryParamMap);
    if (urlRange) {
      this.dateRange.set(urlRange);
      this.chartQueryKey.set(null);
    }
    this.loadChartData();
  }

  private loadChartData(): void {
    const queryKey = JSON.stringify({ query: this.buildQuery() });
    if (this.chartQueryKey() === queryKey) return;

    this.chartLoading.set(true);

    this.analyticsService
      .getPurchasesBySupplier(this.buildQuery())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
      next: (response) => {
        const rows = this.extractRows(response);
        this.chartData.set(rows);
        this.updateChart(rows);
        this.chartQueryKey.set(queryKey);
        this.chartLoading.set(false);
      },
      error: () => {
        this.chartData.set([]);
        this.updateChart([]);
        this.chartLoading.set(false);
      }
      });
  }

  private buildQuery() {
    return {
      date_range: this.dateRange(),
      limit: 10,
    };
  }

  private extractRows(response: any): PurchasesBySupplier[] {
    if (Array.isArray(response?.data)) return response.data;
    if (Array.isArray(response?.data?.data)) return response.data.data;
    return [];
  }

  private updateChart(data: PurchasesBySupplier[]): void {
    const sorted = [...data].sort((a, b) => b.total_spent - a.total_spent);
    const suppliers = sorted.map(s => s.supplier_name);
    const values = sorted.map(s => s.total_spent);
    const colors = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

    const hasData = suppliers.length > 0;
    const chartSuppliers = hasData ? suppliers : ['Sin datos'];
    const chartValues = hasData ? values : [0];

    this.chartOptions.set({
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          let html = `<strong>${params[0].name}</strong><br/>`;
          for (const p of params) {
            if (p.value != null) html += `${p.marker} ${p.seriesName}: <b>$${p.value.toLocaleString('es-CO')}</b><br/>`;
          }
          return html;
        },
      },
legend: {
        data: ['Gasto por Proveedor'],
        selectedMode: true,
        bottom: 30,
        left: 'center',
        itemWidth: 14,
        textStyle: { color: '#6b7280' },
      },
      grid: { left: '3%', right: '4%', bottom: '25%', top: '3%', containLabel: true },
      xAxis: {
        type: 'category',
        data: chartSuppliers,
        axisLine: { lineStyle: { color: '#e5e7eb' } },
        axisLabel: { color: '#6b7280', fontSize: 11 },
      },
      yAxis: {
        type: 'value',
        min: 0,
        splitNumber: 5,
        axisLine: { show: false },
        axisLabel: { color: '#6b7280', formatter: (v: number) => '$' + Math.round(v).toLocaleString('es-CO', { maximumFractionDigits: 0 }) },
        splitLine: { lineStyle: { color: '#f3f4f6' } },
      },
      series: [{
        name: 'Gasto por Proveedor',
        type: 'bar' as const,
        data: chartValues.map((v, i) => ({
          value: v,
          itemStyle: { color: hasData ? colors[i % colors.length] : '#d1d5db' }
        })),
        barMaxWidth: 50,
      }],
    });
  }

  getTotalOrders(): number {
    return this.chartData().reduce((sum, s) => sum + (s.order_count || 0), 0);
  }

  getTotalSpent(): string {
    const total = this.chartData().reduce((sum, s) => sum + (s.total_spent || 0), 0);
    return '$' + total.toLocaleString('es-CO', { maximumFractionDigits: 0 });
  }

  getTopSupplier(): string {
    if (!this.chartData().length) return '-';
    const top = [...this.chartData()].sort((a, b) => b.total_spent - a.total_spent)[0];
    return top?.supplier_name?.substring(0, 15) || '-';
  }

  exportReport(): void {
    this.exporting.set(true);
    this.analyticsService
      .exportPurchasesAnalytics({ date_range: this.dateRange() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `compras_proveedor_${new Date().toISOString().split('T')[0]}.xlsx`;
          a.click();
          window.URL.revokeObjectURL(url);
          this.exporting.set(false);
        },
        error: () => {
          this.exporting.set(false);
        },
      });
  }

  onDateRangeChange(range: DateRangeFilter): void {
    this.dateRange.set(range);
    this.chartQueryKey.set(null);
    this.loadChartData();
  }
}
