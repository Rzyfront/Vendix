import {
  Component,
  DestroyRef,
  inject,
  output,
  signal,
  OnInit,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  TableColumn,
  TableAction,
  ResponsiveDataViewComponent,
  ItemListCardConfig,
  InputsearchComponent,
  OptionsDropdownComponent,
  FilterConfig,
  FilterValues,
  DropdownAction,
  PaginationComponent,
  EmptyStateComponent,
  CardComponent,
  SelectorComponent,
  SelectorOption,
} from '../../../../../../shared/components/index';

import { PlanillasRutasService } from '../../services/planillas-rutas.service';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { formatDateOnlyUTC } from '../../../../../../shared/utils/date.util';
import {
  DispatchRoute,
  DispatchRouteStatus,
} from '../../interfaces/planilla.interface';

const STATUS_LABELS: Record<DispatchRouteStatus, string> = {
  draft: 'Borrador',
  dispatched: 'Despachada',
  in_transit: 'En ruta',
  settling: 'Cuadrando',
  closed: 'Cerrada',
  voided: 'Anulada',
};

// Custom-badge colorMap: TableComponent/ItemListComponent resolve these to
// INLINE styles (soft background + solid text + faint border), so values MUST be
// 7-char hex colors — Tailwind class strings produce invalid inline styles and
// render colorless badges. Semantic, WCAG-AA-friendly status palette.
const STATUS_COLORS: Record<string, string> = {
  draft: '#6b7280', // gray-500 — sin despachar
  dispatched: '#2563eb', // blue-600 — despachada
  in_transit: '#4f46e5', // indigo-600 — en ruta
  settling: '#d97706', // amber-600 — cuadrando
  closed: '#059669', // emerald-600 — cerrada
  voided: '#dc2626', // red-600 — anulada
};

@Component({
  selector: 'app-planillas-list',
  standalone: true,
  imports: [
    FormsModule,
    ResponsiveDataViewComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    PaginationComponent,
    EmptyStateComponent,
    CardComponent,
    SelectorComponent,
  ],
  template: `
    <div class="md:space-y-4">
      <app-card
        [responsive]="true"
        [padding]="false"
        overflow="visible"
      >
        <!-- Search Section -->
        <div
          class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px] md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
        >
          <div
            class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4"
          >
            <h2
              class="text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary"
            >
              Planillas ({{ totalItems() }})
            </h2>

            <div class="flex items-center gap-2 w-full md:w-auto">
              <app-inputsearch
                class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                size="sm"
                placeholder="Buscar por número, ruta o conductor..."
                [debounceTime]="1000"
                [ngModel]="search()"
                (ngModelChange)="onSearchChange($event)"
              ></app-inputsearch>

              <app-options-dropdown
                class="shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                [filters]="filterConfigs"
                [filterValues]="filterValues()"
                [actions]="dropdownActions"
                [isLoading]="loading()"
                (filterChange)="onFilterChange($event)"
                (clearAllFilters)="clearFilters()"
                (actionClick)="onActionClick($event)"
              ></app-options-dropdown>
            </div>
          </div>
        </div>

        <!-- Loading State -->
        @if (loading()) {
          <div class="p-4 md:p-6 text-center">
            <div
              class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
            ></div>
            <p class="mt-2 text-text-secondary">Cargando planillas...</p>
          </div>
        }

        <!-- Empty State -->
        @if (!loading() && routes().length === 0) {
          <app-empty-state
            icon="truck"
            [title]="emptyStateTitle()"
            [description]="emptyStateDescription()"
            actionButtonText="Nueva Planilla"
            [showActionButton]="!hasFilters()"
            [showClearFilters]="hasFilters()"
            (actionClick)="create.emit()"
            (clearFiltersClick)="clearFilters()"
          ></app-empty-state>
        }

        <!-- Routes List -->
        @if (!loading() && routes().length > 0) {
          <div class="px-2 pb-2 pt-3 md:p-4">
            <app-responsive-data-view
              [data]="routes()"
              [columns]="tableColumns"
              [actions]="tableActions"
              [cardConfig]="cardConfig"
              [loading]="loading()"
              [sortable]="true"
              (rowClick)="viewDetail.emit($event)"
            ></app-responsive-data-view>

            <app-pagination
              [currentPage]="page()"
              [totalPages]="totalPages()"
              [total]="totalItems()"
              [limit]="limit()"
              infoStyle="range"
              (pageChange)="goToPage($event)"
            ></app-pagination>

            <!-- Page-size selector (system app-selector) -->
            <div class="flex items-center justify-end gap-2 mt-2 text-xs text-text-secondary">
              <label for="planillas-limit" class="shrink-0">Por página:</label>
              <app-selector
                [id]="'planillas-limit'"
                size="sm"
                class="w-20"
                [options]="limitSelectorOptions"
                [ngModel]="limit()"
                (ngModelChange)="onLimitChange($event)"
              ></app-selector>
            </div>
          </div>
        }
      </app-card>
    </div>
  `,
})
export class PlanillasListComponent implements OnInit {
  private readonly service = inject(PlanillasRutasService);
  private readonly currencyService = inject(CurrencyFormatService);
  private readonly destroyRef = inject(DestroyRef);

