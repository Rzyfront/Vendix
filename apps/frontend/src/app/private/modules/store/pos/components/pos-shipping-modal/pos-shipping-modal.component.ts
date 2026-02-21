import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnDestroy,
  OnChanges,
  SimpleChanges,
  ChangeDetectorRef,
  ViewChild,
  ElementRef,
} from '@angular/core';
import {
  FormBuilder,
  FormGroup,
  FormControl,
  Validators,
  ReactiveFormsModule,
  FormsModule,
} from '@angular/forms';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Subject, takeUntil, debounceTime } from 'rxjs';
import { environment } from '../../../../../../../environments/environment';

import {
  ModalComponent,
  InputComponent,
  IconComponent,
  TooltipComponent,
  SelectorComponent,
  SelectorOption,
} from '../../../../../../shared/components';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { CurrencyFormatService, CurrencyPipe } from '../../../../../../shared/pipes/currency';
import { CountryService, Department, City } from '../../../../../../services/country.service';
import { PosPaymentService, PaymentMethod } from '../../services/pos-payment.service';
import { PosShippingService } from '../../services/pos-shipping.service';
import { PosCustomerService } from '../../services/pos-customer.service';
import { CartState } from '../../models/cart.model';
import { PosCustomer } from '../../models/customer.model';
import {
  PosShippingMethod,
  PosShippingAddress,
  PosShippingPaymentMode,
} from '../../models/shipping.model';
import { PaymentRequest } from '../../models/payment.model';

