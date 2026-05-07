import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { ChartComponent } from '../../../../../../shared/components/chart/chart.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { CurrencyPipe, CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import { ExportButtonComponent } from '../../components/export-button/export-button.component';
import { DateRangeFilterComponent } from '../../components/date-range-filter/date-range-filter.component';
import { PurchasesSummary, PurchasesBySupplier, AnalyticsService } from '../../services/analytics.service';
import { EChartsOption } from 'echarts';
import { AnalyticsCardComponent } from '../../components/analytics-card/analytics-card.component';
import { getViewsByCategory, AnalyticsView } from '../../config/analytics-registry';
import { DateRangeFilter } from '../../interfaces/analytics.interface';
import { getDefaultStartDate, getDefaultEndDate } from '../../../../../../shared/utils/date.util';

@Component({
  selector: 'vendix-purchase-summary',
  standalone: true,
  imports: [
    CommonModule,
    CardComponent,
    StatsComponent,
    ChartComponent,
    IconComponent,
    CurrencyPipe,
    ExportButtonComponent,
    DateRangeFilterComponent,
    AnalyticsCardComponent,
  ],
  template: `
    <div class="pb-6">
      <!-- Stats Cards -->
      @if (loading()) {
        <div class="stats-container">
          @for (i of [1, 2, 3, 4]; track i) {
            <div class="bg-surface border border-border rounded-xl p-4 animate-pulse">
              <div class="h-4 bg-gray-200 rounded w-1/2 mb-2"></div>
              <div class="h-8 bg-gray-200 rounded w-3/4"></div>
            </div>
          }
        </div>
      } @else {
        <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
          <app-stats
            title="Total Órdenes"
            [value]="summary()?.total_orders || 0"
            smallText="Órdenes de compra"
            iconName="shopping-cart"
            iconBgColor="bg-blue-100"
            iconColor="text-blue-600"
          ></app-stats>

          <app-stats
            title="Total Gastado"
            [value]="summary()?.total_spent | currency"
            smallText="Gasto total en proveedores"
            iconName="dollar-sign"
            iconBgColor="bg-green-100"
            iconColor="text-green-600"
          ></app-stats>

          <app-stats
            title="Pendientes"
            [value]="summary()?.pending_orders || 0"
            smallText="Sin completar"
            iconName="clock"
            iconBgColor="bg-yellow-100"
            iconColor="text-yellow-600"
          ></app-stats>

          <app-stats
            title="Completadas"
            [value]="summary()?.completed_orders || 0"
            smallText="Completadas"
            iconName="check-circle"
            iconBgColor="bg-emerald-100"
            iconColor="text-emerald-600"
          ></app-stats>
        </div>
      }

      <!-- Filter Bar -->
      <div
        class="flex items-center justify-between gap-3 sticky top-0 z-10 bg-white px-4 py-3 border-b border-border rounded-lg mx-1 mb-4"
      >
        <div class="flex items-center gap-2.5 min-w-0">
          <div
            class="hidden md:flex w-10 h-10 rounded-lg bg-[var(--color-background)] items-center justify-center border border-[var(--color-border)] shadow-sm shrink-0"
          >
            <app-icon name="shopping-cart" class="text-[var(--color-primary)]"></app-icon>
          </div>
          <div class="min-w-0">
            <h2 class="text-base md:text-lg font-bold text-[var(--color-text-primary)] leading-tight truncate">
              Analíticas de Compras
            </h2>
            <p class="hidden sm:block text-xs text-[var(--color-text-secondary)] font-medium truncate">
              Resumen de órdenes de compra y gastos en proveedores
            </p>
          </div>
        </div>

        <div class="flex items-center gap-2 md:gap-3 flex-shrink-0">
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
        <!-- Charts Row -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Spent Trend Chart (placeholder) -->
        <app-card
          shadow="none"
          [padding]="false"
          overflow="hidden"
          [showHeader]="true"
        >
          <div slot="header" class="flex flex-col">
            <span class="text-sm font-bold text-[var(--color-text-primary)]">Gasto por Proveedor</span>
            <span class="text-xs text-[var(--color-text-secondary)]">Top proveedores por volumen</span>
          </div>
          <div class="p-4">
            @if (loading()) {
              <div class="h-64 flex items-center justify-center">
                <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            } @else {
              <app-chart [options]="suppliersChartOptions()" size="large" [showLegend]="false"></app-chart>
            }
          </div>
        </app-card>

        <!-- Orders Status Chart -->
        <app-card
          shadow="none"
          [padding]="false"
          overflow="hidden"
          [showHeader]="true"
        >
          <div slot="header" class="flex flex-col">
            <span class="text-sm font-bold text-[var(--color-text-primary)]">Estado de Órdenes</span>
            <span class="text-xs text-[var(--color-text-secondary)]">Distribución por estado</span>
          </div>
          <div class="p-4">
            @if (loading()) {
              <div class="h-64 flex items-center justify-center">
                <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            } @else {
              <app-chart [options]="ordersStatusChartOptions()" size="large" [showLegend]="false"></app-chart>
            }
          </div>
        </app-card>
      </div>

      <!-- Quick Links -->
      <app-card shadow="none" [responsivePadding]="true" class="md:mt-4">
        <span class="text-sm font-bold text-[var(--color-text-primary)]">Vistas de Compras</span>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
          @for (view of purchasesViews; track view.key) {
            <app-analytics-card [view]="view"></app-analytics-card>
          }
        </div>
      </app-card>
    </div>
  `,
})
export class PurchaseSummaryComponent implements OnInit {
  private analyticsService = inject(AnalyticsService);
  private currencyService = inject(CurrencyFormatService);

