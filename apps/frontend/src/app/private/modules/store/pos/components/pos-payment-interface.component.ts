import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnDestroy,
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

import {
  ButtonComponent,
  ModalComponent,
  InputComponent,
  CardComponent,
  IconComponent,
} from '../../../../../shared/components';
import {
  PosPaymentService,
  PaymentMethod,
} from '../services/pos-payment.service';
import { CartState } from '../models/cart.model';

interface PaymentState {
  selectedMethod: PaymentMethod | null;
  cashReceived: number;
  reference: string;
  isProcessing: boolean;
  change: number;
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
  ],
  templateUrl: './pos-payment-interface.component.html',
  styles: [
    `
      .payment-method-card {
        border: 2px solid var(--color-border);
        border-radius: var(--radius-md);
        background: var(--color-surface);
        transition: all 0.2s ease;
      }

      .payment-method-card:hover {
        border-color: var(--color-primary);
        transform: translateY(-2px);
        box-shadow: var(--shadow-md);
      }

      .payment-method-card.selected {
        border-color: var(--color-primary);
        background: var(--color-primary-light);
        box-shadow: var(--shadow-md);
      }

      .keypad-btn {
        padding: 1rem;
        font-size: 1.125rem;
        font-weight: 500;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        background: var(--color-surface);
        color: var(--color-text-primary);
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .keypad-btn:hover:not(:disabled) {
        background: var(--color-primary-light);
        border-color: var(--color-primary);
      }

      .keypad-btn:active {
        transform: scale(0.95);
      }

      @keyframes pulse-success {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.7;
        }
      }

      .pulse-success {
        animation: pulse-success 2s infinite;
      }
    `,
  ],
})
export class PosPaymentInterfaceComponent implements OnInit, OnDestroy {
  @Input() isOpen = false;
  @Input() cartState: CartState | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() paymentCompleted = new EventEmitter<any>();
  @Output() draftSaved = new EventEmitter<any>();

  paymentMethods: PaymentMethod[] = [];
  paymentForm: FormGroup;
  paymentState: PaymentState = {
    selectedMethod: null,
    cashReceived: 0,
    reference: '',
    isProcessing: false,
    change: 0,
  };

  quickCashAmounts = [10, 20, 50, 100];

  private destroy$ = new Subject<void>();

  get cashReceivedControl(): FormControl {
    return this.paymentForm.get('cashReceived') as FormControl;
  }

  get referenceControl(): FormControl {
    return this.paymentForm.get('reference') as FormControl;
  }

  constructor(
    private fb: FormBuilder,
    private paymentService: PosPaymentService,
  ) {
    this.paymentForm = this.createPaymentForm();
  }

  ngOnInit(): void {
    this.loadPaymentMethods();
    this.setupFormListeners();
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

  private setupFormListeners(): void {
    this.cashReceivedControl.valueChanges
      .pipe(takeUntil(this.destroy$), debounceTime(100))
      .subscribe((value) => {
        this.paymentState.cashReceived = parseFloat(value) || 0;
        this.calculateChange();
      });

    this.referenceControl.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe((value) => {
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

  selectPaymentMethod(method: PaymentMethod): void {
    this.paymentState.selectedMethod = method;
    this.paymentForm.reset();
    this.paymentState.change = 0;

    if (method.type === 'cash') {
      this.cashReceivedControl.setValue(this.cartState?.summary?.total || 0);
    }
  }

  getPaymentMethodClasses(method: PaymentMethod): string {
    const baseClasses = ['payment-method-card'];
    if (this.paymentState.selectedMethod?.id === method.id) {
      baseClasses.push('selected');
    }
    return baseClasses.join(' ');
  }

  setCashAmount(amount: number): void {
    this.cashReceivedControl.setValue(amount);
  }

  appendNumber(num: number): void {
    const currentValue = this.cashReceivedControl.value || 0;
    const newValue = parseFloat(currentValue.toString() + num.toString());
    this.cashReceivedControl.setValue(newValue);
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

    this.paymentState.isProcessing = true;

    const paymentRequest = {
      orderId: 'ORDER_' + Date.now(),
      amount: this.cartState.summary.total,
      paymentMethod: this.paymentState.selectedMethod,
      cashReceived: this.paymentState.cashReceived,
      reference: this.paymentState.reference,
    };

    this.paymentService
      .processSaleWithPayment(this.cartState, paymentRequest, 'current_user')
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
            });
            this.onModalClosed();
          } else {
            console.error('Payment failed:', response.message);
          }
        },
        error: (error) => {
          this.paymentState.isProcessing = false;
          console.error('Payment error:', error);
        },
      });
  }

  processCreditSale(): void {
    if (!this.cartState || this.paymentState.isProcessing) return;

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
          }
        },
        error: (error) => {
          this.paymentState.isProcessing = false;
          console.error('Credit sale error:', error);
        },
      });
  }

  saveAsDraft(): void {
    if (!this.cartState) return;

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
    };
    this.paymentForm.reset();
    this.closed.emit();
  }
}
