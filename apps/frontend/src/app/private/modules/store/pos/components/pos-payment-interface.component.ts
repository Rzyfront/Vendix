import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnDestroy,
  ChangeDetectorRef,
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
  ButtonComponent,
  ModalComponent,
  InputComponent,
  CardComponent,
  IconComponent,
  SelectorComponent,
} from '../../../../../shared/components';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
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
    ButtonComponent,
    ModalComponent,
    InputComponent,
    CardComponent,
    IconComponent,
    SelectorComponent,
  ],
  templateUrl: './pos-payment-interface.component.html',
  styles: [
    `
      /* Enhanced Payment Method Cards with Better Contrast */
      .payment-method-card {
        position: relative;
        border: 2px solid var(--color-border);
        border-radius: var(--radius-lg);
        background: var(--color-surface);
        transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
        overflow: hidden;
      }

      .payment-method-card::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 3px;
        background: transparent;
        transition: background 0.25s ease;
      }

      .payment-method-card:hover {
        border-color: var(--color-primary);
        transform: translateY(-3px);
        box-shadow: var(--shadow-lg);
      }

      .payment-method-card:hover::before {
        background: linear-gradient(
          90deg,
          var(--color-primary),
          var(--color-accent)
        );
      }

      .payment-method-card.selected {
        border-color: var(--color-primary);
        background: linear-gradient(
          135deg,
          var(--color-primary-light),
          rgba(126, 215, 165, 0.05)
        );
        box-shadow:
          var(--shadow-md),
          0 0 0 1px rgba(126, 215, 165, 0.2),
          0 4px 12px rgba(126, 215, 165, 0.15);
      }

      .payment-method-card.selected::before {
        background: linear-gradient(
          90deg,
          var(--color-primary),
          var(--color-accent)
        );
      }

      /* Enhanced Keypad Buttons with Better Accessibility */
      .keypad-btn {
        position: relative;
        padding: 1.25rem;
        font-size: 1.25rem;
        font-weight: var(--fw-semibold);
        font-family: var(--font-primary);
        border: 2px solid var(--color-border);
        border-radius: var(--radius-md);
        background: linear-gradient(
          135deg,
          var(--color-surface),
          rgba(248, 250, 252, 0.8)
        );
        color: var(--color-text-primary);
        cursor: pointer;
        transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
        user-select: none;
        -webkit-user-select: none;
        -moz-user-select: none;
        -ms-user-select: none;
      }

      .keypad-btn:focus {
        outline: none;
        border-color: var(--color-primary);
        box-shadow:
          0 0 0 3px rgba(126, 215, 165, 0.3),
          var(--shadow-sm);
      }

      .keypad-btn:hover:not(:disabled) {
        background: linear-gradient(
          135deg,
          var(--color-primary-light),
          rgba(126, 215, 165, 0.15)
        );
        border-color: var(--color-primary);
        transform: translateY(-1px);
        box-shadow: var(--shadow-md);
      }

      .keypad-btn:active {
        transform: scale(0.96) translateY(0);
        transition: transform 0.1s ease;
      }

      .keypad-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none;
      }

      /* Credit Sale Special Styling */
      .credit-sale-card {
        background: linear-gradient(
          135deg,
          rgba(251, 146, 60, 0.08),
          rgba(251, 146, 60, 0.02)
        );
        border-color: rgba(251, 146, 60, 0.3);
      }

      .credit-sale-card:hover {
        border-color: var(--color-warning);
        box-shadow:
          var(--shadow-md),
          0 0 0 1px rgba(251, 146, 60, 0.2);
      }

      .credit-sale-card:hover::before {
        background: linear-gradient(90deg, var(--color-warning), #f59e0b);
      }

      /* Enhanced Payment Summary Card */
      .payment-summary-enhanced {
        background: linear-gradient(
          135deg,
          var(--color-surface),
          rgba(126, 215, 165, 0.02)
        );
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        position: relative;
        overflow: hidden;
      }

      .payment-summary-enhanced::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 2px;
        background: linear-gradient(
          90deg,
          var(--color-primary),
          var(--color-accent)
        );
      }

      /* Enhanced Change Display */
      .change-display-enhanced {
        background: linear-gradient(
          135deg,
          rgba(34, 197, 94, 0.12),
          rgba(34, 197, 94, 0.04)
        );
        border: 2px solid rgba(34, 197, 94, 0.3);
        border-radius: var(--radius-md);
        padding: 1rem;
        position: relative;
        overflow: hidden;
      }

      .change-display-enhanced::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 3px;
        background: linear-gradient(90deg, var(--color-success), #16a34a);
      }

      /* Enhanced Quick Amount Buttons */
      .quick-amount-btn {
        position: relative;
        padding: 0.75rem;
        font-weight: var(--fw-medium);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        background: var(--color-surface);
        color: var(--color-text-primary);
        cursor: pointer;
        transition: all 0.2s ease;
        overflow: hidden;
      }

      .quick-amount-btn::before {
        content: '';
        position: absolute;
        top: 50%;
        left: 50%;
        width: 0;
        height: 0;
        background: rgba(126, 215, 165, 0.1);
        border-radius: 50%;
        transform: translate(-50%, -50%);
        transition:
          width 0.3s ease,
          height 0.3s ease;
      }

      .quick-amount-btn:hover::before {
        width: 100%;
        height: 100%;
      }

      .quick-amount-btn:hover {
        border-color: var(--color-primary);
        color: var(--color-primary);
        transform: translateY(-1px);
        box-shadow: var(--shadow-sm);
      }

      .quick-amount-btn:focus {
        outline: none;
        border-color: var(--color-primary);
        box-shadow: 0 0 0 2px rgba(126, 215, 165, 0.3);
      }

      /* Enhanced Section Headers */
      .section-header-enhanced {
        position: relative;
        padding-left: 1rem;
        font-weight: var(--fw-semibold);
        color: var(--color-text-primary);
      }

      .section-header-enhanced::before {
        content: '';
        position: absolute;
        left: 0;
        top: 50%;
        transform: translateY(-50%);
        width: 4px;
        height: 1.5rem;
        background: linear-gradient(
          180deg,
          var(--color-primary),
          var(--color-accent)
        );
        border-radius: 2px;
      }

      /* Enhanced Payment Details Section */
      .payment-details-enhanced {
        background: linear-gradient(
          135deg,
          var(--color-surface),
          rgba(6, 182, 212, 0.02)
        );
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        position: relative;
        overflow: hidden;
      }

      .payment-details-enhanced::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 2px;
        background: linear-gradient(
          90deg,
          var(--color-accent),
          var(--color-primary)
        );
      }

      /* Enhanced Input Styling */
      .enhanced-cash-input {
        position: relative;
        border: 2px solid var(--color-border);
        border-radius: var(--radius-md);
        background: var(--color-surface);
        transition: all 0.2s ease;
      }

      .enhanced-cash-input:focus-within {
        border-color: var(--color-primary);
        box-shadow: 0 0 0 3px rgba(126, 215, 165, 0.2);
      }

      .enhanced-cash-input input {
        border: none;
        outline: none;
        background: transparent;
        font-family: var(--font-primary);
        font-size: 1.125rem;
        font-weight: var(--fw-medium);
        color: var(--color-text-primary);
      }

      /* Responsive Design Improvements */
      @media (max-width: 768px) {
        .keypad-btn {
          padding: 1rem;
          font-size: 1.125rem;
        }

        .payment-method-card {
          border-radius: var(--radius-md);
        }

        .quick-amount-btn {
          padding: 0.625rem;
          font-size: var(--fs-sm-mobile);
        }

        .section-header-enhanced {
          font-size: var(--fs-base-mobile);
        }
      }

      @media (max-width: 480px) {
        .keypad-btn {
          padding: 0.875rem;
          font-size: 1rem;
        }

        .quick-amount-btn {
          padding: 0.5rem;
          font-size: var(--fs-xs-mobile);
        }
      }

      /* Smooth Animations */
      @keyframes slideInUp {
        from {
          opacity: 0;
          transform: translateY(10px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .animate-slide-in {
        animation: slideInUp 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
      }

      @keyframes pulse-success {
        0%,
        100% {
          opacity: 1;
          transform: scale(1);
        }
        50% {
          opacity: 0.8;
          transform: scale(1.02);
        }
      }

      .pulse-success {
        animation: pulse-success 2s cubic-bezier(0.34, 1.56, 0.64, 1) infinite;
      }

      /* Enhanced Loading States */
      .loading-enhanced {
        position: relative;
        pointer-events: none;
        opacity: 0.7;
      }

      .loading-enhanced::after {
        content: '';
        position: absolute;
        top: 50%;
        left: 50%;
        width: 20px;
        height: 20px;
        margin: -10px 0 0 -10px;
        border: 2px solid var(--color-primary);
        border-radius: 50%;
        border-top-color: transparent;
        animation: spin 1s linear infinite;
      }

      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }

      /* High Contrast Mode Support */
      @media (prefers-contrast: high) {
        .payment-method-card {
          border-width: 3px;
        }

        .keypad-btn {
          border-width: 2px;
          font-weight: var(--fw-bold);
        }

        .quick-amount-btn {
          border-width: 2px;
        }
      }

      /* Reduced Motion Support */
      @media (prefers-reduced-motion: reduce) {
        .payment-method-card,
        .keypad-btn,
        .quick-amount-btn {
          transition: none;
        }

        .pulse-success {
          animation: none;
        }

        .loading-enhanced::after {
          animation: none;
        }
      }
    `,
  ],
})
export class PosPaymentInterfaceComponent implements OnInit, OnDestroy {
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
    private cdr: ChangeDetectorRef
  ) {
    this.paymentForm = this.createPaymentForm();
    this.customerForm = this.createCustomerForm();
  }

  ngOnInit(): void {
    this.loadPaymentMethods();
    this.setupFormListeners();
    this.loadStoreSettings();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

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

  private loadStoreSettings(): void {
    this.storeSettingsSubscription = this.store.select(fromAuth.selectStoreSettings).pipe(takeUntil(this.destroy$)).subscribe((storeSettings: any) => {
      // store_settings is the StoreSettings object directly: { pos: { ... }, general: { ... }, ... }
      const settings = storeSettings;
      if (settings?.pos) {
        const prevAllowAnonymous = this.allowAnonymousSales;

        this.allowAnonymousSales = settings.pos.allow_anonymous_sales || false;
        this.anonymousSalesAsDefault = settings.pos.anonymous_sales_as_default || false;

        console.log('[POS Payment] Store settings updated:', {
          allowAnonymousSales: this.allowAnonymousSales,
          anonymousSalesAsDefault: this.anonymousSalesAsDefault,
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

    const register_id = localStorage.getItem('pos_register_id');
    if (!register_id) {
      this.toastService.info('Configure la caja para continuar');
      this.requestRegisterConfig.emit();
      this.onModalClosed();
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

    const register_id = localStorage.getItem('pos_register_id');
    if (!register_id) {
      this.toastService.info('Configure la caja para continuar');
      this.requestRegisterConfig.emit();
      this.onModalClosed();
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
      isAnonymousSale: this.allowAnonymousSales && this.anonymousSalesAsDefault,
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