@Component({
  selector: 'app-pos-shipping-modal',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    ModalComponent,
    InputComponent,
    IconComponent,
    TooltipComponent,
    SelectorComponent,
    CurrencyPipe,
  ],
  templateUrl: './pos-shipping-modal.component.html',
  styles: [
    `
      /* Content */
      .shipping-content {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

      /* Section Styling (shared with payment interface) */
      .payment-section {
        background: var(--color-surface);
        border-radius: 16px;
        border: 1px solid var(--color-border);
        padding: 16px;
      }

      .section-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 16px;
      }

      .section-indicator {
        width: 4px;
        height: 20px;
        background: var(--color-primary);
        border-radius: 2px;
      }

      .section-icon { color: var(--color-primary); }

      .section-title {
        font-size: 14px;
        font-weight: 600;
        color: var(--color-text-primary);
        margin: 0;
      }

      /* Product List */
      .product-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
        max-height: 120px;
        overflow-y: auto;
        margin-bottom: 12px;
      }

      .product-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 13px;
      }

      .product-name {
        color: var(--color-text-secondary);
        flex: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        margin-right: 8px;
      }

      .product-qty {
        color: var(--color-text-muted);
        font-weight: 500;
        flex-shrink: 0;
      }

      .empty-cart {
        text-align: center;
        color: var(--color-text-muted);
        font-size: 13px;
        font-style: italic;
        padding: 16px 0;
      }

      /* Summary */
      .summary-details {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding-top: 12px;
        margin-top: 12px;
        border-top: 1px solid var(--color-border);
      }

      .summary-row {
        display: flex;
        justify-content: space-between;
        font-size: 12px;
        color: var(--color-text-muted);
      }

      .summary-value {
        font-weight: 600;
        color: var(--color-text-secondary);
      }

      .summary-value.discount { color: var(--color-error); }
      .summary-value.shipping-cost-highlight { color: var(--color-primary); }

      .total-section { margin-top: 16px; padding-top: 16px; }

      .total-label {
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--color-text-muted);
        font-weight: 600;
        margin: 0;
      }

      .total-amount {
        font-size: 24px;
        font-weight: 700;
        color: var(--color-primary);
        margin: 4px 0 0 0;
      }

      /* Tabs */
      .tab-headers {
        display: flex;
        gap: 4px;
        margin-bottom: 16px;
        background: var(--color-background);
        border-radius: 10px;
        padding: 4px;
      }

      .tab-btn {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 10px 12px;
        border: none;
        border-radius: 8px;
        background: transparent;
        color: var(--color-text-muted);
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
      }

      .tab-btn:hover { color: var(--color-text-primary); }

      .tab-btn.active {
        background: var(--color-surface);
        color: var(--color-primary);
        box-shadow: 0 1px 3px rgba(0,0,0,0.08);
      }

      .tab-content { min-height: 200px; }

      /* Methods Grid */
      .payment-methods-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 12px;
      }

      .payment-method-btn {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 16px 12px;
        border: 1px solid var(--color-border);
        border-radius: 12px;
        background: var(--color-surface);
        cursor: pointer;
        transition: all 0.2s ease;
        color: var(--color-text-muted);
      }

      .payment-method-btn:hover {
        border-color: var(--color-primary);
        color: var(--color-primary);
      }

      .payment-method-btn.selected {
        border: 2px solid var(--color-primary);
        background: rgba(var(--color-primary-rgb), 0.05);
        color: var(--color-primary);
      }

      .method-name {
        font-size: 12px;
        font-weight: 600;
        margin-top: 8px;
        color: var(--color-text-primary);
        text-align: center;
        line-height: 1.2;
      }

      .no-methods {
        text-align: center;
        padding: 24px;
        color: var(--color-text-muted);
      }

      .no-methods p { font-size: 13px; margin: 8px 0; }

      /* Address Form */
      .address-form {
        margin-top: 16px;
        padding-top: 16px;
        border-top: 1px solid var(--color-border);
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .form-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }

      /* Shipping Cost Section */
      .shipping-cost-section {
        margin-top: 16px;
        padding-top: 16px;
        border-top: 1px solid var(--color-border);
      }

      .calculating-indicator {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 12px;
        color: var(--color-text-muted);
        font-size: 13px;
      }

      .spinner-sm {
        width: 16px;
        height: 16px;
        border: 2px solid var(--color-border);
        border-top-color: var(--color-primary);
        border-radius: 50%;
        animation: spin 1s linear infinite;
      }

      .cost-display { display: flex; flex-direction: column; gap: 12px; }

      .calculated-cost {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 12px;
        background: rgba(var(--color-success-rgb), 0.1);
        border: 1px solid rgba(var(--color-success-rgb), 0.3);
        border-radius: 10px;
      }

      .cost-label {
        font-size: 13px;
        color: var(--color-text-secondary);
        font-weight: 500;
      }

      .cost-value {
        font-size: 16px;
        font-weight: 700;
        color: var(--color-success);
      }

      .manual-toggle {
        display: flex;
        align-items: center;
      }

      .toggle-label {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
        color: var(--color-text-secondary);
        cursor: pointer;
      }

      .toggle-label input[type="checkbox"] {
        accent-color: var(--color-primary);
        width: 16px;
        height: 16px;
      }

      .manual-cost-input { margin-top: 4px; }

      /* Cash input (shared with payment interface) */
      .cash-input {
        display: flex;
        align-items: center;
        background: var(--color-background);
        border: 2px solid var(--color-border);
        border-radius: 10px;
        padding: 8px 12px;
        transition: border-color 0.2s;
      }

      .cash-input:focus-within { border-color: var(--color-primary); }
      .cash-input.error { border-color: var(--color-error); background: rgba(var(--color-error-rgb), 0.05); }

      .cash-input .currency {
        font-size: 16px;
        font-weight: 600;
        color: var(--color-text-secondary);
        margin-right: 4px;
      }

      .cash-input input {
        flex: 1;
        border: none;
        background: transparent;
        font-size: 18px;
        font-weight: 700;
        color: var(--color-text-primary);
        outline: none;
        width: 100%;
        min-width: 0;
      }

      .cash-input.error input { color: var(--color-error); }

      .error-text {
        display: block;
        font-size: 11px;
        color: var(--color-error);
        font-weight: 500;
        margin-top: 4px;
      }

      /* Cash section */
      .cash-section {
        margin-top: 16px;
        padding-top: 16px;
        border-top: 1px solid var(--color-border);
      }

      .cash-inputs {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
        margin-bottom: 12px;
      }

      .cash-input-group label {
        display: block;
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        color: var(--color-text-muted);
        margin-bottom: 6px;
      }

      .change-display {
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: rgba(var(--color-success-rgb), 0.1);
        border: 2px solid rgba(var(--color-success-rgb), 0.3);
        border-radius: 10px;
        padding: 8px 12px;
        height: 44px;
      }

      .change-display span { font-size: 16px; font-weight: 700; color: var(--color-success); }
      .change-display app-icon { color: var(--color-success); }

      .quick-amounts {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        margin-bottom: 12px;
      }

      .quick-btn {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 12px;
        border: 2px solid var(--color-border);
        border-radius: 10px;
        background: var(--color-surface);
        font-size: 13px;
        font-weight: 600;
        color: var(--color-text-primary);
        cursor: pointer;
        transition: all 0.2s;
      }

      .quick-btn:hover { border-color: var(--color-primary); }

      .quick-btn.primary {
        border-color: var(--color-primary);
        background: rgba(var(--color-primary-rgb), 0.05);
      }

      .quick-btn .quick-value { color: var(--color-primary); }
      .quick-btn.primary app-icon { color: var(--color-primary); }

      .keypad {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
      }

      .keypad-btn {
        padding: 14px;
        font-size: 18px;
        font-weight: 600;
        border: 1px solid var(--color-border);
        border-radius: 10px;
        background: var(--color-surface);
        color: var(--color-text-primary);
        cursor: pointer;
        transition: all 0.15s;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .keypad-btn:hover { background: var(--color-muted); }
      .keypad-btn:active { transform: scale(0.95); }
      .keypad-btn.clear { color: var(--color-error); border-color: rgba(var(--color-error-rgb), 0.3); }
      .keypad-btn.clear:hover { background: rgba(var(--color-error-rgb), 0.1); }

      .reference-section { margin-top: 16px; text-align: center; }

      .reference-header { margin-bottom: 16px; }
      .reference-header app-icon { color: var(--color-primary); margin-bottom: 8px; }
      .reference-header p { font-size: 13px; color: var(--color-text-secondary); margin: 0; }

      /* Sale type / radio buttons */
      .sale-type-options { display: flex; flex-direction: column; gap: 12px; }

      .sale-type-btn {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 14px;
        border: 2px solid var(--color-border);
        border-radius: 12px;
        background: var(--color-surface);
        cursor: pointer;
        transition: all 0.2s;
        width: 100%;
        text-align: left;
      }

      .sale-type-btn:hover { border-color: var(--color-primary); }

      .sale-type-btn.selected {
        border-color: var(--color-primary);
        background: rgba(var(--color-primary-rgb), 0.05);
      }

      .radio-indicator {
        width: 20px;
        height: 20px;
        border: 2px solid var(--color-border);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }

      .sale-type-btn.selected .radio-indicator { border-color: var(--color-primary); }

      .radio-dot {
        width: 10px;
        height: 10px;
        background: var(--color-primary);
        border-radius: 50%;
      }

      .sale-type-btn app-icon { color: var(--color-text-muted); flex-shrink: 0; }
      .sale-type-btn.selected app-icon { color: var(--color-primary); }

      .sale-type-info { flex: 1; min-width: 0; }

      .sale-type-name { display: block; font-size: 13px; font-weight: 600; color: var(--color-text-primary); }
      .sale-type-desc { display: block; font-size: 11px; color: var(--color-text-muted); margin-top: 2px; }

      /* Customer section */
      .selected-customer {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px;
        background: rgba(var(--color-success-rgb), 0.1);
        border-radius: 10px;
      }

      .customer-avatar {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        background: var(--color-success);
        color: white;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }

      .customer-info { flex: 1; min-width: 0; }
      .customer-name { display: block; font-size: 13px; font-weight: 600; color: var(--color-text-primary); }
      .customer-email { display: block; font-size: 11px; color: var(--color-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

      .change-customer-btn {
        width: 32px;
        height: 32px;
        border-radius: 8px;
        border: none;
        background: var(--color-surface);
        color: var(--color-text-muted);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
        flex-shrink: 0;
      }

      .change-customer-btn:hover { color: var(--color-primary); }

      .select-customer-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        width: 100%;
        padding: 14px;
        border: 2px dashed var(--color-border);
        border-radius: 12px;
        background: transparent;
        color: var(--color-text-muted);
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
      }

      .select-customer-btn:hover { border-color: var(--color-primary); color: var(--color-primary); }

      .customer-selector { margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--color-border); }

      .selector-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
      }

      .selector-header span { font-size: 12px; font-weight: 600; text-transform: uppercase; color: var(--color-text-muted); }
      .selector-header button { background: none; border: none; color: var(--color-text-muted); cursor: pointer; padding: 4px; }

      .search-results { display: flex; flex-direction: column; gap: 8px; max-height: 150px; overflow-y: auto; margin-top: 12px; }

      .customer-result {
        display: flex;
        flex-direction: column;
        padding: 12px;
        border: 1px solid var(--color-border);
        border-radius: 10px;
        background: var(--color-surface);
        cursor: pointer;
        transition: all 0.2s;
        text-align: left;
        width: 100%;
      }

      .customer-result:hover { border-color: var(--color-primary); }
      .result-name { font-size: 13px; font-weight: 500; color: var(--color-text-primary); }
      .result-email { font-size: 11px; color: var(--color-text-secondary); }

      .create-customer-action { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--color-border); }

      .create-customer-btn {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 12px;
        background: var(--color-primary);
        color: white;
        border: none;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: filter 0.2s;
      }

      .create-customer-btn:hover { filter: brightness(1.1); }

      .create-customer-form { margin-top: 12px; display: flex; flex-direction: column; gap: 12px; }
      .create-customer-form h5 { font-size: 14px; font-weight: 600; color: var(--color-text-primary); margin: 0; }

      .form-actions { display: flex; gap: 8px; margin-top: 8px; }

      .btn-create {
        flex: 1;
        padding: 10px;
        background: var(--color-primary);
        color: white;
        border: none;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: filter 0.2s;
      }

      .btn-create:hover { filter: brightness(1.1); }

      .btn-cancel {
        flex: 1;
        padding: 10px;
        background: var(--color-surface);
        color: var(--color-text-primary);
        border: 1px solid var(--color-border);
        border-radius: 8px;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
      }

      /* Delivery Notes */
      .delivery-notes { margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--color-border); }

      /* Footer */
      .payment-footer { display: flex; flex-direction: column; gap: 12px; width: 100%; }
      .footer-row { display: flex; gap: 12px; }

      .btn-cancel-payment {
        flex: 1;
        padding: 12px;
        border: 1px solid rgba(var(--color-error-rgb), 0.3);
        border-radius: 12px;
        background: transparent;
        color: var(--color-error);
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.2s;
      }

      .btn-cancel-payment:hover:not(:disabled) { background: rgba(var(--color-error-rgb), 0.05); }
      .btn-cancel-payment:disabled { opacity: 0.5; cursor: not-allowed; }

      .btn-confirm {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        width: 100%;
        padding: 16px;
        background: var(--color-primary);
        color: white;
        border: none;
        border-radius: 12px;
        font-size: 16px;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.2s;
        box-shadow: 0 4px 12px rgba(var(--color-primary-rgb), 0.3);
      }

      .btn-confirm:hover:not(:disabled) { filter: brightness(1.05); transform: translateY(-1px); }
      .btn-confirm:active:not(:disabled) { transform: scale(0.98); }
      .btn-confirm:disabled { opacity: 0.5; cursor: not-allowed; box-shadow: none; }

      .spinner {
        width: 20px;
        height: 20px;
        border: 2px solid white;
        border-top-color: transparent;
        border-radius: 50%;
        animation: spin 1s linear infinite;
      }

      @keyframes spin { to { transform: rotate(360deg); } }

      /* Desktop: 3-column horizontal layout */
      @media (min-width: 1024px) {
        .shipping-content {
          display: grid;
          grid-template-columns: 3fr 5fr 4fr;
          gap: 16px;
          height: 100%;
          min-height: 0;
        }

        .payment-section {
          display: flex;
          flex-direction: column;
          overflow-y: auto;
          height: 100%;
        }

        .product-list { max-height: none; flex: 1; }
        .search-results { max-height: 200px; }
      }

      @media (max-width: 480px) {
        .shipping-content { gap: 12px; }
        .payment-section { padding: 14px; }
        .total-amount { font-size: 22px; }
        .keypad-btn { padding: 12px; font-size: 16px; }
        .btn-confirm { padding: 14px; font-size: 15px; }
      }

      /* Validation flash warning animation */
      @keyframes configFlashWarning {
        0%   { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0);   border-color: transparent; }
        15%  { box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.4); border-color: #f59e0b; }
        30%  { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0);   border-color: transparent; }
        55%  { box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.4); border-color: #f59e0b; }
        70%  { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0);   border-color: transparent; }
        100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0);   border-color: transparent; }
      }

      .config-flash-warning {
        animation: configFlashWarning 1.2s ease-out;
        border: 2px solid transparent;
        border-radius: 12px;
      }
    `,
  ],
})
export class PosShippingModalComponent implements OnInit, OnDestroy, OnChanges {
  @Input() isOpen = false;
  @Input() cartState: CartState | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() shippingCompleted = new EventEmitter<any>();
  @Output() customerSelected = new EventEmitter<PosCustomer>();

