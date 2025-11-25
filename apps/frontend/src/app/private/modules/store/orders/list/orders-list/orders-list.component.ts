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
} from '../../../../../../shared/components/table/table.component';

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
    { key: 'status', label: 'Status', sortable: true },
    { key: 'paymentStatus', label: 'Payment', sortable: true },
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

  constructor(private ordersService: StoreOrdersService) {}

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
    console.log('Edit order:', orderId);
    // Navigate to edit order or open modal
  }

  deleteOrder(orderId: string): void {
    if (confirm('Are you sure you want to delete this order?')) {
      this.ordersService
        .deleteOrder(orderId)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.loadOrders();
          },
          error: (error: any) => {
            console.error('Error deleting order:', error);
          },
        });
    }
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
        },
      });
  }

  // Math utility for template
  get totalPages(): number {
    return Math.ceil(this.totalItems / (this.filters.limit || 10));
  }
}
