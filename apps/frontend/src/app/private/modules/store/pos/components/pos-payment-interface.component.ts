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
  inject,
} from '@angular/core';
import {
  FormBuilder,
  FormGroup,
  FormControl,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil, debounceTime } from 'rxjs';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';

import {
  ModalComponent,
  InputComponent,
  IconComponent,
  SelectorComponent,
} from '../../../../../shared/components';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { CurrencyFormatService, CurrencyPipe } from '../../../../../shared/pipes/currency';
import {
  PosPaymentService,
  PaymentMethod,
} from '../services/pos-payment.service';
import { PosCustomerService } from '../services/pos-customer.service';
import { CartState } from '../models/cart.model';
import { PosCustomer } from '../models/customer.model';
import * as fromAuth from '../../../../../core/store/auth';

interface PaymentState {
  selectedMethod: PaymentMethod | null;
  cashReceived: number;
  reference: string;
  isProcessing: boolean;
  change: number;
  isAnonymousSale: boolean;
}

@Component({
  selector: 'app-pos-payment-interface',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ModalComponent,
    InputComponent,
    IconComponent,
    SelectorComponent,
    CurrencyPipe,
  ],
  templateUrl: './pos-payment-interface.component.html',
  styles: [
    `
      /* Content */
      .payment-content {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

      /* Section Styling */
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

      .section-icon {
        color: var(--color-primary);
      }

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

      /* Summary Details */
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

      .summary-value.discount {
        color: var(--color-error);
      }

      /* Total */
      .total-section {
        margin-top: 16px;
        padding-top: 16px;
      }

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

      /* Payment Methods Grid */
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

      .no-methods p {
        font-size: 13px;
        margin: 8px 0;
      }

      .configure-link {
        background: none;
        border: none;
        color: var(--color-primary);
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        text-decoration: underline;
      }

      /* Cash Section */
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

      .cash-input {
        display: flex;
        align-items: center;
        background: var(--color-background);
        border: 2px solid var(--color-border);
        border-radius: 10px;
        padding: 8px 12px;
        transition: border-color 0.2s;
      }

      .cash-input:focus-within {
        border-color: var(--color-primary);
      }

      .cash-input.error {
        border-color: var(--color-error);
        background: rgba(var(--color-error-rgb), 0.05);
      }

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

      .cash-input.error input {
        color: var(--color-error);
      }

      .error-text {
        display: block;
        font-size: 11px;
        color: var(--color-error);
        font-weight: 500;
        margin-top: 4px;
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

      .change-display span {
        font-size: 16px;
        font-weight: 700;
        color: var(--color-success);
      }

      .change-display app-icon {
        color: var(--color-success);
      }

      /* Quick Amounts */
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

      .quick-btn:hover {
        border-color: var(--color-primary);
      }

      .quick-btn.primary {
        border-color: var(--color-primary);
        background: rgba(var(--color-primary-rgb), 0.05);
      }

      .quick-btn .quick-value {
        color: var(--color-primary);
      }

      .quick-btn.primary app-icon {
        color: var(--color-primary);
      }

      /* Keypad */
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

      .keypad-btn:hover {
        background: var(--color-muted);
      }

      .keypad-btn:active {
        transform: scale(0.95);
      }

      .keypad-btn.clear {
        color: var(--color-error);
        border-color: rgba(var(--color-error-rgb), 0.3);
      }

      .keypad-btn.clear:hover {
        background: rgba(var(--color-error-rgb), 0.1);
      }

      /* Reference Section */
      .reference-section {
        margin-top: 16px;
        text-align: center;
      }

      .reference-header {
        margin-bottom: 16px;
      }

      .reference-header app-icon {
        color: var(--color-primary);
        margin-bottom: 8px;
      }

      .reference-header p {
        font-size: 13px;
        color: var(--color-text-secondary);
        margin: 0;
      }

      /* Sale Type Options */
      .sale-type-options {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

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

      .sale-type-btn:hover {
        border-color: var(--color-primary);
      }

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

      .sale-type-btn.selected .radio-indicator {
        border-color: var(--color-primary);
      }

      .radio-dot {
        width: 10px;
        height: 10px;
        background: var(--color-primary);
        border-radius: 50%;
      }

      .sale-type-btn app-icon {
        color: var(--color-text-muted);
        flex-shrink: 0;
      }

      .sale-type-btn.selected app-icon {
        color: var(--color-primary);
      }

      .sale-type-info {
        flex: 1;
        min-width: 0;
      }

      .sale-type-name {
        display: block;
        font-size: 13px;
        font-weight: 600;
        color: var(--color-text-primary);
      }

      .sale-type-desc {
        display: block;
        font-size: 11px;
        color: var(--color-text-muted);
        margin-top: 2px;
      }

      /* Selected Customer */
      .selected-customer {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px;
        background: rgba(var(--color-success-rgb), 0.1);
        border-radius: 10px;
        margin-top: 12px;
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

      .customer-info {
        flex: 1;
        min-width: 0;
      }

      .customer-name {
        display: block;
        font-size: 13px;
        font-weight: 600;
        color: var(--color-text-primary);
      }

      .customer-email {
        display: block;
        font-size: 11px;
        color: var(--color-text-secondary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

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

      .change-customer-btn:hover {
        color: var(--color-primary);
      }

      /* Select Customer Button */
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
        margin-top: 12px;
      }

      .select-customer-btn:hover {
        border-color: var(--color-primary);
        color: var(--color-primary);
      }

      /* Customer Selector */
      .customer-selector {
        margin-top: 16px;
        padding-top: 16px;
        border-top: 1px solid var(--color-border);
      }

      .selector-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
      }

      .selector-header span {
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        color: var(--color-text-muted);
      }

      .selector-header button {
        background: none;
        border: none;
        color: var(--color-text-muted);
        cursor: pointer;
        padding: 4px;
      }

      .search-results {
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-height: 150px;
        overflow-y: auto;
        margin-top: 12px;
      }

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

      .customer-result:hover {
        border-color: var(--color-primary);
      }

      .result-name {
        font-size: 13px;
        font-weight: 500;
        color: var(--color-text-primary);
      }

      .result-email {
        font-size: 11px;
        color: var(--color-text-secondary);
      }

      .no-results {
        text-align: center;
        padding: 16px;
      }

      .no-results p {
        font-size: 13px;
        color: var(--color-text-secondary);
        margin: 0 0 8px 0;
      }

      .no-results button {
        background: none;
        border: none;
        color: var(--color-primary);
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
      }

      /* Create Customer Action - Always visible */
      .create-customer-action {
        margin-top: 12px;
        padding-top: 12px;
        border-top: 1px solid var(--color-border);
      }

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

      .create-customer-btn:hover {
        filter: brightness(1.1);
      }

      /* Create Customer Form */
      .create-customer-form {
        margin-top: 12px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .create-customer-form h5 {
        font-size: 14px;
        font-weight: 600;
        color: var(--color-text-primary);
        margin: 0;
      }

      .form-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }

      .form-actions {
        display: flex;
        gap: 8px;
        margin-top: 8px;
      }

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

      .btn-create:hover {
        filter: brightness(1.1);
      }

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

      /* Footer */
      .payment-footer {
        display: flex;
        flex-direction: column;
        gap: 12px;
        width: 100%;
      }

      .footer-row {
        display: flex;
        gap: 12px;
      }

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

      .btn-cancel-payment:hover:not(:disabled) {
        background: rgba(var(--color-error-rgb), 0.05);
      }

      .btn-cancel-payment:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .btn-draft {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 12px;
        border: 1px solid var(--color-primary);
        border-radius: 12px;
        background: transparent;
        color: var(--color-primary);
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.2s;
      }

      .btn-draft:hover:not(:disabled) {
        background: rgba(var(--color-primary-rgb), 0.05);
      }

      .btn-draft:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

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

      .btn-confirm:hover:not(:disabled) {
        filter: brightness(1.05);
        transform: translateY(-1px);
      }

      .btn-confirm:active:not(:disabled) {
        transform: scale(0.98);
      }

      .btn-confirm:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        box-shadow: none;
      }

      .spinner {
        width: 20px;
        height: 20px;
        border: 2px solid white;
        border-top-color: transparent;
        border-radius: 50%;
        animation: spin 1s linear infinite;
      }

      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }

      /* Desktop: 3-column horizontal layout */
      @media (min-width: 1024px) {
        .payment-content {
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

        .product-list {
          max-height: none;
          flex: 1;
        }

        .search-results {
          max-height: 200px;
        }
      }

      /* Responsive */
      @media (max-width: 480px) {
        .payment-content {
          gap: 12px;
        }

        .payment-section {
          padding: 14px;
        }

        .total-amount {
          font-size: 22px;
        }

        .keypad-btn {
          padding: 12px;
          font-size: 16px;
        }

        .btn-confirm {
          padding: 14px;
          font-size: 15px;
        }
      }
    `,
  ],
})
export class PosPaymentInterfaceComponent implements OnInit, OnDestroy, OnChanges {
  @Input() isOpen = false;
  @Input() cartState: CartState | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() paymentCompleted = new EventEmitter<any>();
  @Output() requestCustomer = new EventEmitter<void>();
  @Output() requestRegisterConfig = new EventEmitter<void>();
  @Output() draftSaved = new EventEmitter<any>();
  @Output() customerSelected = new EventEmitter<PosCustomer>();