  readonly viewDetail = output<DispatchRoute>();
  readonly create = output<void>();
  readonly refresh = output<void>();

  readonly routes = signal<DispatchRoute[]>([]);
  readonly loading = signal(false);
  readonly page = signal(1);
  readonly totalPages = signal(1);
  readonly totalItems = signal(0);
  readonly search = signal('');
  readonly statusFilter = signal<DispatchRouteStatus | ''>('');
  readonly filterValues = signal<FilterValues>({});

  readonly limit = signal(20);
  readonly limitOptions = [10, 20, 50, 100];
  readonly limitSelectorOptions: SelectorOption[] = this.limitOptions.map(
    (n) => ({ value: n, label: String(n) }),
  );

  readonly filterConfigs: FilterConfig[] = [
    {
      key: 'status',
      label: 'Estado',
      type: 'select',
      options: [
        { value: '', label: 'Todos los Estados' },
        { value: 'draft', label: 'Borrador' },
        { value: 'dispatched', label: 'Despachada' },
        { value: 'in_transit', label: 'En ruta' },
        { value: 'settling', label: 'Cuadrando' },
        { value: 'closed', label: 'Cerrada' },
        { value: 'voided', label: 'Anulada' },
      ],
    },
  ];

  readonly dropdownActions: DropdownAction[] = [
    {
      label: 'Nueva Planilla',
      icon: 'plus',
      action: 'create',
      variant: 'primary',
    },
    {
      label: 'Refrescar',
      icon: 'refresh-cw',
      action: 'refresh',
      variant: 'outline',
    },
  ];

