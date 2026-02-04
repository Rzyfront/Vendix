import { Component, OnInit, OnDestroy, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { Subject, takeUntil, forkJoin } from 'rxjs';
import { StoreOrdersService } from '../../services/store-orders.service';
import { Order, OrderState } from '../../interfaces/order.interface';
import { DialogService } from '../../../../../../shared/components';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import {
  StickyHeaderComponent,
  StickyHeaderActionButton,
  StickyHeaderBadgeColor,
} from '../../../../../../shared/components/sticky-header/sticky-header.component';

@Component({
  selector: 'app-order-details-page',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, ButtonComponent, IconComponent, StickyHeaderComponent],
  templateUrl: './order-details-page.component.html',
  styleUrls: ['./order-details-page.component.css'],
})
export class OrderDetailsPageComponent implements OnInit, OnDestroy {
  orderId: string | null = null;
  order = signal<Order | null>(null);
  timeline: any[] = [];
  isLoading = signal(false);
  error: string | null = null;

  // Status constants
  readonly orderStatusOptions = [
    'created',
    'pending_payment',
    'processing',
    'shipped',
    'delivered',
    'cancelled',
    'refunded',
    'finished',
  ] as const;

  // Sticky Header Configuration
  readonly headerTitle = computed(() => {
    const order = this.order();
    return order ? `Orden #${order.order_number}` : 'Cargando...';
  });

  readonly headerSubtitle = computed(() => {
    const order = this.order();
    if (!order) return '';
    const date = this.formatDate(order.created_at);
    const store = order.stores?.name || order.store_id;
    return `${date} • Tienda: ${store}`;
  });

  readonly headerBadgeText = computed(() => {
    const order = this.order();
    return order ? this.formatStatus(order.state) : '';
  });

  readonly headerBadgeColor = computed<StickyHeaderBadgeColor>(() => {
    const order = this.order();
    if (!order) return 'gray';
    const colorMap: Record<string, StickyHeaderBadgeColor> = {
      created: 'gray',
      pending_payment: 'yellow',
      processing: 'blue',
      shipped: 'blue',
      delivered: 'green',
      cancelled: 'red',
      refunded: 'yellow',
      finished: 'green',
    };
    return colorMap[order.state || ''] || 'gray';
  });

  readonly headerActions = computed<StickyHeaderActionButton[]>(() => [
    { id: 'print', label: 'Imprimir', variant: 'outline', icon: 'printer' },
  ]);

  private destroy$ = new Subject<void>();

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private ordersService: StoreOrdersService,
    private dialogService: DialogService,
  ) {}

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      this.orderId = params.get('id');
      if (this.orderId) {
        this.loadData();
      }
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadData(): void {
    if (!this.orderId) return;

    this.isLoading.set(true);
    this.error = null;

    forkJoin({
      order: this.ordersService.getOrderById(this.orderId),
      timeline: this.ordersService.getOrderTimeline(this.orderId),
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: ({ order, timeline }) => {
          // Normalize order data (similar to modal)
          const orderData = (order as any).data || order;
          this.order.set({
            ...orderData,
            grand_total: Number(orderData.grand_total),
            subtotal_amount: Number(orderData.subtotal_amount),
            tax_amount: Number(orderData.tax_amount),
            shipping_cost: Number(orderData.shipping_cost),
            discount_amount: Number(orderData.discount_amount),
            order_items: (orderData.order_items || []).map((item: any) => ({
              ...item,
              unit_price: Number(item.unit_price),
              total_price: Number(item.total_price),
              quantity: Number(item.quantity),
            })),
          });

          // Normalize timeline data
          this.timeline = (timeline as any).data || timeline || [];

          this.isLoading.set(false);
        },
        error: (err) => {
          console.error('Error loading order data:', err);
          this.error = 'Failed to load order data.';
          this.isLoading.set(false);
        },
      });
  }

  updateOrderStatus(newStatus: string): void {
    const currentOrder = this.order();
    if (!currentOrder || currentOrder.id == null) return;

    this.dialogService
      .confirm({
        title: 'Cambiar estado de la orden',
        message: `¿Estás seguro de que deseas cambiar el estado a "${this.formatStatus(newStatus)}"?`,
        confirmText: 'Cambiar Estado',
        cancelText: 'Cancelar',
        confirmVariant: 'primary',
      })
      .then((confirmed: boolean) => {
        if (confirmed) {
          this.ordersService
            .updateOrderStatus(String(currentOrder.id), newStatus as OrderState)
            .pipe(takeUntil(this.destroy$))
            .subscribe({
              next: () => {
                this.loadData(); // Reload to get updated status and new log
              },
              error: (err) => {
                console.error(err);
                // Optionally show toast error
              },
            });
        }
      });
  }

  onHeaderAction(actionId: string): void {
    if (actionId === 'print') {
      this.printOrder();
    }
  }

  printOrder(): void {
    // Implement print logic (reuse from modal or improve)
    window.print();
  }

  goBack(): void {
    this.router.navigate(['/admin/orders']);
  }

  // Helpers
  getStatusColor(status: string | undefined): string {
    const colors: Record<string, string> = {
      created: 'bg-gray-100 text-gray-800',
      pending_payment: 'bg-yellow-100 text-yellow-800',
      processing: 'bg-blue-100 text-blue-800',
      shipped: 'bg-indigo-100 text-indigo-800',
      delivered: 'bg-green-100 text-green-800',
      cancelled: 'bg-red-100 text-red-800',
      refunded: 'bg-orange-100 text-orange-800',
      finished: 'bg-green-100 text-green-800',
    };
    return colors[status || ''] || 'bg-gray-100 text-gray-800';
  }

  formatStatus(status: string | undefined): string {
    if (!status) return 'Unknown';
    return status
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  formatDate(dateString: string | undefined): string {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleString();
  }

  getAuditActionLabel(action: string): string {
    const labels: Record<string, string> = {
      create: 'Orden Creada',
      update: 'Orden Actualizada',
      delete: 'Orden Eliminada',
      view: 'Orden Vista',
      // Add more as needed
    };
    return labels[action] || action;
  }
}
