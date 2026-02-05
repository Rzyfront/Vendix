import {
  Component,
  Output,
  EventEmitter,
  OnInit,
  OnDestroy,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';

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
} from '../../../../../../shared/components/index';

import { PurchaseOrdersService } from '../../../inventory/services';
import { SuppliersService } from '../../../inventory/services';
import {
  PurchaseOrder,
  PurchaseOrderStatus,
} from '../../../inventory/interfaces';

import { PurchaseOrderEmptyStateComponent } from './purchase-order-empty-state';
import { PurchaseOrderStats } from './purchase-order-stats.component';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';

@Component({
  selector: 'app-purchase-order-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ResponsiveDataViewComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    PurchaseOrderEmptyStateComponent,
  ],
  templateUrl: './purchase-order-list.component.html',
  styleUrls: ['./purchase-order-list.component.scss'],
})
export class PurchaseOrderListComponent implements OnInit, OnDestroy {
  private currencyService = inject(CurrencyFormatService);

  @Output() viewOrder = new EventEmitter<PurchaseOrder>();
  @Output() create = new EventEmitter<void>();
  @Output() refresh = new EventEmitter<void>();
  @Output() statsUpdated = new EventEmitter<PurchaseOrderStats>();

  private destroy$ = new Subject<void>();

  // Data
  orders: PurchaseOrder[] = [];
  suppliers: any[] = [];
  loading = false;
  totalItems = 0;

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
  ];

  // Current filter values
  filterValues: FilterValues = {};

  // Dropdown actions
  dropdownActions: DropdownAction[] = [
    { label: 'Nueva Orden', icon: 'plus', action: 'create', variant: 'primary' },
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
      label: 'View Details',
      icon: 'eye',
      action: (order: PurchaseOrder) => this.viewOrderDetails(order),
      variant: 'ghost',
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
        transform: (val: any) => val ? new Date(val).toLocaleDateString() : '-'
      }
    ]
  };

  constructor(
    private purchaseOrdersService: PurchaseOrdersService,
    private suppliersService: SuppliersService,
    private dialogService: DialogService,
    private toastService: ToastService
  ) {}

  ngOnInit(): void {
    this.loadOrders();
    this.loadSuppliers();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // Load orders with current filters
  loadOrders(): void {
    this.loading = true;

    const query: any = {};
    if (this.selectedStatus) {
      query.status = this.selectedStatus;
    }
    if (this.searchTerm) {
      query.search = this.searchTerm;
    }

    this.purchaseOrdersService
      .getPurchaseOrders(query)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response: any) => {
          const orders = response.data || response;
          this.orders = Array.isArray(orders) ? orders : [];
          this.totalItems = this.orders.length;

          // Enrich orders with supplier names
          this.enrichOrdersWithSuppliers();

          this.loading = false;

          // Calculate and emit stats to parent
          this.calculateAndEmitStats();
        },
        error: (error: any) => {
          console.error('Error loading purchase orders:', error);
          this.toastService.error(
            'Error al cargar las órdenes de compra. Por favor intenta nuevamente.'
          );
          this.loading = false;
        },
      });
  }

  loadSuppliers(): void {
    this.suppliersService
      .getSuppliers()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response: any) => {
          this.suppliers = response.data || response || [];
          // Enrich orders if they were loaded before suppliers
          if (this.orders.length > 0) {
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
    this.orders = this.orders.map((order: any) => {
      // If suppliers object is already populated, use it
      if (order.suppliers && order.suppliers.name) {
        return {
          ...order,
          supplierName: order.suppliers.name,
        };
      }
      // Fallback to supplier map if needed
      const supplier = this.suppliers.find((s: any) => s.id === order.supplier_id);
      return {
        ...order,
        supplierName: supplier?.name || 'N/A',
      };
    }) as any;
  }

  // Calculate stats from orders and emit to parent
  private calculateAndEmitStats(): void {
    const stats: PurchaseOrderStats = {
      total: this.orders.length,
      pending: this.orders.filter(
        (o) => ['draft', 'submitted', 'approved', 'ordered', 'partial'].includes(o.status)
      ).length,
      received: this.orders.filter((o) => o.status === 'received').length,
      total_value: this.orders.reduce(
        (sum, o) => {
          const amount = typeof o.total_amount === 'string'
            ? parseFloat(o.total_amount)
            : (o.total_amount || 0);
          return sum + amount;
        },
        0
      ),
    };
    this.statsUpdated.emit(stats);
  }

  // Filter event handlers
  onSearchChange(term: string): void {
    this.searchTerm = term;
    this.loadOrders();
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues = values;
    this.selectedStatus = (values['status'] as string) || '';
    this.loadOrders();
  }

  clearFilters(): void {
    this.searchTerm = '';
    this.selectedStatus = '';
    this.filterValues = {};
    this.loadOrders();
  }

  onActionClick(action: string): void {
    switch (action) {
      case 'create':
        this.create.emit();
        break;
    }
  }

  // Check if there are active filters
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
  viewOrderDetails(order: PurchaseOrder): void {
    this.viewOrder.emit(order);
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
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.toastService.success('Orden cancelada exitosamente');
            this.loadOrders();
          },
          error: (error: any) => {
            console.error('Error cancelling purchase order:', error);
            this.toastService.error(
              'Error al cancelar la orden. Por favor intenta nuevamente.'
            );
          },
        });
    }
  }

  // Helper methods
  formatCurrency(value: any): string {
    const numValue = typeof value === 'string' ? parseFloat(value) : (value || 0);
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
}
