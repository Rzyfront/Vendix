import { Component, DestroyRef, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
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

  /**
   * Bug 2 (Fase K): tick counter that increments every time the user
   * re-enters `/admin/orders/sales` (or the orders host route). The
   * list component watches it via an effect and re-fetches the orders
   * so the POS-created order shows up without a manual refresh.
   */
  reloadTick = signal(0);

  constructor() {
    this.loadOrderStats();
    this.router.events
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((evt) => {
        if (evt instanceof NavigationEnd) {
          // Re-entering the orders host route (after a POS sale) should
          // re-fetch. Avoid firing on child navigations that don't
          // remount the list (e.g. order detail back-and-forth).
          if (evt.urlAfterRedirects.startsWith('/admin/orders') &&
              !evt.urlAfterRedirects.match(/^\/admin\/orders\/[^/]+/)) {
            this.reloadTick.update((n) => n + 1);
            this.loadOrderStats();
          }
        }
      });
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

  // Refresh orders and stats. Bug 2 (Fase K): also tick the list
  // reload trigger so the existing "refresh" action in the toolbar
  // does the right thing without waiting for a route change.
  refreshOrders(): void {
    this.loadOrderStats();
    this.reloadTick.update((n) => n + 1);
  }
}
