import { Component, computed, effect, input, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import {
  ModalComponent,
  ButtonComponent,
  IconComponent,
  PaymentModalComponent,
} from '../../../../../../../shared/components/index';
import type { PaymentSubmit } from '../../../../../../../shared/components/index';
import { CurrencyPipe } from '../../../../../../../shared/pipes/index';
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
 *                  (`context="table"`). Its normalized {@link PaymentSubmit}
 *                  is mapped here into {@link TablePaymentSubmit} and emitted
 *                  via `pay`; the page combines it with the order totals and
 *                  calls `TablesService.payTableSession` (`POST /store/payments/pos`).
 *
 *   - `'confirm'` (E2 — staff confirmation of diner-initiated payments):
 *                  the mesero reconciles a `pending` payment row created
 *                  by the comensal flow (cash / transfer). No method picker
 *                  (the row already carries the method), no cash flow, no
 *                  reference. Emits `confirm` with the payment id; the page
 *                  calls `TablesService.confirmPayment`. The session REMAINS
 *                  OPEN — staff can chain multiple confirms until the
 *                  order is fully paid.
 *
 * T1 — la propina del modo 'pos' la renderiza la tarjeta del
 * `app-payment-collector` (que ya trae toggle Monto/Porcentaje y
 * campo de mesero) y se emite dentro del propio `PaymentSubmit.tip`
 * / `tipType` / `tipValue` / `tipWaiterId`. El modo 'confirm' no
 * tiene sección de propina: la confirmación de un pago del comensal
 * es un acto administrativo (reconciliar el pendiente), no un
 * cobro nuevo con sus propios atributos monetarios. Si la
 * confirmación requiriera agregar propina, el camino canónico
 * sigue siendo el cobro POS normal.
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
  /**
   * T1 — el collector emite los 4 campos de propina ya resueltos
   * (monto + tipo + valor + mesero) en camelCase. Este DTO los
   * traduce a snake_case (forma del DTO del backend
   * `create-pos-payment.dto.ts` y contrato externo que el page y
   * otros consumidores — ej. `table-session-page.component.ts` —
   * esperan). El nombre del campo externo es INMUTABLE: lo que
   * cambió en T1 es de DÓNDE sale el valor (la tarjeta del
   * collector), no la forma del payload.
   */
  tip_amount?: number;
  tip_type?: 'percentage' | 'fixed';
  tip_value?: number;
  tip_waiter_id?: number | null;
  /** QUI-728 (E.1) — cuenta bancaria elegida para transferencia. */
  bank_account_id?: number;
}

/** Output for the `'confirm'` mode — staff confirms a diner's payment. */
export interface TablePaymentConfirmSubmit {
  payment_id: number;
  /**
   * T1 — el page (`table-session-page`) propaga `tip_amount` y
   * metadatos del `TablePaymentSubmit` original para que el
   * backend pueda anexar/registrar la propina en modo confirm
   * cuando el operador la suma al conciliar el pendiente.
   */
  tip_amount?: number;
  tip_type?: 'percentage' | 'fixed';
  tip_value?: number;
  tip_waiter_id?: number | null;
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

  /** 'confirm' mode gate — the mesero just confirms the pending row. */
  readonly canProcess = computed(() => {
    if (this.isProcessing()) return false;
    return !!this.pendingPayment();
  });

  constructor() {
    // T1 — el effect ya no resetea campos de propina: no existen
    // localmente. La propina vive en el collector y se reinicia
    // cuando el modal del collector se monta de nuevo (gate @if).
    effect(() => {
      if (this.isOpen()) {
        this.resetState();
      }
    });
  }

  /**
   * Map the shared collector's normalized {@link PaymentSubmit} into the
   * table settlement DTO and emit `pay`. T1 — la propina (monto + tipo +
   * valor + mesero) viene del collector (ya resuelta: el % se calculó
   * contra el subtotal en `tipAmount()`). Este modal traduce camelCase
   * → snake_case para preservar el contrato externo que el page y los
   * consumidores (`table-session-page.component.ts`) esperan.
   */
  onCollectorSubmit(submit: PaymentSubmit): void {
    const payload: TablePaymentSubmit = {
      store_payment_method_id: Number(submit.storePaymentMethodId),
      ...(submit.amountReceived != null
        ? { amount_received: submit.amountReceived }
        : {}),
      ...(submit.reference ? { payment_reference: submit.reference } : {}),
      // T1 — la tarjeta del collector emite los 4 metadatos ya
      // resueltos (`tip` es el monto, `tipValue` puede ser % o monto
      // crudo, `tipType` es 'percentage'|'fixed', `tipWaiterId` el id
      // del mesero si fue ligado). El page espera snake_case, así que
      // se traduce acá sin tocar el contrato del backend ni del page.
      ...(submit.tip && submit.tip > 0
        ? {
            tip_amount: submit.tip,
            tip_type: submit.tipType,
            tip_value: submit.tipValue ?? submit.tip,
            tip_waiter_id: submit.tipWaiterId ?? null,
          }
        : {}),
      // QUI-728 (E.1) — el selector de cuentas del collector emite bankAccountId.
      ...(submit.bankAccountId != null
        ? { bank_account_id: submit.bankAccountId }
        : {}),
    };
    this.pay.emit(payload);
  }

  /** 'confirm' mode submit — staff confirms a diner's pending payment. */
  submit(): void {
    const p = this.pendingPayment();
    if (!p || !this.canProcess()) return;
    this.confirmPayment.emit({ payment_id: p.id });
  }

  onIsOpenChange(value: boolean): void {
    this.isOpenChange.emit(value);
  }

  onModalClosed(): void {
    this.resetState();
    this.closed.emit();
  }

  private resetState(): void {
    // Sin campos de propina locales: la única fuente de estado era
    // `tip / tipType / tipWaiterId`, todos eliminados en T1. La
    // función queda como hook para futuros resets del modo confirm.
  }
}
