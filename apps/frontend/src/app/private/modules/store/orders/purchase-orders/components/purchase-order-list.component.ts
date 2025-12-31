import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';

import {
  TableComponent,
  TableColumn,
  TableAction,
  IconComponent,
  DialogService,
  ToastService,
} from '../../../../../../shared/components/index';

import { PurchaseOrdersService } from '../../../inventory/services';
import { SuppliersService } from '../../../inventory/services';
import {
  PurchaseOrder,
  PurchaseOrderStatus,
} from '../../../inventory/interfaces';

@Component({
  selector: 'app-purchase-order-list',
  standalone: true,
  imports: [CommonModule, FormsModule, TableComponent, IconComponent],
  templateUrl: './purchase-order-list.component.html',
  styleUrls: ['./purchase-order-list.component.scss'],
})
export class PurchaseOrderListComponent implements OnInit, OnDestroy {
  @Input() filters: {
    status: PurchaseOrderStatus | 'all';
    search: string;
  } = {
      status: 'all',
      search: '',
    };

  @Output() viewOrder = new EventEmitter<PurchaseOrder>();
  @Output() ordersLoaded = new EventEmitter<{
    orders: PurchaseOrder[];
    total: number;
  }>();

  private destroy$ = new Subject<void>();

  // Data
  orders: PurchaseOrder[] = [];
  suppliers: any[] = [];
  loading = false;

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

  // Status options for filter
  status_options = [
    { value: 'all', label: 'Todos los estados' },
    { value: 'draft', label: 'Borrador' },
    { value: 'ordered', label: 'Ordenada' },
    { value: 'partial', label: 'Parcial' },
    { value: 'received', label: 'Recibida' },
    { value: 'cancelled', label: 'Cancelada' },
  ];

  constructor(
    private purchaseOrdersService: PurchaseOrdersService,
    private suppliersService: SuppliersService,
    private dialogService: DialogService,
    private toastService: ToastService
  ) { }

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
    if (this.filters.status && this.filters.status !== 'all') {
      query.status = this.filters.status;
    }
    if (this.filters.search) {
      query.search = this.filters.search;
    }

    this.purchaseOrdersService
      .getPurchaseOrders(query)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response: any) => {
          const orders = response.data || response;
          this.orders = Array.isArray(orders) ? orders : [];

          // Enrich orders with supplier names (backend includes suppliers data)
          this.enrichOrdersWithSuppliers();

          this.loading = false;
          this.ordersLoaded.emit({
            orders: this.orders,
            total: this.orders.length,
          });
        },
        error: (error: any) => {
          console.error('Error loading purchase orders:', error);
          this.toastService.error(
            'Failed to load purchase orders. Please try again.'
          );
          this.loading = false;
          this.ordersLoaded.emit({
            orders: [],
            total: 0,
          });
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
    return `$${numValue.toFixed(2)}`;
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
