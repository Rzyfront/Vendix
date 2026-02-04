import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';

// Import components
import { OrdersListComponent } from '../components/orders-list';
import { OrderStatsComponent } from '../components/order-stats';

// Import interfaces and services
import { ExtendedOrderStats } from '../interfaces/order.interface';
import { StoreOrdersService } from '../services/store-orders.service';

@Component({
  selector: 'app-orders',
  standalone: true,
  imports: [CommonModule, OrdersListComponent, OrderStatsComponent],
  templateUrl: './orders.component.html',
  styleUrls: ['./orders.component.css'],
})
export class OrdersComponent implements OnInit, OnDestroy {
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
        next: (response: any) => {
          const stats = response.data || response;
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

  // Navigate to POS for new order
  createNewOrder(): void {
    this.router.navigate(['/admin/pos']);
  }

  // Navigate to order details page
  viewOrderDetails(orderId: string): void {
    this.router.navigate(['/admin/orders', orderId]);
  }

  // Refresh orders and stats
  refreshOrders(): void {
    this.loadOrderStats();
  }
}
