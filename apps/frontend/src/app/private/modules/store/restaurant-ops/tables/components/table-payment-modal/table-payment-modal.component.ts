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
import { DatePipe } from '@angular/common';
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
import { PaymentPendingView } from '../../interfaces/table.interface';

/**
 * Restaurant Suite — table checkout / payment-confirmation modal.
 *
 * Two modes driven by the `mode` input:
 *
 *   - `'pos'`     (default, legacy): settles an open table's bill
 *                  directly from the session page when
 *                  `restaurant.enable_table_checkout` is ON. Focused
 *                  replica of the order-details "modal cobro estilo-POS":
 *                  payment-method picker, cash flow with `amount_received`,
 *                  transfer/card `payment_reference`, optional gratuity.
 *                  Emits `pay` with the minimal payment fields; the page
 *                  combines them with the order's `subtotal` / `grand_total`
 *                  and calls `TablesService.payTableSession`.
 *
 *   - `'confirm'` (E2 — staff confirmation of diner-initiated payments):
 *                  the mesero reconciles a `pending` payment row created
 *                  by the comensal flow (cash / transfer). No method
 *                  picker (the row already carries the method), no cash
 *                  flow, no reference. Emits `confirm` with the payment
 *                  id and an optional tip; the page calls
 *                  `TablesService.confirmPayment`. The session REMAINS
 *                  OPEN — staff can chain multiple confirms until the
 *                  order is fully paid.
 *
 * The modal does NOT call the backend itself in either mode; the page
 * owns the network call so it can refresh the pending list and surface
 * the SSE-driven live reflection.
 *
 * Zoneless + Signals: every template-read piece of state is a signal.
 */
export interface TablePaymentSubmit {
  store_payment_method_id: number;
  amount_received?: number;
  payment_reference?: string;
  /** Optional gratuity added on top of the bill (only sent when > 0). */
  tip_amount?: number;
}

/** Output for the `'confirm'` mode — staff confirms a diner's payment. */
export interface TablePaymentConfirmSubmit {
  payment_id: number;
  /** Optional gratuity echo-back (only sent when > 0). */
  tip_amount?: number;
}

export type TablePaymentMode = 'pos' | 'confirm';

@Component({
  selector: 'app-table-payment-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    DatePipe,
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
  /**
   * Operation mode:
   *  - 'pos'     → POS-style bill settlement (legacy default).
   *  - 'confirm' → staff reconciles a pending diner payment (E2).
   */
  readonly mode = input<TablePaymentMode>('pos');
  /** Bill total (order grand_total). Used as the cash default + summary. */
  readonly total = input<number>(0);
  readonly tableName = input<string>('');
  /** Driven by the parent while the POS payment request is in flight. */
  readonly isProcessing = input<boolean>(false);
  /**
   * Pending payment row to reconcile (only meaningful in 'confirm' mode).
   * Renders the method/amount and is the target of the `confirm` emit.
   */
  readonly pendingPayment = input<PaymentPendingView | null>(null);

  // ── Outputs ─────────────────────────────────────────────────────────
  readonly isOpenChange = output<boolean>();
  readonly closed = output<void>();
  readonly pay = output<TablePaymentSubmit>();
  /** Fires only in 'confirm' mode when the mesero confirms a payment. */
  readonly confirmPayment = output<TablePaymentConfirmSubmit>();

  // ── State ───────────────────────────────────────────────────────────
  readonly methods = signal<PaymentMethod[]>([]);
  readonly isLoadingMethods = signal(false);
  readonly selectedMethod = signal<PaymentMethod | null>(null);
  readonly cashReceived = signal<number>(0);
  /** Gratuity added on top of the bill. Signal → templates + computeds stay reactive. */
  readonly tip = signal<number>(0);
  readonly referenceControl = new FormControl('');

  readonly currencySymbol = this.currencyService.currencySymbol;

  /** Title bound to the modal — varies by mode. */
  readonly modalTitle = computed(() =>
    this.mode() === 'confirm' ? 'Confirmar pago' : 'Cobrar mesa',
  );

  /** Amount actually charged: bill total + gratuity. */
  readonly effectiveTotal = computed(() => this.total() + this.tip());

  /** Payment amount in 'confirm' mode (the row's amount as a number). */
  readonly pendingPaymentAmount = computed(() => {
    const p = this.pendingPayment();
    if (!p) return 0;
    return Number(p.amount) || 0;
  });

  /** Payment amount in 'confirm' mode (the row's amount + optional tip). */
  readonly confirmEffectiveTotal = computed(() => {
    return this.pendingPaymentAmount() + this.tip();
  });

  readonly change = computed(() => {
    if (this.selectedMethod()?.type !== 'cash') return 0;
    return Math.max(0, this.cashReceived() - this.effectiveTotal());
  });

  readonly isCashInsufficient = computed(() => {
    if (this.selectedMethod()?.type !== 'cash') return false;
    return this.cashReceived() < this.effectiveTotal();
  });

  readonly missingAmount = computed(() =>
    this.isCashInsufficient() ? this.effectiveTotal() - this.cashReceived() : 0,
  );

  /** In 'pos' mode: requires method + amount/ref constraints. */
  readonly canProcess = computed(() => {
    if (this.isProcessing()) return false;
    if (this.mode() === 'confirm') {
      // Confirm is just "I see the pending row + optional tip".
      return !!this.pendingPayment();
    }
    const method = this.selectedMethod();
    if (!method) return false;
    if (method.type === 'cash') {
      return this.cashReceived() >= this.effectiveTotal();
    }
    if (method.requiresReference) {
      const ref = this.referenceControl.value;
      return !!ref && ref.trim().length >= 4;
    }
    return true;
  });

  constructor() {
    // Reset + (lazy) load methods every time the modal opens. In
    // 'confirm' mode we skip the method fetch entirely.
    effect(() => {
      if (this.isOpen()) {
        this.resetState();
        if (this.mode() === 'pos' && this.methods().length === 0) {
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
      this.cashReceived.set(this.effectiveTotal());
    } else {
      this.cashReceived.set(0);
    }
  }

  onCashInput(value: number): void {
    this.cashReceived.set(Number.isFinite(value) ? value : 0);
  }

  onTipInput(value: number): void {
    this.tip.set(Number.isFinite(value) && value > 0 ? value : 0);
  }

  setFullAmount(): void {
    this.cashReceived.set(this.effectiveTotal());
  }

  getReferenceError(): string | undefined {
    const control = this.referenceControl;
    if (control.touched && control.value && control.value.trim().length < 4) {
      return 'Mínimo 4 caracteres';
    }
    return undefined;
  }

  /** Submit handler — branches by mode. */
  submit(): void {
    if (this.mode() === 'confirm') {
      const p = this.pendingPayment();
      if (!p || !this.canProcess()) return;
      const payload: TablePaymentConfirmSubmit = {
        payment_id: p.id,
        ...(this.tip() > 0 ? { tip_amount: this.tip() } : {}),
      };
      this.confirmPayment.emit(payload);
      return;
    }
    // 'pos' mode — legacy POS-style settlement.
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
      ...(this.tip() > 0 ? { tip_amount: this.tip() } : {}),
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
    this.tip.set(0);
    this.referenceControl.reset();
  }
}
