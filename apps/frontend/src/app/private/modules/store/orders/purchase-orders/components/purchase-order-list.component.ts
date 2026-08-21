import {
  Component,
  DestroyRef,
  inject,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  TableColumn,
  TableAction,
  DialogService,
  ToastService,
  ResponsiveDataViewComponent,
  ItemListCardConfig,
  InputsearchComponent,
  OptionsDropdownComponent,
  FilterConfig,
  FilterValues,
  DropdownAction,
  ButtonComponent,
  IconComponent,
  PaginationComponent,
  EmptyStateComponent,
  CardComponent,
} from '../../../../../../shared/components/index';

import { PurchaseOrdersService } from '../../../inventory/services';
import { SuppliersService } from '../../../inventory/services';
import {
  PurchaseOrder,
  PurchaseOrderStatus,
} from '../../../inventory/interfaces';
import { PurchaseOrderStats } from './purchase-order-stats.component';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { PurchaseOrderPrintService } from '../services/purchase-order-print.service';
import {
  PURCHASE_ORDER_SORT_DEFAULT,
  PURCHASE_ORDER_SORT_OPTIONS,
  PurchaseOrderSortDir,
  PurchaseOrderSortKey,
  buildSortValue,
  loadSortPreference,
  parseSortValue,
  saveSortPreference,
} from '../utils/purchase-order-sort.util';

@Component({
  selector: 'app-purchase-order-list',
  standalone: true,
  imports: [
    FormsModule,
    ResponsiveDataViewComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    EmptyStateComponent,
    PaginationComponent,
    CardComponent,
  ],
  templateUrl: './purchase-order-list.component.html',
  styleUrls: ['./purchase-order-list.component.scss'],
})
export class PurchaseOrderListComponent {
  private currencyService = inject(CurrencyFormatService);
  private printService = inject(PurchaseOrderPrintService);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  readonly viewOrder = output<PurchaseOrder>();
  readonly create = output<void>();
  readonly refresh = output<void>();
  readonly statsUpdated = output<PurchaseOrderStats>();

  // Data
  readonly orders = signal<PurchaseOrder[]>([]);
  readonly suppliers = signal<any[]>([]);
  readonly loading = signal(false);
  readonly totalItems = signal(0);

  // Pagination
  filters = { page: 1, limit: 10 };

  /**
   * CP-ID-VNDX-2026-08-18-PO-PROD — F2.S5: ordenamiento con enum cerrado.
   * Backend rechaza cualquier sort_by fuera del enum.
   *
   * El sort ya no es un `<select>` suelto: vive dentro de
   * `app-options-dropdown` como una FilterConfig más (key `sortBy`, value
   * compuesto `campo:dirección`) y la elección se cachea en localStorage.
   * Default = "Más recientes primero" (`order_date:desc`).
   */
  readonly sortBy = signal<PurchaseOrderSortKey>('order_date');
  readonly sortDir = signal<PurchaseOrderSortDir>('desc');

  // Filter state
  searchTerm = '';
  selectedStatus = '';

  // Filter configuration for the options dropdown
  filterConfigs: FilterConfig[] = [
    {
      key: 'status',
      label: 'Estado',
      type: 'select',
      options: [
        { value: '', label: 'Todos los Estados' },
        { value: 'draft', label: 'Borrador' },
        { value: 'ordered', label: 'Ordenada' },
        { value: 'partial', label: 'Parcial' },
        { value: 'received', label: 'Recibida' },
        { value: 'cancelled', label: 'Cancelada' },
      ],
    },
    // El orden es un filtro más del dropdown. `defaultValue` es lo que el
    // padre restaura cuando el usuario pulsa "Limpiar" — nunca queda en null,
    // porque el listado siempre necesita un criterio de orden válido.
    {
      key: 'sortBy',
      label: 'Ordenar por',
      type: 'select',
      options: [...PURCHASE_ORDER_SORT_OPTIONS],
      placeholder: 'Más recientes primero',
      defaultValue: PURCHASE_ORDER_SORT_DEFAULT,
    },
  ];

  // Current filter values
  filterValues: FilterValues = {};

  // Dropdown actions
  dropdownActions: DropdownAction[] = [
    {
      label: 'Nueva Orden de Compra',
      icon: 'plus',
      action: 'create',
      variant: 'primary',
    },
  ];