  paymentMethods: PaymentMethod[] = [];
  paymentForm: FormGroup;
  paymentState: PaymentState = {
    selectedMethod: null,
    cashReceived: 0,
    reference: '',
    isProcessing: false,
    change: 0,
    isAnonymousSale: false,
  };

  // Store settings
  storeSettingsSubscription: any;
  allowAnonymousSales = false;
  anonymousSalesAsDefault = false;
  requireCashDrawerOpen = false;
  enableScheduleValidation = false;
  businessHours: Record<string, { open: string; close: string }> = {};

  // Currency symbol (computed signal from CurrencyFormatService)
  currencySymbol: any;

  // Currency symbol (computed signal from CurrencyFormatService)
  currencySymbol: any;

  // Document type options for customer creation
  documentTypeOptions = [
    { value: 'dni', label: 'DNI' },
    { value: 'passport', label: 'Pasaporte' },
    { value: 'cedula', label: 'Cédula' },
    { value: 'other', label: 'Otro' },
  ];

  // Customer management within modal
  showCustomerSelector = false;
  customerSearchResults: PosCustomer[] = [];
  customerSearchQuery = '';
  isSearchingCustomer = false;
  showCreateCustomerForm = false;
  customerForm: FormGroup;

  // quickCashAmounts = [10, 20, 50, 100]; // Removed as per new requirement

