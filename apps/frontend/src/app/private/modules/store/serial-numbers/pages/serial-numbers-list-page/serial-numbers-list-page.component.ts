import {
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  CardComponent,
  DropdownAction,
  EmptyStateComponent,
  FilterConfig,
  FilterValues,
  InputsearchComponent,
  ItemListCardConfig,
  OptionsDropdownComponent,
  PaginationComponent,
  ResponsiveDataViewComponent,
  StatsComponent,
  StickyHeaderComponent,
  TableColumn,
  ToastService,
} from '../../../../../../shared/components/index';

import {
  SerialNumber,
  SerialNumberStatus,
  SerialNumbersService,
} from '../../services/serial-numbers.service';

interface SerialNumbersStats {
  total: number;
  in_stock: number;
  sold: number;
  reserved: number;
}

/** Flattened row used by the table/cards (nested keys pre-resolved). */
interface SerialRowFlat extends SerialNumber {
  product_name: string;
  product_sku: string;
  location_name: string;
}

/** Status enum → Spanish display label. */
const STATUS_LABELS: Record<SerialNumberStatus, string> = {
  in_stock: 'En stock',
  reserved: 'Reservado',
  sold: 'Vendido',
  returned: 'Devuelto',
  damaged: 'Dañado',
  expired: 'Expirado',
  in_transit: 'En tránsito',
};

/** Custom badge color map keyed by the raw enum value (7-char hex required). */
const STATUS_COLOR_MAP: Record<string, string> = {
  in_stock: '#22c55e',
  reserved: '#f59e0b',
  sold: '#3b82f6',
  returned: '#a855f7',
  damaged: '#ef4444',
  expired: '#6b7280',
  in_transit: '#06b6d4',
};

const statusBadgeTransform = (value: SerialNumberStatus | string): string =>
  STATUS_LABELS[value as SerialNumberStatus] ?? String(value ?? '-');

@Component({
  selector: 'app-serial-numbers-list-page',
  standalone: true,
  imports: [
    FormsModule,
    StickyHeaderComponent,
    StatsComponent,
    CardComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    ResponsiveDataViewComponent,
    PaginationComponent,
    EmptyStateComponent,
  ],
  templateUrl: './serial-numbers-list-page.component.html',
})
export class SerialNumbersListPageComponent implements OnInit {
  private readonly serialNumbersService = inject(SerialNumbersService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly serials = signal<SerialRowFlat[]>([]);
  readonly stats = signal<SerialNumbersStats>({
    total: 0,
    in_stock: 0,
    sold: 0,
    reserved: 0,
  });

  readonly filters = signal({ page: 1, limit: 10 });
  readonly totalItems = signal(0);
  readonly isLoading = signal(false);

  readonly searchTerm = signal('');
  readonly statusFilter = signal<'all' | SerialNumberStatus>('all');
  filterValues: FilterValues = {};

  readonly totalPages = computed(
    () => Math.ceil(this.totalItems() / this.filters().limit) || 1,
  );

  readonly filterConfigs: FilterConfig[] = [
    {
      key: 'status',
      label: 'Estado',
      type: 'select',
      options: [
        { value: '', label: 'Todos' },
        { value: 'in_stock', label: 'En stock' },
        { value: 'reserved', label: 'Reservado' },
        { value: 'sold', label: 'Vendido' },
        { value: 'returned', label: 'Devuelto' },
        { value: 'damaged', label: 'Dañado' },
        { value: 'expired', label: 'Expirado' },
        { value: 'in_transit', label: 'En tránsito' },
      ],
    },
  ];

  readonly dropdownActions = computed<DropdownAction[]>(() => [
    { label: 'Refrescar', icon: 'refresh-cw', action: 'refresh' },
  ]);

  readonly tableColumns: TableColumn[] = [
    { key: 'serial_number', label: 'Serial', sortable: true, priority: 1 },
    {
      key: 'product_name',
      label: 'Producto',
      defaultValue: '-',
      priority: 1,
    },
    {
      key: 'product_sku',
      label: 'SKU',
      defaultValue: '-',
      width: '140px',
      priority: 2,
    },
    {
      key: 'location_name',
      label: 'Ubicación',
      defaultValue: '-',
      priority: 2,
    },
    {
      key: 'status',
      label: 'Estado',
      priority: 1,
      transform: (value: SerialNumberStatus | string) =>
        statusBadgeTransform(value),
      badge: true,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: STATUS_COLOR_MAP,
      },
    },
    {
      key: 'created_at',
      label: 'Creado',
      priority: 3,
      transform: (value: string | null) =>
        value ? new Date(value).toLocaleDateString() : '-',
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'serial_number',
    subtitleKey: 'product_name',
    avatarFallbackIcon: 'fingerprint',
    avatarShape: 'square',
    badgeKey: 'status',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: STATUS_COLOR_MAP,
    },
    badgeTransform: (value: SerialNumberStatus | string) =>
      statusBadgeTransform(value),
    detailKeys: [
      { key: 'product_sku', label: 'SKU', icon: 'barcode' },
      { key: 'location_name', label: 'Ubicación', icon: 'map-pin' },
    ],
  };