  // Section refs for scroll-to-validation
  @ViewChild('shippingMethodSection') shippingMethodSection!: ElementRef;
  @ViewChild('addressSection') addressSection!: ElementRef;
  @ViewChild('customerSection') customerSection!: ElementRef;
  @ViewChild('paymentSection') paymentSection!: ElementRef;

  // Validation warning flash state
  validationWarningSection: 'shipping-method' | 'address' | 'customer' | 'payment' | null = null;
  validationWarningMessage = '';
  private validationWarningTimeout: any;

  // Tab state
  activeTab: 'shipping' | 'payment' = 'shipping';

  // Shipping state
  shippingMethods: PosShippingMethod[] = [];
  selectedShippingMethod: PosShippingMethod | null = null;
  shippingCost = 0;
  calculatedShippingCost: number | null = null;
  manualCostOverride = false;
  isCalculatingShipping = false;

  // Payment state
  paymentMode: PosShippingPaymentMode = 'on_delivery';
  paymentMethods: PaymentMethod[] = [];
  selectedPaymentMethod: PaymentMethod | null = null;
  cashReceived = 0;
  cashChange = 0;

  // Customer state
  showCustomerSelector = false;
  customerSearchResults: PosCustomer[] = [];
  showCreateCustomerForm = false;
  isSearchingCustomer = false;

