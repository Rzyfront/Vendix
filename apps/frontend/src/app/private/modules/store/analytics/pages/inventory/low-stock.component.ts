import {Component, OnInit, inject, signal, computed,
  DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { getViewsByCategory, AnalyticsView } from '../../config/analytics-registry';

import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { ChartComponent } from '../../../../../../shared/components/chart/chart.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { DateRangeFilterComponent } from '../../components/date-range-filter/date-range-filter.component';
import { ExportButtonComponent } from '../../components/export-button/export-button.component';
import { DateRangeFilter } from '../../interfaces/analytics.interface';
import { getDefaultStartDate, getDefaultEndDate } from '../../../../../../shared/utils/date.util';
import { queryParamsToDateRange } from '../../../shared/utils/date-range-params.util';

import { AnalyticsService } from '../../services/analytics.service';
import {
  StockLevelReport,
  InventorySummary} from '../../interfaces/inventory-analytics.interface';
import { EChartsOption } from 'echarts';
import { AnalyticsCardComponent } from '../../components/analytics-card/analytics-card.component';

@Component({
  selector: 'vendix-low-stock',
  standalone: true,
  imports: [
    RouterModule,
    CardComponent,
    ChartComponent,
    StatsComponent,
    IconComponent,
    DateRangeFilterComponent,
    ExportButtonComponent,
    AnalyticsCardComponent,
  ],
  template: `
    <div class="w-full">
      <!-- Stats: Sticky on mobile, static on desktop -->
      <div
        class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        <app-stats
          title="Total Alertas"
          [value]="totalAlerts()"
          smallText="Stock bajo + agotados"
          iconName="alert-triangle"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
        ></app-stats>

        <app-stats
          title="Agotados"
          [value]="summary()?.out_of_stock_count ?? 0"
          smallText="Sin unidades"
          iconName="x-circle"
          iconBgColor="bg-red-100"
          iconColor="text-red-600"
        ></app-stats>

        <app-stats
          title="Stock Bajo"
          [value]="summary()?.low_stock_count ?? 0"
          smallText="Bajo punto reorden"
          iconName="alert-circle"
          iconBgColor="bg-yellow-100"
          iconColor="text-yellow-600"
        ></app-stats>

        <app-stats
          title="Unidades Totales"
          [value]="summary()?.total_quantity_on_hand ?? 0"
          smallText="En inventario"
          iconName="package"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>
      </div>

      <!-- Header -->
      <div class="flex items-center justify-between gap-3 sticky top-0 z-10 bg-white px-4 py-3 border-b border-border rounded-lg mx-1 mb-4">
        <div class="flex items-center gap-2.5 min-w-0">
          <div class="hidden md:flex w-10 h-10 rounded-lg bg-[var(--color-background)] items-center justify-center border border-[var(--color-border)] shadow-sm shrink-0">
            <app-icon name="alert-triangle" class="text-[var(--color-primary)]"></app-icon>
          </div>
          <div class="min-w-0">
            <h1 class="text-base md:text-lg font-bold text-[var(--color-text-primary)] leading-tight truncate">
              Stock Bajo y Agotados
            </h1>
            <p class="hidden sm:block text-xs text-[var(--color-text-secondary)] font-medium truncate">
              Productos con bajo nivel de inventario
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
      <!-- Chart: Stock Alert Distribution -->
      <app-card shadow="none" [responsivePadding]="true" [showHeader]="true">
        <div slot="header" class="flex flex-col">
          <span class="text-sm font-bold text-[var(--color-text-primary)]">
            Distribución por Estado
          </span>
        </div>
        @if (!summaryLoading() && chartOptions()) {
        <app-chart
          [options]="chartOptions()"
          size="large"
          [showLegend]="true"
        ></app-chart>
        }
      </app-card>
      </div>

      <!-- Quick Links -->
      <app-card shadow="none" [responsivePadding]="true" class="md:mt-4">
        <span class="text-sm font-bold text-[var(--color-text-primary)]">Vistas de Inventario</span>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
          @for (view of inventoryViews; track view.key) {
            <app-analytics-card [view]="view"></app-analytics-card>
          }
        </div>
      </app-card>
    </div>
  `})
export class LowStockComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private analyticsService = inject(AnalyticsService);
  private toastService = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
// Signals
  summaryLoading = signal(false);
  exporting = signal(false);
  summary = signal<InventorySummary | null>(null);
  chartOptions = signal<EChartsOption>({});
  dateRange = signal<DateRangeFilter>({
    start_date: getDefaultStartDate(),
    end_date: getDefaultEndDate(),
    preset: 'thisMonth'});

  readonly inventoryViews: AnalyticsView[] = getViewsByCategory('inventory').filter(
    (v) => v.key !== 'inventory_low_stock'
  );

  // Computed: total alerts
  totalAlerts = computed(() => {
    const s = this.summary();
    if (!s) return 0;
    return s.low_stock_count + s.out_of_stock_count;
  });

  ngOnInit(): void {
    // Read date range from URL query params (e.g. when navigating from Reports)
    const urlRange = queryParamsToDateRange(this.route.snapshot.queryParamMap);
    if (urlRange) {
      this.dateRange.set(urlRange);
    }

    this.loadSummary();
  }

  private loadSummary(): void {
    this.summaryLoading.set(true);

    this.analyticsService.getInventorySummary()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (summary) => {
          this.summary.set(summary.data);
          this.updateChart(summary.data);
          this.summaryLoading.set(false);
        },
        error: () => {
          this.toastService.error('Error al cargar resumen de stock');
          this.summaryLoading.set(false);
        }});
  }

  private updateChart(summary: InventorySummary): void {
    const borderColor = '#e5e7eb';
    const textSecondary = '#6b7280';

    const outOfStock = summary.out_of_stock_count || 0;
    const lowStock = summary.low_stock_count || 0;
    const inStock = Math.max(
      (summary.total_sku_count || 0) - outOfStock - lowStock,
      0,
    );

    this.chartOptions.set({
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          const p = params[0];
          return `${p.name}: ${p.value} productos`;
        },
      },
legend: {
        data: ['Agotados', 'Stock Bajo', 'En Stock'],
        selectedMode: true,
        bottom: 30,
        left: 'center',
        itemWidth: 14,
        textStyle: { color: textSecondary },
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '20%',
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: ['Agotados', 'Stock Bajo', 'En Stock'],
        axisLine: { lineStyle: { color: borderColor } },
        axisLabel: { color: textSecondary },
      },
      yAxis: {
        type: 'value',
        min: 0,
        splitNumber: 5,
        axisLine: { show: false },
        axisLabel: { color: textSecondary },
        splitLine: { lineStyle: { color: borderColor } },
      },
      series: [
        {
          name: 'Agotados',
          type: 'bar',
          data: [outOfStock],
          itemStyle: { color: '#ef4444' },
          barMaxWidth: 32,
        },
        {
          name: 'Stock Bajo',
          type: 'bar',
          data: [lowStock],
          itemStyle: { color: '#f59e0b' },
          barMaxWidth: 32,
        },
        {
          name: 'En Stock',
          type: 'bar',
          data: [inStock],
          itemStyle: { color: '#22c55e' },
          barMaxWidth: 32,
        },
      ],
    });
  }

  onDateRangeChange(range: DateRangeFilter): void {
    this.dateRange.set(range);
    this.loadSummary();
  }

  exportReport(): void {
    this.exporting.set(true);
    this.analyticsService
      .exportInventoryAnalytics({ status: 'low_stock' })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `stock_bajo_${new Date().toISOString().split('T')[0]}.csv`;
          a.click();
          window.URL.revokeObjectURL(url);
          this.exporting.set(false);
        },
        error: () => {
          this.toastService.error('Error al exportar');
          this.exporting.set(false);
        }});
  }
}
