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
  DialogService,
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
  TableAction,
  TableColumn,
  ToastService,
} from '../../../../../../../shared/components/index';

import {
  ProductionOrder,
  ProductionOrderStatus,
  ProductionOrderStats,
} from '../../interfaces';
import { ProductionOrdersService } from '../../services';

type StatusFilter = 'all' | ProductionOrderStatus;

@Component({
  selector: 'app-production-orders-list-page',
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
  templateUrl: './production-orders-list-page.component.html',
  styleUrl: './production-orders-list-page.component.scss',
})
export class ProductionOrdersListPageComponent implements OnInit {
  private readonly productionService = inject(ProductionOrdersService);
  private readonly toastService = inject(ToastService);
  private readonly dialogService = inject(DialogService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly orders = signal<ProductionOrder[]>([]);
  readonly stats = signal<ProductionOrderStats>({
    draft: 0,
    in_progress: 0,
    completed: 0,
    cancelled: 0,
    total: 0,
    produced_today: 0,
    produced_week: 0,
    produced_month: 0,
  });

  readonly filters = signal({ page: 1, limit: 10 });
  readonly totalItems = signal(0);
  readonly isLoading = signal(false);

  readonly searchTerm = signal('');
  readonly statusFilter = signal<StatusFilter>('all');
  filterValues: FilterValues = {};

  readonly totalPages = computed(() =>
    Math.ceil(this.totalItems() / this.filters().limit) || 1,
  );

  readonly filterConfigs: FilterConfig[] = [
    {
      key: 'status',
      label: 'Estado',
      type: 'select',
      options: [
        { value: '', label: 'Todos' },
        { value: 'draft', label: 'Borrador' },
        { value: 'in_progress', label: 'En progreso' },
        { value: 'completed', label: 'Completada' },
        { value: 'cancelled', label: 'Cancelada' },
      ],
    },
  ];

  readonly dropdownActions = computed<DropdownAction[]>(() => [
    { label: 'Refrescar', icon: 'refresh-cw', action: 'refresh' },
    {
      label: 'Nueva Producción',
      icon: 'plus',
      action: 'create',
      variant: 'primary',
    },
  ]);

  readonly tableColumns: TableColumn[] = [
    {
      key: 'product',
      label: 'Producto',
      sortable: false,
      priority: 1,
      transform: (_: unknown, row: ProductionOrder) =>
        row.product?.name ? row.product.name : `Producción #${row.id}`,
    },
    {
      key: 'planned_qty',
      label: 'Planeado',
      sortable: true,
      priority: 2,
      transform: (value: number | string | null, row: ProductionOrder) =>
        `${this.formatNumber(value)} ${row.recipe?.yield_unit ?? ''}`.trim(),
    },
    {
      key: 'produced_qty',
      label: 'Producido',
      sortable: true,
      priority: 2,
      transform: (value: number | string | null | undefined, row: ProductionOrder) => {
        if (value == null) return '—';
        return `${this.formatNumber(value)} ${row.recipe?.yield_unit ?? ''}`.trim();
      },
    },
    {
      key: 'status',
      label: 'Estado',
      priority: 1,
      sortable: true,
      transform: (value: ProductionOrderStatus) =>
        ProductionOrdersService.statusLabel(value),
      badge: true,
      badgeConfig: { type: 'status' },
    },
    {
      key: 'created_at',
      label: 'Creada',
      sortable: true,
      priority: 3,
      transform: (value: string | Date | null | undefined) =>
        value ? this.formatDate(value) : '—',
    },
    {
      key: 'produced_at',
      label: 'Producida',
      sortable: true,
      priority: 3,
      transform: (value: string | Date | null | undefined) =>
        value ? this.formatDate(value) : '—',
    },
  ];

  readonly tableActions = computed<TableAction[]>(() => [
    {
      label: 'Iniciar',
      icon: 'play',
      variant: 'primary',
      condition: (item: ProductionOrder) => item.status === 'draft',
      action: (item: ProductionOrder) => this.startOrder(item),
    },
    {
      label: 'Completar',
      icon: 'check',
      variant: 'primary',
      condition: (item: ProductionOrder) =>
        item.status === 'draft' || item.status === 'in_progress',
      action: (item: ProductionOrder) => this.completeOrder(item),
    },
    {
      label: 'Cancelar',
      icon: 'x',
      variant: 'danger',
      condition: (item: ProductionOrder) =>
        item.status === 'draft' || item.status === 'in_progress',
      action: (item: ProductionOrder) => this.cancelOrder(item),
    },
  ]);

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'product',
    titleTransform: (row: ProductionOrder) =>
      row.product?.name ? row.product.name : `Producción #${row.id}`,
    subtitleKey: 'planned_qty',
    subtitleTransform: (row: ProductionOrder) =>
      `${this.formatNumber(row.planned_qty)} ${row.recipe?.yield_unit ?? ''}`.trim(),
    avatarFallbackIcon: 'flame',
    avatarShape: 'square',
    badgeKey: 'status',
    badgeConfig: { type: 'status', size: 'sm' },
    badgeTransform: (val: ProductionOrderStatus) =>
      ProductionOrdersService.statusLabel(val),
    detailKeys: [
      {
        key: 'produced_qty',
        label: 'Producido',
        icon: 'package',
        transform: (v: number | string | null | undefined, row?: ProductionOrder) => {
          if (v == null) return '—';
          const unit = row?.recipe?.yield_unit ?? '';
          return `${this.formatNumber(v)} ${unit}`.trim();
        },
      },
      {
        key: 'created_at',
        label: 'Creada',
        icon: 'clock',
        transform: (v: string | Date | null | undefined) =>
          v ? this.formatDate(v) : '—',
      },
    ],
  };

