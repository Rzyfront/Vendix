import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import {
  ModalComponent,
  ButtonComponent,
  IconComponent,
  PaymentModalComponent,
} from '../../../../../../../shared/components/index';
import type { PaymentSubmit } from '../../../../../../../shared/components/index';
import {
  CurrencyFormatService,
  CurrencyPipe,
} from '../../../../../../../shared/pipes/index';
import { PaymentPendingView } from '../../interfaces/table.interface';

/**
 * Restaurant Suite — table checkout / payment-confirmation modal.
 *
 * Two modes driven by the `mode` input:
 *
 *   - `'pos'`     (default): settles an open table's bill directly from the
 *                  session page when `restaurant.enable_table_checkout` is ON.
 *                  The collection UI (method picker, cash flow, reference, tip,
 *                  keypad) is delegated to the shared, capability-driven
 *                  `app-payment-modal` / `app-payment-collector`
 *                  (`context="table"`). Its normalized {@link PaymentSubmit} is
 *                  mapped here into {@link TablePaymentSubmit} and emitted via
 *                  `pay`; the page combines it with the order totals and calls
 *                  `TablesService.payTableSession` (`POST /store/payments/pos`).
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
    DatePipe,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    CurrencyPipe,
    PaymentModalComponent,
  ],
  templateUrl: './table-payment-modal.component.html',
  styleUrl: './table-payment-modal.component.scss',
})
export class TablePaymentModalComponent {
  private readonly currencyService = inject(CurrencyFormatService);

  // ── Inputs ──────────────────────────────────────────────────────────
  readonly isOpen = input<boolean>(false);
  /**
   * Operation mode:
   *  - 'pos'     → POS-style bill settlement (default).
   *  - 'confirm' → staff reconciles a pending diner payment (E2).
   */
  readonly mode = input<TablePaymentMode>('pos');
  /** Bill total (order grand_total). Used as the collector's base amount. */
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
  /** Gratuity added on top of the bill (confirm mode). */
  readonly tip = signal<number>(0);

  readonly currencySymbol = this.currencyService.currencySymbol;

  /** Title bound to the modal — varies by mode. */
  readonly modalTitle = computed(() =>
    this.mode() === 'confirm' ? 'Confirmar pago' : 'Cobrar mesa',
  );

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

  /** 'confirm' mode gate — the mesero just confirms the pending row. */
  readonly canProcess = computed(() => {
    if (this.isProcessing()) return false;
    return !!this.pendingPayment();
  });

  constructor() {
    // Reset gratuity every time the modal opens (both modes). The 'pos'
    // collection UI now lives in the shared collector, which is created
    // fresh on each open (app-modal gates its content with @if).
    effect(() => {
      if (this.isOpen()) {
        this.resetState();
      }
    });
  }

  onTipInput(value: number): void {
    this.tip.set(Number.isFinite(value) && value > 0 ? value : 0);
  }

  /**
   * Map the shared collector's normalized {@link PaymentSubmit} into the
   * table settlement DTO and emit `pay`. Keeps the exact contract the page
   * feeds to `TablesService.payTableSession` (`POST /store/payments/pos`).
   */
  onCollectorSubmit(submit: PaymentSubmit): void {
    const payload: TablePaymentSubmit = {
      store_payment_method_id: Number(submit.storePaymentMethodId),
      ...(submit.amountReceived != null
        ? { amount_received: submit.amountReceived }
        : {}),
      ...(submit.reference ? { payment_reference: submit.reference } : {}),
      ...(submit.tip && submit.tip > 0 ? { tip_amount: submit.tip } : {}),
    };
    this.pay.emit(payload);
  }

  /** 'confirm' mode submit — staff confirms a diner's pending payment. */
  submit(): void {
    const p = this.pendingPayment();
    if (!p || !this.canProcess()) return;
    const payload: TablePaymentConfirmSubmit = {
      payment_id: p.id,
      ...(this.tip() > 0 ? { tip_amount: this.tip() } : {}),
    };
    this.confirmPayment.emit(payload);
  }

  onIsOpenChange(value: boolean): void {
    this.isOpenChange.emit(value);
  }

  onModalClosed(): void {
    this.resetState();
    this.closed.emit();
  }

  private resetState(): void {
    this.tip.set(0);
  }
}
