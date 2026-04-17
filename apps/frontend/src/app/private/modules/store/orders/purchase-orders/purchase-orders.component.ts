import { Component, DestroyRef, ViewChild, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { ToastService } from '../../../../../shared/components/index';

// Interfaces
import { PurchaseOrder } from '../../inventory/interfaces';

// Services
import { PurchaseOrdersService } from '../../inventory/services/purchase-orders.service';

// Child Components
import {
  PurchaseOrderStatsComponent,
  PurchaseOrderStats,
  PurchaseOrderListComponent,
} from './components';

// New detail modal with tabs (receptions, payments, attachments, timeline)
import { PoDetailModalComponent } from '../../inventory/pop/components/po-detail-modal/po-detail-modal.component';

@Component({
  selector: 'app-purchase-orders',
  standalone: true,
  imports: [
    PurchaseOrderStatsComponent,
    PurchaseOrderListComponent,
    PoDetailModalComponent,
  ],
  templateUrl: './purchase-orders.component.html',
  styleUrls: ['./purchase-orders.component.scss'],
})
export class PurchaseOrdersComponent {
  @ViewChild(PurchaseOrderListComponent) purchaseOrderList!: PurchaseOrderListComponent;

  private router = inject(Router);
  private toastService = inject(ToastService);
  private purchaseOrdersService = inject(PurchaseOrdersService);
  private destroyRef = inject(DestroyRef);

  // Stats data (updated by child via statsUpdated event)
  readonly stats = signal<PurchaseOrderStats>({
    total: 0,
    pending: 0,
    received: 0,
    total_value: 0,
  });

  // Modal state
  readonly isDetailModalOpen = signal(false);
  readonly selectedOrder = signal<PurchaseOrder | null>(null);

  // Navigate to POP for new order
  createOrder(): void {
    this.router.navigate(['/admin/inventory/pop']);
  }

  // Handle view order from list — fetch full order details for the modal
  viewOrderDetails(order: PurchaseOrder): void {
    this.purchaseOrdersService
      .getPurchaseOrderById(order.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          this.selectedOrder.set(response.data || response);
          this.isDetailModalOpen.set(true);
        },
        error: () => {
          // Fallback to list data if detail fetch fails
          this.selectedOrder.set(order);
          this.isDetailModalOpen.set(true);
        },
      });
  }

  closeDetailModal(): void {
    this.isDetailModalOpen.set(false);
    this.selectedOrder.set(null);
  }

  // Handle stats update from child component
  onStatsUpdated(stats: PurchaseOrderStats): void {
    this.stats.set(stats);
  }

  // Refresh purchase orders list (called when order is updated inside modal)
  onOrderUpdated(): void {
    if (this.purchaseOrderList) {
      this.purchaseOrderList.loadOrders();
    }
  }
}
