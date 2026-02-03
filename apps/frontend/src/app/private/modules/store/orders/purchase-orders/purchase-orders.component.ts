import { Component, OnInit, OnDestroy, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';

import {
  ButtonComponent,
  IconComponent,
  InputsearchComponent,
  SelectorComponent,
  SelectorOption,
  ToastService,
} from '../../../../../shared/components/index';

// Services
import { PurchaseOrdersService } from '../../inventory/services';

// Interfaces
import {
  PurchaseOrder,
  PurchaseOrderStatus,
} from '../../inventory/interfaces';

// Child Components
import {
  PurchaseOrderStatsComponent,
  PurchaseOrderListComponent,
  PurchaseOrderCreateModalComponent,
  PurchaseOrderDetailModalComponent,
  PurchaseOrderEmptyStateComponent,
} from './components';

@Component({
  selector: 'app-purchase-orders',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonComponent,
    IconComponent,
    InputsearchComponent,
    SelectorComponent,
    PurchaseOrderStatsComponent,
    PurchaseOrderListComponent,
    PurchaseOrderCreateModalComponent,
    PurchaseOrderDetailModalComponent,
    PurchaseOrderEmptyStateComponent,
  ],
  templateUrl: './purchase-orders.component.html',
  styleUrls: ['./purchase-orders.component.scss'],
})
export class PurchaseOrdersComponent implements OnInit, OnDestroy {
  @ViewChild(PurchaseOrderListComponent) purchaseOrderList!: PurchaseOrderListComponent;

  // Stats data
  stats = {
    total: 0,
    pending: 0,
    received: 0,
    total_value: 0,
  };

  // Local state for filters
  searchTerm = '';
  currentStatus: PurchaseOrderStatus | 'all' = 'all';

  // Status options
  status_options: SelectorOption[] = [
    { value: 'all', label: 'Todos los estados' },
    { value: 'draft', label: 'Borrador' },
    { value: 'ordered', label: 'Ordenada' },
    { value: 'partial', label: 'Parcial' },
    { value: 'received', label: 'Recibida' },
    { value: 'cancelled', label: 'Cancelada' },
  ];

  // Modal state
  isCreateModalOpen = false;
  isDetailModalOpen = false;
  selectedOrder: PurchaseOrder | null = null;
  isSubmitting = false;
  isLoading = true;

  orders: PurchaseOrder[] = [];
  totalItems = 0;

  private destroy$ = new Subject<void>();

  constructor(
    private router: Router,
    private purchaseOrdersService: PurchaseOrdersService,
    private toastService: ToastService
  ) { }

  ngOnInit(): void {
    // Stats will be calculated when orders are loaded
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // Navigate to POP for new order
  createOrder(): void {
    this.router.navigate(['/admin/inventory/pop']);
  }

  openCreateModal(): void {
    this.isCreateModalOpen = true;
  }

  closeCreateModal(): void {
    this.isCreateModalOpen = false;
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

  // Handle orders loaded event
  onOrdersLoaded(event: { orders: PurchaseOrder[]; total: number }): void {
    this.orders = event.orders;
    this.totalItems = event.total;
    this.calculateStats();
    this.isLoading = false;
  }

  // Calculate stats from orders
  calculateStats(): void {
    this.stats.total = this.orders.length;
    this.stats.pending = this.orders.filter(
      (o) => ['draft', 'submitted', 'approved', 'ordered', 'partial'].includes(o.status)
    ).length;
    this.stats.received = this.orders.filter((o) => o.status === 'received').length;
    this.stats.total_value = this.orders.reduce(
      (sum, o) => {
        const amount = typeof o.total_amount === 'string'
          ? parseFloat(o.total_amount)
          : (o.total_amount || 0);
        return sum + amount;
      },
      0
    );
  }

  // Check if there are active filters
  get hasFilters(): boolean {
    return !!(this.searchTerm || this.currentStatus !== 'all');
  }

  // Get empty state title based on filters
  getEmptyStateTitle(): string {
    if (this.hasFilters) {
      return 'No se encontraron órdenes de compra';
    }
    return 'No hay órdenes de compra';
  }

  // Get empty state description based on filters
  getEmptyStateDescription(): string {
    if (this.hasFilters) {
      return 'Intenta ajustar tus filtros para ver más resultados';
    }
    return 'Comienza creando tu primera orden de compra para reabastecer inventario.';
  }

  // Clear all filters
  clearFilters(): void {
    this.searchTerm = '';
    this.currentStatus = 'all';
    this.refreshList();
  }

  // Search functionality
  onSearch(searchTerm: string): void {
    this.searchTerm = searchTerm;
    this.isLoading = true;
    this.refreshList();
  }

  // Filter functionality
  filterByStatus(status: any): void {
    this.currentStatus = status as PurchaseOrderStatus | 'all';
    this.isLoading = true;
    this.refreshList();
  }

  // Refresh purchase orders list
  refreshList(): void {
    this.isLoading = true;
    if (this.purchaseOrderList) {
      this.purchaseOrderList.loadOrders();
    }
  }

  // Handle create order from modal
  onCreateOrder(order: any): void {
    this.isSubmitting = true;
    // Order creation is handled by the modal
    this.isSubmitting = false;
    this.closeCreateModal();
    this.refreshList();
    this.toastService.success('Orden de compra creada exitosamente');
  }

  // Handle receive order from detail modal
  onReceiveOrder(event: any): void {
    // Handle receiving order - the event contains order data
    this.toastService.success('Orden recibida exitosamente');
    this.refreshList();
    this.closeDetailModal();
  }

  // Handle cancel order from detail modal
  onCancelOrder(order: any): void {
    // Handle cancellation
    this.toastService.success('Orden cancelada exitosamente');
    this.refreshList();
    this.closeDetailModal();
  }

  // Handle edit order from detail modal
  onEditOrder(order: PurchaseOrder): void {
    // Navigate to POP with this order
    this.router.navigate(['/admin/inventory/pop'], {
      queryParams: { orderId: order.id },
    });
  }
}
