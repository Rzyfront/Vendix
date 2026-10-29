import {
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
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
  StickyHeaderComponent,
  TableColumn,
  ToastService,
} from '../../../../../../../shared/components/index';
import { formatDateOnlyUTC } from '../../../../../../../shared/utils/date.util';

import {
  ManufacturingOrder,
  ManufacturingOrderQuery,
  ManufacturingOrderStatus,
  ManufacturingPriority,
  ORDER_PRIORITY_LABELS,
  ORDER_STATUS_COLORS,
  ORDER_STATUS_LABELS,
} from '../../../interfaces';
import {
  ManufacturingFormulasService,
  ManufacturingOrdersService,
} from '../../../services';

const STATUSES = Object.keys(ORDER_STATUS_LABELS) as ManufacturingOrderStatus[];

@Component({
  selector: 'app-manufacturing-orders-list-page',
  standalone: true,
  imports: [
    FormsModule,
    StickyHeaderComponent,
    CardComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    ResponsiveDataViewComponent,
    PaginationComponent,
    EmptyStateComponent,
  ],
  templateUrl: './orders-list-page.component.html',
})
export class OrdersListPageComponent implements OnInit {
  private readonly ordersService = inject(ManufacturingOrdersService);
  private readonly formulasService = inject(ManufacturingFormulasService);
  private readonly toastService = inject(ToastService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly orders = signal<ManufacturingOrder[]>([]);
  readonly filters = signal({ page: 1, limit: 10 });
  readonly totalItems = signal(0);
  readonly isLoading = signal(false);

  readonly searchTerm = signal('');
  readonly statusFilter = signal<ManufacturingOrderStatus | null>(null);
  readonly productFilter = signal<number | null>(null);
  readonly dateFrom = signal<string | null>(null);
  readonly dateTo = signal<string | null>(null);
  filterValues: FilterValues = {};

  private readonly productOptions = signal<{ value: string; label: string }[]>([]);

  readonly totalPages = computed(
    () => Math.ceil(this.totalItems() / this.filters().limit) || 1,
  );
  readonly hasFilters = computed(
    () =>
      this.searchTerm().length > 0 ||
      this.statusFilter() !== null ||
      this.productFilter() !== null ||
      this.dateFrom() !== null ||
      this.dateTo() !== null,
  );

  readonly filterConfigs = computed<FilterConfig[]>(() => [
    {
      key: 'status',
      label: 'Estado',
      type: 'select',
      options: [
        { value: '', label: 'Todos' },
        ...STATUSES.map((s) => ({ value: s, label: ORDER_STATUS_LABELS[s] })),
      ],
    },
    {
      key: 'product_id',
      label: 'Producto',
      type: 'select',
      options: [{ value: '', label: 'Todos' }, ...this.productOptions()],
    },
    {
      key: 'due',
      label: 'Fecha de creación',
      type: 'date-range',
      showPresets: true,
    },
  ]);

  readonly dropdownActions: DropdownAction[] = [
    { label: 'Refrescar', icon: 'refresh-cw', action: 'refresh' },
    { label: 'Nueva orden', icon: 'plus', action: 'create', variant: 'primary' },
  ];

  readonly tableColumns: TableColumn[] = [
    {
      key: 'order_number',
      label: 'Orden',
      priority: 1,
      transform: (v: string | null, row: ManufacturingOrder) => v || `#${row.id}`,
    },
    {
      key: 'product',
      label: 'Producto',
      priority: 1,
      transform: (_: unknown, row: ManufacturingOrder) =>
        row.product?.name ?? `Producto #${row.product_id}`,
    },
    {
      key: 'planned_qty',
      label: 'Planeado',
      priority: 2,
      transform: (v: number | string) => this.formatNumber(v),
    },
    {
      key: 'produced_qty',
      label: 'Producido',
      priority: 2,
      transform: (v: number | string | null | undefined) =>
        v == null ? '—' : this.formatNumber(v),
    },
    {
      key: 'due_date',
      label: 'Entrega',
      priority: 3,
      transform: (v: string | Date | null | undefined) =>
        v ? formatDateOnlyUTC(v) : '—',
    },
    {
      key: 'priority',
      label: 'Prioridad',
      priority: 3,
      transform: (v: ManufacturingPriority | null | undefined) =>
        v ? ORDER_PRIORITY_LABELS[v] : '—',
    },
    {
      key: 'status',
      label: 'Estado',
      priority: 1,
      badge: true,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorFn: (v: ManufacturingOrderStatus) => ORDER_STATUS_COLORS[v],
      },
      transform: (v: ManufacturingOrderStatus) => ORDER_STATUS_LABELS[v] ?? String(v),
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'order_number',
    titleTransform: (row: ManufacturingOrder) => row.order_number || `#${row.id}`,
    subtitleKey: 'product',
    subtitleTransform: (row: ManufacturingOrder) =>
      row.product?.name ?? `Producto #${row.product_id}`,
    avatarFallbackIcon: 'factory',
    avatarShape: 'square',
    badgeKey: 'status',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorFn: (v: ManufacturingOrderStatus) => ORDER_STATUS_COLORS[v],
    },
    badgeTransform: (v: ManufacturingOrderStatus) => ORDER_STATUS_LABELS[v] ?? String(v),
    detailKeys: [
      {
        key: 'planned_qty',
        label: 'Planeado',
        icon: 'package',
        transform: (v: number | string) => this.formatNumber(v),
      },
      {
        key: 'due_date',
        label: 'Entrega',
        icon: 'clock',
        transform: (v: string | Date | null | undefined) =>
          v ? formatDateOnlyUTC(v) : '—',
      },
    ],
  };