  // Processing
  isProcessing = false;

  // Address auto-fill state
  selectedCustomerAddressId: number | null = null;

  // Location dropdowns (API Colombia)
  departments: Department[] = [];
  cities: City[] = [];
  selectedDepartmentId: number | null = null;
  selectedCityId: number | null = null;

  // Forms
  addressForm: FormGroup;
  customerForm: FormGroup;
  paymentForm: FormGroup;

  currencySymbol: any;

  private destroy$ = new Subject<void>();
  private customerSearchSubject = new Subject<string>();

  get addressLine1Control(): FormControl {
    return this.addressForm.get('address_line1') as FormControl;
  }

  get cityControl(): FormControl {
    return this.addressForm.get('city') as FormControl;
  }

  get stateProvinceControl(): FormControl {
    return this.addressForm.get('state_province') as FormControl;
  }

  get deliveryNotesControl(): FormControl {
    return this.addressForm.get('delivery_notes') as FormControl;
  }

  get cashReceivedControl(): FormControl {
    return this.paymentForm.get('cashReceived') as FormControl;
  }

  get referenceControl(): FormControl {
    return this.paymentForm.get('reference') as FormControl;
  }

  get customerEmailControl(): FormControl {
    return this.customerForm.get('email') as FormControl;
  }

  get customerFirstNameControl(): FormControl {
    return this.customerForm.get('firstName') as FormControl;
  }

  get customerLastNameControl(): FormControl {
    return this.customerForm.get('lastName') as FormControl;
  }

