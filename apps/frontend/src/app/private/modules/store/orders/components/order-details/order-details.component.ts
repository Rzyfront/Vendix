import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnDestroy,
  OnChanges,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil } from 'rxjs';
import { StoreOrdersService } from '../../services/store-orders.service';
import { ModalComponent, DialogService } from '../../../../../../shared/components';
import {
  Order,
  OrderState,
} from '../../interfaces/order.interface';

@Component({
  selector: 'app-order-details',
  standalone: true,
  imports: [CommonModule, ModalComponent],
  templateUrl: './order-details.component.html',
  styleUrls: ['./order-details.component.css'],
})
export class OrderDetailsComponent implements OnInit, OnDestroy, OnChanges {
  @Input() orderId: string | null = null;
  @Input() isVisible = false;
  @Output() close = new EventEmitter<void>();
  @Output() orderUpdated = new EventEmitter<Order>();

  order: Order | null = null;
  isLoading = false;
  error: string | null = null;
  private lastLoadedOrderId: string | null = null;

  // Status constants for template
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

  private destroy$ = new Subject<void>();

  constructor(
    private ordersService: StoreOrdersService,
    private dialogService: DialogService,
  ) {}

  ngOnInit(): void {
    if (this.orderId && this.isVisible) {
      this.loadOrderDetails();
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Solo cargar si el orderId cambió a un valor diferente
    if (changes['orderId'] && changes['orderId'].currentValue && 
        changes['orderId'].currentValue !== this.lastLoadedOrderId) {
      if (this.isVisible) {
        this.loadOrderDetails();
      }
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadOrderDetails(): void {
    if (!this.orderId) {
      return;
    }

    this.isLoading = true;
    this.error = null;

    this.ordersService
      .getOrderById(this.orderId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response: any) => {
          // Unwrap ResponseService wrapper if present
          const orderData = response.data || response;

          // Normalize numeric strings to numbers
          const normalizedOrder = {
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
        };
          this.order = normalizedOrder;
          this.lastLoadedOrderId = this.orderId; // Marcar como cargado
          this.isLoading = false;
        },
        error: (err: any) => {
          console.error('Error loading order details:', err);
          this.error = 'Failed to load order details. Please try again.';
          this.isLoading = false;
        },
      });
  }

  closeModal(): void {
    this.close.emit();
  }

  updateOrderStatus(newStatus: string): void {
    if (!this.order || this.order.id == null) return;

    this.dialogService
      .confirm({
        title: 'Change Order Status',
        message: `Are you sure you want to change the order status to "${this.formatStatus(newStatus)}"? This action cannot be undone and may affect order processing.`,
        confirmText: 'Change Status',
        cancelText: 'Cancel',
        confirmVariant: 'danger',
      })
      .then((confirmed: boolean) => {
        if (confirmed) {
          this.ordersService
            .updateOrderStatus(String(this.order!.id), newStatus as OrderState)
            .pipe(takeUntil(this.destroy$))
            .subscribe({
              next: (response: any) => {
                // Unwrap ResponseService wrapper if present
                const orderData = response.data || response;

                // Normalize numeric strings to numbers
                const normalizedOrder = {
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
                };
                this.order = normalizedOrder;
                if (this.order) {
                  this.orderUpdated.emit(this.order);
                }
              },
              error: (err) => {
                console.error(err);
                this.error = 'Failed to update order status.';
              },
            });
        }
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
          <title>Order #${this.order.order_number}</title>
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
            <h1>Order #${this.order.order_number}</h1>
            <p>Date: ${new Date(this.order.created_at).toLocaleDateString()}</p>
            <p>Status: ${this.order.state}</p>
            <p>Store: ${this.order.stores?.name || 'N/A'}</p>
          </div>
          
          <div class="section">
            <h2>Order Summary</h2>
            <p>Subtotal: $${(this.order.subtotal_amount || 0).toFixed(2)}</p>
            <p>Tax: $${(this.order.tax_amount || 0).toFixed(2)}</p>
            <p>Shipping: $${(this.order.shipping_cost || 0).toFixed(2)}</p>
            <p>Discount: $${(this.order.discount_amount || 0).toFixed(2)}</p>
          </div>
          
          <div class="section">
            <h2>Order Items</h2>
            ${
              this.order.order_items
                ?.map(
                  (item) => `
              <div class="item">
                <div>${item.product_name} (${item.variant_sku || 'N/A'})</div>
                <div>Quantity: ${item.quantity} × $${(item.unit_price || 0).toFixed(2)} = $${(item.total_price || 0).toFixed(2)}</div>
              </div>
            `,
                )
                .join('') || 'No items'
            }
          </div>
          
          <div class="section">
            <div class="total">Grand Total: $${(this.order.grand_total || 0).toFixed(2)}</div>
          </div>
        </body>
      </html>
    `;
  }

  // Helper methods for status display
  getStatusColor(status: OrderState): string {
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
      created: 'bg-gray-100 text-gray-800',
      pending_payment: 'bg-yellow-100 text-yellow-800',
      processing: 'bg-blue-100 text-blue-800',
      finished: 'bg-green-100 text-green-800',
    };

    return statusColors[status] || 'bg-gray-100 text-gray-800';
  }

  formatStatus(status: string | undefined): string {
    if (!status) return 'Unknown';
    return (
      status.charAt(0).toUpperCase() +
      status.slice(1).replace(/([A-Z])/g, ' $1')
    );
  }

  formatDate(dateString: string | undefined): string {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return isNaN(date.getTime()) ? 'Invalid Date' : date.toLocaleString();
  }
}
