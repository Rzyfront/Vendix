import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subject, takeUntil, forkJoin } from 'rxjs';

import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { TableColumn } from '../../../../../../shared/components/table/table.component';
import {
  ResponsiveDataViewComponent,
  ItemListCardConfig,
} from '../../../../../../shared/components/index';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { InputsearchComponent } from '../../../../../../shared/components/inputsearch/inputsearch.component';
import { OptionsDropdownComponent } from '../../../../../../shared/components/options-dropdown/options-dropdown.component';
import {
  FilterConfig,
  FilterValues,
  DropdownAction,
} from '../../../../../../shared/components/options-dropdown/options-dropdown.interfaces';

import { AnalyticsService } from '../../services/analytics.service';
import {
  StockLevelReport,
  InventorySummary,
} from '../../interfaces/inventory-analytics.interface';

@Component({
  selector: 'vendix-low-stock',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    CardComponent,
    ResponsiveDataViewComponent,
    StatsComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
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

      <!-- Card with search + data -->
      <div class="md:space-y-4">
        <app-card
          [responsive]="true"
          [padding]="false"
          customClasses="md:min-h-[600px]"
        >
          <!-- Search Section: sticky below stats on mobile, normal on desktop -->
          <div
            class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px] md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
          >
            <div
              class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4"
            >
              <h2
                class="text-[13px] font-semibold text-text-secondary tracking-wide md:text-lg md:font-semibold md:text-text-primary md:tracking-normal"
              >
                Productos
                <span
                  class="font-normal text-text-secondary/50 md:font-semibold md:text-text-primary"
                >
                  ({{ filteredData().length }})
                </span>
              </h2>
              <div class="flex items-center gap-2 w-full md:w-auto">
                <app-inputsearch
                  class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                  size="sm"
                  placeholder="Buscar producto o SKU..."
                  [debounceTime]="300"
                  (searchChange)="onSearch($event)"
                ></app-inputsearch>
                <app-options-dropdown
                  class="shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                  [filters]="filterConfigs"
                  [filterValues]="filterValues"
                  [actions]="dropdownActions"
                  [isLoading]="loading()"
                  (filterChange)="onFilterChange($event)"
                  (clearAllFilters)="clearFilters()"
                  (actionClick)="onActionClick($event)"
                ></app-options-dropdown>
              </div>
            </div>
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
    </div>
  `,
})
export class LowStockComponent implements OnInit, OnDestroy {
  private analyticsService = inject(AnalyticsService);
  private toastService = inject(ToastService);
  private destroy$ = new Subject<void>();

  // Signals
  loading = signal(true);
  exporting = signal(false);
  data = signal<StockLevelReport[]>([]);
  summary = signal<InventorySummary | null>(null);
  searchTerm = signal('');
  statusFilter = signal<string>('');

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
      ],
    },
  ];

  filterValues: FilterValues = {};

  dropdownActions: DropdownAction[] = [
    {
      label: 'Crear Orden de Compra',
      icon: 'shopping-cart',
      action: 'create-pop',
      variant: 'primary',
    },
    {
      label: 'Exportar',
      icon: 'download',
      action: 'export',
    },
  ];

  // Columns with SPANISH badges
  columns: TableColumn[] = [
    {
      key: 'image_url',
      label: '',
      width: '50px',
      align: 'center',
      priority: 1,
      type: 'image',
    },
    { key: 'product_name', label: 'Producto', sortable: true, priority: 1 },
    { key: 'sku', label: 'SKU', sortable: true, priority: 2, width: '120px' },
    {
      key: 'quantity_available',
      label: 'Disponible',
      sortable: true,
      align: 'right',
      priority: 1,
      width: '100px',
    },
    {
      key: 'reorder_point',
      label: 'Punto Reorden',
      sortable: true,
      align: 'right',
      priority: 1,
      width: '120px',
    },
    {
      key: 'days_of_stock',
      label: 'Dias de Stock',
      sortable: true,
      align: 'right',
      priority: 2,
      width: '120px',
      defaultValue: '-',
      transform: (val: any) => `${val} dias`,
    },
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
          out_of_stock: '#ef4444',
        },
      },
      transform: (val: string) =>
        val === 'out_of_stock'
          ? 'Agotado'
          : val === 'low_stock'
            ? 'Stock Bajo'
            : val,
    },
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
        out_of_stock: '#ef4444',
      },
    },
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
        transform: (val: any) => `${val} uds`,
      },
      {
        key: 'reorder_point',
        label: 'Reorden',
        transform: (val: any) => `${val} uds`,
      },
    ],
  };

  ngOnInit(): void {
    this.loadData();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadData(): void {
    this.loading.set(true);

    forkJoin({
      alerts: this.analyticsService.getLowStockAlerts({ limit: 100 }),
      summary: this.analyticsService.getInventorySummary(),
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: ({ alerts, summary }) => {
          this.data.set(alerts.data);
          this.summary.set(summary.data);
          this.loading.set(false);
        },
        error: () => {
          this.toastService.error('Error al cargar alertas de stock');
          this.loading.set(false);
        },
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
      .pipe(takeUntil(this.destroy$))
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
        },
      });
  }
}
