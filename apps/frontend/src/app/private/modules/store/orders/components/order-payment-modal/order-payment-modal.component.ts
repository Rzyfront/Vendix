import {
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { ModalComponent } from '../../../../../../shared/components';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { InputComponent } from '../../../../../../shared/components';
import { CurrencyFormatService, CurrencyPipe } from '../../../../../../shared/pipes/currency';
import { Order, PayOrderDto, PaymentType } from '../../interfaces/order.interface';
import { StorePaymentMethod } from '../../../settings/payments/interfaces/payment-methods.interface';

interface PaymentMethodDisplay {
  id: string;
  display_name: string;
  type: string;
  icon: string;
  requiresReference: boolean;
  referenceLabel: string;
}

@Component({
  selector: 'app-order-payment-modal',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    InputComponent,
    CurrencyPipe,
  ],
  templateUrl: './order-payment-modal.component.html',
  styleUrls: ['./order-payment-modal.component.css'],
})
export class OrderPaymentModalComponent {
  // ── Signal Inputs ───────────────────────────────────────────
  isOpen = input<boolean>(false);
  order = input<Order | null>(null);
  paymentMethods = input<StorePaymentMethod[]>([]);

  // ── Signal Outputs ──────────────────────────────────────────
  isOpenChange = output<boolean>();
  closed = output<void>();
  paymentSubmitted = output<PayOrderDto & { reference?: string }>();

  // ── Internal State ──────────────────────────────────────────
  selectedMethod = signal<PaymentMethodDisplay | null>(null);
  cashReceived = signal<number>(0);
  change = signal<number>(0);
  paymentType = signal<PaymentType>('direct');
  isProcessing = signal(false);
  referenceControl = new FormControl('');

  // ── Currency ────────────────────────────────────────────────
  private currencyService = inject(CurrencyFormatService);
  currencySymbol = this.currencyService.currencySymbol;

  constructor() {
    // Reset state when modal opens (replaces ngOnChanges)
    effect(() => {
      if (this.isOpen()) {
        this.resetState();
      }
    });
  }

  // ── Computed ──────────────────────────────────────────────

  readonly displayMethods = computed<PaymentMethodDisplay[]>(() => {
    return this.paymentMethods().map((m) => this.mapToDisplay(m));
  });

  readonly orderTotal = computed(() => this.order()?.grand_total || 0);

  readonly isCashInsufficient = computed(() => {
    if (this.selectedMethod()?.type !== 'cash') return false;
    return this.cashReceived() < this.orderTotal();
  });

  readonly missingAmount = computed(() => {
    if (!this.isCashInsufficient()) return 0;
    return this.orderTotal() - this.cashReceived();
  });

  readonly canProcess = computed(() => {
    const method = this.selectedMethod();
    if (!method || this.isProcessing()) return false;

    if (method.type === 'cash') {
      return this.cashReceived() >= this.orderTotal();
    }

    if (method.requiresReference) {
      const ref = this.referenceControl.value;
      return !!ref && ref.trim().length >= 4;
    }

    return true;
  });

  // ── Methods ──────────────────────────────────────────────

  selectPaymentMethod(method: PaymentMethodDisplay): void {
    this.selectedMethod.set(method);
    this.referenceControl.reset();
    this.change.set(0);

    if (method.type === 'cash') {
      this.cashReceived.set(this.orderTotal());
      this.calculateChange();
    } else {
      this.cashReceived.set(0);
    }
  }

  calculateChange(): void {
    if (this.selectedMethod()?.type === 'cash') {
      const total = this.orderTotal();
      const received = this.cashReceived();
      this.change.set(Math.max(0, received - total));
    }
  }

  appendNumber(num: number): void {
    const current = this.cashReceived();
    const newValue = parseFloat(current.toString() + num.toString());
    this.cashReceived.set(newValue);
    this.calculateChange();
  }

  backspace(): void {
    const str = this.cashReceived().toString();
    if (str.length <= 1) {
      this.cashReceived.set(0);
    } else {
      this.cashReceived.set(parseFloat(str.slice(0, -1)));
    }
    this.calculateChange();
  }

  clearCashAmount(): void {
    this.cashReceived.set(0);
    this.change.set(0);
  }

  setHalfAmount(): void {
    this.cashReceived.set(this.orderTotal() / 2);
    this.calculateChange();
  }

  setFullAmount(): void {
    this.cashReceived.set(this.orderTotal());
    this.calculateChange();
  }

  selectPaymentType(type: PaymentType): void {
    this.paymentType.set(type);
  }

  confirmPayment(): void {
    const method = this.selectedMethod();
    if (!method || !this.canProcess()) return;

    this.isProcessing.set(true);

    const dto: PayOrderDto & { reference?: string } = {
      store_payment_method_id: Number(method.id),
      payment_type: this.paymentType(),
      ...(method.type === 'cash' ? { amount_received: this.cashReceived() } : {}),
      ...(method.requiresReference ? { reference: this.referenceControl.value || undefined } : {}),
    };

    this.paymentSubmitted.emit(dto);
  }

  onModalClosed(): void {
    this.resetState();
    this.closed.emit();
  }

  onIsOpenChange(value: boolean): void {
    this.isOpenChange.emit(value);
  }

  getReferenceError(): string | undefined {
    const control = this.referenceControl;
    if (control.touched && control.value && control.value.trim().length < 4) {
      return 'Minimo 4 caracteres';
    }
    return undefined;
  }

  // ── Private ──────────────────────────────────────────────

  private resetState(): void {
    this.selectedMethod.set(null);
    this.cashReceived.set(0);
    this.change.set(0);
    this.paymentType.set('direct');
    this.isProcessing.set(false);
    this.referenceControl.reset();
  }

  private mapToDisplay(m: StorePaymentMethod): PaymentMethodDisplay {
    const typeIconMap: Record<string, string> = {
      cash: 'banknote',
      card: 'credit-card',
      bank_transfer: 'landmark',
      paypal: 'smartphone',
    };

    const type = m.system_payment_method?.type || 'cash';
    const requiresRef = type !== 'cash';

    const refLabelMap: Record<string, string> = {
      card: 'Ultimos 4 digitos',
      bank_transfer: 'Numero de referencia',
      paypal: 'Referencia de pago',
    };

    return {
      id: m.id,
      display_name: m.display_name,
      type,
      icon: typeIconMap[type] || 'credit-card',
      requiresReference: requiresRef,
      referenceLabel: refLabelMap[type] || 'Referencia',
    };
  }
}