  ngOnInit(): void {
    this.loadSerials();
  }

  loadSerials(): void {
    this.isLoading.set(true);

    const query: Record<string, unknown> = {
      page: this.filters().page,
      limit: this.filters().limit,
    };

    if (this.searchTerm()) {
      query['search'] = this.searchTerm();
    }
    if (this.statusFilter() !== 'all') {
      query['status'] = this.statusFilter();
    }

    this.serialNumbersService
      .listPaginated(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const data = response.data ?? [];
          const flat: SerialRowFlat[] = data.map((row) => ({
            ...row,
            product_name: row.products?.name ?? '-',
            product_sku: row.products?.sku ?? '-',
            location_name: row.inventory_locations?.name ?? '-',
          }));
          this.serials.set(flat);
          this.totalItems.set(
            response.meta?.pagination?.total ?? flat.length,
          );
          this.recalculateStats(flat);
          this.isLoading.set(false);
        },
        error: (error) => {
          this.toastService.error(
            typeof error === 'string'
              ? error
              : 'Error al cargar los números de serie',
          );
          this.isLoading.set(false);
        },
      });
  }

  private recalculateStats(list: SerialRowFlat[]): void {
    this.stats.set({
      total: this.totalItems(),
      in_stock: list.filter((s) => s.status === 'in_stock').length,
      sold: list.filter((s) => s.status === 'sold').length,
      reserved: list.filter((s) => s.status === 'reserved').length,
    });
  }

  onSearch(term: string): void {
    this.searchTerm.set(term);
    this.filters.update((f) => ({ ...f, page: 1 }));
    this.loadSerials();
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues = values;
    const statusValue = values['status'] as string | undefined;
    if (statusValue) {
      this.statusFilter.set(statusValue as SerialNumberStatus);
    } else {
      this.statusFilter.set('all');
    }
    this.filters.update((f) => ({ ...f, page: 1 }));
    this.loadSerials();
  }

  clearFilters(): void {
    this.searchTerm.set('');
    this.statusFilter.set('all');
    this.filterValues = {};
    this.filters.update((f) => ({ ...f, page: 1 }));
    this.loadSerials();
  }

  onPageChange(page: number): void {
    this.filters.update((f) => ({ ...f, page }));
    this.loadSerials();
  }

  onActionClick(action: string): void {
    if (action === 'refresh') {
      this.loadSerials();
    }
  }

  get hasFilters(): boolean {
    return this.searchTerm().length > 0 || this.statusFilter() !== 'all';
  }

  getEmptyStateTitle(): string {
    return this.hasFilters
      ? 'Ningún número de serie coincide con tus filtros'
      : 'No hay números de serie registrados';
  }

  getEmptyStateDescription(): string {
    return this.hasFilters
      ? 'Ajusta los filtros o la búsqueda para encontrar números de serie.'
      : 'Los números de serie se generan automáticamente al recibir compras o vender en el POS.';
  }
}
