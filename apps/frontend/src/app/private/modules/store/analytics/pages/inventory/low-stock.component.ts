import {Component, OnInit, inject, signal, computed,
  DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterModule } from '@angular/router';
import { forkJoin } from 'rxjs';
import { getViewsByCategory, AnalyticsView } from '../../config/analytics-registry';

import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { ChartComponent } from '../../../../../../shared/components/chart/chart.component';
import { TableColumn } from '../../../../../../shared/components/table/table.component';
import {
  ResponsiveDataViewComponent,
  ItemListCardConfig} from '../../../../../../shared/components/index';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { InputsearchComponent } from '../../../../../../shared/components/inputsearch/inputsearch.component';
import { OptionsDropdownComponent } from '../../../../../../shared/components/options-dropdown/options-dropdown.component';
import {
  FilterConfig,
  FilterValues,
  DropdownAction} from '../../../../../../shared/components/options-dropdown/options-dropdown.interfaces';

import { AnalyticsService } from '../../services/analytics.service';
import {
  StockLevelReport,
  InventorySummary} from '../../interfaces/inventory-analytics.interface';
import { EChartsOption } from 'echarts';

@Component({
  selector: 'vendix-low-stock',
  standalone: true,
imports: [
    RouterModule,
    CardComponent,
    ChartComponent,
    ResponsiveDataViewComponent,
    StatsComponent,
    IconComponent,
    InputsearchComponent,
    OptionsDropdownComponent
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

        <div class="flex items-center gap-2 md:gap-3 shrink-0">
          <div class="flex rounded-lg border border-border overflow-hidden">
            <button
              (click)="activeView.set('chart')"
              class="flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors"
              [class]="activeView() === 'chart' ? 'bg-black text-white' : 'bg-surface text-text-secondary hover:bg-background'"
            >
              <app-icon name="bar-chart-2" [size]="16"></app-icon>
              Gráfica
            </button>
            <button
              (click)="activeView.set('table')"
              class="flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors"
              [class]="activeView() === 'table' ? 'bg-black text-white' : 'bg-surface text-text-secondary hover:bg-background'"
            >
              <app-icon name="table" [size]="16"></app-icon>
              Tabla
            </button>
          </div>
        </div>
      </div>

      @if (activeView() === 'chart') {
      <!-- Chart: Stock Alert Distribution -->
      <app-card shadow="none" [responsivePadding]="true" [showHeader]="true">
        <div slot="header" class="flex flex-col">
          <span class="text-sm font-bold text-[var(--color-text-primary)]">
            Distribución por Estado
          </span>
        </div>
        @if (!loading() && chartOptions()) {
        <app-chart
          [options]="chartOptions()"
          size="large"
          [showLegend]="true"
        ></app-chart>
        }
      </app-card>
      }

      @if (activeView() === 'table') {
      <!-- Card with search + data -->
      <div class="md:space-y-4">
        <app-card
          [responsive]="true"
          [padding]="false"
          customClasses="md:min-h-[600px]"
        >
          <!-- Search + Filter Bar -->
          <div class="flex items-center gap-2 md:gap-3 px-4 py-3 border-b border-border">
            <app-inputsearch
                class="flex-1 md:w-64"
                size="sm"
                placeholder="Buscar producto o SKU..."
                [debounceTime]="300"
                (searchChange)="onSearch($event)"
              ></app-inputsearch>
              <app-options-dropdown
                [filters]="filterConfigs"
                [filterValues]="filterValues"
                [actions]="dropdownActions"
                [isLoading]="loading()"
                (filterChange)="onFilterChange($event)"
                (clearAllFilters)="clearFilters()"
                (actionClick)="onActionClick($event)"
              ></app-options-dropdown>
          </div>

          <!-- Loading -->
          @if (loading()) {
            <div class="p-4 md:p-6 text-center">
              <div
                class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
              ></div>
              <p class="mt-2 text-text-secondary">Cargando alertas...</p>
            </div>
          }

          <!-- Data View -->
          @if (!loading()) {
            <div class="px-2 pb-2 pt-3 md:p-4">
              <app-responsive-data-view
                [data]="filteredData()"
                [columns]="columns"
                [cardConfig]="cardConfig"
                [loading]="loading()"
                emptyMessage="No hay productos con stock bajo"
                emptyIcon="check-circle"
              ></app-responsive-data-view>
            </div>
          }
        </app-card>
      </div>
      }
    </div>
  `})
export class LowStockComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private analyticsService = inject(AnalyticsService);
  private toastService = inject(ToastService);
// Signals
  loading = signal(true);
  exporting = signal(false);
  data = signal<StockLevelReport[]>([]);
  summary = signal<InventorySummary | null>(null);
  searchTerm = signal('');
  statusFilter = signal<string>('');
  chartOptions = signal<EChartsOption>({});
  activeView = signal<'chart' | 'table'>('chart');

  // Computed: filtered data based on search + status filter
  filteredData = computed(() => {
    let items = this.data();
    const term = this.searchTerm().toLowerCase().trim();
    const status = this.statusFilter();

    if (term) {
      items = items.filter(
        (item) =>
          item.product_name.toLowerCase().includes(term) ||
          item.sku.toLowerCase().includes(term),
      );
    }

    if (status) {
      items = items.filter((item) => item.status === status);
    }

    return items;
  });

  // Computed: total alerts
  totalAlerts = computed(() => {
    const s = this.summary();
    if (!s) return this.data().length;
    return s.low_stock_count + s.out_of_stock_count;
  });

  // Filter configs for OptionsDropdown
  filterConfigs: FilterConfig[] = [
    {
      key: 'status',
      label: 'Estado',
      type: 'select',
      options: [
        { value: '', label: 'Todos' },
        { value: 'out_of_stock', label: 'Agotado' },
        { value: 'low_stock', label: 'Stock Bajo' },
      ]},
  ];

  filterValues: FilterValues = {};

  dropdownActions: DropdownAction[] = [
    {
      label: 'Crear Orden de Compra',
      icon: 'shopping-cart',
      action: 'create-pop',
      variant: 'primary'},
    {
      label: 'Exportar',
      icon: 'download',
      action: 'export'},
  ];

  // Columns with SPANISH badges
  columns: TableColumn[] = [
    {
      key: 'image_url',
      label: '',
      width: '50px',
      align: 'center',
      priority: 1,
      type: 'image'},
    { key: 'product_name', label: 'Producto', sortable: true, priority: 1 },
    { key: 'sku', label: 'SKU', sortable: true, priority: 2, width: '120px' },
    {
      key: 'quantity_available',
      label: 'Disponible',
      sortable: true,
      align: 'right',
      priority: 1,
      width: '100px'},
    {
      key: 'reorder_point',
      label: 'Punto Reorden',
      sortable: true,
      align: 'right',
      priority: 1,
      width: '120px'},
    {
      key: 'days_of_stock',
      label: 'Dias de Stock',
      sortable: true,
      align: 'right',
      priority: 2,
      width: '120px',
      defaultValue: '-',
      transform: (val: any) => `${val} dias`},
    {
      key: 'status',
      label: 'Estado',
      badge: true,
      align: 'center',
      priority: 1,
      width: '100px',
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: {
          low_stock: '#f59e0b',
          out_of_stock: '#ef4444'}},
      transform: (val: string) =>
        val === 'out_of_stock'
          ? 'Agotado'
          : val === 'low_stock'
            ? 'Stock Bajo'
            : val},
  ];

  cardConfig: ItemListCardConfig = {
    titleKey: 'product_name',
    subtitleKey: 'sku',
    avatarKey: 'image_url',
    badgeKey: 'status',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: {
        low_stock: '#f59e0b',
        out_of_stock: '#ef4444'}},
    badgeTransform: (val: string) =>
      val === 'out_of_stock'
        ? 'Agotado'
        : val === 'low_stock'
          ? 'Stock Bajo'
          : val,
    detailKeys: [
      {
        key: 'quantity_available',
        label: 'Disponible',
        transform: (val: any) => `${val} uds`},
      {
        key: 'reorder_point',
        label: 'Reorden',
        transform: (val: any) => `${val} uds`},
    ]};

  ngOnInit(): void {
    this.loadData();
  }
  loadData(): void {
    this.loading.set(true);

    forkJoin({
      alerts: this.analyticsService.getLowStockAlerts({ limit: 100 }),
      summary: this.analyticsService.getInventorySummary()})
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ alerts, summary }) => {
          this.data.set(alerts.data);
          this.summary.set(summary.data);
          this.updateChart(alerts.data);
          this.loading.set(false);
        },
        error: () => {
          this.toastService.error('Error al cargar alertas de stock');
          this.loading.set(false);
        }});
  }

  private updateChart(alerts: StockLevelReport[]): void {
    const borderColor = '#e5e7eb';
    const textSecondary = '#6b7280';

    const outOfStock = alerts.filter(a => a.status === 'out_of_stock').length;
    const lowStock = alerts.filter(a => a.status === 'low_stock').length;
    const inStock = alerts.filter(a => a.status === 'in_stock').length;

    this.chartOptions.set({
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          const p = params[0];
          return `${p.name}: ${p.value} productos`;
        },
      },
      legend: {
        data: ['Alertas'],
        bottom: 30,
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
        axisLine: { show: false },
        axisLabel: { color: textSecondary },
        splitLine: { lineStyle: { color: borderColor } },
      },
      series: [
        {
          name: 'Alertas',
          type: 'bar',
          data: [outOfStock, lowStock, inStock],
          itemStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: '#f59e0b' },
                { offset: 1, color: '#f59e0b80' },
              ],
            },
            borderRadius: [4, 4, 0, 0],
          },
          barMaxWidth: 40,
        },
      ],
    });
  }

  onSearch(term: string): void {
    this.searchTerm.set(term);
  }

  onFilterChange(values: FilterValues): void {
    const status = values['status'] as string;
    this.statusFilter.set(status || '');
    this.filterValues = values;
  }

  clearFilters(): void {
    this.searchTerm.set('');
    this.statusFilter.set('');
    this.filterValues = {};
  }

  onActionClick(action: string): void {
    if (action === 'export') {
      this.exportReport();
    } else if (action === 'create-pop') {
      window.location.href = '/admin/inventory/pop';
    }
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