  readonly tableColumns: TableColumn[] = [
    {
      key: 'route_number',
      label: 'Planilla',
      sortable: true,
      width: '140px',
      priority: 1,
    },
    {
      key: 'route_code',
      label: 'Ruta',
      defaultValue: '—',
      priority: 3,
    },
    {
      key: 'status',
      label: 'Estado',
      badge: true,
      priority: 1,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: STATUS_COLORS,
      },
      transform: (value: DispatchRouteStatus) => this.getStatusLabel(value),
    },
    {
      key: 'driver_user',
      label: 'Conductor',
      priority: 2,
      transform: (_: any, row?: DispatchRoute) =>
        row ? this.getDriverName(row) : '—',
    },
    {
      key: 'vehicle',
      label: 'Vehículo',
      priority: 3,
      transform: (value: DispatchRoute['vehicle']) => value?.plate || '—',
    },
    {
      key: '_count',
      label: 'Paradas',
      align: 'right',
      priority: 3,
      transform: (_: any, row?: DispatchRoute) =>
        String(row?._count?.stops ?? row?.stops?.length ?? 0),
    },
    {
      key: 'total_to_collect',
      label: 'A recaudar',
      align: 'right',
      priority: 1,
      transform: (value: any) => this.formatCurrency(value),
    },
    {
      key: 'planned_date',
      label: 'Fecha',
      sortable: true,
      priority: 2,
      transform: (value: string) => (value ? formatDateOnlyUTC(value) : '—'),
    },
  ];

  readonly tableActions: TableAction[] = [
    {
      label: 'Ver Detalle',
      icon: 'eye',
      action: (route: DispatchRoute) => this.viewDetail.emit(route),
      variant: 'secondary',
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'route_number',
    titleTransform: (item: DispatchRoute) => item.route_number,
    subtitleTransform: (item: DispatchRoute) =>
      item.route_code ? `Ruta ${item.route_code}` : this.getDriverName(item),
    avatarFallbackIcon: 'truck',
    avatarShape: 'square',
    badgeKey: 'status',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: STATUS_COLORS,
    },
    badgeTransform: (val: any) => this.getStatusLabel(val),
    footerKey: 'total_to_collect',
    footerLabel: 'A recaudar',
    footerStyle: 'prominent',
    footerTransform: (val: any) => this.formatCurrency(val),
    detailKeys: [
      {
        key: 'driver_user',
        label: 'Conductor',
        transform: (_: any, row?: DispatchRoute) =>
          row ? this.getDriverName(row) : '—',
      },
      {
        key: 'vehicle',
        label: 'Vehículo',
        transform: (val: DispatchRoute['vehicle']) => val?.plate || '—',
      },
      {
        key: '_count',
        label: 'Paradas',
        transform: (_: any, row?: DispatchRoute) =>
          String(row?._count?.stops ?? row?.stops?.length ?? 0),
      },
      {
        key: 'planned_date',
        label: 'Fecha',
        transform: (val: any) => (val ? formatDateOnlyUTC(val) : '—'),
      },
    ],
  };

  ngOnInit() {
    this.load();
  }

  load() {
    this.loading.set(true);
    this.service
      .list({
        page: this.page(),
        limit: this.limit(),
        search: this.search() || undefined,
        status: (this.statusFilter() || undefined) as DispatchRouteStatus,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.routes.set(res.data);
          this.totalPages.set(res.pagination.totalPages);
          this.totalItems.set(res.pagination.total);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
        },
      });
  }

  onSearchChange(term: string) {
    this.search.set(term);
    this.page.set(1);
    this.load();
  }

  onFilterChange(values: FilterValues) {
    this.filterValues.set(values);
    this.statusFilter.set((values['status'] as DispatchRouteStatus) || '');
    this.page.set(1);
    this.load();
  }

  clearFilters() {
    this.search.set('');
    this.statusFilter.set('');
    this.filterValues.set({});
    this.page.set(1);
    this.load();
  }

  onActionClick(action: string) {
    if (action === 'create') {
      this.create.emit();
    } else if (action === 'refresh') {
      this.refresh.emit();
    }
  }

  /**
   * Change the page size (limit) and reload the list from page 1.
   */
  onLimitChange(limit: number): void {
    this.limit.set(limit);
    this.page.set(1);
    this.load();
  }

  goToPage(p: number) {
    if (p < 1 || p > this.totalPages()) return;
    this.page.set(p);
    this.load();
  }

  hasFilters(): boolean {
    return !!(this.search() || this.statusFilter());
  }

  emptyStateTitle(): string {
    return this.hasFilters()
      ? 'No se encontraron planillas'
      : 'No hay planillas';
  }

  emptyStateDescription(): string {
    return this.hasFilters()
      ? 'Intenta ajustar tus filtros para ver más resultados'
      : 'Comienza creando tu primera planilla de despacho.';
  }

  getDriverName(route: DispatchRoute): string {
    if (route.driver_user) {
      const name = `${route.driver_user.first_name ?? ''} ${route.driver_user.last_name ?? ''}`.trim();
      return name || '—';
    }
    if (route.external_driver_name) {
      return `${route.external_driver_name} (ext.)`;
    }
    return '—';
  }

  getStatusLabel(status: DispatchRouteStatus): string {
    return STATUS_LABELS[status] || status;
  }

  formatCurrency(value: any): string {
    const num_value =
      typeof value === 'string' ? parseFloat(value) : value || 0;
    return this.currencyService.format(num_value);
  }
}
