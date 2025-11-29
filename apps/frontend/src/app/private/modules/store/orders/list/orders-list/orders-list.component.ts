import {
  Component,
  OnInit,
  OnDestroy,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';

import {
  TableComponent,
  TableColumn,
  TableAction,
  ButtonComponent,
  IconComponent,
  DialogService,
  ToastService,
} from '../../../../../../shared/components/index';

import { StoreOrdersService } from '../../services/store-orders.service';
import {
  Order,
  OrderQuery,
  PaginatedOrdersResponse,
  FilterOption,
} from '../../interfaces/order.interface';

@Component({
  selector: 'app-orders-list',
  standalone: true,
  imports: [CommonModule, FormsModule, TableComponent],
  templateUrl: './orders-list.component.html',
  styleUrls: ['./orders-list.component.css'],
})
export class OrdersListComponent implements OnInit, OnDestroy, OnChanges {
  @Input() filters: OrderQuery = {
    search: '',
    status: undefined,
    payment_status: undefined,
    date_range: undefined,
    page: 1,
    limit: 10,
    sort_by: 'created_at',
    sort_order: 'desc',
  };

  @Output() viewOrder = new EventEmitter<string>();
  @Output() ordersLoaded = new EventEmitter<any>();
  private destroy$ = new Subject<void>();

  // Data
  orders: Order[] = [];
  totalItems = 0;
  loading = false;

  // Table configuration
  columns: TableColumn[] = [
    { key: 'order_number', label: 'Order ID', sortable: true },
    {
      key: 'customer_id',
      label: 'Customer ID',
      sortable: true,
      transform: (order: Order) => order.customer_id?.toString() || 'N/A',
    },
    {
      key: 'state',
      label: 'Status',
      sortable: true,
      badge: true,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: {
          created: '#6b7280',
          pending_payment: '#f59e0b',
          processing: '#3b82f6',
          shipped: '#06b6d4',
          delivered: '#10b981',
          cancelled: '#ef4444',
          refunded: '#f97316',
          finished: '#8b5cf6',
        },
      },
      transform: (order: Order) => this.formatStatus(order.state),
    },
    {
      key: 'grand_total',
      label: 'Total',
      sortable: true,
      transform: (order: Order) => `$${order.grand_total.toFixed(2)}`,
    },
    {
      key: 'created_at',
      label: 'Date',
      sortable: true,
      transform: (order: Order) =>
        new Date(order.created_at).toLocaleDateString(),
    },
  ];

  actions: TableAction[] = [
    {
      label: 'View',
      action: (order: Order) => this.handleViewOrder(order.id.toString()),
      variant: 'ghost',
    },
    {
      label: 'Edit',
      action: (order: Order) => this.editOrder(order.id.toString()),
      variant: 'ghost',
    },
    {
      label: 'Delete',
      action: (order: Order) => this.deleteOrder(order.id.toString()),
      variant: 'danger',
    },
  ];

  // Filter options (now handled by parent component)

  constructor(
    private ordersService: StoreOrdersService,
    private dialogService: DialogService,
    private toastService: ToastService,
  ) {}

  ngOnInit(): void {
    this.loadOrders();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['filters'] && !changes['filters'].firstChange) {
      this.loadOrders();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // Load orders with current filters
  loadOrders(): void {
    this.loading = true;

    this.ordersService
      .getOrders(this.filters)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response: PaginatedOrdersResponse) => {
          this.orders = response.data;
          this.totalItems = response.pagination.total;
          this.loading = false;
          this.ordersLoaded.emit({
            orders: this.orders,
            totalItems: this.totalItems,
            filters: this.filters,
          });
        },
        error: (error: any) => {
          console.error('Error loading orders:', error);
          this.toastService.error('Failed to load orders. Please try again.');
          this.loading = false;
        },
      });
  }

  // Event handlers
  onPageChange(page: number): void {
    if (this.filters.page !== undefined) {
      this.filters.page = page;
      this.loadOrders();
    }
  }

  onSort(event: { column: string; direction: 'asc' | 'desc' | null }): void {
    if (event.direction) {
      this.filters.sort_by = event.column as any;
      this.filters.sort_order = event.direction;
      this.loadOrders();
    }
  }

  // Actions
  handleViewOrder(orderId: string): void {
    this.viewOrder.emit(orderId);
  }

  editOrder(orderId: string): void {
    // For now, navigate to order details
    // In the future, this could open an edit modal
    this.viewOrder.emit(orderId);
  }

  deleteOrder(orderId: string): void {
    this.dialogService
      .confirm({
        title: 'Delete Order',
        message:
          'Are you sure you want to delete this order? This action cannot be undone.',
        confirmText: 'Delete',
        cancelText: 'Cancel',
        confirmVariant: 'danger',
      })
      .then((confirmed: boolean) => {
        if (confirmed) {
          this.ordersService
            .deleteOrder(orderId)
            .pipe(takeUntil(this.destroy$))
            .subscribe({
              next: () => {
                this.loadOrders();
                this.toastService.success('Order deleted successfully');
              },
              error: (error: any) => {
                console.error('Error deleting order:', error);
                this.toastService.error(
                  'Failed to delete order. Please try again.',
                );
              },
            });
        }
      });
  }

  exportOrders(): void {
    this.ordersService
      .exportOrders(this.filters)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response: any) => {
          // Handle file download
          const blob = new Blob([response], { type: 'text/csv' });
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `orders_${new Date().toISOString().split('T')[0]}.csv`;
          a.click();
          window.URL.revokeObjectURL(url);
        },
        error: (error: any) => {
          console.error('Error exporting orders:', error);
          this.toastService.error('Failed to export orders. Please try again.');
        },
      });
  }

  // Helper methods for formatting
  formatStatus(status: string): string {
    return status.charAt(0).toUpperCase() + status.slice(1);
  }

  formatPaymentStatus(status: string): string {
    return status.charAt(0).toUpperCase() + status.slice(1);
  }

  // Math utility for template
  get totalPages(): number {
    return Math.ceil(this.totalItems / (this.filters.limit || 10));
  }
}
