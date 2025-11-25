import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil } from 'rxjs';
import { StoreOrdersService } from '../../services/store-orders.service';
import {
  Order,
  OrderStatus,
  PaymentStatus,
} from '../../interfaces/order.interface';

@Component({
  selector: 'app-order-details',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './order-details.component.html',
  styleUrls: ['./order-details.component.css'],
})
export class OrderDetailsComponent implements OnInit, OnDestroy {
  @Input() orderId: string | null = null;
  @Input() isVisible = false;
  @Output() close = new EventEmitter<void>();
  @Output() orderUpdated = new EventEmitter<Order>();

  order: Order | null = null;
  isLoading = false;
  error: string | null = null;

  // Status constants for template
  readonly orderStatusOptions = [
    'confirmed',
    'preparing',
    'ready',
    'shipped',
    'delivered',
  ] as const;
  readonly paymentStatusOptions = [
    'pending',
    'processing',
    'paid',
    'failed',
  ] as const;

  private destroy$ = new Subject<void>();

  constructor(private ordersService: StoreOrdersService) {}

  ngOnInit(): void {
    if (this.orderId && this.isVisible) {
      this.loadOrderDetails();
    }
  }

  ngOnChanges(): void {
    if (this.orderId && this.isVisible) {
      this.loadOrderDetails();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadOrderDetails(): void {
    if (!this.orderId) return;

    this.isLoading = true;
    this.error = null;

    this.ordersService
      .getOrderById(this.orderId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (order: Order) => {
          this.order = order;
          this.isLoading = false;
        },
        error: (err: any) => {
          this.error = 'Failed to load order details. Please try again.';
          this.isLoading = false;
          console.error('Error loading order details:', err);
        },
      });
  }

  closeModal(): void {
    this.close.emit();
  }

  updateOrderStatus(newStatus: string): void {
    if (!this.order) return;

    this.ordersService
      .updateOrderStatus(this.order.id, newStatus as OrderStatus)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (updatedOrder: Order) => {
          this.order = updatedOrder;
          this.orderUpdated.emit(updatedOrder);
        },
        error: (err: any) => {
          console.error('Error updating order status:', err);
          this.error = 'Failed to update order status.';
        },
      });
  }

  updatePaymentStatus(newStatus: string): void {
    if (!this.order) return;

    this.ordersService
      .updatePaymentStatus(this.order.id, {
        paymentStatus: newStatus as PaymentStatus,
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (updatedOrder: Order) => {
          this.order = updatedOrder;
          this.orderUpdated.emit(updatedOrder);
        },
        error: (err: any) => {
          console.error('Error updating payment status:', err);
          this.error = 'Failed to update payment status.';
        },
      });
  }

  printOrder(): void {
    if (!this.order) return;

    // Create a print-friendly version
    const printContent = this.generatePrintContent();
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(printContent);
      printWindow.document.close();
      printWindow.print();
    }
  }

  private generatePrintContent(): string {
    if (!this.order) return '';

    return `
      <html>
        <head>
          <title>Order #${this.order.orderNumber}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; }
            .header { border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 20px; }
            .section { margin-bottom: 20px; }
            .item { border-bottom: 1px solid #eee; padding: 10px 0; }
            .total { font-weight: bold; font-size: 18px; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>Order #${this.order.orderNumber}</h1>
            <p>Date: ${new Date(this.order.createdAt).toLocaleDateString()}</p>
            <p>Status: ${this.order.status}</p>
            <p>Payment Status: ${this.order.paymentStatus}</p>
          </div>
          
          <div class="section">
            <h2>Customer Information</h2>
            <p>Name: ${this.order.customer?.name || 'N/A'}</p>
            <p>Email: ${this.order.customer?.email || 'N/A'}</p>
            <p>Phone: ${this.order.customer?.phone || 'N/A'}</p>
          </div>
          
          <div class="section">
            <h2>Order Items</h2>
            ${this.order.items
              .map(
                (item) => `
              <div class="item">
                <div>${item.productName} (${item.productSku})</div>
                <div>Quantity: ${item.quantity} × $${item.unitPrice.toFixed(2)} = $${item.totalPrice.toFixed(2)}</div>
              </div>
            `,
              )
              .join('')}
          </div>
          
          <div class="section">
            <div class="total">Total: $${this.order.total.toFixed(2)}</div>
          </div>
        </body>
      </html>
    `;
  }

  // Helper methods for status display
  getStatusColor(status: OrderStatus | PaymentStatus): string {
    const statusColors: Record<string, string> = {
      // Order Status
      draft: 'bg-gray-100 text-gray-800',
      pending: 'bg-yellow-100 text-yellow-800',
      confirmed: 'bg-blue-100 text-blue-800',
      preparing: 'bg-purple-100 text-purple-800',
      ready: 'bg-indigo-100 text-indigo-800',
      shipped: 'bg-cyan-100 text-cyan-800',
      delivered: 'bg-green-100 text-green-800',
      cancelled: 'bg-red-100 text-red-800',
      refunded: 'bg-orange-100 text-orange-800',
      returned: 'bg-pink-100 text-pink-800',

      // Payment Status
      processing: 'bg-blue-100 text-blue-800',
      paid: 'bg-green-100 text-green-800',
      partial: 'bg-yellow-100 text-yellow-800',
      overpaid: 'bg-purple-100 text-purple-800',
      failed: 'bg-red-100 text-red-800',
      disputed: 'bg-orange-100 text-orange-800',
    };

    return statusColors[status] || 'bg-gray-100 text-gray-800';
  }

  formatStatus(status: string): string {
    return (
      status.charAt(0).toUpperCase() +
      status.slice(1).replace(/([A-Z])/g, ' $1')
    );
  }

  formatDate(dateString: string): string {
    return new Date(dateString).toLocaleString();
  }
}
