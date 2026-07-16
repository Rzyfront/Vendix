import { Component, ViewChild, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

// Child Components
import {
  PurchaseOrderStatsComponent,
  PurchaseOrderStats,
  PurchaseOrderListComponent,
} from './components';

/**
 * STORE_ADMIN — Purchase Orders list shell.
 *
 * The per-order management flow now lives in a dedicated full-page view
 * (`purchase-orders/:id`, StorePurchaseOrderDetailComponent). The list
 * navigates there directly, so this shell no longer opens the legacy
 * `po-detail-modal` (kept in the codebase but no longer routed here).
 */
@Component({
  selector: 'app-purchase-orders',
  standalone: true,
  imports: [PurchaseOrderStatsComponent, PurchaseOrderListComponent],
  templateUrl: './purchase-orders.component.html',
  styleUrls: ['./purchase-orders.component.scss'],
})
export class PurchaseOrdersComponent {
  @ViewChild(PurchaseOrderListComponent) purchaseOrderList!: PurchaseOrderListComponent;

  private router = inject(Router);

  // Stats data (updated by child via statsUpdated event)
  readonly stats = signal<PurchaseOrderStats>({
    total: 0,
    pending: 0,
    received: 0,
    total_value: 0,
  });

  // Navigate to POP for new order
  createOrder(): void {
    this.router.navigate(['/admin/inventory/pop']);
  }

  // Handle stats update from child component
  onStatsUpdated(stats: PurchaseOrderStats): void {
    this.stats.set(stats);
  }

  // Reload the list (empty-state refresh action)
  onOrderUpdated(): void {
    this.purchaseOrderList?.loadOrders();
  }
}
