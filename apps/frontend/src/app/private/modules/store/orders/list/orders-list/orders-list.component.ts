import {
  Component,
  OnInit,
  OnDestroy,
  Output,
  EventEmitter,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';

import { InputsearchComponent } from '../../../../../../shared/components/inputsearch/inputsearch.component';
import { SelectorComponent } from '../../../../../../shared/components/selector/selector.component';
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
  imports: [
    CommonModule,
    FormsModule,
    InputsearchComponent,
    SelectorComponent,
    TableComponent,
  ],
  templateUrl: './orders-list.component.html',
  styleUrls: ['./orders-list.component.css'],
})
export class OrdersListComponent implements OnInit, OnDestroy {
  @Output() viewOrder = new EventEmitter<string>();
  private destroy$ = new Subject<void>();

  // Data
  orders: Order[] = [];
  totalItems = 0;
  loading = false;

  // Filters
  filters: OrderQuery = {
    search: '',
    status: undefined,
    paymentStatus: undefined,
    dateRange: undefined,
    page: 1,
    limit: 10,
    sortBy: 'createdAt',
    sortOrder: 'desc',
  };

  // Table configuration
  columns: TableColumn[] = [
    { key: 'orderNumber', label: 'Order ID', sortable: true },
    {
      key: 'customer',
      label: 'Customer',
      sortable: true,
      transform: (order: Order) => order.customer?.name || 'N/A',
    },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      badge: true,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: {
          draft: '#6b7280',
          pending: '#f59e0b',
          confirmed: '#3b82f6',
          preparing: '#8b5cf6',
          ready: '#6366f1',
          shipped: '#06b6d4',
          delivered: '#10b981',
          cancelled: '#ef4444',
          refunded: '#f97316',
          returned: '#ec4899',
        },
      },
      transform: (order: Order) => this.formatStatus(order.status),
    },
    {
      key: 'paymentStatus',
      label: 'Payment',
      sortable: true,
      badge: true,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: {
          pending: '#f59e0b',
          processing: '#3b82f6',
          paid: '#10b981',
          partial: '#f59e0b',
          overpaid: '#8b5cf6',
          failed: '#ef4444',
          refunded: '#f97316',
          disputed: '#ef4444',
        },
      },
      transform: (order: Order) =>
        this.formatPaymentStatus(order.paymentStatus),
    },
    {
      key: 'total',
      label: 'Total',
      sortable: true,
      transform: (order: Order) => `$${order.total.toFixed(2)}`,
    },
    {
      key: 'createdAt',
      label: 'Date',
      sortable: true,
      transform: (order: Order) =>
        new Date(order.createdAt).toLocaleDateString(),
    },
  ];

  actions: TableAction[] = [
    {
      label: 'View',
      action: (order: Order) => this.handleViewOrder(order.id),
      variant: 'ghost',
    },
    {
      label: 'Edit',
      action: (order: Order) => this.editOrder(order.id),
      variant: 'ghost',
    },
    {
      label: 'Delete',
      action: (order: Order) => this.deleteOrder(order.id),
      variant: 'danger',
    },
  ];

  // Filter options
  statusOptions: FilterOption[] = [
    { value: 'draft', label: 'Draft' },
    { value: 'pending', label: 'Pending' },
    { value: 'confirmed', label: 'Confirmed' },
    { value: 'preparing', label: 'Preparing' },
    { value: 'ready', label: 'Ready' },
    { value: 'shipped', label: 'Shipped' },
    { value: 'delivered', label: 'Delivered' },
    { value: 'cancelled', label: 'Cancelled' },
    { value: 'refunded', label: 'Refunded' },
    { value: 'returned', label: 'Returned' },
  ];

  paymentStatusOptions: FilterOption[] = [
    { value: 'pending', label: 'Pending' },
    { value: 'processing', label: 'Processing' },
    { value: 'paid', label: 'Paid' },
    { value: 'partial', label: 'Partial' },
    { value: 'overpaid', label: 'Overpaid' },
    { value: 'failed', label: 'Failed' },
    { value: 'refunded', label: 'Refunded' },
    { value: 'disputed', label: 'Disputed' },
  ];

  dateRangeOptions: FilterOption[] = [
    { value: 'today', label: 'Today' },
    { value: 'yesterday', label: 'Yesterday' },
    { value: 'thisWeek', label: 'This Week' },
    { value: 'lastWeek', label: 'Last Week' },
    { value: 'thisMonth', label: 'This Month' },
    { value: 'lastMonth', label: 'Last Month' },
    { value: 'thisYear', label: 'This Year' },
    { value: 'lastYear', label: 'Last Year' },
  ];

  constructor(
    private ordersService: StoreOrdersService,
    private dialogService: DialogService,
    private toastService: ToastService,
  ) {}

  ngOnInit(): void {
    this.loadOrders();
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
          this.orders = response.orders;
          this.totalItems = response.total;
          this.loading = false;
        },
        error: (error: any) => {
          console.error('Error loading orders:', error);
          this.toastService.error('Failed to load orders. Please try again.');
          this.loading = false;
        },
      });
  }

  // Event handlers
  onSearch(searchTerm: string): void {
    this.filters.search = searchTerm;
    this.filters.page = 1;
    this.loadOrders();
  }

  onFilterChange(
    filterType: keyof OrderQuery,
    value: string | number | null,
  ): void {
    if (!value || value === '') {
      this.filters[filterType] = undefined;
    } else {
      this.filters[filterType] = value as any;
    }
    this.filters.page = 1;
    this.loadOrders();
  }

  onPageChange(page: number): void {
    if (this.filters.page !== undefined) {
      this.filters.page = page;
      this.loadOrders();
    }
  }

  onSort(event: { column: string; direction: 'asc' | 'desc' | null }): void {
    if (event.direction) {
      this.filters.sortBy = event.column as any;
      this.filters.sortOrder = event.direction;
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
        message: 'Are you sure you want to delete this order? This action cannot be undone.',
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
                this.toastService.error('Failed to delete order. Please try again.');
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