  // Table configuration
  table_columns: TableColumn[] = [
    {
      key: 'order_number',
      label: 'No. Orden',
      sortable: true,
      width: '120px',
      priority: 1,
    },
    {
      key: 'supplierName',
      label: 'Proveedor',
      sortable: true,
      defaultValue: '-',
      priority: 2,
    },
    {
      key: 'order_date',
      label: 'Fecha',
      sortable: true,
      priority: 3,
      transform: (value: string) =>
        value ? new Date(value).toLocaleDateString() : '-',
    },
    {
      key: 'expected_date',
      label: 'Entrega Esperada',
      priority: 3,
      transform: (value: string) =>
        value ? new Date(value).toLocaleDateString() : '-',
    },
    // CP-ID-VNDX-2026-08-18-PO-PROD — Anotación 3: badge dinámico por proximity.
    // Verde > 7d, amarillo 1-7d, naranja 0d (vence hoy), rojo < 0 (vencida),
    // gris null (sin plan). La clave apunta al campo numérico crudo para
    // que table.component.ts:583 pase `value` (número) al colorFn.
    {
      key: 'next_payment_due_in_days',
      label: 'Próximo pago',
      priority: 2,
      badge: true,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorFn: (value: any) => {
          if (value === null || value === undefined || value === '') return '#9ca3af';
          const num = Number(value);
          if (!Number.isFinite(num)) return '#9ca3af';
          if (num < 0) return '#ef4444';   // vencida: rojo
          if (num === 0) return '#f97316';  // vence hoy: naranja
          if (num <= 7) return '#f59e0b';   // 1-7d: amarillo
          return '#10b981';                 // > 7d: verde
        },
      },
      transform: (value: any, row?: any) =>
        this.formatNextPaymentBadge(row?.next_payment_due_in_days ?? value),
      sortable: true,
    },
    {
      key: 'total_amount',
      label: 'Total',
      align: 'right',
      priority: 1,
      transform: (value: any) => this.formatCurrency(value),
    },
    {
      key: 'status',
      label: 'Estado',
      badge: true,
      priority: 1,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: {
          draft: '#6b7280',
          submitted: '#f59e0b',
          approved: '#3b82f6',
          ordered: '#8b5cf6',
          partial: '#f97316',
          received: '#10b981',
          cancelled: '#ef4444',
        },
      },
      transform: (value: PurchaseOrderStatus) => this.getStatusLabel(value),
    },
  ];

  table_actions: TableAction[] = [
    {
      label: 'Ver',
      icon: 'eye',
      action: (order: PurchaseOrder) => this.viewOrderDetails(order),
      variant: 'secondary',
    },
    {
      label: 'Aprobar',
      icon: 'check-circle',
      action: (order: PurchaseOrder) => this.approveOrder(order),
      variant: 'primary',
      show: (order: PurchaseOrder) =>
        ['draft', 'submitted'].includes(order.status),
    },
    {
      label: 'Imprimir',
      icon: 'printer',
      action: (order: PurchaseOrder) => this.printService.printPurchaseOrder(order),
      variant: 'info',
      show: (order: PurchaseOrder) =>
        ['ordered', 'partial', 'received'].includes(order.status),
    },
    {
      label: 'Cancel Order',
      icon: 'x-circle',
      action: (order: PurchaseOrder) => this.cancelOrder(order),
      variant: 'danger',
      show: (order: PurchaseOrder) =>
        ['draft', 'submitted', 'approved', 'ordered'].includes(order.status),
    },
  ];

  // Card Config - mobile-first with prominent footer (no avatar needed for orders)
  // Note: titleTransform receives the FULL item, not the titleKey value
  cardConfig: ItemListCardConfig = {
    titleKey: 'order_number',
    titleTransform: (item: any) => `#${item.order_number}`,
    subtitleTransform: (item: any) => item.supplierName || 'Sin proveedor',
    badgeKey: 'status',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: {
        draft: '#6b7280',
        submitted: '#f59e0b',
        approved: '#3b82f6',
        ordered: '#8b5cf6',
        partial: '#f97316',
        received: '#10b981',
        cancelled: '#ef4444',
      },
    },
    badgeTransform: (val: any) => this.getStatusLabel(val),
    footerKey: 'total_amount',
    footerLabel: 'Total',
    footerStyle: 'prominent',
    footerTransform: (val: any) => this.formatCurrency(val),
    detailKeys: [
      {
        key: 'expected_date',
        label: 'Entrega',
        transform: (val: any) =>
          val ? new Date(val).toLocaleDateString() : '-',
      },
    ],
  };

  constructor(
    private purchaseOrdersService: PurchaseOrdersService,
    private suppliersService: SuppliersService,
    private dialogService: DialogService,
    private toastService: ToastService,
  ) {
    // Hidratar el orden desde el caché del cliente ANTES del primer load, para
    // no disparar dos peticiones (una con el default y otra con la preferencia).
    this.applySortValue(loadSortPreference() ?? PURCHASE_ORDER_SORT_DEFAULT);
    this.loadOrders();
    this.loadSuppliers();
  }

  /**
   * Sincroniza signals + `filterValues` a partir del value compuesto del
   * dropdown. Un value inválido cae al default dentro de `parseSortValue`,
   * así que el query param que sale de aquí siempre respeta el enum cerrado.
   */
  private applySortValue(value: string | null | undefined): void {
    const { sortBy, sortDir } = parseSortValue(value);
    this.sortBy.set(sortBy);
    this.sortDir.set(sortDir);
    // Reasignar el objeto (no mutarlo) para que el input signal del
    // options-dropdown vea el cambio y repinte el selector.
    this.filterValues = {
      ...this.filterValues,
      sortBy: buildSortValue(sortBy, sortDir),
    };
  }

  // Load orders with current filters
  loadOrders(): void {
    this.loading.set(true);

    const query: any = {
      page: this.filters.page,
      limit: this.filters.limit,
      sort_by: this.sortBy(),
      sort_order: this.sortDir(),
    };
    if (this.selectedStatus) {
      query.status = this.selectedStatus;
    }
    if (this.searchTerm) {
      query.search = this.searchTerm;
    }

    this.purchaseOrdersService
      .getPurchaseOrders(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          const orders = response.data || response;
          const parsedOrders: PurchaseOrder[] = Array.isArray(orders) ? orders : [];
          this.orders.set(parsedOrders);
          this.totalItems.set(
            response.meta?.pagination?.total ??
            response.meta?.total ??
            parsedOrders.length,
          );

          // Enrich orders with supplier names
          this.enrichOrdersWithSuppliers();

          this.loading.set(false);

          // Calculate and emit stats to parent
          this.calculateAndEmitStats();
        },
        error: (error: any) => {
          console.error('Error loading purchase orders:', error);
          this.toastService.error(
            'Error al cargar las órdenes de compra. Por favor intenta nuevamente.',
          );
          this.loading.set(false);
        },
      });
  }

  loadSuppliers(): void {
    this.suppliersService
      .getSuppliers()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          this.suppliers.set(response.data || response || []);
          // Enrich orders if they were loaded before suppliers
          if (this.orders().length > 0) {
            this.enrichOrdersWithSuppliers();
          }
        },
        error: (error: any) => {
          console.error('Error loading suppliers:', error);
        },
      });
  }

  private enrichOrdersWithSuppliers(): void {
    // Backend already includes suppliers data, just extract the name
    this.orders.update((orders) =>
      orders.map((order: any) => {
        // If suppliers object is already populated, use it
        if (order.suppliers && order.suppliers.name) {
          return {
            ...order,
            supplierName: order.suppliers.name,
          };
        }
        // Fallback to supplier map if needed
        const supplier = this.suppliers().find(
          (s: any) => s.id === order.supplier_id,
        );
        return {
          ...order,
          supplierName: supplier?.name || 'N/A',
        };
      }) as any,
    );
  }

  // Calculate stats from orders and emit to parent
  private calculateAndEmitStats(): void {
    const orders = this.orders();
    const stats: PurchaseOrderStats = {
      total: orders.length,
      pending: orders.filter((o) =>
        ['draft', 'submitted', 'approved', 'ordered', 'partial'].includes(
          o.status,
        ),
      ).length,
      received: orders.filter((o) => o.status === 'received').length,
      total_value: orders.reduce((sum, o) => {
        const amount =
          typeof o.total_amount === 'string'
            ? parseFloat(o.total_amount)
            : o.total_amount || 0;
        return sum + amount;
      }, 0),
    };
    this.statsUpdated.emit(stats);
  }

  // Pagination
  get totalPages(): number {
    return Math.ceil(this.totalItems() / (this.filters.limit || 10));
  }

  onPageChange(page: number): void {
    this.filters.page = page;
    this.loadOrders();
  }

  // Filter event handlers
  onSearchChange(term: string): void {
    this.searchTerm = term;
    this.filters.page = 1;
    this.loadOrders();
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues = values;
    this.selectedStatus = (values['status'] as string) || '';

    // El sort viaja como un filtro más. "Limpiar" individual lo deja en null,
    // por eso se cae al default en vez de mandar un sort_by vacío al backend.
    const nextSort = (values['sortBy'] as string) || PURCHASE_ORDER_SORT_DEFAULT;
    const previousSort = buildSortValue(this.sortBy(), this.sortDir());
    this.applySortValue(nextSort);
    const appliedSort = buildSortValue(this.sortBy(), this.sortDir());
    if (appliedSort !== previousSort) {
      saveSortPreference(appliedSort);
    }

    this.filters.page = 1;
    this.loadOrders();
  }

  clearFilters(): void {
    this.searchTerm = '';
    this.selectedStatus = '';
    this.filterValues = {};
    // El listado no puede quedarse sin criterio de orden: "Limpiar" restaura
    // el default declarado en la FilterConfig y lo persiste como preferencia.
    this.applySortValue(PURCHASE_ORDER_SORT_DEFAULT);
    saveSortPreference(PURCHASE_ORDER_SORT_DEFAULT);
    this.filters.page = 1;
    this.loadOrders();
  }

  onActionClick(action: string): void {
    switch (action) {
      case 'create':
        this.create.emit();
        break;
    }
  }

  /**
   * `hasFilters` gobierna el empty-state y el botón "Limpiar filtros". El sort
   * queda deliberadamente FUERA: siempre tiene valor, y contarlo haría que la
   * lista vacía dijera siempre "ajusta tus filtros" aunque no hubiera ninguno.
   */
  get hasFilters(): boolean {
    return !!(this.searchTerm || this.selectedStatus);
  }

  // Get empty state title based on filters
  getEmptyStateTitle(): string {
    if (this.hasFilters) {
      return 'No se encontraron órdenes de compra';
    }
    return 'No hay órdenes de compra';
  }

  // Get empty state description based on filters
  getEmptyStateDescription(): string {
    if (this.hasFilters) {
      return 'Intenta ajustar tus filtros para ver más resultados';
    }
    return 'Comienza creando tu primera orden de compra para reabastecer inventario.';
  }

  // Actions
  // Navigate to the dedicated full-page detail view (replaces the modal flow).
  viewOrderDetails(order: PurchaseOrder): void {
    this.router.navigate(['/admin/orders/purchase-orders', order.id]);
  }

  async approveOrder(order: PurchaseOrder): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Aprobar Orden de Compra',
      message: `¿Confirmas la aprobación de la orden ${order.order_number || '#' + order.id}? Quedará lista para recepción.`,
      confirmText: 'Aprobar',
      cancelText: 'Cancelar',
    });
    if (!confirmed) return;

    this.purchaseOrdersService
      .approvePurchaseOrder(order.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Orden aprobada exitosamente');
          this.loadOrders();
        },
        error: (error: any) => {
          console.error('Error approving purchase order:', error);
          this.toastService.error(
            typeof error === 'string' ? error : 'Error al aprobar la orden.',
          );
        },
      });
  }

  async cancelOrder(order: PurchaseOrder): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Cancelar Orden de Compra',
      message: `¿Estás seguro de que deseas cancelar la orden ${order.order_number}? Esta acción no se puede deshacer.`,
      confirmText: 'Cancelar Orden',
      cancelText: 'Volver',
    });

    if (confirmed) {
      this.purchaseOrdersService
        .cancelPurchaseOrder(order.id)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => {
            this.toastService.success('Orden cancelada exitosamente');
            this.loadOrders();
          },
          error: (error: any) => {
            console.error('Error cancelling purchase order:', error);
            this.toastService.error(
              'Error al cancelar la orden. Por favor intenta nuevamente.',
            );
          },
        });
    }
  }

  // Helper methods
  formatCurrency(value: any): string {
    const numValue = typeof value === 'string' ? parseFloat(value) : value || 0;
    return this.currencyService.format(numValue);
  }

  getStatusLabel(status: PurchaseOrderStatus): string {
    const labels: Record<PurchaseOrderStatus, string> = {
      draft: 'Borrador',
      submitted: 'Enviada',
      approved: 'Aprobada',
      ordered: 'Ordenada',
      partial: 'Parcial',
      received: 'Recibida',
      cancelled: 'Cancelada',
    };
    return labels[status] || status;
  }

  /**
   * Bug 4 frontend — Etiqueta del badge de "Próximo pago" según días restantes.
   * Verde > 7d, amarillo 0–7d, rojo < 0 (vencida), gris si null.
   * Devuelve solo el label; el color va por CSS class del badge (negociado
   * en el colorMap de la columna: ok / soon / overdue / none).
   */
  formatNextPaymentBadge(days: number | null | undefined): string {
    if (days === null || days === undefined) return 'Sin plan';
    if (days < 0) return `Vencida hace ${Math.abs(days)}d`;
    if (days === 0) return 'Vence hoy';
    return `Vence en ${days}d`;
  }
}
