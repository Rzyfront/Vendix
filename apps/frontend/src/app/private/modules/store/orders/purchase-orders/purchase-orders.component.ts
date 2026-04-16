import { Component, OnDestroy, ViewChild } from '@angular/core';

import { Router } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';

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
    PoDetailModalComponent
],
  templateUrl: './purchase-orders.component.html',
  styleUrls: ['./purchase-orders.component.scss'],
})
export class PurchaseOrdersComponent implements OnDestroy {
  @ViewChild(PurchaseOrderListComponent) purchaseOrderList!: PurchaseOrderListComponent;

  // Stats data (updated by child via statsUpdated event)
  stats: PurchaseOrderStats = {
    total: 0,
    pending: 0,
    received: 0,
    total_value: 0,
  };

  // Modal state
  isDetailModalOpen = false;
  selectedOrder: PurchaseOrder | null = null;

  private destroy$ = new Subject<void>();

  constructor(
    private router: Router,
    private toastService: ToastService,
    private purchaseOrdersService: PurchaseOrdersService
  ) {}

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // Navigate to POP for new order
  createOrder(): void {
    this.router.navigate(['/admin/inventory/pop']);
  }

  // Handle view order from list — fetch full order details for the modal
  viewOrderDetails(order: PurchaseOrder): void {
    this.purchaseOrdersService
      .getPurchaseOrderById(order.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response: any) => {
          this.selectedOrder = response.data || response;
          this.isDetailModalOpen = true;
        },
        error: () => {
          // Fallback to list data if detail fetch fails
          this.selectedOrder = order;
          this.isDetailModalOpen = true;
        },
      });
  }

  closeDetailModal(): void {
    this.isDetailModalOpen = false;
    this.selectedOrder = null;
  }

  // Handle stats update from child component
  onStatsUpdated(stats: PurchaseOrderStats): void {
    this.stats = stats;
  }

  // Refresh purchase orders list (called when order is updated inside modal)
  onOrderUpdated(): void {
    if (this.purchaseOrderList) {
      this.purchaseOrderList.loadOrders();
    }
  }
}
