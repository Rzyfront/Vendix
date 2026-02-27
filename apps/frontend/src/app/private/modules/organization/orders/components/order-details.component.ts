import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnDestroy,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { FormBuilder, FormGroup } from '@angular/forms';
import { Subscription } from 'rxjs';
import { CurrencyFormatService } from '../../../../../shared/pipes/currency/currency.pipe';

import {
  OrderListItem,
  OrderDetails,
  OrderStatus,
  PaymentStatus,
  UpdateOrderDto,
  DeliveryType,
} from '../interfaces/order.interface';

// Import shared components
import {
  ModalComponent,
  IconComponent,
  ButtonComponent,
  ToastService,
  InputComponent,
  SelectorComponent,
  TextareaComponent,
} from '../../../../../shared/components/index';

@Component({
  selector: 'app-order-details',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    ModalComponent,
    IconComponent,
    ButtonComponent,
    InputComponent,
    SelectorComponent,
    TextareaComponent,
  ],
  templateUrl: './order-details.component.html',
})
export class OrderDetailsComponent implements OnInit, OnDestroy {
  private currencyService = inject(CurrencyFormatService);
  @Input() isOpen = false;
  @Input() order?: OrderListItem;
  @Output() isOpenChange = new EventEmitter<boolean>();

  orderDetails?: OrderDetails;
  isLoading = false;
  isUpdating = false;
  isDispatching = false;
  showDispatchModal = false;

  // Dispatch form
  dispatchForm!: FormGroup;

  // Update form
  updateForm!: FormGroup;

  // Options arrays for selectors
  orderStatusOptions = [
    { value: 'pending', label: 'Pendiente' },
    { value: 'confirmed', label: 'Confirmado' },
    { value: 'processing', label: 'Procesando' },
    { value: 'shipped', label: 'Enviado' },
    { value: 'delivered', label: 'Entregado' },
    { value: 'cancelled', label: 'Cancelado' },
    { value: 'refunded', label: 'Reembolsado' }
  ];

  paymentStatusOptions = [
    { value: 'pending', label: 'Pendiente' },
    { value: 'paid', label: 'Pagado' },
    { value: 'failed', label: 'Fallido' },
    { value: 'refunded', label: 'Reembolsado' },
    { value: 'partially_refunded', label: 'Reembolso parcial' }
  ];

  private subscriptions: Subscription[] = [];

  constructor(private fb: FormBuilder) {
    this.initializeUpdateForm();
    this.initializeDispatchForm();
  }

  ngOnInit(): void {
    if (this.order) {
      this.loadOrderDetails();
    }
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((sub) => sub.unsubscribe());
  }

  private initializeUpdateForm(): void {
    this.updateForm = this.fb.group({
      status: [''],
      payment_status: [''],
      tracking_number: [''],
      estimated_delivery: [''],
      notes: [''],
    });
  }

  private initializeDispatchForm(): void {
    this.dispatchForm = this.fb.group({
      tracking_number: [''],
      carrier: [''],
      notes: [''],
    });
  }

  ngOnChanges(): void {
    if (this.order && this.isOpen) {
      this.loadOrderDetails();
    }
  }

  loadOrderDetails(): void {
    if (!this.order) return;

    this.isLoading = true;

    // TODO: Replace with actual API call
    // For now, generate mock data
    setTimeout(() => {
      this.orderDetails = this.generateMockOrderDetails(this.order!);
      this.updateForm.patchValue({
        status: this.orderDetails.status,
        payment_status: this.orderDetails.payment_status,
        tracking_number: this.orderDetails.tracking_number || '',
        estimated_delivery: this.orderDetails.estimated_delivery || '',
        notes: this.orderDetails.notes || '',
      });
      this.isLoading = false;
    }, 1000);
  }

  private generateMockOrderDetails(order: OrderListItem): OrderDetails {
    return {
      ...order,
      items: [
        {
          id: 'item_1',
          product_id: 'product_1',
          product_name: 'Sample Product 1',
          product_sku: 'SKU001',
          quantity: 2,
          unit_price: 50,
          total_price: 100,
        },
        {
          id: 'item_2',
          product_id: 'product_2',
          product_name: 'Sample Product 2',
          product_sku: 'SKU002',
          quantity: 1,
          unit_price: 75,
          total_price: 75,
        },
      ],
      payment_method: 'credit_card',
      transaction_id: 'txn_123456',
      tracking_number: 'TRACK123456',
      estimated_delivery: new Date(
        Date.now() + 5 * 24 * 60 * 60 * 1000,
      ).toISOString(),
      delivered_at:
        order.status === OrderStatus.DELIVERED
          ? new Date().toISOString()
          : undefined,
      subtotal: order.total_amount * 0.9,
      tax_amount: order.total_amount * 0.1,
      shipping_amount: 10,
      discount_amount: 0,
    };
  }

  onClose(): void {
    this.isOpenChange.emit(false);
  }

  onUpdateOrder(): void {
    if (!this.orderDetails || this.updateForm.invalid) return;

    this.isUpdating = true;

    // TODO: Replace with actual API call
    setTimeout(() => {
      console.log('Order updated successfully');
      this.loadOrderDetails(); // Reload details
      this.isUpdating = false;
    }, 1000);
  }

