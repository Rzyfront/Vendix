import {
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
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
  ManufacturingPlantsService,
} from '../../../services';
import { ProductionOrdersService } from '../../../../restaurant-ops/production/services/production-orders.service';
import { ProductionSseService } from '../../../../restaurant-ops/production/services/production-sse.service';

const STATUSES = Object.keys(ORDER_STATUS_LABELS) as ManufacturingOrderStatus[];

/** Id de planta válido (entero > 0) o null. */
function parsePlantId(raw: string | null | undefined): number | null {
  if (raw == null || raw === '') return null;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

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
  private readonly plantsService = inject(ManufacturingPlantsService);
  private readonly toastService = inject(ToastService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly sse = inject(ProductionSseService);

  readonly orders = signal<ManufacturingOrder[]>([]);
  readonly filters = signal({ page: 1, limit: 10 });
  readonly totalItems = signal(0);
  readonly isLoading = signal(false);

  readonly searchTerm = signal('');
  readonly statusFilter = signal<ManufacturingOrderStatus | null>(null);
  readonly productFilter = signal<number | null>(null);
  /** QUI-1013: only the orders of this plant. */
  readonly plantFilter = signal<number | null>(null);
  readonly dateFrom = signal<string | null>(null);
  readonly dateTo = signal<string | null>(null);
  filterValues: FilterValues = {};

  private readonly productOptions = signal<{ value: string; label: string }[]>([]);
  /** Every plant (inactive ones keep their orders); the filter shows with two or more. */
  private readonly plantOptions = signal<{ value: string; label: string }[]>([]);

  readonly totalPages = computed(
    () => Math.ceil(this.totalItems() / this.filters().limit) || 1,
  );
  readonly hasFilters = computed(
    () =>
      this.searchTerm().length > 0 ||
      this.statusFilter() !== null ||
      this.productFilter() !== null ||
      this.plantFilter() !== null ||
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
    ...(this.plantOptions().length > 1
      ? [
          {
            key: 'plant_id',
            label: 'Planta',
            type: 'select' as const,
            options: [{ value: '', label: 'Todas' }, ...this.plantOptions()],
          },
        ]
      : []),
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
        ProductionOrdersService.displayName(
        row.product?.name ?? `Producto #${row.product_id}`,
        row.product_variant?.name,
      ),
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
      key: 'plant',
      label: 'Planta',
      priority: 3,
      transform: (_: unknown, row: ManufacturingOrder) => row.plant?.name ?? '—',
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
      ProductionOrdersService.displayName(
        row.product?.name ?? `Producto #${row.product_id}`,
        row.product_variant?.name,
      ),
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
    // QUI-1065 — el filtro por planta vive en `?plant_id=` (mismo nombre que la
    // sesión de producción) para sobrevivir a recargas y enlaces compartidos.
    const plantFromUrl = parsePlantId(this.route.snapshot.queryParamMap.get('plant_id'));
    if (plantFromUrl != null) {
      this.plantFilter.set(plantFromUrl);
      this.filterValues = { ...this.filterValues, plant_id: String(plantFromUrl) };
    }
    this.loadProductOptions();
    this.loadPlantOptions();
    this.loadOrders();
    // Another screen (or device) moved an order: refresh without a spinner.
    this.sse.listen(this.destroyRef, () => this.loadOrders(true), undefined, 'manufacturing');
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

  private loadPlantOptions(): void {
    this.plantsService
      .list(true)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => {
          this.plantOptions.set(
            rows.map((p) => ({
              value: String(p.id),
              label: p.is_active ? p.name : `${p.name} (inactiva)`,
            })),
          );
          this.dropUnknownPlantFilter(rows.map((p) => p.id));
        },
        error: () => {
          // El filtro por planta es opcional: se omite en silencio.
        },
      });
  }

  loadOrders(silent = false): void {
    if (!silent) this.isLoading.set(true);
    const query: ManufacturingOrderQuery = {
      page: this.filters().page,
      limit: this.filters().limit,
    };
    if (this.searchTerm()) query.search = this.searchTerm();
    if (this.statusFilter()) query.status = this.statusFilter() as ManufacturingOrderStatus;
    if (this.productFilter() != null) query.product_id = this.productFilter() as number;
    if (this.plantFilter() != null) query.plant_id = this.plantFilter() as number;
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
    const plant = Number(values['plant_id']);
    this.plantFilter.set(Number.isInteger(plant) && plant > 0 ? plant : null);
    this.dateFrom.set((values['due_start'] as string | undefined) || null);
    this.dateTo.set((values['due_end'] as string | undefined) || null);
    this.filters.update((f) => ({ ...f, page: 1 }));
    this.syncPlantToUrl();
    this.loadOrders();
  }

  /**
   * QUI-1065 — una planta del enlace que no es de esta tienda (o un enlace
   * abierto en una tienda con una sola planta, donde el filtro ni se muestra)
   * no debe dejar la lista filtrada sin forma visible de quitarlo.
   */
  private dropUnknownPlantFilter(plantIds: number[]): void {
    const plant = this.plantFilter();
    if (plant == null) return;
    if (plantIds.length > 1 && plantIds.includes(plant)) return;
    this.plantFilter.set(null);
    const rest = { ...this.filterValues };
    delete rest['plant_id'];
    this.filterValues = rest;
    this.filters.update((f) => ({ ...f, page: 1 }));
    this.syncPlantToUrl();
    this.loadOrders();
  }

  /** Refleja la planta en `?plant_id=` sin tocar el resto de la URL ni el historial. */
  private syncPlantToUrl(): void {
    const plant = this.plantFilter();
    const current = parsePlantId(this.route.snapshot.queryParamMap.get('plant_id'));
    if (current === plant) return;
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { plant_id: plant },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  clearFilters(): void {
    this.searchTerm.set('');
    this.statusFilter.set(null);
    this.productFilter.set(null);
    this.plantFilter.set(null);
    this.dateFrom.set(null);
    this.dateTo.set(null);
    this.filterValues = {};
    this.filters.update((f) => ({ ...f, page: 1 }));
    this.syncPlantToUrl();
    this.loadOrders();
  }

  onPageChange(page: number): void {
    this.filters.update((f) => ({ ...f, page }));
    this.loadOrders();
  }

  onActionClick(action: string): void {
    if (action === 'create') this.createOrder();
    if (action === 'day') this.router.navigate(['/admin/manufacturing/orders/day']);
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
