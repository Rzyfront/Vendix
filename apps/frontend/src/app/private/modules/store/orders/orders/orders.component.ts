import { Component, ViewChild, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { OrdersListComponent } from '../list/orders-list';
import { OrderDetailsComponent } from '../details/order-details';
import { InputsearchComponent } from '../../../../../shared/components/inputsearch/inputsearch.component';
import { SelectorComponent } from '../../../../../shared/components/selector/selector.component';
import { StatsComponent } from '../../../../../shared/components/stats/stats.component';
import {
  Order,
  OrderQuery,
  FilterOption,
  OrderStats,
} from '../interfaces/order.interface';
import { StoreOrdersService } from '../services/store-orders.service';
import { Subject, takeUntil } from 'rxjs';

@Component({
  selector: 'app-orders',
  standalone: true,
  imports: [
    CommonModule,
    OrdersListComponent,
    OrderDetailsComponent,
    InputsearchComponent,
    SelectorComponent,
    StatsComponent,
  ],
  templateUrl: './orders.component.html',
  styleUrls: ['./orders.component.css'],
})
export class OrdersComponent implements OnInit {
  selectedOrderId: string | null = null;
  showOrderDetails = false;

  @ViewChild(OrdersListComponent) ordersList!: OrdersListComponent;

  // Stats data
  orderStats: OrderStats | null = null;
  isLoadingStats = false;
  private destroy$ = new Subject<void>();

  // Filters
  filters: OrderQuery = {
    search: '',
    status: undefined,
    payment_status: undefined,
    date_range: undefined,
    page: 1,
    limit: 10,
    sort_by: 'created_at',
    sort_order: 'desc',
  };

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
    private router: Router,
    private ordersService: StoreOrdersService,
  ) {}

  ngOnInit(): void {
    this.loadOrderStats();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadOrderStats(): void {
    this.isLoadingStats = true;
    this.ordersService
      .getOrderStats()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (stats: OrderStats) => {
          this.orderStats = stats;
          this.isLoadingStats = false;
        },
        error: (err: any) => {
          console.error('Error loading order stats:', err);
          this.isLoadingStats = false;
        },
      });
  }

  // Navigate to POS for new order
  createNewOrder(): void {
    this.router.navigate(['/admin/pos']);
  }

  // Show order details modal
  viewOrderDetails(orderId: string): void {
    this.selectedOrderId = orderId;
    this.showOrderDetails = true;
  }

  // Close order details modal
  closeOrderDetails(): void {
    this.showOrderDetails = false;
    this.selectedOrderId = null;
  }

  // Handle order update from details modal
  onOrderUpdated(updatedOrder: Order): void {
    // The orders list will automatically refresh when the modal closes
    // You could emit an event to refresh the list if needed
    console.log('Order updated:', updatedOrder);
  }

  // Search functionality
  onSearch(searchTerm: string): void {
    this.filters.search = searchTerm;
    this.filters.page = 1;
    this.ordersList.loadOrders();
  }

  // Filter changes
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
    this.ordersList.loadOrders();
  }

  // Export orders
  exportOrders(): void {
    this.ordersList.exportOrders();
  }

  // Handle orders loaded event
  onOrdersLoaded(event: any): void {
    // Handle any post-loading logic if needed
    console.log('Orders loaded:', event);
  }

  // Format currency helper
  formatCurrency(amount: number): string {
    return `$${amount?.toFixed(2) || '0.00'}`;
  }
}
