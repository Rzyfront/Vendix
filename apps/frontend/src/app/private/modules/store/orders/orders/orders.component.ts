import { Component, ViewChild, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';

// Import components
import { OrdersListComponent } from '../components/orders-list';
import { OrderDetailsComponent } from '../components/order-details';
import { OrderEmptyStateComponent } from '../components/order-empty-state';
import { OrderFilterDropdownComponent } from '../components/order-filter-dropdown';
import { OrderStatsComponent } from '../components/order-stats';

// Import shared components
import {
  InputsearchComponent,
  ButtonComponent,
  IconComponent,
} from '../../../../../shared/components';

// Import interfaces and services
import {
  Order,
  OrderQuery,
  ExtendedOrderStats,
} from '../interfaces/order.interface';
import { StoreOrdersService } from '../services/store-orders.service';

@Component({
  selector: 'app-orders',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    OrdersListComponent,
    OrderDetailsComponent,
    OrderEmptyStateComponent,
    OrderFilterDropdownComponent,
    OrderStatsComponent,
    InputsearchComponent,
    ButtonComponent,
    IconComponent,
  ],
  templateUrl: './orders.component.html',
  styleUrls: ['./orders.component.css'],
})
export class OrdersComponent implements OnInit, OnDestroy {
  selectedOrderId: string | null = null;
  showOrderDetails = false;

  @ViewChild(OrdersListComponent) ordersList!: OrdersListComponent;

  // Stats data
  orderStats: ExtendedOrderStats = {
    total_orders: 0,
    total_revenue: 0,
    pending_orders: 0,
    completed_orders: 0,
    average_order_value: 0,
    ordersGrowthRate: 0,
    pendingGrowthRate: 0,
    completedGrowthRate: 0,
    revenueGrowthRate: 0,
  };

  // Local state for filters
  searchTerm = '';
  selectedStatus = '';
  selectedPaymentStatus = '';
  selectedDateRange = '';
  isLoading = false;

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

  orders: Order[] = [];
  totalItems = 0;

  private destroy$ = new Subject<void>();

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
    this.ordersService
      .getOrderStats()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (stats: any) => {
          this.orderStats = {
            ...stats,
            ordersGrowthRate: 5.2, // Mock data - should come from backend
            pendingGrowthRate: -2.1,
            completedGrowthRate: 8.7,
            revenueGrowthRate: 12.3,
          };
        },
        error: (err: any) => {
          console.error('Error loading order stats:', err);
        },
      });
  }

  get hasFilters(): boolean {
    return !!(this.searchTerm || this.selectedStatus || this.selectedPaymentStatus || this.selectedDateRange);
  }

  getEmptyStateTitle(): string {
    if (this.hasFilters) {
      return 'No orders match your filters';
    }
    return 'No orders found';
  }

  getEmptyStateDescription(): string {
    if (this.hasFilters) {
      return 'Try adjusting your search terms or filters';
    }
    return 'Get started by creating your first order.';
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
    console.log('Order updated:', updatedOrder);
  }

  // Search functionality
  onSearchChange(searchTerm: string): void {
    this.searchTerm = searchTerm;
    this.filters.search = searchTerm;
    this.filters.page = 1;
    this.ordersList.loadOrders();
  }

  // Filter dropdown change
  onFilterDropdownChange(query: OrderQuery): void {
    this.selectedStatus = query.status || '';
    this.selectedPaymentStatus = query.payment_status || '';
    this.selectedDateRange = query.date_range || '';

    this.filters.status = query.status;
    this.filters.payment_status = query.payment_status;
    this.filters.date_range = query.date_range;
    this.filters.page = 1;

    this.ordersList.loadOrders();
  }

  // Clear all filters
  clearFilters(): void {
    this.searchTerm = '';
    this.selectedStatus = '';
    this.selectedPaymentStatus = '';
    this.selectedDateRange = '';

    this.filters.search = '';
    this.filters.status = undefined;
    this.filters.payment_status = undefined;
    this.filters.date_range = undefined;
    this.filters.page = 1;

    this.ordersList.loadOrders();
  }

  // Refresh orders
  refreshOrders(): void {
    this.ordersList.loadOrders();
    this.loadOrderStats();
  }

  // Export orders
  exportOrders(): void {
    this.ordersList.exportOrders();
  }

  // Handle orders loaded event
  onOrdersLoaded(event: any): void {
    this.orders = event.orders;
    this.totalItems = event.totalItems;
  }

  // Format currency helper
  formatCurrency(amount: number): string {
    return `$${amount?.toFixed(2) || '0.00'}`;
  }
}