  private destroy$ = new Subject<void>();

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

  get customerDocumentTypeControl(): FormControl {
    return this.customerForm.get('documentType') as FormControl;
  }

  get customerDocumentNumberControl(): FormControl {
    return this.customerForm.get('documentNumber') as FormControl;
  }

  get customerDisplayName(): string {
    if (!this.cartState?.customer) {
      return 'Seleccionar cliente';
    }
    const firstName = this.cartState.customer.first_name || '';
    const lastName = this.cartState.customer.last_name || '';
    return `${firstName} ${lastName}`.trim() || 'Cliente sin nombre';
  }

  get customerEmail(): string {
    return this.cartState?.customer?.email || '';
  }

  constructor(
    private fb: FormBuilder,
    private paymentService: PosPaymentService,
    private customerService: PosCustomerService,
    private toastService: ToastService,
    private router: Router,
    private store: Store,
    private cdr: ChangeDetectorRef,
    private currencyService: CurrencyFormatService
  ) {
    this.paymentForm = this.createPaymentForm();
    this.customerForm = this.createCustomerForm();
    // Exponer el símbolo de moneda para usar en el template
    this.currencySymbol = this.currencyService.currencySymbol;
  }

  ngOnInit(): void {
    this.loadPaymentMethods();
    this.setupFormListeners();
    this.loadStoreSettings();
    // Asegurar que la moneda esté cargada para la interfaz de pago
    this.currencyService.loadCurrency();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  ngOnChanges(changes: SimpleChanges): void {
    // When modal opens, sync anonymous sale state with current settings
    if (changes['isOpen'] && changes['isOpen'].currentValue === true) {
      this.syncAnonymousSaleState();
    }
  }

  private syncAnonymousSaleState(): void {
    // If anonymous sales are not allowed, always disable
    if (!this.allowAnonymousSales) {
      this.paymentState.isAnonymousSale = false;
    } else {
      // Use the default setting from store settings
      this.paymentState.isAnonymousSale = this.anonymousSalesAsDefault;
    }
    this.cdr.markForCheck();
  }

  // Track if settings have been loaded at least once
  private settingsLoaded = false;

  private createPaymentForm(): FormGroup {
    return this.fb.group({
      cashReceived: [0, [Validators.required, Validators.min(0)]],
      reference: [''],
    });
  }

  private createCustomerForm(): FormGroup {
    return this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      firstName: ['', [Validators.required, Validators.minLength(2)]],
      lastName: ['', [Validators.required, Validators.minLength(2)]],
      phone: [''],
      documentType: [''],
      documentNumber: ['', [Validators.required]],
    });
  }

  private setupFormListeners(): void {
    this.cashReceivedControl.valueChanges
      .pipe(takeUntil(this.destroy$), debounceTime(100))
      .subscribe((value: string | number | null) => {
        if (value !== null && value !== undefined && value !== '') {
          this.paymentState.cashReceived = parseFloat(value.toString()) || 0;
          this.calculateChange();
        }
      });

    this.referenceControl.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe((value: string | null) => {
        this.paymentState.reference = value || '';
      });
  }

  private loadPaymentMethods(): void {
    this.paymentService
      .getPaymentMethods()
      .pipe(takeUntil(this.destroy$))
      .subscribe((methods) => {
        this.paymentMethods = methods;
      });
  }

  private isWithinBusinessHours(): boolean {
    // If schedule validation is disabled, always allow
    if (!this.enableScheduleValidation) {
      return true;
    }

    // Get current day and time in store timezone
    const now = new Date();
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const currentDayName = dayNames[now.getDay()];

    // Get business hours for current day
    const todayHours = this.businessHours?.[currentDayName];

    // If no hours configured for today, allow by default
    if (!todayHours) {
      return true;
    }

    // If day is marked as closed, don't allow sales
    if (todayHours.open === 'closed' || todayHours.close === 'closed') {
      return false;
    }

    // Parse current time to minutes for comparison
    const currentTime = now.getHours() * 60 + now.getMinutes();

    // Parse opening and closing times
    const [openHour, openMinute] = todayHours.open.split(':').map(Number);
    const [closeHour, closeMinute] = todayHours.close.split(':').map(Number);

    const openTime = openHour * 60 + openMinute;
    const closeTime = closeHour * 60 + closeMinute;

    // Check if current time is within business hours
    return currentTime >= openTime && currentTime <= closeTime;
  }

  private loadStoreSettings(): void {
    this.storeSettingsSubscription = this.store.select(fromAuth.selectStoreSettings).pipe(takeUntil(this.destroy$)).subscribe((storeSettings: any) => {
      // store_settings has structure: { settings: { pos: { ... }, general: { ... }, ... } }
      const settings = storeSettings;
      if (settings?.pos) {
        const prevAllowAnonymous = this.allowAnonymousSales;

        this.allowAnonymousSales = settings.pos.allow_anonymous_sales || false;
        this.anonymousSalesAsDefault = settings.pos.anonymous_sales_as_default || false;
        this.requireCashDrawerOpen = settings.pos.require_cash_drawer_open || false;
        this.enableScheduleValidation = settings.pos.enable_schedule_validation || false;
        this.businessHours = settings.pos.business_hours || {};
        this.settingsLoaded = true;

        console.log('[POS Payment] Store settings updated:', {
          allowAnonymousSales: this.allowAnonymousSales,
          anonymousSalesAsDefault: this.anonymousSalesAsDefault,
          requireCashDrawerOpen: this.requireCashDrawerOpen,
          enableScheduleValidation: this.enableScheduleValidation,
          businessHours: this.businessHours,
          prevAllowAnonymous,
          isAnonymousSale: this.paymentState.isAnonymousSale,
          rawSettings: settings,
        });

        // If anonymous sales are not allowed, always disable the toggle
        if (!this.allowAnonymousSales) {
          this.paymentState.isAnonymousSale = false;
        } else {
          // Only update if this is first load (prevAllowAnonymous is falsy)
          // or if we want to respect the default setting
          if (!prevAllowAnonymous || this.anonymousSalesAsDefault) {
            this.paymentState.isAnonymousSale = this.anonymousSalesAsDefault;
          }
          // Otherwise, preserve current user selection
        }

        // Trigger change detection to update UI
        this.cdr.markForCheck();
      }
    });
  }

  selectPaymentMethod(method: PaymentMethod): void {
    this.paymentState.selectedMethod = method;
    this.paymentForm.reset();
    this.paymentState.change = 0;

    if (method.type === 'cash') {
      this.cashReceivedControl.setValue(this.cartState?.summary?.total || 0);
    }
  }

  getPaymentMethodClasses(method: PaymentMethod): string {
    const base_classes = ['payment-method-card'];
    if (this.paymentState.selectedMethod?.id === method.id) {
      base_classes.push('selected');
    }
    return base_classes.join(' ');
  }

  setCashAmount(amount: number): void {
    this.cashReceivedControl.setValue(amount);
  }

  setFullAmount(): void {
    const total = this.cartState?.summary?.total || 0;
    this.setCashAmount(total);
  }

  setHalfAmount(): void {
    const total = this.cartState?.summary?.total || 0;
    this.setCashAmount(total / 2);
  }

  appendNumber(num: number): void {
    const current_value = this.cashReceivedControl.value || 0;
    // If current value is 0, replace it, otherwise append (handling string vs number)
    const new_value = parseFloat(current_value.toString() + num.toString());
    this.cashReceivedControl.setValue(new_value);
  }

  backspace(): void {
    const current_value = this.cashReceivedControl.value;
    if (!current_value) return;

    const str_val = current_value.toString();
    if (str_val.length <= 1) {
      this.cashReceivedControl.setValue(0);
    } else {
      this.cashReceivedControl.setValue(parseFloat(str_val.slice(0, -1)));
    }
  }

  clearCashAmount(): void {
    this.cashReceivedControl.setValue(0);
  }

  calculateChange(): void {
    if (this.paymentState.selectedMethod?.type === 'cash') {
      const total = this.cartState?.summary?.total || 0;
      const received = this.paymentState.cashReceived || 0;
      this.paymentState.change = Math.max(0, received - total);
    }
  }

  getReferenceError(): string | undefined {
    const control = this.referenceControl;
    if (control && control.errors && control.touched) {
      if (control.errors['required']) {
        return 'Este campo es requerido';
      }
      if (control.errors['minlength']) {
        return 'Mínimo 4 caracteres';
      }
    }
    return undefined;
  }

  canProcessPayment(): boolean {
    if (!this.paymentState.selectedMethod || this.paymentState.isProcessing) {
      return false;
    }

    // Check customer requirement (unless anonymous sale is allowed and selected)
    if (!this.paymentState.isAnonymousSale && !this.cartState?.customer) {
      return false;
    }

    if (this.paymentState.selectedMethod.type === 'cash') {
      const total = this.cartState?.summary?.total || 0;
      return this.paymentState.cashReceived >= total;
    }

    if (this.paymentState.selectedMethod.requiresReference) {
      const reference = this.referenceControl.value;
      return reference && reference.trim().length >= 4;
    }

    return true;
  }

  processPayment(): void {
    if (
      !this.canProcessPayment() ||
      !this.cartState ||
      !this.paymentState.selectedMethod
    ) {
      return;
    }

    // Check customer requirement (unless anonymous sale is allowed and selected)
    if (!this.paymentState.isAnonymousSale && !this.cartState.customer) {
      this.toastService.info('Seleccione un cliente para continuar');
      this.requestCustomer.emit();
      this.onModalClosed();
      return;
    }

    let register_id = localStorage.getItem('pos_register_id');

    // Auto-configure default register if not required
    if (!register_id && !this.requireCashDrawerOpen) {
      register_id = 'DEFAULT-POS';
      localStorage.setItem('pos_register_id', register_id);
    }

    if (!register_id) {
      this.toastService.info('Configure la caja para continuar');
      this.requestRegisterConfig.emit();
      this.onModalClosed();
      return;
    }

    // Check business hours if validation is enabled
    if (!this.isWithinBusinessHours()) {
      const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
      const today = dayNames[new Date().getDay()];
      this.toastService.show({
        variant: 'error',
        title: 'Fuera del horario de atención',
        description: `El POS está cerrado. Hoy ${today} no se permite realizar ventas fuera del horario configurado.`,
      });
      return;
    }

    this.paymentState.isProcessing = true;

    const payment_request = {
      orderId: 'ORDER_' + Date.now(),
      amount: this.cartState.summary.total,
      paymentMethod: this.paymentState.selectedMethod,
      cashReceived: this.paymentState.cashReceived,
      reference: this.paymentState.reference,
      isAnonymousSale: this.paymentState.isAnonymousSale,
    };

    this.paymentService
      .processSaleWithPayment(this.cartState, payment_request, 'current_user')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.paymentState.isProcessing = false;
          if (response.success) {
            this.paymentCompleted.emit({
              success: true,
              order: response.order,
              payment: response.payment,
              change: response.change,
              message: response.message,
              isAnonymousSale: this.paymentState.isAnonymousSale,
            });
            this.onModalClosed();
          } else {
            console.error('Payment failed:', response.message);
            this.toastService.show({
              variant: 'error',
              title: 'Error',
              description: response.message || 'Error al procesar el pago',
            });
          }
        },
        error: (error) => {
          this.paymentState.isProcessing = false;
          console.error('Payment error:', error);
          this.toastService.show({
            variant: 'error',
            title: 'Error',
            description: error.message || 'Error de conexión al procesar el pago',
          });
        },
      });
  }

  processCreditSale(): void {
    if (!this.cartState || this.paymentState.isProcessing) return;

    // Credit sales always require a customer (cannot be anonymous)
    if (!this.cartState.customer) {
      this.toastService.info('Seleccione un cliente para continuar');
      this.requestCustomer.emit();
      this.onModalClosed();
      return;
    }

    let register_id = localStorage.getItem('pos_register_id');

    // Auto-configure default register if not required
    if (!register_id && !this.requireCashDrawerOpen) {
      register_id = 'DEFAULT-POS';
      localStorage.setItem('pos_register_id', register_id);
    }

    if (!register_id) {
      this.toastService.info('Configure la caja para continuar');
      this.requestRegisterConfig.emit();
      this.onModalClosed();
      return;
    }

    // Check business hours if validation is enabled
    if (!this.isWithinBusinessHours()) {
      const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
      const today = dayNames[new Date().getDay()];
      this.toastService.show({
        variant: 'error',
        title: 'Fuera del horario de atención',
        description: `El POS está cerrado. Hoy ${today} no se permite realizar ventas fuera del horario configurado.`,
      });
      return;
    }

    this.paymentState.isProcessing = true;

    this.paymentService
      .processCreditSale(this.cartState, 'current_user')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.paymentState.isProcessing = false;
          if (response.success) {
            this.paymentCompleted.emit({
              success: true,
              order: response.order,
              message: response.message,
              isCreditSale: true,
            });
            this.onModalClosed();
          } else {
            console.error('Credit sale failed:', response.message);
            this.toastService.show({
              variant: 'error',
              title: 'Error',
              description: response.message || 'Error al procesar la venta a crédito',
            });
          }
        },
        error: (error) => {
          this.paymentState.isProcessing = false;
          console.error('Credit sale error:', error);
          this.toastService.show({
            variant: 'error',
            title: 'Error',
            description: error.message || 'Error al procesar la venta a crédito',
          });
        },
      });
  }

  saveAsDraft(): void {
    if (!this.cartState) return;

    if (!this.cartState.customer) {
      this.toastService.show({
        variant: 'error',
        title: 'Cliente Requerido',
        description: 'Debe seleccionar un cliente para guardar el borrador',
      });
      return;
    }

    this.paymentState.isProcessing = true;

    this.paymentService
      .saveDraft(this.cartState, 'current_user')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.paymentState.isProcessing = false;
          if (response.success) {
            this.draftSaved.emit({
              success: true,
              order: response.order,
              message: response.message,
            });
            this.onModalClosed();
          }
        },
        error: (error) => {
          this.paymentState.isProcessing = false;
          console.error('Save draft error:', error);
          this.toastService.show({
            variant: 'error',
            title: 'Error',
            description: error.message || 'Error al guardar el borrador',
          });
        },
      });
  }

  onModalClosed(): void {
    this.paymentState = {
      selectedMethod: null,
      cashReceived: 0,
      reference: '',
      isProcessing: false,
      change: 0,
      isAnonymousSale: false, // Will be synced when modal opens
    };
    this.paymentForm.reset();
    this.customerForm.reset();
    this.showCustomerSelector = false;
    this.customerSearchResults = [];
    this.customerSearchQuery = '';
    this.showCreateCustomerForm = false;
    this.closed.emit();
  }

  // Anonymous Sale Toggle
  toggleAnonymousSale(enabled: boolean): void {
    this.paymentState.isAnonymousSale = enabled;
    if (enabled) {
      // When switching to anonymous, clear customer selector
      this.showCustomerSelector = false;
      this.showCreateCustomerForm = false;
    } else {
      // When switching to customer sale, show customer selector if no customer selected
      if (!this.cartState?.customer) {
        this.showCustomerSelector = true;
      }
    }
  }

  // Customer Management Methods
  openCustomerSelector(): void {
    this.showCustomerSelector = true;
    this.showCreateCustomerForm = false;
    this.paymentState.isAnonymousSale = false;
  }

  closeCustomerSelector(): void {
    this.showCustomerSelector = false;
    this.showCreateCustomerForm = false;
    this.customerSearchResults = [];
    this.customerSearchQuery = '';
  }

  onCustomerSearch(query: string): void {
    this.customerSearchQuery = query;
    if (query && query.trim().length >= 2) {
      this.isSearchingCustomer = true;

      this.customerService
        .searchCustomers({ query: query.trim(), limit: 10 })
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (response) => {
            this.customerSearchResults = response.data || [];
            this.isSearchingCustomer = false;
          },
          error: (error) => {
            console.error('Error searching customers:', error);
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
      this.isSearchingCustomer = false;
    }
  }

  selectCustomer(customer: PosCustomer): void {
    // Emit event to parent to update cart customer
    this.customerSelected.emit(customer);
    this.closeCustomerSelector();
  }

  switchToCreateCustomer(): void {
    this.showCreateCustomerForm = true;
    this.customerSearchResults = [];
  }

  switchToCustomerSearch(): void {
    this.showCreateCustomerForm = false;
  }

  onCreateCustomer(): void {
    if (this.customerForm.valid) {
      const formValue = this.customerForm.value;

      const customerRequest = {
        email: formValue.email,
        first_name: formValue.firstName,
        last_name: formValue.lastName,
        phone: formValue.phone || undefined,
        document_type: formValue.documentType || undefined,
        document_number: formValue.documentNumber || undefined,
      };

      this.isSearchingCustomer = true;

      this.customerService
        .createQuickCustomer(customerRequest)
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
            console.error('Error creating customer:', error);
            this.toastService.show({
              variant: 'error',
              title: 'Error',
              description: error.error?.message || error.message || 'Error al crear cliente',
            });
          },
        });
    } else {
      // Mark all fields as touched to show validation errors
      Object.keys(this.customerForm.controls).forEach((key) => {
        const control = this.customerForm.get(key);
        control?.markAsTouched();
      });
      this.toastService.info('Por favor completa los campos requeridos');
    }
  }

  // Getter for insufficient amount
  get isCashAmountInsufficient(): boolean {
    if (this.paymentState.selectedMethod?.type === 'cash') {
      const total = this.cartState?.summary?.total || 0;
      const received = this.paymentState.cashReceived || 0;
      return received < total;
    }
    return false;
  }

  get missingAmount(): number {
    if (this.isCashAmountInsufficient) {
      const total = this.cartState?.summary?.total || 0;
      const received = this.paymentState.cashReceived || 0;
      return total - received;
    }
    return 0;
  }

  navigateToSettings(): void {
    this.onModalClosed();
    this.router.navigate(['/admin/settings/payments']);
  }
}
