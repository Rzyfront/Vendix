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
import { truncateLabel } from '../../../../../../shared/utils/chart-labels.util';
import { CurrencyFormatService, CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';
import { DateRangeFilterComponent } from '../../components/date-range-filter/date-range-filter.component';
import { ExportButtonComponent } from '../../components/export-button/export-button.component';

@Component({
  selector: 'vendix-purchases-by-supplier',
  standalone: true,
  imports: [CommonModule, RouterModule, CardComponent, ChartComponent, StatsComponent, IconComponent, DateRangeFilterComponent, ExportButtonComponent, CurrencyPipe],
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
          title="Comprado (sin IVA)"
          [value]="getTotalSpent()"
          smallText="Cuadra con el Resumen de Compras"
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
      <div class="flex items-center justify-between gap-3 sticky top-0 z-10 bg-surface px-4 py-3 border-b border-border rounded-lg mx-1 mb-4">
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

        <!-- Detalle. La fila de totales debe coincidir EXACTAMENTE con las
             tarjetas del Resumen de Compras: mismo universo, mismos estados,
             misma base sin IVA. Si difieren, una de las dos miente. -->
        <app-card shadow="none" [padding]="false" overflow="hidden" [showHeader]="true">
          <div slot="header" class="flex flex-col">
            <span class="text-sm font-bold text-[var(--color-text-primary)]">Detalle por proveedor</span>
            <span class="text-xs text-[var(--color-text-secondary)]">
              El total cuadra con el Resumen de Compras
            </span>
          </div>
          <div class="p-4 overflow-x-auto">
            @if (chartData().length === 0) {
              <p class="text-sm text-[var(--color-text-secondary)] py-4 text-center">
                Sin compras a proveedores en el período.
              </p>
            } @else {
              <table class="w-full text-sm min-w-[720px]">
                <thead>
                  <tr class="text-left text-xs text-[var(--color-text-secondary)] border-b border-border">
                    <th class="py-2 pr-4 font-medium">Proveedor</th>
                    <th class="py-2 pr-4 font-medium text-right">Órdenes</th>
                    <th class="py-2 pr-4 font-medium text-right">Comprado (sin IVA)</th>
                    <th class="py-2 pr-4 font-medium text-right">IVA</th>
                    <th class="py-2 pr-4 font-medium text-right">Pendientes</th>
                    <th class="py-2 pr-4 font-medium text-right">% del total</th>
                    <th class="py-2 pr-4 font-medium text-right">vs. anterior</th>
                    <th class="py-2 font-medium">Última compra</th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of chartData(); track row.supplier_id) {
                    <tr class="border-b border-border/50">
                      <td class="py-2 pr-4 text-[var(--color-text-primary)]">{{ row.supplier_name }}</td>
                      <td class="py-2 pr-4 text-right tabular-nums">{{ row.order_count }}</td>
                      <td class="py-2 pr-4 text-right tabular-nums text-[var(--color-text-primary)]">
                        {{ row.total_spent | currency }}
                      </td>
                      <td class="py-2 pr-4 text-right tabular-nums text-[var(--color-text-secondary)]">
                        {{ row.tax_amount | currency }}
                      </td>
                      <td class="py-2 pr-4 text-right tabular-nums">{{ row.pending_orders }}</td>
                      <td class="py-2 pr-4 text-right tabular-nums">{{ row.percentage_of_total }} %</td>
                      <td class="py-2 pr-4 text-right tabular-nums text-xs">
                        {{ growthLabel(row.growth) }}
                      </td>
                      <td class="py-2 text-[var(--color-text-secondary)] text-xs">
                        {{ formatLastOrder(row.last_order_date) }}
                      </td>
                    </tr>
                  }
                </tbody>
                <tfoot>
                  <tr class="border-t-2 border-border font-bold">
                    <td class="py-2 pr-4 text-[var(--color-text-primary)]">Total</td>
                    <td class="py-2 pr-4 text-right tabular-nums">{{ getTotalOrders() }}</td>
                    <td class="py-2 pr-4 text-right tabular-nums text-[var(--color-text-primary)]">
                      {{ totalSpentValue() | currency }}
                    </td>
                    <td class="py-2 pr-4 text-right tabular-nums">{{ totalTaxValue() | currency }}</td>
                    <td class="py-2 pr-4 text-right tabular-nums">{{ totalPendingOrders() }}</td>
                    <td class="py-2 pr-4 text-right tabular-nums">{{ totalPercentage() }} %</td>
                    <td class="py-2 pr-4"></td>
                    <td class="py-2"></td>
                  </tr>
                </tfoot>
              </table>
            }
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
  private currencyService = inject(CurrencyFormatService);

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
        axisLabel: { color: '#6b7280', fontSize: 11, formatter: (val: string) => truncateLabel(val, 14) },
      },
      yAxis: {
        type: 'value',
        min: 0,
        splitNumber: 5,
        axisLine: { show: false },
        axisLabel: { color: '#6b7280', formatter: (v: number) => this.currencyService.formatChartAxis(v) },
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

  /** Raw total, for the footer cell that goes through the currency pipe. */
  totalSpentValue(): number {
    return this.chartData().reduce((sum, s) => sum + (s.total_spent || 0), 0);
  }

  totalTaxValue(): number {
    return this.chartData().reduce((sum, s) => sum + (s.tax_amount || 0), 0);
  }

  totalPendingOrders(): number {
    return this.chartData().reduce((sum, s) => sum + (s.pending_orders || 0), 0);
  }

  /**
   * Rounded to 1 decimal because the shares are already rounded per row; the
   * column is expected to read 100 and any drift is a rounding artefact, not a
   * reconciliation failure.
   */
  totalPercentage(): number {
    const total = this.chartData().reduce(
      (sum, s) => sum + (s.percentage_of_total || 0),
      0,
    );
    return Math.round(total * 10) / 10;
  }

  getTotalSpent(): string {
    return (
      '$' +
      this.totalSpentValue().toLocaleString('es-CO', {
        maximumFractionDigits: 0,
      })
    );
  }

  /** `null` = the supplier had no purchases in the previous window. */
  growthLabel(growth: number | null | undefined): string {
    if (growth === null || growth === undefined) return 'Sin base';
    const sign = growth > 0 ? '+' : '';
    return `${sign}${growth.toFixed(1)} %`;
  }

  /**
   * `last_order_date` arrives as a raw ISO INSTANT (the backend emits it
   * unconverted on purpose), so it must be rendered in a local calendar, never
   * with `formatDateOnlyUTC` — that helper is for business-dates and would show
   * a 20:51 purchase on the following day.
   *
   * The browser's own zone is used rather than a hardcoded `America/Bogota`:
   * the operator reading this table is physically at the store, and hardcoding
   * a country would be wrong for any tenant outside Colombia.
   */
  formatLastOrder(iso: string | null): string {
    if (!iso) return 'Sin compras';
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
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
