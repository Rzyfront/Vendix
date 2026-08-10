import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin } from 'rxjs';
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
import { queryParamsToDateRange } from '../../../shared/utils/date-range-params.util';
import { truncateLabel } from '../../../../../../shared/utils/chart-labels.util';

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
          @for (i of [1, 2, 3, 4, 5]; track i) {
            <div class="bg-surface border border-border rounded-xl p-4 animate-pulse">
              <div class="h-4 bg-gray-200 rounded w-1/2 mb-2"></div>
              <div class="h-8 bg-gray-200 rounded w-3/4"></div>
            </div>
          }
        </div>
      } @else {
        <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
          <app-stats
            title="Comprado (sin IVA)"
            [value]="summary()?.total_spent | currency"
            [smallText]="growthLabel(summary()?.total_spent_growth)"
            iconName="dollar-sign"
            iconBgColor="bg-green-100"
            iconColor="text-green-600"
          ></app-stats>

          <app-stats
            [title]="taxCardTitle()"
            [value]="taxCardValue() | currency"
            [smallText]="taxCardHint()"
            iconName="receipt"
            iconBgColor="bg-indigo-100"
            iconColor="text-indigo-600"
          ></app-stats>

          <app-stats
            title="Órdenes"
            [value]="summary()?.total_orders || 0"
            [smallText]="growthLabel(summary()?.total_orders_growth)"
            iconName="shopping-cart"
            iconBgColor="bg-blue-100"
            iconColor="text-blue-600"
          ></app-stats>

          <app-stats
            title="Pendientes de recibir"
            [value]="summary()?.pending_orders || 0"
            [smallText]="pendingUnitsLabel()"
            iconName="clock"
            iconBgColor="bg-yellow-100"
            iconColor="text-yellow-600"
          ></app-stats>

          <app-stats
            title="Ticket promedio"
            [value]="summary()?.average_order_value | currency"
            [smallText]="growthLabel(summary()?.average_order_value_growth)"
            iconName="calculator"
            iconBgColor="bg-emerald-100"
            iconColor="text-emerald-600"
          ></app-stats>
        </div>
      }

      <!-- Filter Bar -->
      <div
        class="flex items-center justify-between gap-3 sticky top-0 z-10 bg-surface px-4 py-3 border-b border-border rounded-lg mx-1 mb-4"
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

        <div class="flex items-end gap-2 md:gap-3 flex-shrink-0">
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
              <app-chart [options]="suppliersChartOptions()" size="large" [showLegend]="true"></app-chart>
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
              <app-chart [options]="ordersStatusChartOptions()" size="large" [showLegend]="true"></app-chart>
            }
          </div>
        </app-card>
      </div>

      <!-- Órdenes por estado: hace visible QUÉ quedó fuera del gasto y por qué -->
      <app-card
        shadow="none"
        [padding]="false"
        overflow="hidden"
        [showHeader]="true"
        class="md:mt-4"
      >
        <div slot="header" class="flex flex-col">
          <span class="text-sm font-bold text-[var(--color-text-primary)]">Órdenes por estado</span>
          <span class="text-xs text-[var(--color-text-secondary)]">
            Solo los estados marcados como comprometidos suman al gasto
          </span>
        </div>
        <div class="p-4 overflow-x-auto">
          @if (loading()) {
            <div class="h-24 flex items-center justify-center">
              <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          } @else if (statusRows().length === 0) {
            <p class="text-sm text-[var(--color-text-secondary)] py-4 text-center">
              Sin órdenes de compra en el período.
            </p>
          } @else {
            <table class="w-full text-sm">
              <thead>
                <tr class="text-left text-xs text-[var(--color-text-secondary)] border-b border-border">
                  <th class="py-2 pr-4 font-medium">Estado</th>
                  <th class="py-2 pr-4 font-medium text-right">Órdenes</th>
                  <th class="py-2 font-medium">Cuenta al gasto</th>
                </tr>
              </thead>
              <tbody>
                @for (row of statusRows(); track row.status) {
                  <tr class="border-b border-border/50 last:border-0">
                    <td class="py-2 pr-4 text-[var(--color-text-primary)]">{{ row.label }}</td>
                    <td class="py-2 pr-4 text-right tabular-nums text-[var(--color-text-primary)]">
                      {{ row.count }}
                    </td>
                    <td class="py-2">
                      @if (row.committed) {
                        <span class="text-xs font-medium text-green-600">Sí</span>
                      } @else {
                        <span class="text-xs font-medium text-[var(--color-text-secondary)]">No</span>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </div>
      </app-card>

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
  private destroyRef = inject(DestroyRef);
  private analyticsService = inject(AnalyticsService);
  private currencyService = inject(CurrencyFormatService);
  private readonly route = inject(ActivatedRoute);

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

  private static readonly STATUS_LABELS: Record<string, string> = {
    draft: 'Borrador',
    approved: 'Aprobada',
    partial: 'Recepción parcial',
    received: 'Recibida',
    cancelled: 'Cancelada',
  };

  /**
   * A `null` growth means the previous window had NO base to compare against.
   * Rendering it as "0 %" would assert "sin cambios" about a period that did not
   * exist, which reads as a flat business instead of a new one.
   */
  growthLabel(growth: number | null | undefined): string {
    if (growth === null || growth === undefined) {
      return 'Sin base de comparación';
    }
    const sign = growth > 0 ? '+' : '';
    return `${sign}${growth.toFixed(1)} % vs período anterior`;
  }

  /**
   * The VAT card names what the figure ACTUALLY is for this store. A store that
   * is not VAT-responsible (O-49) capitalizes purchase VAT into inventory cost:
   * it never reaches a declaration, so labelling it "descontable" would lie.
   */
  readonly taxCardTitle = computed(() => {
    const s = this.summary();
    if (!s) return 'IVA de compras';
    if (s.capitalized_tax_amount > 0 && s.deductible_tax_amount === 0) {
      return 'IVA capitalizado';
    }
    return 'IVA descontable';
  });

  readonly taxCardValue = computed(() => {
    const s = this.summary();
    if (!s) return 0;
    if (s.capitalized_tax_amount > 0 && s.deductible_tax_amount === 0) {
      return s.capitalized_tax_amount;
    }
    return s.deductible_tax_amount || s.total_tax_amount;
  });

  readonly taxCardHint = computed(() => {
    const s = this.summary();
    if (!s) return '';
    if (s.capitalized_tax_amount > 0 && s.deductible_tax_amount === 0) {
      return 'Entra al costo del inventario';
    }
    return 'Se descuenta en la declaración';
  });

  readonly pendingUnitsLabel = computed(() => {
    const units = this.summary()?.pending_units ?? 0;
    if (units <= 0) return 'Sin unidades faltantes';
    return `${units.toLocaleString('es-CO')} unidades faltantes`;
  });

  readonly statusRows = computed(() => {
    const s = this.summary();
    if (!s?.orders_by_status) return [];
    const committed = s.committed_states ?? [];
    return Object.entries(s.orders_by_status)
      .map(([status, count]) => ({
        status,
        label: PurchaseSummaryComponent.STATUS_LABELS[status] ?? status,
        count,
        committed: committed.includes(status),
      }))
      .sort((a, b) => b.count - a.count);
  });

  ngOnInit(): void {
    this.currencyService.loadCurrency();

    const urlRange = queryParamsToDateRange(this.route.snapshot.queryParamMap);
    if (urlRange) {
      this.dateRange.set(urlRange);
    }

    this.loadData();
  }

  loadData(): void {
    this.loading.set(true);

    forkJoin({
      suppliers: this.analyticsService.getPurchasesBySupplier({
        date_range: this.dateRange(),
        limit: 5,
      }),
      summary: this.analyticsService.getPurchasesSummary({
        date_range: this.dateRange(),
      }),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
      next: ({ suppliers, summary }) => {
        this.suppliers.set(this.extractSupplierRows(suppliers));
        this.summary.set(summary.data);
        this.updateCharts();
        this.loading.set(false);
      },
      error: () => {
        this.updateCharts();
        this.loading.set(false);
      },
    });
  }

  private extractSupplierRows(response: any): PurchasesBySupplier[] {
    if (Array.isArray(response?.data)) return response.data;
    if (Array.isArray(response?.data?.data)) return response.data.data;
    return [];
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
    const colors = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

    const hasData = suppliersData.length > 0;
    const supplierNames = hasData
      ? suppliersData.map((s) => s.supplier_name)
      : ['Sin datos'];

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
        data: ['Gasto por Proveedor'],
        selectedMode: true,
        bottom: 30,
        left: 'center',
        itemWidth: 14,
        textStyle: { color: textSecondary },
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '25%',
        top: '3%',
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: supplierNames,
        axisLine: { lineStyle: { color: '#e5e7eb' } },
        axisLabel: { color: textSecondary, fontSize: 11, formatter: (val: string) => truncateLabel(val, 14) },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        min: 0,
        axisLine: { show: false },
        axisLabel: {
          color: textSecondary,
          formatter: (v: number) => this.currencyService.formatChartAxis(v),
        },
        splitLine: { lineStyle: { color: '#e5e7eb' } },
      },
      series: [{
        name: 'Gasto por Proveedor',
        type: 'bar' as const,
        data: hasData
          ? suppliersData.map((s, i) => ({ value: s.total_spent, itemStyle: { color: colors[i % colors.length] } }))
          : [{ value: 0, itemStyle: { color: '#d1d5db' } }],
        barMaxWidth: 50,
      }],
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
        data: ['Pendientes', 'Completadas'],
        selectedMode: true,
        bottom: 30,
        left: 'center',
        itemWidth: 14,
        textStyle: { color: textSecondary },
      },
      grid: { left: '3%', right: '4%', bottom: '20%', top: '3%', containLabel: true },
      xAxis: {
        type: 'category',
        data: ['Pendientes', 'Completadas'],
        axisLine: { lineStyle: { color: '#e5e7eb' } },
        axisLabel: { color: textSecondary },
      },
      yAxis: {
        type: 'value',
        min: 0,
        splitNumber: 5,
        axisLine: { show: false },
        axisLabel: { color: textSecondary },
        splitLine: { lineStyle: { color: '#e5e7eb' } },
      },
      series: [
        {
          name: 'Pendientes',
          type: 'bar' as const,
          data: [pending],
          itemStyle: { color: '#f59e0b' },
          barMaxWidth: 40,
        },
        {
          name: 'Completadas',
          type: 'bar' as const,
          data: [completed],
          itemStyle: { color: '#22c55e' },
          barMaxWidth: 40,
        },
      ],
    });
  }
}
