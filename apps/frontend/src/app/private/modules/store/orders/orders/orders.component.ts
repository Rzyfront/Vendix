import { Component, DestroyRef, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

// Import components
import { OrdersListComponent } from '../components/orders-list';
import { OrderStatsComponent } from '../components/order-stats';

// Import interfaces and services
import { ExtendedOrderStats } from '../interfaces/order.interface';
import { StoreOrdersService } from '../services/store-orders.service';

@Component({
  selector: 'app-orders',
  standalone: true,
  imports: [OrdersListComponent, OrderStatsComponent],
  templateUrl: './orders.component.html',
  styleUrls: ['./orders.component.css'],
})
export class OrdersComponent {
  private router = inject(Router);
  private ordersService = inject(StoreOrdersService);
  private destroyRef = inject(DestroyRef);

  // Stats data
  orderStats = signal<ExtendedOrderStats>({
    total_orders: 0,
    total_revenue: 0,
    pending_orders: 0,
    completed_orders: 0,
    average_order_value: 0,
    ordersGrowthRate: 0,
    pendingGrowthRate: 0,
    completedGrowthRate: 0,
    revenueGrowthRate: 0,
  });

  constructor() {
    this.loadOrderStats();
  }

  loadOrderStats(): void {
    this.ordersService
      .getOrderStats()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          const stats = response.data || response;
          this.orderStats.set({
            ...stats,
            ordersGrowthRate: 5.2, // Mock data - should come from backend
            pendingGrowthRate: -2.1,
            completedGrowthRate: 8.7,
            revenueGrowthRate: 12.3,
          });
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
  viewOrderDetails(orderId: string | Event): void {
    // Handle Event case (when called from template)
    const id = typeof orderId === 'string' ? orderId : (orderId as any);
    this.router.navigate(['/admin/orders', id]);
  }

  // Refresh orders and stats
  refreshOrders(): void {
    this.loadOrderStats();
  }
}