  loading = signal(true);
  exporting = signal(false);
  summary = signal<PurchasesSummary | null>(null);
  suppliers = signal<PurchasesBySupplier[]>([]);

  suppliersChartOptions= signal<EChartsOption>({});
  ordersStatusChartOptions= signal<EChartsOption>({});
  dateRange = signal<DateRangeFilter>({
    start_date: getDefaultStartDate(),
    end_date: getDefaultEndDate(),
    preset: 'thisMonth'});

  readonly purchasesViews: AnalyticsView[] = getViewsByCategory('purchases');

  ngOnInit(): void {
    this.currencyService.loadCurrency();
    this.loadData();
  }

  loadData(): void {
    this.loading.set(true);

    this.analyticsService.getPurchasesBySupplier({ date_range: this.dateRange() }).subscribe({
      next: (response: any) => {
        const data = Array.isArray(response?.data) ? response.data : (response?.data?.data || []);
        this.suppliers.set(data);
        this.updateCharts();
        this.loading.set(false);
      },
      error: () => {
        this.updateCharts();
        this.loading.set(false);
      },
    });

    this.analyticsService.getPurchasesSummary({ date_range: this.dateRange() }).subscribe({
      next: (response) => {
        if (response?.data) {
          this.summary.set(response.data);
        }
        this.updateCharts();
        this.loading.set(false);
      },
      error: () => {
        this.updateCharts();
        this.loading.set(false);
      },
    });
  }

  exportReport(): void {
    this.exporting.set(true);
    this.analyticsService.exportPurchasesAnalytics({ date_range: this.dateRange() }).subscribe({
      next: (blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `compras_${new Date().toISOString().split('T')[0]}.csv`;
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
    this.loadData();
  }

  private updateCharts(): void {
    const style = getComputedStyle(document.documentElement);
    const textSecondary = style.getPropertyValue('--color-text-secondary').trim() || '#6b7280';

    const suppliersData = this.suppliers().slice(0, 5);
    const pending = this.summary()?.pending_orders || 0;
    const completed = this.summary()?.completed_orders || 0;

    // Top Suppliers Horizontal Bar
    this.suppliersChartOptions.set({
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          const data = params[0];
          return `<strong>${data.name}</strong><br/>Gasto: ${this.currencyService.format(data.value)}`;
        },
      },
      legend: {
        data: ['Proveedores'],
        bottom: 30,
        textStyle: { color: textSecondary },
      },
      grid: {
        left: '3%',
        right: '6%',
        bottom: '20%',
        top: '3%',
        containLabel: true,
      },
      xAxis: {
        type: 'value',
        axisLine: { show: false },
        axisLabel: {
          color: textSecondary,
          formatter: (v: number) => this.currencyService.format(Math.round(v), 0),
        },
        splitLine: { lineStyle: { color: '#e5e7eb' } },
      },
      yAxis: {
        type: 'category',
        data: suppliersData.map((s) => s.supplier_name.length > 20 ? s.supplier_name.substring(0, 20) + '...' : s.supplier_name).reverse(),
        axisLine: { lineStyle: { color: '#e5e7eb' } },
        axisLabel: { color: textSecondary, fontSize: 11 },
      },
      series: [
        {
          name: 'Proveedores',
          type: 'bar',
          data: suppliersData.map((s) => s.total_spent).reverse(),
          itemStyle: { color: '#3b82f6' },
        },
      ],
    });

    // Orders Status Line
    this.ordersStatusChartOptions.set({
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          const p = params[0];
          return `${p.name}: <b>${p.value}</b>`;
        },
      },
      legend: {
        data: ['Estado de Órdenes'],
        bottom: 30,
        textStyle: { color: textSecondary },
      },
      grid: { left: '3%', right: '10%', bottom: '20%', top: '3%', containLabel: true },
      xAxis: { type: 'value' },
      yAxis: {
        type: 'category',
        data: ['Pendientes', 'Completadas'],
        axisLabel: { color: textSecondary },
      },
      series: [
        {
          name: 'Estado de Órdenes',
          type: 'bar',
          data: [
            { value: pending, itemStyle: { color: '#f59e0b' } },
            { value: completed, itemStyle: { color: '#22c55e' } },
          ],
        },
      ],
    });
  }
}