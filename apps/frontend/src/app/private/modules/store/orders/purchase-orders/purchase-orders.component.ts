import { Component, OnDestroy, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';

import { ToastService } from '../../../../../shared/components/index';

// Interfaces
import { PurchaseOrder } from '../../inventory/interfaces';

// Child Components
import {
  PurchaseOrderStatsComponent,
  PurchaseOrderStats,
  PurchaseOrderListComponent,
  PurchaseOrderDetailModalComponent,
} from './components';

@Component({
  selector: 'app-purchase-orders',
  standalone: true,
  imports: [
    CommonModule,
    PurchaseOrderStatsComponent,
    PurchaseOrderListComponent,
    PurchaseOrderDetailModalComponent,
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
    private toastService: ToastService
  ) {}

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // Navigate to POP for new order
  createOrder(): void {
    this.router.navigate(['/admin/inventory/pop']);
  }

  // Handle view order from list
  viewOrderDetails(order: PurchaseOrder): void {
    this.selectedOrder = order;
    this.isDetailModalOpen = true;
  }

  closeDetailModal(): void {
    this.isDetailModalOpen = false;
    this.selectedOrder = null;
  }

  // Handle stats update from child component
  onStatsUpdated(stats: PurchaseOrderStats): void {
    this.stats = stats;
  }

  // Refresh purchase orders list
  refreshList(): void {
    if (this.purchaseOrderList) {
      this.purchaseOrderList.loadOrders();
    }
  }

  // Handle receive order from detail modal
  onReceiveOrder(event: any): void {
    this.toastService.success('Orden recibida exitosamente');
    this.refreshList();
    this.closeDetailModal();
  }

  // Handle cancel order from detail modal
  onCancelOrder(order: any): void {
    this.toastService.success('Orden cancelada exitosamente');
    this.refreshList();
    this.closeDetailModal();
  }

  // Handle edit order from detail modal
  onEditOrder(order: PurchaseOrder): void {
    this.router.navigate(['/admin/inventory/pop'], {
      queryParams: { orderId: order.id },
    });
  }
}