  ngOnInit(): void {
    this.loadProductOptions();
    this.loadOrders();
  }

  private loadProductOptions(): void {
    this.formulasService
      .listProducts()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) =>
          this.productOptions.set(
            rows
              .filter((p) => p.product_type !== 'service')
              .map((p) => ({ value: String(p.id), label: p.name })),
          ),
        error: () => {
          // El filtro por producto es opcional: se omite en silencio.
        },
      });
  }

  loadOrders(): void {
    this.isLoading.set(true);
    const query: ManufacturingOrderQuery = {
      page: this.filters().page,
      limit: this.filters().limit,
    };
    if (this.searchTerm()) query.search = this.searchTerm();
    if (this.statusFilter()) query.status = this.statusFilter() as ManufacturingOrderStatus;
    if (this.productFilter() != null) query.product_id = this.productFilter() as number;
    if (this.dateFrom()) query.date_from = this.dateFrom() as string;
    if (this.dateTo()) query.date_to = this.dateTo() as string;

    this.ordersService
      .listPaginated(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const data = response.data ?? [];
          this.orders.set(data);
          this.totalItems.set(response.meta?.pagination?.total ?? data.length);
          this.isLoading.set(false);
        },
        error: (error) => {
          this.toastService.error(
            typeof error === 'string'
              ? error
              : 'Error al cargar las órdenes de producción',
          );
          this.isLoading.set(false);
        },
      });
  }

  onSearch(term: string): void {
    this.searchTerm.set(term);
    this.filters.update((f) => ({ ...f, page: 1 }));
    this.loadOrders();
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues = values;
    const status = values['status'] as string | undefined;
    this.statusFilter.set(
      status && (STATUSES as string[]).includes(status)
        ? (status as ManufacturingOrderStatus)
        : null,
    );
    const product = Number(values['product_id']);
    this.productFilter.set(Number.isFinite(product) && product > 0 ? product : null);
    this.dateFrom.set((values['due_start'] as string | undefined) || null);
    this.dateTo.set((values['due_end'] as string | undefined) || null);
    this.filters.update((f) => ({ ...f, page: 1 }));
    this.loadOrders();
  }

  clearFilters(): void {
    this.searchTerm.set('');
    this.statusFilter.set(null);
    this.productFilter.set(null);
    this.dateFrom.set(null);
    this.dateTo.set(null);
    this.filterValues = {};
    this.filters.update((f) => ({ ...f, page: 1 }));
    this.loadOrders();
  }

  onPageChange(page: number): void {
    this.filters.update((f) => ({ ...f, page }));
    this.loadOrders();
  }

  onActionClick(action: string): void {
    if (action === 'create') this.createOrder();
    if (action === 'refresh') this.loadOrders();
  }

  onRowClick(order: ManufacturingOrder): void {
    this.router.navigate(['/admin/manufacturing/orders', order.id]);
  }

  createOrder(): void {
    this.router.navigate(['/admin/manufacturing/orders/new']);
  }

  emptyTitle(): string {
    return this.hasFilters()
      ? 'Ninguna orden coincide con tus filtros'
      : 'Aún no tienes órdenes de producción';
  }

  emptyDescription(): string {
    return this.hasFilters()
      ? 'Ajusta los filtros o la búsqueda para encontrar órdenes.'
      : 'Crea tu primera orden para fabricar un producto a partir de su fórmula.';
  }

  private formatNumber(value: number | string | null | undefined): string {
    if (value == null) return '0';
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    return Number.isInteger(n) ? n.toString() : n.toFixed(2);
  }
}