  get customerPhoneControl(): FormControl {
    return this.customerForm.get('phone') as FormControl;
  }

  get customerDisplayName(): string {
    if (!this.cartState?.customer) return 'Seleccionar cliente';
    const firstName = this.cartState.customer.first_name || '';
    const lastName = this.cartState.customer.last_name || '';
    return `${firstName} ${lastName}`.trim() || 'Cliente sin nombre';
  }

  get totalWithShipping(): number {
    return (this.cartState?.summary?.total || 0) + this.shippingCost;
  }

  get isCashInsufficient(): boolean {
    if (this.selectedPaymentMethod?.type !== 'cash') return false;
    return this.cashReceived < this.totalWithShipping;
  }

  get departmentOptions(): SelectorOption[] {
    return this.departments.map(d => ({ value: d.id, label: d.name }));
  }

  get cityOptions(): SelectorOption[] {
    return this.cities.map(c => ({ value: c.id, label: c.name }));
  }

  constructor(
    private fb: FormBuilder,
    private http: HttpClient,
    private paymentService: PosPaymentService,
    private shippingService: PosShippingService,
    private customerService: PosCustomerService,
    private toastService: ToastService,
    private cdr: ChangeDetectorRef,
    private currencyService: CurrencyFormatService,
    private countryService: CountryService,
  ) {
    this.addressForm = this.fb.group({
      address_line1: ['', Validators.required],
      city: ['', Validators.required],
      state_province: [''],
      delivery_notes: [''],
    });
    this.customerForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      firstName: ['', [Validators.required, Validators.minLength(2)]],
      lastName: ['', [Validators.required, Validators.minLength(2)]],
      phone: [''],
    });
    this.paymentForm = this.fb.group({
      cashReceived: [0, [Validators.required, Validators.min(0)]],
      reference: [''],
    });
    this.currencySymbol = this.currencyService.currencySymbol;
  }

  ngOnInit(): void {
    this.loadShippingMethods();
    this.loadPaymentMethods();
    this.setupFormListeners();
    this.currencyService.loadCurrency();
    this.loadDepartments();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.validationWarningTimeout) {
      clearTimeout(this.validationWarningTimeout);
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && changes['isOpen'].currentValue === true) {
      this.resetState();
    }
  }

  private resetState(): void {
    this.activeTab = 'shipping';
    this.selectedShippingMethod = null;
    this.shippingCost = 0;
    this.calculatedShippingCost = null;
    this.manualCostOverride = false;
    this.paymentMode = 'on_delivery';
    this.selectedPaymentMethod = null;
    this.cashReceived = 0;
    this.cashChange = 0;
    this.isProcessing = false;
    this.showCustomerSelector = false;
    this.customerSearchResults = [];
    this.showCreateCustomerForm = false;
    this.selectedCustomerAddressId = null;
    this.cities = [];
    this.selectedDepartmentId = null;
    this.selectedCityId = null;
    this.validationWarningSection = null;
    this.validationWarningMessage = '';
    if (this.validationWarningTimeout) {
      clearTimeout(this.validationWarningTimeout);
    }
    this.addressForm.reset();
    this.paymentForm.reset();
    this.customerForm.reset();
    this.cdr.markForCheck();
  }

  private loadShippingMethods(): void {
    this.shippingService
      .getShippingMethods()
      .pipe(takeUntil(this.destroy$))
      .subscribe((methods) => {
        this.shippingMethods = methods;
        this.cdr.markForCheck();
      });
  }

  private loadPaymentMethods(): void {
    this.paymentService
      .getPaymentMethods()
      .pipe(takeUntil(this.destroy$))
      .subscribe((methods) => {
        this.paymentMethods = methods;
        this.cdr.markForCheck();
      });
  }

  private setupFormListeners(): void {
    this.cashReceivedControl.valueChanges
      .pipe(takeUntil(this.destroy$), debounceTime(100))
      .subscribe((value: string | number | null) => {
        if (value !== null && value !== undefined && value !== '') {
          this.cashReceived = parseFloat(value.toString()) || 0;
          this.cashChange = Math.max(0, this.cashReceived - this.totalWithShipping);
        }
      });

    // Trigger shipping calculation when address changes
    this.addressForm.valueChanges
      .pipe(takeUntil(this.destroy$), debounceTime(500))
      .subscribe(() => {
        if (this.selectedShippingMethod && !this.manualCostOverride) {
          this.calculateShippingCost();
        }
      });

    // Debounced customer search (300ms)
    this.customerSearchSubject
      .pipe(takeUntil(this.destroy$), debounceTime(300))
      .subscribe((query) => this.executeCustomerSearch(query));
  }

  // --- Shipping Methods ---

  selectShippingMethod(method: PosShippingMethod): void {
    this.selectedShippingMethod = method;
    if (method.type === 'pickup') {
      this.shippingCost = 0;
      this.calculatedShippingCost = 0;
    } else {
      this.calculateShippingCost();
    }
    this.cdr.markForCheck();
  }

  getShippingIcon(type: string): string {
    const iconMap: Record<string, string> = {
      own_fleet: 'truck',
      carrier: 'package',
      pickup: 'store',
      custom: 'settings',
      third_party_provider: 'globe',
    };
    return iconMap[type] || 'truck';
  }

  private calculateShippingCost(): void {
    if (!this.selectedShippingMethod || !this.cartState?.items?.length) return;

    const address = this.addressForm.value;
    if (this.selectedShippingMethod.type !== 'pickup' && !address.city) return;

    this.isCalculatingShipping = true;
    this.cdr.markForCheck();

    const items = this.cartState.items.map((item) => ({
      product_id: parseInt(item.product.id),
      quantity: item.quantity,
      price: item.totalPrice,
    }));

    this.shippingService
      .calculateShipping(items, {
        country_code: 'CO', // Default for now
        city: address.city || undefined,
        state_province: address.state_province || undefined,
        address_line1: address.address_line1 || undefined,
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (options) => {
          this.isCalculatingShipping = false;
          const matchingOption = options.find(
            (o) => o.method_id === this.selectedShippingMethod!.id,
          );
          if (matchingOption) {
            this.calculatedShippingCost = matchingOption.cost;
            if (!this.manualCostOverride) {
              this.shippingCost = matchingOption.cost;
            }
          } else if (options.length > 0) {
            this.calculatedShippingCost = options[0].cost;
            if (!this.manualCostOverride) {
              this.shippingCost = options[0].cost;
            }
          } else {
            // No rates found, let user enter manually
            this.calculatedShippingCost = null;
            this.manualCostOverride = true;
            this.shippingCost = 0;
          }
          this.cdr.markForCheck();
        },
        error: () => {
          this.isCalculatingShipping = false;
          this.calculatedShippingCost = null;
          this.manualCostOverride = true;
          this.shippingCost = 0;
          this.cdr.markForCheck();
        },
      });
  }

  toggleManualCost(): void {
    this.manualCostOverride = !this.manualCostOverride;
    if (!this.manualCostOverride && this.calculatedShippingCost !== null) {
      this.shippingCost = this.calculatedShippingCost;
    }
  }

  onManualCostChange(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.shippingCost = parseFloat(value) || 0;
  }

  // --- Location Dropdowns (API Colombia) ---

  private async loadDepartments(): Promise<void> {
    this.departments = await this.countryService.getDepartments();
    this.cdr.markForCheck();
  }

  async onDepartmentChange(departmentId: number): Promise<void> {
    this.selectedDepartmentId = departmentId || null;
    const dept = this.departments.find(d => d.id === departmentId);
    this.addressForm.patchValue({ state_province: dept?.name || '' });

    // Reset city
    this.cities = [];
    this.selectedCityId = null;
    this.addressForm.patchValue({ city: '' });

    if (departmentId) {
      this.cities = await this.countryService.getCitiesByDepartment(departmentId);
      this.cdr.markForCheck();
    }
  }

  onCityChange(cityId: number): void {
    this.selectedCityId = cityId || null;
    const city = this.cities.find(c => c.id === cityId);
    this.addressForm.patchValue({ city: city?.name || '' });
  }

  // --- Payment ---

  setPaymentMode(mode: PosShippingPaymentMode): void {
    this.paymentMode = mode;
    if (mode === 'on_delivery') {
      this.selectedPaymentMethod = null;
    }
  }

  selectPaymentMethod(method: PaymentMethod): void {
    this.selectedPaymentMethod = method;
    this.paymentForm.reset();
    this.cashChange = 0;
    if (method.type === 'cash') {
      this.cashReceivedControl.setValue(this.totalWithShipping);
    }
  }

  setCashAmount(amount: number): void {
    this.cashReceivedControl.setValue(amount);
  }

  appendNumber(num: number): void {
    const current = this.cashReceivedControl.value || 0;
    const newValue = parseFloat(current.toString() + num.toString());
    this.cashReceivedControl.setValue(newValue);
  }

  backspace(): void {
    const current = this.cashReceivedControl.value;
    if (!current) return;
    const str = current.toString();
    this.cashReceivedControl.setValue(str.length <= 1 ? 0 : parseFloat(str.slice(0, -1)));
  }

  clearCashAmount(): void {
    this.cashReceivedControl.setValue(0);
  }

  // --- Customer ---

  openCustomerSelector(): void {
    this.showCustomerSelector = true;
    this.showCreateCustomerForm = false;
  }

  closeCustomerSelector(): void {
    this.showCustomerSelector = false;
    this.showCreateCustomerForm = false;
    this.customerSearchResults = [];
  }

  onCustomerSearch(query: string): void {
    this.customerSearchSubject.next(query);
  }

  private executeCustomerSearch(query: string): void {
    if (query && query.trim().length >= 2) {
      this.isSearchingCustomer = true;
      this.customerService
        .searchCustomers({ query: query.trim(), limit: 10 })
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (response) => {
            this.customerSearchResults = response.data || [];
            this.isSearchingCustomer = false;
            this.cdr.markForCheck();
          },
          error: () => {
            this.customerSearchResults = [];
            this.isSearchingCustomer = false;
            this.toastService.show({
              variant: 'error',
              title: 'Error',
              description: 'Error al buscar clientes',
            });
          },
        });
    } else {
      this.customerSearchResults = [];
    }
  }

  async selectCustomer(customer: PosCustomer): Promise<void> {
    this.customerSelected.emit(customer);
    this.closeCustomerSelector();

    // Auto-fill address if customer has a shipping address
    const shippingAddress = customer.addresses?.find(a => a.is_primary) || customer.addresses?.[0];
    if (shippingAddress) {
      this.addressForm.patchValue({
        address_line1: shippingAddress.address_line1,
      });
      this.selectedCustomerAddressId = shippingAddress.id;

      // Match department by name from API Colombia data
      if (shippingAddress.state_province) {
        const dept = this.departments.find(d =>
          d.name.toLowerCase() === shippingAddress.state_province!.toLowerCase(),
        );
        if (dept) {
          this.selectedDepartmentId = dept.id;
          this.addressForm.patchValue({ state_province: dept.name });
          this.cities = await this.countryService.getCitiesByDepartment(dept.id);

          if (shippingAddress.city) {
            const city = this.cities.find(c =>
              c.name.toLowerCase() === shippingAddress.city!.toLowerCase(),
            );
            if (city) {
              this.selectedCityId = city.id;
              this.addressForm.patchValue({ city: city.name });
            }
          }
        } else {
          // Fallback: set the raw text values if no API match
          this.addressForm.patchValue({
            state_province: shippingAddress.state_province || '',
            city: shippingAddress.city || '',
          });
        }
      }

      this.cdr.markForCheck();

      // Trigger shipping calculation if method is selected
      if (this.selectedShippingMethod && !this.manualCostOverride) {
        this.calculateShippingCost();
      }
    } else {
      this.addressForm.reset();
      this.selectedCustomerAddressId = null;
      this.selectedDepartmentId = null;
      this.selectedCityId = null;
      this.cities = [];
    }
  }

  onCreateCustomer(): void {
    if (this.customerForm.valid) {
      const formValue = this.customerForm.value;
      this.isSearchingCustomer = true;

      this.customerService
        .createQuickCustomer({
          email: formValue.email,
          first_name: formValue.firstName,
          last_name: formValue.lastName,
          phone: formValue.phone || undefined,
        })
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (customer) => {
            this.isSearchingCustomer = false;
            this.customerSelected.emit(customer);
            this.closeCustomerSelector();
            this.toastService.success('Cliente creado correctamente');
          },
          error: (error) => {
            this.isSearchingCustomer = false;
            this.toastService.show({
              variant: 'error',
              title: 'Error',
              description: error.error?.message || error.message || 'Error al crear cliente',
            });
          },
        });
    } else {
      Object.keys(this.customerForm.controls).forEach((key) => {
        this.customerForm.get(key)?.markAsTouched();
      });
      this.toastService.info('Por favor completa los campos requeridos');
    }
  }

  // --- Validation & Confirm ---

  canConfirm(): boolean {
    if (!this.selectedShippingMethod) return false;
    if (!this.cartState?.customer) return false;
    if (!this.cartState?.items?.length) return false;

    // Address required for non-pickup
    if (this.selectedShippingMethod.type !== 'pickup') {
      const addr = this.addressForm.value;
      if (!addr.address_line1 || !addr.city) return false;
    }

    // If pay_now, need a valid payment method
    if (this.paymentMode === 'pay_now') {
      if (!this.selectedPaymentMethod) return false;
      if (this.selectedPaymentMethod.type === 'cash' && this.isCashInsufficient) return false;
      if (this.selectedPaymentMethod.requiresReference) {
        const ref = this.referenceControl.value;
        if (!ref || ref.trim().length < 4) return false;
      }
    }

    return true;
  }

  private getFirstValidationError(): { section: 'shipping-method' | 'address' | 'customer' | 'payment'; message: string } | null {
    if (!this.selectedShippingMethod) {
      return { section: 'shipping-method', message: 'Selecciona un método de envío' };
    }

    if (this.selectedShippingMethod.type !== 'pickup') {
      const addr = this.addressForm.value;
      if (!addr.address_line1 || !addr.city) {
        return { section: 'address', message: 'Completa la dirección de envío' };
      }
    }

    if (!this.cartState?.customer) {
      return { section: 'customer', message: 'Selecciona un cliente' };
    }

    if (this.paymentMode === 'pay_now') {
      if (!this.selectedPaymentMethod) {
        return { section: 'payment', message: 'Selecciona un método de pago' };
      }
      if (this.selectedPaymentMethod.type === 'cash' && this.isCashInsufficient) {
        return { section: 'payment', message: 'El monto recibido es insuficiente' };
      }
      if (this.selectedPaymentMethod.requiresReference) {
        const ref = this.referenceControl.value;
        if (!ref || ref.trim().length < 4) {
          return { section: 'payment', message: 'Ingresa la referencia de pago' };
        }
      }
    }

    return null;
  }

  private flashValidationWarning(section: 'shipping-method' | 'address' | 'customer' | 'payment', message: string): void {
    // Turn off first to allow animation re-trigger (POP pattern)
    this.validationWarningSection = null;
    if (this.validationWarningTimeout) {
      clearTimeout(this.validationWarningTimeout);
    }

    // Switch tab if the section is in a different tab
    if (section === 'shipping-method' || section === 'address') {
      this.activeTab = 'shipping';
    } else if (section === 'payment') {
      this.activeTab = 'payment';
    }

    setTimeout(() => {
      this.validationWarningSection = section;
      this.validationWarningMessage = message;
      this.cdr.markForCheck();

      // Scroll to the relevant section
      const sectionRef = this.getSectionRef(section);
      if (sectionRef) {
        sectionRef.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }

      this.validationWarningTimeout = setTimeout(() => {
        this.validationWarningSection = null;
        this.validationWarningMessage = '';
        this.cdr.markForCheck();
      }, 3000);
    }, 0);
  }

  private getSectionRef(section: string): ElementRef | undefined {
    const map: Record<string, ElementRef> = {
      'shipping-method': this.shippingMethodSection,
      'address': this.addressSection,
      'customer': this.customerSection,
      'payment': this.paymentSection,
    };
    return map[section];
  }

  confirmShipping(): void {
    if (this.isProcessing) return;

    if (!this.canConfirm()) {
      const error = this.getFirstValidationError();
      if (error) {
        this.flashValidationWarning(error.section, error.message);
      }
      return;
    }

    if (!this.cartState || !this.selectedShippingMethod) return;

    this.isProcessing = true;

    const deliveryType =
      this.selectedShippingMethod.type === 'pickup' ? 'pickup' : 'home_delivery';

    const address = this.addressForm.value;
    const shippingAddress: PosShippingAddress = {
      address_line1: address.address_line1 || '',
      city: address.city || '',
      state_province: address.state_province || '',
      country_code: 'CO',
      recipient_name: this.customerDisplayName,
      recipient_phone: this.cartState.customer?.phone || '',
    };

    let paymentRequest: PaymentRequest | null = null;
    if (this.paymentMode === 'pay_now' && this.selectedPaymentMethod) {
      paymentRequest = {
        orderId: 'ORDER_' + Date.now(),
        amount: this.totalWithShipping,
        paymentMethod: this.selectedPaymentMethod,
        cashReceived: this.cashReceived,
        reference: this.referenceControl.value || '',
      };
    }

    // If customer has no saved address and we have a new address, create it first
    if (!this.selectedCustomerAddressId && address.address_line1 && address.city && this.cartState.customer) {
      this.createAddressThenProcessOrder(address, shippingAddress, deliveryType, paymentRequest);
    } else {
      this.processOrder(shippingAddress, deliveryType, paymentRequest, this.selectedCustomerAddressId);
    }
  }

  private createAddressThenProcessOrder(
    address: any,
    shippingAddress: PosShippingAddress,
    deliveryType: string,
    paymentRequest: PaymentRequest | null,
  ): void {
    const customer = this.cartState!.customer!;
    const defaultCountryCode = this.countryService.getDefaultCountry();

    this.http.post<any>(`${environment.apiUrl}/store/addresses`, {
      customer_id: customer.id,
      address_line_1: address.address_line1,
      city: address.city,
      state: address.state_province || '',
      country: defaultCountryCode,
      type: 'shipping',
      is_primary: !customer.addresses?.length,
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (response) => {
        const newAddressId = response?.data?.id || response?.id || null;
        this.processOrder(shippingAddress, deliveryType, paymentRequest, newAddressId);
      },
      error: () => {
        // Fallback: process order without address ID
        this.processOrder(shippingAddress, deliveryType, paymentRequest, null);
      },
    });
  }

  private processOrder(
    shippingAddress: PosShippingAddress,
    deliveryType: string,
    paymentRequest: PaymentRequest | null,
    addressId: number | null,
  ): void {
    const address = this.addressForm.value;

    this.paymentService
      .processShippingSale(
        this.cartState!,
        {
          shippingMethodId: this.selectedShippingMethod!.id,
          shippingCost: this.shippingCost,
          deliveryType,
          shippingAddress,
          deliveryNotes: address.delivery_notes || undefined,
          shippingAddressId: addressId,
        },
        paymentRequest,
        'current_user',
      )
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.isProcessing = false;
          if (response.success) {
            this.shippingCompleted.emit({
              success: true,
              order: response.order,
              payment: response.payment,
              change: response.change,
              message: response.message,
              isShippingOrder: true,
            });
            this.onModalClosed();
          } else {
            this.toastService.show({
              variant: 'error',
              title: 'Error',
              description: response.message || 'Error al procesar el envío',
            });
          }
          this.cdr.markForCheck();
        },
        error: (error) => {
          this.isProcessing = false;
          this.toastService.show({
            variant: 'error',
            title: 'Error',
            description: error.message || 'Error al procesar el envío',
          });
          this.cdr.markForCheck();
        },
      });
  }

  onModalClosed(): void {
    this.resetState();
    this.closed.emit();
  }
}
