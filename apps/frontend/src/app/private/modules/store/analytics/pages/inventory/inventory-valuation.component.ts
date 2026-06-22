import {Component, OnInit, inject, signal,
  DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { RouterModule, ActivatedRoute } from '@angular/router';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { ChartComponent } from '../../../../../../shared/components/chart/chart.component';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ExportButtonComponent } from '../../components/export-button/export-button.component';
import { DateRangeFilterComponent } from '../../components/date-range-filter/date-range-filter.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';

import { AnalyticsService } from '../../services/analytics.service';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import { InventoryValuation } from '../../interfaces/inventory-analytics.interface';
import { DateRangeFilter } from '../../interfaces/analytics.interface';

import { EChartsOption } from 'echarts';
import { getDefaultStartDate, getDefaultEndDate } from '../../../../../../shared/utils/date.util';
import { queryParamsToDateRange } from '../../../shared/utils/date-range-params.util';
import { getViewsByCategory, AnalyticsView } from '../../config/analytics-registry';
import { AnalyticsCardComponent } from '../../components/analytics-card/analytics-card.component';

@Component({
  selector: 'vendix-inventory-valuation',
  standalone: true,
  imports: [
    RouterModule,
    CardComponent,
    ChartComponent,
    StatsComponent,
    IconComponent,
    ExportButtonComponent,
    DateRangeFilterComponent,
    AnalyticsCardComponent,
  ],
  template: `
    <div class="space-y-6 w-full max-w-[1600px] mx-auto py-4" style="display:block;width:100%">
      <!-- Stats Cards -->
      <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Ubicaciones"
          [value]="getLocationCount()"
          smallText=" ubicaciones"
          iconName="map-pin"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>

        <app-stats
          title="Valor Total"
          [value]="getTotalValue()"
          iconName="dollar-sign"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>

        <app-stats
          title="Unidades Totales"
          [value]="getTotalUnits()"
          iconName="package"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        ></app-stats>

        <app-stats
          title="Ubicación Principal"
          [value]="getTopLocation()"
          iconName="trophy"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
        ></app-stats>
      </div>

      <!-- Header -->
      <div
        class="flex items-center justify-between gap-3 sticky top-0 z-10 bg-white px-4 py-3 border-b border-border rounded-lg mx-1 mb-4"
      >
        <div class="flex items-center gap-2.5 min-w-0">
          <div
            class="hidden md:flex w-10 h-10 rounded-lg bg-[var(--color-background)] items-center justify-center border border-[var(--color-border)] shadow-sm shrink-0"
          >
            <app-icon name="dollar-sign" class="text-[var(--color-primary)]"></app-icon>
          </div>
          <div class="min-w-0">
            <h1 class="text-base md:text-lg font-bold text-[var(--color-text-primary)] leading-tight truncate">
              Valoración de Inventario
            </h1>
            <p class="hidden sm:block text-xs text-[var(--color-text-secondary)] font-medium truncate">
              Valor del inventario por ubicación y categoría
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

      <!-- Total Value Card -->
      @if (!chartLoading()) {
        <div
          class="bg-gradient-to-r from-green-500 to-green-600 rounded-xl p-6 text-white"
        >
          <p class="text-green-100 text-sm">Valor Total del Inventario</p>
          <p class="text-3xl font-bold mt-1">
            {{ formatCurrency(totalValue()) }}
          </p>
          <p class="text-green-100 text-sm mt-2">
            {{ totalQuantity() }} unidades en {{ chartData().length }} ubicaciones
          </p>
        </div>
      }

      <!-- Content Grid -->
      <div class="grid grid-cols-1 gap-6">
        <app-card
          shadow="none"
          [padding]="false"
          overflow="hidden"
          [showHeader]="true"
        >
          <div slot="header" class="flex flex-col">
            <span class="text-sm font-bold text-[var(--color-text-primary)]"
              >Distribución por Ubicación</span
            >
          </div>
          <div class="p-4">
            @if (chartLoading()) {
              <div class="h-80 flex items-center justify-center">
                <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            } @else if (chartData().length === 0) {
              <div class="h-80 flex flex-col items-center justify-center text-text-secondary">
                <app-icon name="bar-chart-2" [size]="48" class="mb-2 opacity-50"></app-icon>
                <p>No hay datos para el período seleccionado</p>
              </div>
            } @else {
              <app-chart [options]="chartOptions()" size="large"></app-chart>
            }
          </div>
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
export class InventoryValuationComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private analyticsService = inject(AnalyticsService);
  private toastService = inject(ToastService);
  private currencyService = inject(CurrencyFormatService);
  private readonly route = inject(ActivatedRoute);
  chartLoading = signal(false);
  exporting = signal(false);
  chartData = signal<InventoryValuation[]>([]);
  chartOptions = signal<EChartsOption>({});
  totalValue = signal(0);
  totalQuantity = signal(0);
  private chartQueryKey = signal<string | null>(null);
  dateRange = signal<DateRangeFilter>({
    start_date: getDefaultStartDate(),
    end_date: getDefaultEndDate(),
    preset: 'thisMonth'});

  readonly inventoryViews: AnalyticsView[] = getViewsByCategory('inventory').filter(
    (v) => v.key !== 'inventory_valuation'
  );

  ngOnInit(): void {
    this.currencyService.loadCurrency();

    // Read date range from URL query params (e.g. when navigating from Reports)
    const urlRange = queryParamsToDateRange(this.route.snapshot.queryParamMap);
    if (urlRange) {
      this.dateRange.set(urlRange);
      this.invalidateModeData();
    }

    this.loadChartData();
  }

  private buildQueryKey(): string {
    return JSON.stringify({ dateRange: this.dateRange() });
  }

  private invalidateModeData(): void {
    this.chartQueryKey.set(null);
  }

  private loadChartData(): void {
    const queryKey = this.buildQueryKey();
    if (this.chartQueryKey() === queryKey) return;

    this.chartLoading.set(true);

    this.analyticsService
      .getInventoryValuation({ date_range: this.dateRange() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.chartData.set(response.data);
          this.calculateTotals(response.data);
          this.updateChart(response.data);
          this.chartQueryKey.set(queryKey);
          this.chartLoading.set(false);
        },
        error: () => {
          this.toastService.error('Error al cargar valoración');
          this.chartLoading.set(false);
        }});
  }

  private calculateTotals(data: InventoryValuation[]): void {
    const total = data.reduce((sum, item) => sum + item.total_value, 0);
    const quantity = data.reduce((sum, item) => sum + item.total_quantity, 0);
    this.totalValue.set(total);
    this.totalQuantity.set(quantity);
  }

  private updateChart(data: InventoryValuation[]): void {
    const chartData = data.map((item) => ({
      value: item.total_value,
      name: item.location_name,
    }));

    this.chartOptions.set({
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          const p = params[0];
          return `${p.name}<br/>Valor: ${this.formatCurrency(p.value)}<br/>Porcentaje: ${p.percent}%`;
        },
      },
legend: {
        data: ['Valor'],
        selectedMode: true,
        bottom: 30,
        left: 'center',
        itemWidth: 14,
        textStyle: { color: '#6b7280' },
      },
      grid: { left: '3%', right: '4%', bottom: '20%', top: '3%', containLabel: true },
      xAxis: {
        type: 'category',
        data: chartData.map((d: any) => d.name),
        axisLine: { lineStyle: { color: '#e5e7eb' } },
        axisLabel: { color: '#6b7280', fontSize: 11 },
      },
      yAxis: {
        type: 'value',
        min: 0,
        splitNumber: 5,
        axisLine: { show: false },
        axisLabel: { color: '#6b7280', fontSize: 11, formatter: (v: number) => '$' + Math.round(v).toLocaleString('es-CO') },
        splitLine: { lineStyle: { color: '#e5e7eb' } },
      },
      series: chartData.map((d: any, i: number) => ({
          name: d.name,
          type: 'bar' as const,
          data: [d.value],
          itemStyle: { color: ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'][i % 6] },
          barMaxWidth: 40,
        })),
    });
  }

  exportReport(): void {
    this.exporting.set(true);
    this.analyticsService
      .exportInventoryAnalytics({ date_range: this.dateRange() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `valoracion_inventario_${new Date().toISOString().split('T')[0]}.csv`;
          a.click();
          window.URL.revokeObjectURL(url);
          this.exporting.set(false);
        },
        error: () => {
          this.toastService.error('Error al exportar');
          this.exporting.set(false);
        }});
  }

  onDateRangeChange(range: DateRangeFilter): void {
    this.dateRange.set(range);
    this.invalidateModeData();
    this.loadChartData();
  }

  formatCurrency(value: number): string {
    return this.currencyService.format(value, 0);
  }

  getLocationCount(): number {
    return this.chartData().length;
  }

  getTotalValue(): string {
    const total = this.chartData().reduce((sum, l) => sum + (l.total_value || 0), 0);
    return this.currencyService.format(total, 0);
  }

  getTotalUnits(): number {
    return this.chartData().reduce((sum, l) => sum + (l.total_quantity || 0), 0);
  }

  getTopLocation(): string {
    if (!this.chartData().length) return '-';
    const top = [...this.chartData()].sort((a, b) => b.total_value - a.total_value)[0];
    return top?.location_name?.substring(0, 15) || '-';
  }
}
