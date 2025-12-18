import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormsModule,
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
  FormArray,
} from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../../../environments/environment';

import {
  ModalComponent,
  InputComponent,
  ButtonComponent,
  SelectorComponent,
  IconComponent,
} from '../../../../../shared/components/index';
import { ProductSelectorComponent } from './product-selector.component';
import {
  CreateOrderDto,
  OrderType,
  OrderAddress,
} from '../interfaces/order.interface';

@Component({
  selector: 'app-order-create-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    ModalComponent,
    InputComponent,
    ButtonComponent,
    SelectorComponent,
    IconComponent,
    ProductSelectorComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen"
      [size]="'lg'"
      title="Create New Order"
      subtitle="Fill in the details to create a new order"
      (openChange)="onModalChange($event)"
    >
      <form [formGroup]="orderForm" class="space-y-6">
        <!-- Order Information -->
        <div class="space-y-4">
          <h3
            class="text-lg font-semibold text-text-primary border-b border-border pb-2"
          >
            Order Information
          </h3>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <!-- Order Type (first to control other fields) -->
            <app-selector
              formControlName="order_type"
              label="Order Type"
              placeholder="Select order type"
              [required]="true"
              [options]="orderTypeOptions"
            ></app-selector>

            <app-input
              formControlName="organization_id"
              label="Organization ID"
              type="number"
              placeholder="Enter organization ID"
              [required]="true"
            ></app-input>

            <!-- Customer fields (shown for Sales and Return orders) -->
            <app-input
              formControlName="customer_id"
              label="Customer ID"
              type="number"
              placeholder="Enter customer ID"
              [required]="
                orderForm.get('order_type')?.value === 'SALE' ||
                orderForm.get('order_type')?.value === 'RETURN'
              "
              [hidden]="orderForm.get('order_type')?.value === 'PURCHASE'"
            ></app-input>

            <!-- Supplier field (shown for Purchase orders) -->
            <app-input
              formControlName="supplier_id"
              label="Supplier ID"
              type="number"
              placeholder="Enter supplier ID"
              [required]="orderForm.get('order_type')?.value === 'PURCHASE'"
              [hidden]="orderForm.get('order_type')?.value !== 'PURCHASE'"
            ></app-input>

            <!-- Store field (shown for Sales and Return orders) -->
            <app-selector
              formControlName="store_id"
              label="Store"
              placeholder="Select a store"
              [required]="
                orderForm.get('order_type')?.value === 'SALE' ||
                orderForm.get('order_type')?.value === 'RETURN'
              "
              [options]="storeOptions"
              [hidden]="orderForm.get('order_type')?.value === 'PURCHASE'"
            ></app-selector>

            <!-- Location field (shown for Purchase orders and Transfers) -->
            <app-input
              formControlName="location_id"
              label="Location ID"
              type="number"
              placeholder="Enter location ID"
              [required]="
                orderForm.get('order_type')?.value === 'PURCHASE' ||
                orderForm.get('order_type')?.value === 'TRANSFER'
              "
              [hidden]="
                orderForm.get('order_type')?.value === 'SALE' ||
                orderForm.get('order_type')?.value === 'RETURN'
              "
            ></app-input>

            <!-- Partner field (shown for Return orders) -->
            <app-input
              formControlName="partner_id"
              label="Partner ID"
              type="number"
              placeholder="Enter partner ID"
              [hidden]="orderForm.get('order_type')?.value !== 'RETURN'"
            ></app-input>

            <!-- Order dates -->
            <app-input
              formControlName="order_date"
              label="Order Date"
              type="date"
            ></app-input>

            <app-input
              formControlName="expected_delivery_date"
              label="Expected Delivery Date"
              type="date"
            ></app-input>

            <!-- Status and payment -->
            <app-selector
              formControlName="status"
              label="Status"
              placeholder="Select status"
              [options]="getStatusOptions()"
            ></app-selector>

            <app-input
              formControlName="payment_method"
              label="Payment Method"
              placeholder="e.g., credit_card, cash, paypal"
            ></app-input>

            <app-selector
              formControlName="payment_status"
              label="Payment Status"
              placeholder="Select payment status"
              [options]="getPaymentStatusOptions()"
            ></app-selector>

            <app-input
              formControlName="shipping_method"
              label="Shipping Method"
              placeholder="e.g., standard, express"
            ></app-input>

            <!-- Purchase order specific -->
            <app-input
              formControlName="payment_terms"
              label="Payment Terms"
              placeholder="e.g., NET 30, NET 60"
              [hidden]="orderForm.get('order_type')?.value !== 'PURCHASE'"
            ></app-input>

            <!-- Return order specific -->
            <app-selector
              formControlName="return_type"
              label="Return Type"
              placeholder="Select return type"
              [options]="getReturnTypeOptions()"
              [hidden]="orderForm.get('order_type')?.value !== 'RETURN'"
            ></app-selector>

            <app-selector
              formControlName="return_reason"
              label="Return Reason"
              placeholder="Select return reason"
              [options]="getReturnReasonOptions()"
              [hidden]="orderForm.get('order_type')?.value !== 'RETURN'"
            ></app-selector>

            <app-selector
              formControlName="refund_method"
              label="Refund Method"
              placeholder="Select refund method"
              [options]="getRefundMethodOptions()"
              [hidden]="orderForm.get('order_type')?.value !== 'RETURN'"
            ></app-selector>

            <app-selector
              formControlName="currency"
              label="Currency"
              placeholder="Select currency"
              [options]="currencyOptions"
            ></app-selector>
          </div>
        </div>

        <!-- Order Items -->
        <div class="space-y-4">
          <div class="flex justify-between items-center">
            <h3
              class="text-lg font-semibold text-text-primary border-b border-border pb-2"
            >
              Order Items
            </h3>
            <app-button
              variant="outline"
              size="sm"
              (clicked)="addItem()"
              [disabled]="items.length >= 10"
            >
              <app-icon name="plus" [size]="16" slot="icon"></app-icon>
              Add Item
            </app-button>
          </div>

          <div formArrayName="items" class="space-y-3">
            <div
              *ngFor="let itemGroup of itemsArray.controls; let i = index"
              [formGroupName]="i"
              class="border border-border rounded-lg p-4 bg-surface/50"
            >
              <div class="space-y-4">
                <!-- Basic product info -->
                <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <app-product-selector
                    [storeId]="selectedStoreId"
                    [label]="'Product'"
                    [required]="true"
                    (productSelected)="onProductSelected($event, i)"
                    (inventoryChecked)="onInventoryChecked($event, i)"
                  ></app-product-selector>

                  <app-input
                    formControlName="product_name"
                    label="Product Name"
                    placeholder="Product name"
                    [required]="true"
                  ></app-input>

                  <app-input
                    formControlName="product_variant_id"
                    label="Variant ID"
                    type="number"
                    placeholder="Enter variant ID (optional)"
                  ></app-input>
                </div>

                <!-- Quantity and pricing -->
                <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <app-input
                    formControlName="quantity"
                    label="Quantity"
                    type="number"
                    placeholder="1"
                    [required]="true"
                    (input)="calculateItemTotal(i)"
                  ></app-input>

                  <app-input
                    formControlName="unit_price"
                    label="Unit Price"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    [required]="true"
                    (input)="calculateItemTotal(i)"
                  ></app-input>

                  <app-input
                    formControlName="total_price"
                    label="Total Price"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    [readonly]="true"
                  ></app-input>

                  <app-input
                    formControlName="discount_percentage"
                    label="Discount %"
                    type="number"
                    step="0.01"
                    placeholder="0"
                    min="0"
                    max="100"
                  ></app-input>
                </div>

                <!-- Tax and location -->
                <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <app-input
                    formControlName="tax_rate"
                    label="Tax Rate"
                    type="number"
                    step="0.01"
                    placeholder="0.10"
                    (input)="calculateItemTotal(i)"
                  ></app-input>

                  <app-input
                    formControlName="tax_amount_item"
                    label="Tax Amount"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    [readonly]="true"
                  ></app-input>

                  <app-input
                    formControlName="location_id"
                    label="Location ID"
                    type="number"
                    placeholder="Enter location ID"
                    [hidden]="
                      orderForm.get('order_type')?.value !== 'PURCHASE' &&
                      orderForm.get('order_type')?.value !== 'TRANSFER'
                    "
                  ></app-input>
                </div>

                <!-- Return order specific fields -->
                <div
                  class="grid grid-cols-1 md:grid-cols-4 gap-4"
                  [hidden]="orderForm.get('order_type')?.value !== 'RETURN'"
                >
                  <app-input
                    formControlName="order_item_id"
                    label="Order Item ID"
                    type="number"
                    placeholder="Original order item ID"
                  ></app-input>

                  <app-input
                    formControlName="quantity_returned"
                    label="Quantity Returned"
                    type="number"
                    placeholder="1"
                    [required]="orderForm.get('order_type')?.value === 'RETURN'"
                  ></app-input>

                  <app-selector
                    formControlName="return_reason"
                    label="Return Reason"
                    placeholder="Select reason"
                    [options]="getReturnReasonOptions()"
                    [required]="orderForm.get('order_type')?.value === 'RETURN'"
                  ></app-selector>

                  <app-selector
                    formControlName="condition_on_return"
                    label="Condition on Return"
                    placeholder="Select condition"
                    [options]="getConditionOptions()"
                    [required]="orderForm.get('order_type')?.value === 'RETURN'"
                  ></app-selector>
                </div>

                <!-- Return specific fields continued -->
                <div
                  class="grid grid-cols-1 md:grid-cols-3 gap-4"
                  [hidden]="orderForm.get('order_type')?.value !== 'RETURN'"
                >
                  <app-input
                    formControlName="refund_amount"
                    label="Refund Amount"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                  ></app-input>

                  <div class="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="restock_{{ i }}"
                      formControlName="restock"
                      class="mr-2"
                    />
                    <label
                      for="restock_{{ i }}"
                      class="text-sm text-text-primary"
                    >
                      Restock Item
                    </label>
                  </div>

                  <app-input
                    formControlName="notes"
                    label="Item Notes"
                    placeholder="Additional notes for this item"
                  ></app-input>
                </div>

                <!-- Remove button -->
                <div class="flex justify-end">
                  <app-button
                    variant="outline"
                    size="sm"
                    (clicked)="removeItem(i)"
                    [disabled]="items.length <= 1"
                  >
                    <app-icon name="trash-2" [size]="16" slot="icon"></app-icon>
                    Remove Item
                  </app-button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Shipping Address -->
        <div class="space-y-4">
          <h3
            class="text-lg font-semibold text-text-primary border-b border-border pb-2"
          >
            Shipping Address
          </h3>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <app-input
              formControlName="shipping_street"
              label="Street Address"
              placeholder="123 Main St"
            ></app-input>

            <app-input
              formControlName="shipping_city"
              label="City"
              placeholder="New York"
            ></app-input>

            <app-input
              formControlName="shipping_state"
              label="State/Province"
              placeholder="NY"
            ></app-input>

            <app-input
              formControlName="shipping_postal_code"
              label="Postal Code"
              placeholder="10001"
            ></app-input>

            <app-input
              formControlName="shipping_country"
              label="Country"
              placeholder="United States"
            ></app-input>

            <div class="flex items-center">
              <input
                type="checkbox"
                id="sameAsBilling"
                formControlName="sameAsBilling"
                class="mr-2"
              />
              <label for="sameAsBilling" class="text-sm text-text-primary">
                Same as billing address
              </label>
            </div>
          </div>
        </div>

        <!-- Billing Address -->
        <div class="space-y-4" [hidden]="orderForm.get('sameAsBilling')?.value">
          <h3
            class="text-lg font-semibold text-text-primary border-b border-border pb-2"
          >
            Billing Address
          </h3>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <app-input
              formControlName="billing_street"
              label="Street Address"
              placeholder="123 Main St"
            ></app-input>

            <app-input
              formControlName="billing_city"
              label="City"
              placeholder="New York"
            ></app-input>

            <app-input
              formControlName="billing_state"
              label="State/Province"
              placeholder="NY"
            ></app-input>

            <app-input
              formControlName="billing_postal_code"
              label="Postal Code"
              placeholder="10001"
            ></app-input>

            <app-input
              formControlName="billing_country"
              label="Country"
              placeholder="United States"
            ></app-input>
          </div>
        </div>

        <!-- Financial Information -->
        <div class="space-y-4">
          <h3
            class="text-lg font-semibold text-text-primary border-b border-border pb-2"
          >
            Financial Information
          </h3>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <app-input
              formControlName="discount_amount"
              label="Discount Amount"
              type="number"
              step="0.01"
              placeholder="0.00"
            ></app-input>

            <app-input
              formControlName="tax_amount"
              label="Tax Amount"
              type="number"
              step="0.01"
              placeholder="0.00"
            ></app-input>

            <app-input
              formControlName="shipping_cost"
              label="Shipping Cost"
              type="number"
              step="0.01"
              placeholder="0.00"
            ></app-input>
          </div>
        </div>

        <!-- Order Notes -->
        <div class="space-y-4">
          <h3
            class="text-lg font-semibold text-text-primary border-b border-border pb-2"
          >
            Additional Information
          </h3>

          <div class="grid grid-cols-1 gap-4">
            <app-input
              formControlName="notes"
              label="Order Notes"
              placeholder="Enter any additional notes or special instructions..."
              [control]="orderForm.get('notes')"
            ></app-input>
          </div>
        </div>
      </form>

      <div slot="footer" class="flex justify-end space-x-3">
        <app-button variant="outline" (clicked)="onCancel()">
          <app-icon name="close" [size]="16" slot="icon"></app-icon>
          Cancel
        </app-button>

        <app-button
          variant="primary"
          (clicked)="onSubmit()"
          [disabled]="!orderForm.valid || isSubmitting"
          [loading]="isSubmitting"
        >
          <app-icon name="cart" [size]="16" slot="icon"></app-icon>
          Create Order
        </app-button>
      </div>
    </app-modal>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class OrderCreateModalComponent {
  @Input() isOpen = false;
  @Input() storeOptions: Array<{ label: string; value: string }> = [];
  @Input() selectedStoreId: number | null = null;
  @Output() openChange = new EventEmitter<boolean>();
  @Output() orderCreated = new EventEmitter<CreateOrderDto>();

  orderForm!: FormGroup;
  isSubmitting = false;
  items: Array<{
    product_id: string;
    quantity: number;
    unit_price?: number;
    product?: any;
  }> = [{ product_id: '', quantity: 1 }];

  orderTypeOptions = [
    { label: 'Sale', value: OrderType.SALE },
    { label: 'Purchase', value: OrderType.PURCHASE },
    { label: 'Transfer', value: OrderType.TRANSFER },
    { label: 'Return', value: OrderType.RETURN },
  ];

  currencyOptions = [
    { label: 'USD - US Dollar', value: 'USD' },
    { label: 'EUR - Euro', value: 'EUR' },
    { label: 'GBP - British Pound', value: 'GBP' },
    { label: 'JPY - Japanese Yen', value: 'JPY' },
    { label: 'MXN - Mexican Peso', value: 'MXN' },
  ];

  getStatusOptions() {
    return [
      { label: 'Draft', value: 'draft' },
      { label: 'Confirmed', value: 'confirmed' },
      { label: 'Processing', value: 'processing' },
      { label: 'Shipped', value: 'shipped' },
      { label: 'Delivered', value: 'delivered' },
      { label: 'Cancelled', value: 'cancelled' },
      { label: 'Refunded', value: 'refunded' },
      { label: 'Finished', value: 'finished' },
    ];
  }

  getPaymentStatusOptions() {
    return [
      { label: 'Pending', value: 'pending' },
      { label: 'Paid', value: 'paid' },
      { label: 'Failed', value: 'failed' },
      { label: 'Refunded', value: 'refunded' },
      { label: 'Partially Refunded', value: 'partially_refunded' },
    ];
  }

  getReturnTypeOptions() {
    return [
      { label: 'Refund', value: 'refund' },
      { label: 'Replacement', value: 'replacement' },
      { label: 'Store Credit', value: 'credit' },
    ];
  }

  getReturnReasonOptions() {
    return [
      { label: 'Defective', value: 'defective' },
      { label: 'Wrong Item', value: 'wrong_item' },
      { label: 'Damaged in Shipping', value: 'damaged_shipping' },
      { label: 'Customer Dissatisfaction', value: 'customer_dissatisfaction' },
      { label: 'Expired', value: 'expired' },
      { label: 'Other', value: 'other' },
    ];
  }

  getRefundMethodOptions() {
    return [
      { label: 'Original Payment', value: 'original_payment' },
      { label: 'Store Credit', value: 'store_credit' },
      { label: 'Cash', value: 'cash' },
      { label: 'Bank Transfer', value: 'bank_transfer' },
    ];
  }

  getConditionOptions() {
    return [
      { label: 'New', value: 'new' },
      { label: 'Used', value: 'used' },
      { label: 'Damaged', value: 'damaged' },
      { label: 'Defective', value: 'defective' },
      { label: 'Missing Parts', value: 'missing_parts' },
    ];
  }

  constructor(
    private fb: FormBuilder,
    private http: HttpClient,
  ) {
    this.initializeForm();

    // Listen for order type changes to update validators
    this.orderForm.get('order_type')?.valueChanges.subscribe((orderType) => {
      this.updateValidators(orderType);
    });
  }

  private initializeForm(): void {
    this.orderForm = this.fb.group({
      // Common fields for all order types
      order_type: [OrderType.SALE, Validators.required],
      organization_id: ['', Validators.required],
      store_id: [''], // Will be conditionally required
      customer_id: [''], // Will be conditionally required
      order_date: [new Date().toISOString().split('T')[0]],
      expected_delivery_date: [''],
      status: ['draft'],
      payment_method: [''],
      payment_status: ['pending'],
      shipping_method: [''],
      shipping_cost: [0, [Validators.min(0)]],
      tax_amount: [0, [Validators.min(0)]],
      discount_amount: [0, [Validators.min(0)]],
      subtotal: [0, [Validators.min(0)]],
      total_amount: [0, [Validators.min(0)]],
      currency: ['USD', Validators.required],
      notes: [''],
      internal_notes: [''],
      internal_reference: [''],
      customer_reference: [''],

      // Address fields
      shipping_address_id: [''],
      billing_address_id: [''],
      sameAsBilling: [false],

      // Manual address fields (when address_id is not selected)
      shipping_street: [''],
      shipping_city: [''],
      shipping_state: [''],
      shipping_postal_code: [''],
      shipping_country: [''],
      billing_street: [''],
      billing_city: [''],
      billing_state: [''],
      billing_postal_code: [''],
      billing_country: [''],

      // Type-specific fields
      supplier_id: [''], // Will be conditionally required for Purchase Orders
      location_id: [''], // Will be conditionally required for Purchase Orders and Stock Transfers
      partner_id: [''], // Will be conditionally required for Return Orders
      return_type: ['refund'], // For Return Orders
      return_reason: [''], // For Return Orders
      refund_method: ['original_payment'], // For Return Orders
      payment_terms: [''], // For Purchase Orders

      // Items array
      items: this.fb.array([this.createItemGroup()]),
    });
  }

  private createItemGroup() {
    return this.fb.group({
      product_id: ['', Validators.required],
      product_variant_id: [''],
      product_name: ['', Validators.required],
      variant_sku: [''],
      variant_attributes: [''],
      quantity: [1, [Validators.required, Validators.min(1)]],
      unit_price: [0, [Validators.required, Validators.min(0)]],
      total_price: [0, [Validators.required, Validators.min(0)]],
      tax_rate: [0.1, [Validators.min(0), Validators.max(1)]],
      tax_amount_item: [0, [Validators.min(0)]],
      discount_percentage: [0, [Validators.min(0), Validators.max(100)]],
      location_id: [''], // For purchase orders and stock transfers
      notes: [''],
      // Return order specific fields
      order_item_id: [''],
      quantity_returned: [1, [Validators.min(1)]],
      return_reason: ['defective'],
      condition_on_return: ['used'],
      refund_amount: [0, [Validators.min(0)]],
      restock: [true],
    });
  }

  get itemsArray() {
    return this.orderForm.get('items') as any;
  }

  addItem(): void {
    this.itemsArray.push(this.createItemGroup());
  }

  calculateItemTotal(index: number): void {
    const itemGroup = this.itemsArray.at(index);
    const quantity = itemGroup.get('quantity')?.value || 0;
    const unitPrice = itemGroup.get('unit_price')?.value || 0;
    const taxRate = itemGroup.get('tax_rate')?.value || 0;
    const discountPercentage = itemGroup.get('discount_percentage')?.value || 0;

    // Calculate subtotal after discount
    const subtotal = quantity * unitPrice;
    const discountAmount = subtotal * (discountPercentage / 100);
    const afterDiscount = subtotal - discountAmount;

    // Calculate tax
    const taxAmount = afterDiscount * taxRate;

    // Calculate total
    const total = afterDiscount + taxAmount;

    // Update form values
    itemGroup.get('total_price')?.setValue(total);
    itemGroup.get('tax_amount_item')?.setValue(taxAmount);

    // Calculate order totals
    this.calculateOrderTotals();
  }

  calculateOrderTotals(): void {
    const items = this.orderForm.get('items')?.value || [];
    const subtotal = items.reduce((sum: number, item: any) => {
      return sum + (item.total_price || 0);
    }, 0);

    const discountAmount = this.orderForm.get('discount_amount')?.value || 0;
    const taxAmount = this.orderForm.get('tax_amount')?.value || 0;
    const shippingCost = this.orderForm.get('shipping_cost')?.value || 0;

    const totalAmount = subtotal - discountAmount + taxAmount + shippingCost;

    this.orderForm.get('subtotal')?.setValue(subtotal);
    this.orderForm.get('total_amount')?.setValue(totalAmount);
  }

  removeItem(index: number): void {
    if (this.itemsArray.length > 1) {
      this.itemsArray.removeAt(index);
    }
  }

  onModalChange(isOpen: boolean): void {
    this.isOpen = isOpen;
    this.openChange.emit(isOpen);

    if (!isOpen) {
      this.resetForm();
    }
  }

  onCancel(): void {
    this.openChange.emit(false);
  }

  onSubmit(): void {
    console.log('Form valid:', this.orderForm.valid);
    console.log('Form value:', this.orderForm.value);
    console.log('Form errors:', this.orderForm.errors);

    if (this.orderForm.valid) {
      this.isSubmitting = true;

      const formValue = this.orderForm.value;
      const orderType = formValue.order_type;

      // Calculate totals
      const items = formValue.items.filter((item: any) => item.product_id);
      const subtotal = items.reduce((sum: number, item: any) => {
        return sum + (item.total_price || 0);
      }, 0);

      const discountAmount = formValue.discount_amount || 0;
      const taxAmount = formValue.tax_amount || 0;
      const shippingCost = formValue.shipping_cost || 0;
      const totalAmount = subtotal - discountAmount + taxAmount + shippingCost;

      // Build order items for backend
      const orderItems = items.map((item: any) => {
        const baseItem = {
          product_id: parseInt(item.product_id),
          product_variant_id: item.product_variant_id
            ? parseInt(item.product_variant_id)
            : undefined,
          product_name: item.product_name || `Product ${item.product_id}`,
          quantity: parseInt(item.quantity),
          unit_price: parseFloat(item.unit_price || 0),
          total_price: parseFloat(item.total_price || 0),
          tax_rate: parseFloat(item.tax_rate || 0),
          tax_amount_item: parseFloat(item.tax_amount_item || 0),
          discount_percentage: parseFloat(item.discount_percentage || 0),
          notes: item.notes || '',
        };

        // Add type-specific fields
        if (orderType === 'PURCHASE' || orderType === 'TRANSFER') {
          return {
            ...baseItem,
            location_id: item.location_id
              ? parseInt(item.location_id)
              : undefined,
          };
        }

        if (orderType === 'RETURN') {
          return {
            ...baseItem,
            order_item_id: item.order_item_id
              ? parseInt(item.order_item_id)
              : undefined,
            quantity_returned: parseInt(
              item.quantity_returned || item.quantity,
            ),
            return_reason: item.return_reason,
            condition_on_return: item.condition_on_return,
            refund_amount: parseFloat(
              item.refund_amount || item.total_price || 0,
            ),
            restock: Boolean(item.restock),
          };
        }

        return baseItem;
      });

      // Build order data based on type
      let orderData: any = {
        organization_id: parseInt(formValue.organization_id),
        order_type: orderType,
        items: orderItems,
        subtotal: subtotal,
        discount_amount: discountAmount,
        tax_amount: taxAmount,
        shipping_cost: shippingCost,
        total_amount: totalAmount,
        currency: formValue.currency,
        notes: formValue.notes,
        internal_notes: formValue.internal_notes,
        order_date: formValue.order_date,
        expected_delivery_date: formValue.expected_delivery_date,
      };

      // Add type-specific fields
      if (orderType === 'SALE') {
        orderData = {
          ...orderData,
          customer_id: parseInt(formValue.customer_id),
          store_id: parseInt(formValue.store_id),
          status: formValue.status || 'draft',
          payment_method: formValue.payment_method,
          payment_status: formValue.payment_status,
          shipping_method: formValue.shipping_method,
          shipping_address_id: formValue.shipping_address_id,
          billing_address_id: formValue.billing_address_id,
          customer_reference: formValue.customer_reference,
        };
      } else if (orderType === 'PURCHASE') {
        orderData = {
          ...orderData,
          supplier_id: parseInt(formValue.supplier_id),
          location_id: parseInt(formValue.location_id),
          status: formValue.status || 'draft',
          payment_terms: formValue.payment_terms,
          created_by_user_id: 1, // TODO: Get from auth service
        };
      } else if (orderType === 'TRANSFER') {
        orderData = {
          ...orderData,
          location_id: parseInt(formValue.location_id),
          status: formValue.status || 'draft',
        };
      } else if (orderType === 'RETURN') {
        orderData = {
          ...orderData,
          customer_id: parseInt(formValue.customer_id),
          store_id: formValue.store_id
            ? parseInt(formValue.store_id)
            : undefined,
          partner_id: formValue.partner_id
            ? parseInt(formValue.partner_id)
            : undefined,
          type: formValue.return_type,
          return_reason: formValue.return_reason,
          refund_method: formValue.refund_method,
          return_date: formValue.order_date,
          total_refund_amount: totalAmount,
        };
      }

      // Make API call based on order type
      let apiUrl = `${environment.apiUrl}/orders`;
      if (orderType === 'SALE') {
        apiUrl = `${environment.apiUrl}/sales-orders`;
      } else if (orderType === 'PURCHASE') {
        apiUrl = `${environment.apiUrl}/purchase-orders`;
      } else if (orderType === 'TRANSFER') {
        apiUrl = `${environment.apiUrl}/stock-transfers`;
      } else if (orderType === 'RETURN') {
        apiUrl = `${environment.apiUrl}/return-orders`;
      }

      this.http.post(apiUrl, orderData).subscribe({
        next: (response: any) => {
          this.orderCreated.emit(response.data || response);
          this.isSubmitting = false;
          this.openChange.emit(false);
          this.resetForm();
        },
        error: (error) => {
          console.error('Error creating order:', error);
          this.isSubmitting = false;
          // Handle error - show message to user
        },
      });
    }
  }

  onProductSelected(product: any, index: number): void {
    console.log('Product selected:', product, 'index:', index);
    // Actualizar el item con el producto seleccionado
    const itemsArray = this.orderForm.get('items') as any;
    const itemGroup = itemsArray.at(index);
    if (itemGroup) {
      itemGroup.patchValue({
        product_id: product.id,
        unit_price: product.price,
        quantity: itemGroup.value.quantity || 1,
        product: product, // Store the full product object
      });
    }
  }

  onInventoryChecked(inventory: any, index: number): void {
    console.log('Inventory checked:', inventory, 'index:', index);
    // Actualizar el item con la información de inventario
    const itemsArray = this.orderForm.get('items') as any;
    const itemGroup = itemsArray.at(index);
    if (itemGroup && inventory) {
      itemGroup.patchValue({
        available_stock: inventory.quantity,
        location_id: inventory.location_id,
      });
    }
  }

  private updateValidators(orderType: string): void {
    console.log('Updating validators for order type:', orderType);

    // Reset all conditional validators first
    this.orderForm.get('store_id')?.clearValidators();
    this.orderForm.get('customer_id')?.clearValidators();
    this.orderForm.get('supplier_id')?.clearValidators();
    this.orderForm.get('location_id')?.clearValidators();
    this.orderForm.get('partner_id')?.clearValidators();

    // Apply validators based on order type
    switch (orderType) {
      case 'SALE':
        this.orderForm.get('store_id')?.setValidators([Validators.required]);
        this.orderForm.get('customer_id')?.setValidators([Validators.required]);
        break;

      case 'PURCHASE':
        this.orderForm.get('supplier_id')?.setValidators([Validators.required]);
        this.orderForm.get('location_id')?.setValidators([Validators.required]);
        break;

      case 'TRANSFER':
        this.orderForm.get('location_id')?.setValidators([Validators.required]);
        break;

      case 'RETURN':
        this.orderForm.get('store_id')?.setValidators([Validators.required]);
        this.orderForm.get('customer_id')?.setValidators([Validators.required]);
        break;
    }

    // Update validation
    this.orderForm.get('store_id')?.updateValueAndValidity();
    this.orderForm.get('customer_id')?.updateValueAndValidity();
    this.orderForm.get('supplier_id')?.updateValueAndValidity();
    this.orderForm.get('location_id')?.updateValueAndValidity();
    this.orderForm.get('partner_id')?.updateValueAndValidity();

    console.log('Form valid after validator update:', this.orderForm.valid);
  }

  private resetForm(): void {
    this.orderForm.reset({
      order_type: OrderType.SALE,
      organization_id: '',
      store_id: '',
      customer_id: '',
      order_date: new Date().toISOString().split('T')[0],
      expected_delivery_date: '',
      status: 'draft',
      payment_method: '',
      payment_status: 'pending',
      shipping_method: '',
      shipping_cost: 0,
      tax_amount: 0,
      discount_amount: 0,
      subtotal: 0,
      total_amount: 0,
      currency: 'USD',
      notes: '',
      internal_notes: '',
      internal_reference: '',
      customer_reference: '',
      shipping_address_id: '',
      billing_address_id: '',
      sameAsBilling: false,
      supplier_id: '',
      location_id: '',
      partner_id: '',
      return_type: 'refund',
      return_reason: '',
      refund_method: 'original_payment',
      payment_terms: '',
      items: [this.createItemGroup()],
    });
  }
}
