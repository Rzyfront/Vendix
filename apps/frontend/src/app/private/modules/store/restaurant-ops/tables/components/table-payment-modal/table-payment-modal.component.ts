import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import {
  ModalComponent,
  ButtonComponent,
  IconComponent,
  InputComponent,
} from '../../../../../../../shared/components/index';
import {
  CurrencyFormatService,
  CurrencyPipe,
} from '../../../../../../../shared/pipes/index';
import { PosPaymentService } from '../../../../pos/services/pos-payment.service';
import { PaymentMethod } from '../../../../pos/models/payment.model';

/**
 * Restaurant Suite — table checkout payment.
 *
 * Settles an open table's bill directly from the session page when
 * `restaurant.enable_table_checkout` is ON. It is a focused replica of the
 * order-details "modal cobro estilo-POS" (reference only — NOT edited):
 * payment-method picker, cash flow with `amount_received`, transfer/card
 * `payment_reference`, and an `isProcessing` flag driven by the parent.
 *
 * The component does NOT call the backend itself — it emits a `pay` event
 * with the minimal payment fields. The page combines those with the
 * order's `subtotal` / `grand_total` and calls
 * `TablesService.payTableSession` (POST /store/payments/pos with
 * `table_session_id`).
 *
 * Zoneless + Signals: every template-read piece of state is a signal.
 */
export interface TablePaymentSubmit {
  store_payment_method_id: number;
  amount_received?: number;
  payment_reference?: string;
}

@Component({
  selector: 'app-table-payment-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    InputComponent,
    CurrencyPipe,
  ],
  templateUrl: './table-payment-modal.component.html',
  styleUrl: './table-payment-modal.component.scss',
})
export class TablePaymentModalComponent {
  private readonly posPaymentService = inject(PosPaymentService);
  private readonly currencyService = inject(CurrencyFormatService);
  private readonly destroyRef = inject(DestroyRef);

  // ── Inputs ──────────────────────────────────────────────────────────
  readonly isOpen = input<boolean>(false);
  /** Bill total (order grand_total). Used as the cash default + summary. */
  readonly total = input<number>(0);
  readonly tableName = input<string>('');
  /** Driven by the parent while the POS payment request is in flight. */
  readonly isProcessing = input<boolean>(false);

  // ── Outputs ─────────────────────────────────────────────────────────
  readonly isOpenChange = output<boolean>();
  readonly closed = output<void>();
  readonly pay = output<TablePaymentSubmit>();

  // ── State ───────────────────────────────────────────────────────────
  readonly methods = signal<PaymentMethod[]>([]);
  readonly isLoadingMethods = signal(false);
  readonly selectedMethod = signal<PaymentMethod | null>(null);
  readonly cashReceived = signal<number>(0);
  readonly referenceControl = new FormControl('');

  readonly currencySymbol = this.currencyService.currencySymbol;

  readonly change = computed(() => {
    if (this.selectedMethod()?.type !== 'cash') return 0;
    return Math.max(0, this.cashReceived() - this.total());
  });

  readonly isCashInsufficient = computed(() => {
    if (this.selectedMethod()?.type !== 'cash') return false;
    return this.cashReceived() < this.total();
  });

  readonly missingAmount = computed(() =>
    this.isCashInsufficient() ? this.total() - this.cashReceived() : 0,
  );

  readonly canProcess = computed(() => {
    const method = this.selectedMethod();
    if (!method || this.isProcessing()) return false;
    if (method.type === 'cash') {
      return this.cashReceived() >= this.total();
    }
    if (method.requiresReference) {
      const ref = this.referenceControl.value;
      return !!ref && ref.trim().length >= 4;
    }
    return true;
  });

  constructor() {
    // Reset + (lazy) load methods every time the modal opens.
    effect(() => {
      if (this.isOpen()) {
        this.resetState();
        if (this.methods().length === 0) {
          this.loadMethods();
        }
      }
    });
  }

  private loadMethods(): void {
    this.isLoadingMethods.set(true);
    this.posPaymentService
      .getPaymentMethods()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (methods) => {
          const enabled = (methods ?? []).filter((m) => m.enabled !== false);
          this.methods.set(enabled);
          this.isLoadingMethods.set(false);
          if (enabled.length > 0 && !this.selectedMethod()) {
            this.selectMethod(enabled[0]);
          }
        },
        error: () => {
          this.methods.set([]);
          this.isLoadingMethods.set(false);
        },
      });
  }

  selectMethod(method: PaymentMethod): void {
    this.selectedMethod.set(method);
    this.referenceControl.reset();
    if (method.type === 'cash') {
      this.cashReceived.set(this.total());
    } else {
      this.cashReceived.set(0);
    }
  }

  onCashInput(value: number): void {
    this.cashReceived.set(Number.isFinite(value) ? value : 0);
  }

  setFullAmount(): void {
    this.cashReceived.set(this.total());
  }

  getReferenceError(): string | undefined {
    const control = this.referenceControl;
    if (control.touched && control.value && control.value.trim().length < 4) {
      return 'Mínimo 4 caracteres';
    }
    return undefined;
  }

  confirm(): void {
    const method = this.selectedMethod();
    if (!method || !this.canProcess()) return;
    const payload: TablePaymentSubmit = {
      store_payment_method_id: Number(method.id),
      ...(method.type === 'cash'
        ? { amount_received: this.cashReceived() }
        : {}),
      ...(method.requiresReference && this.referenceControl.value?.trim()
        ? { payment_reference: this.referenceControl.value.trim() }
        : {}),
    };
    this.pay.emit(payload);
  }

  onIsOpenChange(value: boolean): void {
    this.isOpenChange.emit(value);
  }

  onModalClosed(): void {
    this.resetState();
    this.closed.emit();
  }

  private resetState(): void {
    this.selectedMethod.set(null);
    this.cashReceived.set(0);
    this.referenceControl.reset();
  }
}
