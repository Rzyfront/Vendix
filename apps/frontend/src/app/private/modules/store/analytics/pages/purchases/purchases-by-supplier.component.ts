import { Component, DestroyRef, OnInit, inject, computed, signal  } from '@angular/core';
import {
  FilterConfig,
  FilterValues,
  DropdownAction } from '../../../../../../shared/components/options-dropdown/options-dropdown.interfaces';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { Router, RouterModule } from '@angular/router';
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
import { ResponsiveDataViewComponent } from '../../../../../../shared/components';
import type { TableColumn, ItemListCardConfig } from '../../../../../../shared/components';

import {
  OptionsDropdownComponent } from '../../../../../../shared/components/options-dropdown/options-dropdown.component';

@Component({
  selector: 'vendix-purchases-by-supplier',
  standalone: true,
  imports: [CommonModule, RouterModule, CardComponent, ChartComponent, StatsComponent, IconComponent, CurrencyPipe, ResponsiveDataViewComponent,
    OptionsDropdownComponent,],
  styles: [
    `
      :host {
        display: block;
        margin: -16px;
        @media (min-width: 768px) { margin: -24px; }
      }
      :host ::ng-deep .stats-container { padding: 0; margin: 0; margin-bottom: 0; }
      :host ::ng-deep .results-header { padding: 0.75rem 1rem; }
    `,
  ],
  template: `
    <div class="space-y-6 w-full max-w-[1600px] mx-auto py-4">
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

          <app-card shadow="none" [padding]="false" overflow="hidden" [showHeader]="true">
      <div slot="header" class="results-header flex items-center justify-between gap-3 flex-wrap">
        <div class="flex items-center gap-2 min-w-0">
          <app-icon name="truck" [size]="20" class="shrink-0 text-[var(--color-primary)]"></app-icon>
          <span class="results-header__title text-base md:text-lg font-bold text-[var(--color-text-primary)] leading-tight whitespace-nowrap">Compras por Proveedor</span>
        </div>
        <div class="flex items-end gap-2 flex-wrap shrink-0">
          <app-options-dropdown
            class="shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
            [filters]="filterConfigs"
            [filterValues]="filterValues"
            [actions]="dropdownActions()"
            [showActions]="true"
            triggerLabel="Acciones"
            triggerIcon="plus"
            [debounceMs]="350"
            [isLoading]="exporting()"
            (filterChange)="onFiltersDropdownChange($event)"
            (clearAllFilters)="onFiltersDropdownClearAll()"
            (actionClick)="onActionsDropdownClick($event)"
          ></app-options-dropdown>
        </div>
      </div>
      <div class="p-4 space-y-6">


      <!-- Content Grid -->
      <div class="grid grid-cols-1 gap-6">
      @if (chartLoading()) {
        <app-card shadow="none" [responsivePadding]="true" customClasses="text-center py-8">
          <app-icon name="loader-2" [size]="32" class="animate-spin text-text-tertiary mx-auto"></app-icon>
          <span class="text-sm text-text-secondary mt-2 block">Cargando...</span>
        </app-card>
      } @else {

        <app-card shadow="none" [padding]="false" overflow="hidden" [showHeader]="true">
          <div slot="header" class="results-header flex flex-col">
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
          <div slot="header" class="results-header flex flex-col">
            <span class="text-sm font-bold text-[var(--color-text-primary)]">Detalle por proveedor</span>
            <span class="text-xs text-[var(--color-text-secondary)]">
              El total cuadra con el Resumen de Compras
            </span>
          </div>
          <div class="p-4">
            <app-responsive-data-view
              [data]="chartData()"
              [columns]="supplierColumns"
              [cardConfig]="supplierCardConfig"
              [loading]="chartLoading()"
              [hoverable]="true"
              emptyTitle="Sin compras"
              emptyMessage="Sin compras a proveedores en el período."
              (rowClick)="openSupplier($event)"
            ></app-responsive-data-view>
            <!--
              La fila de totales queda fuera de la tabla del sistema: es un
              agregado de la vista, no un registro. Es la prueba visual de que
              esta pantalla cuadra con el Resumen de Compras.
            -->
            @if (chartData().length > 0) {
              <div class="mt-3 pt-3 border-t-2 border-border flex flex-wrap gap-x-6 gap-y-1 text-sm font-bold">
                <span class="text-[var(--color-text-primary)]">Total</span>
                <span>{{ getTotalOrders() }} órdenes</span>
                <span>{{ totalSpentValue() | currency }}</span>
                <span class="text-[var(--color-text-secondary)]">IVA {{ totalTaxValue() | currency }}</span>
                <span>{{ totalPendingOrders() }} pendientes</span>
                <span>{{ totalPercentage() }} %</span>
              </div>
            }
          </div>
        </app-card>
      }
      </div>
          </div>
    </app-card>
</div>


`,
})
export class PurchasesBySupplierComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private analyticsService = inject(AnalyticsService);
  private readonly route = inject(ActivatedRoute);
  private currencyService = inject(CurrencyFormatService);
  private readonly router = inject(Router);

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

  filterConfigs: FilterConfig[] = [
    {
      key: 'date_range',
      label: 'Período',
      type: 'date-range' },
  ];

  filterValues: FilterValues = {
    date_range_start: getDefaultStartDate(),
    date_range_end: getDefaultEndDate(),
    date_range_preset: 'thisMonth',
  };

  ngOnInit(): void {
    const urlRange = queryParamsToDateRange(this.route.snapshot.queryParamMap);
    if (urlRange) {
      this.dateRange.set(urlRange);
      this.filterValues = {
        date_range_start: urlRange.start_date,
        date_range_end: urlRange.end_date,
        date_range_preset: urlRange.preset || null,
      };
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

  readonly supplierColumns: TableColumn[] = [
    { key: 'supplier_name', label: 'Proveedor', priority: 1 },
    { key: 'order_count', label: 'Órdenes', align: 'right', priority: 2 },
    {
      key: 'total_spent',
      label: 'Comprado (sin IVA)',
      align: 'right',
      priority: 1,
      transform: (value: any) => this.currencyService.format(Number(value)),
    },
    {
      key: 'tax_amount',
      label: 'IVA',
      align: 'right',
      priority: 3,
      transform: (value: any) => this.currencyService.format(Number(value)),
    },
    { key: 'pending_orders', label: 'Pendientes', align: 'right', priority: 3 },
    {
      key: 'percentage_of_total',
      label: '% del total',
      align: 'right',
      priority: 2,
      transform: (value: any) => `${value} %`,
    },
    {
      key: 'growth',
      label: 'vs. anterior',
      align: 'right',
      priority: 3,
      // `defaultValue` y no `transform` para el caso nulo: la celda de
      // `app-table` corta antes del transform cuando el valor es null y pinta
      // `defaultValue || "No data"`. Acá el null SIGNIFICA algo — el proveedor
      // no tuvo compras en la ventana previa — así que debe decirlo.
      defaultValue: 'Sin base',
      transform: (value: any) => this.growthLabel(value as number | null),
    },
    {
      key: 'last_order_date',
      label: 'Última compra',
      priority: 3,
      defaultValue: 'Sin compras',
      transform: (value: any) => this.formatLastOrder(value as string | null),
    },
  ];

  readonly supplierCardConfig: ItemListCardConfig = {
    titleKey: 'supplier_name',
    detailKeys: [
      { key: 'order_count', label: 'Órdenes', icon: 'file-text' },
      {
        key: 'percentage_of_total',
        label: '% del total',
        icon: 'percent',
        transform: (value: any) => `${value} %`,
      },
      {
        key: 'growth',
        label: 'vs. anterior',
        icon: 'trending-up',
        transform: (value: any) => this.growthLabel(value as number | null),
      },
      {
        key: 'last_order_date',
        label: 'Última compra',
        icon: 'calendar',
        transform: (value: any) => this.formatLastOrder(value as string | null),
      },
    ],
    footerKey: 'total_spent',
    footerLabel: 'Comprado (sin IVA)',
    footerTransform: (value: any) => this.currencyService.format(Number(value)),
  };

  /**
   * Un proveedor listado tiene que llevar a su perfil (QUI-656), que es donde
   * está su deuda, su historial y sus documentos.
   */
  openSupplier(row: PurchasesBySupplier): void {
    this.router.navigate(['/admin/inventory/suppliers', row.supplier_id]);
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

  readonly dropdownActions = computed<DropdownAction[]>(() => [
    {
      action: 'export-xlsx',
      label: 'Exportar XLSX',
      icon: 'download',
    },
  ]);

  onActionsDropdownClick(action: string): void {
    if (action === 'export-xlsx') {
      this.exportReport();
    }
  }

  onFiltersDropdownChange(values: FilterValues): void {
    const dateFrom = values['date_range_start'] as string;
    const dateTo = values['date_range_end'] as string;
    const preset = values['date_range_preset'] as string;

    if (!dateFrom || !dateTo) return;
    const start = this.filterValues['date_range_start'];
    const end = this.filterValues['date_range_end'];
    if (start === dateFrom && end === dateTo) return;

    this.filterValues = values;
    this.dateRange.set({
      start_date: dateFrom,
      end_date: dateTo,
      preset: (preset || 'custom') as DateRangeFilter['preset'] });
    this.chartQueryKey.set(null);
    this.loadChartData();
  }

  onFiltersDropdownClearAll(): void {
    const reset = getDefaultStartDate();
    const end = getDefaultEndDate();
    this.filterValues = {
      date_range_start: reset,
      date_range_end: end,
      date_range_preset: 'thisMonth',
    };
    this.dateRange.set({
      start_date: reset,
      end_date: end,
      preset: 'thisMonth' });
    this.chartQueryKey.set(null);
    this.loadChartData();
  }
}