  ngOnInit(): void {
    this.loadOrders();
    this.loadStats();
  }

  loadOrders(): void {
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

    this.productionService
      .listPaginated(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const data = response.data ?? [];
          this.orders.set(data);
          this.totalItems.set(
            response.meta?.pagination?.total ?? data.length,
          );
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

  private loadStats(): void {
    this.productionService
      .getStats()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => this.stats.set(data),
        error: () => {
          // Stats are non-critical — silently ignore.
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
    const raw = values['status'] as string | undefined;
    if (raw === 'draft' || raw === 'in_progress' || raw === 'completed' || raw === 'cancelled') {
      this.statusFilter.set(raw);
    } else {
      this.statusFilter.set('all');
    }
    this.filters.update((f) => ({ ...f, page: 1 }));
    this.loadOrders();
  }

  clearFilters(): void {
    this.searchTerm.set('');
    this.statusFilter.set('all');
    this.filterValues = {};
    this.filters.update((f) => ({ ...f, page: 1 }));
    this.loadOrders();
  }

  onPageChange(page: number): void {
    this.filters.update((f) => ({ ...f, page }));
    this.loadOrders();
  }

  onActionClick(action: string): void {
    switch (action) {
      case 'create':
        this.createOrder();
        break;
      case 'refresh':
        this.loadOrders();
        this.loadStats();
        break;
    }
  }

  onRowClick(order: ProductionOrder): void {
    // Row click is intentionally a no-op for now; the only edits happen
    // through the action menu (start / complete / cancel).
  }

  createOrder(): void {
    this.router.navigate(['/admin/restaurant-ops/production/new']);
  }

  private startOrder(order: ProductionOrder): void {
    this.productionService
      .start(order.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Producción iniciada');
          this.loadOrders();
          this.loadStats();
        },
        error: (error) => {
          this.toastService.error(
            typeof error === 'string' ? error : 'Error al iniciar la producción',
          );
        },
      });
  }

  private completeOrder(order: ProductionOrder): void {
    // Prompt for the real produced_qty (post-merma). The user may also
    // override the global waste percentage if the actual waste was
    // significantly different than the recipe's planned value.
    this.dialogService
      .prompt({
        title: 'Completar producción',
        message: `¿Cuántas ${order.recipe?.yield_unit ?? 'unidades'} se produjeron realmente? (Planeado: ${this.formatNumber(order.planned_qty)})`,
        placeholder: 'Cantidad producida',
        defaultValue: String(order.planned_qty),
        confirmText: 'Completar',
        cancelText: 'Cancelar',
        inputType: 'number',
      })
      .then((value) => {
        if (value == null) return;
        const produced = Number(value);
        if (!Number.isFinite(produced) || produced <= 0) {
          this.toastService.error('La cantidad producida debe ser mayor a 0');
          return;
        }
        this.productionService
          .complete(order.id, { produced_qty: produced })
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => {
              this.toastService.success(
                'Producción completada: stock generado y consumos registrados',
              );
              this.loadOrders();
              this.loadStats();
            },
            error: (error) => {
              this.toastService.error(
                typeof error === 'string'
                  ? error
                  : 'Error al completar la producción',
              );
            },
          });
      });
  }

  private cancelOrder(order: ProductionOrder): void {
    this.dialogService
      .confirm({
        title: 'Cancelar producción',
        message: `¿Cancelar la producción de "${order.product?.name ?? `#${order.id}`}"? Esta acción no se puede deshacer.`,
        confirmText: 'Cancelar producción',
        cancelText: 'Volver',
        confirmVariant: 'danger',
      })
      .then((confirmed) => {
        if (!confirmed) return;
        this.productionService
          .cancel(order.id)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => {
              this.toastService.success('Producción cancelada');
              this.loadOrders();
              this.loadStats();
            },
            error: (error) => {
              this.toastService.error(
                typeof error === 'string'
                  ? error
                  : 'Error al cancelar la producción',
              );
            },
          });
      });
  }

  get hasFilters(): boolean {
    return this.searchTerm().length > 0 || this.statusFilter() !== 'all';
  }

  getEmptyStateTitle(): string {
    return this.hasFilters
      ? 'Ninguna producción coincide con tus filtros'
      : 'Aún no tienes órdenes de producción';
  }

  getEmptyStateDescription(): string {
    return this.hasFilters
      ? 'Ajusta los filtros o la búsqueda para encontrar producciones.'
      : 'Crea tu primera orden de producción para generar stock de sub-recetas en lote.';
  }

  private formatNumber(value: number | string | null | undefined): string {
    if (value == null) return '0';
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    return Number.isInteger(n) ? n.toString() : n.toFixed(2);
  }

  private formatDate(value: string | Date): string {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}