  onCancelOrder(): void {
    if (!this.orderDetails) return;

    const reason = prompt('Please enter the reason for cancellation:');
    if (!reason) return;

    // TODO: Replace with actual API call
    setTimeout(() => {
      console.log('Order cancelled successfully');
      this.loadOrderDetails(); // Reload details
    }, 1000);
  }

  onRefundOrder(): void {
    if (!this.orderDetails) return;

    const amount = prompt('Enter refund amount (leave empty for full refund):');
    const refundAmount = amount ? parseFloat(amount) : undefined;
    const reason = prompt('Please enter the reason for refund:');
    if (!reason) return;

    // TODO: Replace with actual API call
    setTimeout(() => {
      console.log('Order refunded successfully');
      this.loadOrderDetails(); // Reload details
    }, 1000);
  }

  onPrintInvoice(): void {
    if (!this.orderDetails) return;

    // TODO: Replace with actual API call
    console.log('Invoice downloaded successfully');
  }

  onPrintPackingSlip(): void {
    if (!this.orderDetails) return;

    // TODO: Replace with actual API call
    console.log('Packing slip downloaded successfully');
  }

  // Helper methods
  formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString('es-ES', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  formatCurrency(amount: number): string {
    return this.currencyService.format(amount);
  }

  getStatusColor(status: OrderStatus): string {
    const colorMap: Record<OrderStatus, string> = {
      [OrderStatus.PENDING]: 'text-yellow-600 bg-yellow-100',
      [OrderStatus.CONFIRMED]: 'text-blue-600 bg-blue-100',
      [OrderStatus.PROCESSING]: 'text-purple-600 bg-purple-100',
      [OrderStatus.SHIPPED]: 'text-indigo-600 bg-indigo-100',
      [OrderStatus.DELIVERED]: 'text-green-600 bg-green-100',
      [OrderStatus.CANCELLED]: 'text-red-600 bg-red-100',
      [OrderStatus.REFUNDED]: 'text-orange-600 bg-orange-100',
    };
    return colorMap[status] || 'text-gray-600 bg-gray-100';
  }

  getPaymentStatusColor(status: PaymentStatus): string {
    const colorMap: Record<PaymentStatus, string> = {
      [PaymentStatus.PENDING]: 'text-yellow-600 bg-yellow-100',
      [PaymentStatus.PAID]: 'text-green-600 bg-green-100',
      [PaymentStatus.FAILED]: 'text-red-600 bg-red-100',
      [PaymentStatus.REFUNDED]: 'text-orange-600 bg-orange-100',
      [PaymentStatus.PARTIALLY_REFUNDED]: 'text-orange-500 bg-orange-100',
    };
    return colorMap[status] || 'text-gray-600 bg-gray-100';
  }

  getCustomerName(): string {
    if (!this.orderDetails?.customer) return 'Unknown Customer';
    return `${this.orderDetails.customer.first_name} ${this.orderDetails.customer.last_name}`;
  }

  getStoreName(): string {
    if (!this.orderDetails?.store) return 'Unknown Store';
    return this.orderDetails.store.name;
  }

  canCancelOrder(): boolean {
    if (!this.orderDetails) return false;
    return [
      OrderStatus.PENDING,
      OrderStatus.CONFIRMED,
      OrderStatus.PROCESSING,
    ].includes(this.orderDetails.status);
  }

  canRefundOrder(): boolean {
    if (!this.orderDetails) return false;
    return (
      this.orderDetails.payment_status === PaymentStatus.PAID &&
      [OrderStatus.DELIVERED, OrderStatus.SHIPPED].includes(
        this.orderDetails.status,
      )
    );
  }

  canUpdateTracking(): boolean {
    if (!this.orderDetails) return false;
    return [
      OrderStatus.CONFIRMED,
      OrderStatus.PROCESSING,
      OrderStatus.SHIPPED,
    ].includes(this.orderDetails.status);
  }

  canDispatchOrder(): boolean {
    if (!this.orderDetails) return false;
    return (
      this.orderDetails.status === OrderStatus.PROCESSING &&
      this.orderDetails.payment_status === PaymentStatus.PAID &&
      this.orderDetails.delivery_type === 'home_delivery' &&
      !!this.orderDetails.shipping_method_id
    );
  }

  openDispatchModal(): void {
    this.dispatchForm.reset();
    this.showDispatchModal = true;
  }

  closeDispatchModal(): void {
    this.showDispatchModal = false;
  }

  onDispatchOrder(): void {
    if (!this.orderDetails) return;

    this.isDispatching = true;

    const dispatchData = {
      tracking_number: this.dispatchForm.get('tracking_number')?.value || undefined,
      carrier: this.dispatchForm.get('carrier')?.value || undefined,
      notes: this.dispatchForm.get('notes')?.value || undefined,
    };

    // TODO: Replace with actual API call to POST /store/orders/:id/flow/ship
    setTimeout(() => {
      console.log('Order dispatched successfully', dispatchData);
      this.closeDispatchModal();
      this.loadOrderDetails();
      this.isDispatching = false;
    }, 1000);
  }
}
