import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  untracked,
  viewChild,
} from '@angular/core';

import {
  ButtonComponent,
  IconComponent,
  ModalComponent,
  PaymentCollectorComponent,
  type PaymentSubmit,
} from '../../../../../../shared/components';
import { CurrencyPipe } from '../../../../../../shared/pipes';
import {
  fromStorePaymentMethod,
  PaymentMethodType,
  type PaymentMethod,
} from '../../../../../../shared/models/payment-method.model';
import { Order } from '../../interfaces/order.interface';
import { StorePaymentMethod } from '../../../settings/payments/interfaces/payment-methods.interface';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';

/**
 * Contrato congelado con el backend (plan pos-draft-without-cash-session,
 * paso 4): HTTP 409 cuando un cobro exige caja abierta y el usuario no
 * tiene sesión (`require_session_for_sales` activo).
 */
const CASH_SESSION_REQUIRED_CODE = 'CASH_SESSION_REQUIRED_001';
const CASH_SESSION_REQUIRED_MESSAGE = 'Abre tu caja para registrar pagos.';

/**
 * Order payment / abono modal around the shared payment collector.
 *
 * The shared collector owns the payment-method grid, cash keypad, amount
 * override and installment selector. This wrapper validates a credit abono
 * against the current order balance before forwarding PaymentSubmit. The parent
 * `order-details-page` maps that submit to `PayOrderDto` and calls the SAME flow
 * endpoints as before: `flow/pay` for a regular order, `flow/credit-payment` for a
 * credit abono (routing stays keyed on `isCreditOrder`, exactly as today).
 *
 * The public open/close contract (`isOpen` / `isOpenChange` / `closed`) and the
 * `paymentSubmitted` output NAME are intentionally unchanged so the page keeps
 * working; only the emitted type widened from `PayOrderDto` to `PaymentSubmit`.
 *
 * NOTE on credit: the collector's `credito` mode (installment-plan creation via
 * `CreditTerms`) is intentionally NOT enabled here — the order-flow backend has
 * no plan-creation endpoint (`flow/credit-payment` accepts the abono `PayOrderDto`,
 * not plan terms). Enabling it would ship an unmappable tab. Wompi/wallet are also
 * disabled to match the previous modal's capabilities (direct + reference methods).
 */
@Component({
  selector: 'app-order-payment-modal',
  standalone: true,
  imports: [ModalComponent, PaymentCollectorComponent, ButtonComponent, IconComponent, CurrencyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './order-payment-modal.component.html',
  styleUrl: './order-payment-modal.component.css',
})
export class OrderPaymentModalComponent {
  // ── Signal Inputs ───────────────────────────────────────────
  readonly isOpen = input<boolean>(false);
  readonly order = input<Order | null>(null);
  readonly paymentMethods = input<StorePaymentMethod[]>([]);
  readonly isCreditOrder = input<boolean>(false);
  /**
   * Fase 2 (paso 8): cobro manual pendiente (pago `pending` de confirmación
   * manual o saldo parcial). Habilita monto editable ≤ saldo, preselecciona
   * efectivo y muestra el saldo restante. Nunca coincide con crédito.
   */
  readonly manualPaymentPending = input<boolean>(false);
  readonly remainingBalance = input<number>(0);
  readonly installments = input<any[]>([]);
  readonly creditType = input<string>('');
  readonly preSelectedInstallment = input<any>(null);
  readonly isProcessing = input<boolean>(false);
  /**
   * Último error del cobro, fijado por la página en el `error` del
   * `flow/pay` / `flow/credit-payment`. La página NO cierra el modal ante
   * un fallo, así el cajero lee el motivo sin perder el cobro.
   */
  readonly paymentError = input<unknown>(null);

  // ── Signal Outputs ──────────────────────────────────────────
  readonly isOpenChange = output<boolean>();
  readonly closed = output<void>();
  /** Normalized submit forwarded up; the page maps it to `PayOrderDto`. */
  readonly paymentSubmitted = output<PaymentSubmit>();

  private readonly collector = viewChild<PaymentCollectorComponent>('collector');

  constructor() {
    // Fase 2 (paso 8): efectivo preseleccionado en el cobro manual (mismo
    // patrón que `pos-payment-step`): corre al montar el collector o al
    // resolver los métodos mientras nada está elegido; nunca pisa la
    // elección explícita del operador.
    effect(() => {
      if (!this.manualPaymentPending()) return;
      const collector = this.collector();
      const methods = this.collectorMethods();
      if (!collector || methods.length === 0 || collector.selectedMethod()) return;
      untracked(() => {
        const pick = methods.find((m) => m.type === PaymentMethodType.CASH) ?? null;
        if (pick) collector.selectMethod(pick, { advance: false });
      });
    });
  }

  // ── Derived ─────────────────────────────────────────────────
  /**
   * Suggested charge: the full order total for a regular order, the remaining
   * balance for a credit abono (the collector still lets the operator override it
   * when `allowAmountOverride` is on). Fase 2 (paso 8): the manual lane also
   * suggests the outstanding balance, falling back to the grand total when the
   * order carries a manual `pending` payment but no computed balance yet.
   */
  readonly chargeAmount = computed<number>(() => {
    if (this.isCreditOrder()) {
      return this.remainingBalance();
    }
    if (this.manualPaymentPending() && this.remainingBalance() > 0) {
      return this.remainingBalance();
    }
    return Number(this.order()?.grand_total) || 0;
  });

  /** Only feed a remaining balance to the collector for credit abonos. */
  readonly collectorRemaining = computed<number | undefined>(() => {
    if (this.isCreditOrder()) return this.remainingBalance();
    // Fase 2 (paso 8): el cobro manual también parte del saldo (con fallback
    // a `chargeAmount`, nunca 0 por un balance aún sin computar).
    if (this.manualPaymentPending()) return this.chargeAmount();
    return undefined;
  });

  readonly modalSubtitle = computed<string>(() => {
    const num = this.order()?.order_number;
    return num ? 'Orden #' + num : '';
  });

  readonly submitLabel = computed<string>(() =>
    // Fase 2 (paso 8): el cobro manual REGISTRA (monto + método), no confirma.
    this.isCreditOrder() ? 'Registrar Abono' : this.manualPaymentPending() ? 'Registrar Pago' : 'Confirmar Pago',
  );

  readonly modalTitle = computed<string>(() =>
    this.isCreditOrder() ? 'Registrar Abono' : 'Procesar Pago',
  );

  /** Adapt the store payment-method rows to the collector's canonical shape. */
  readonly collectorMethods = computed<PaymentMethod[]>(() =>
    (this.paymentMethods() ?? []).map((m) => fromStorePaymentMethod(m)),
  );

  /**
   * Mensaje inline solo cuando el cobro fue rechazado por falta de caja
   * (`CASH_SESSION_REQUIRED_001`, leído vía `parseApiError`). Cualquier
   * otro error sigue por el toast de la página (retorna `null`).
   * Tolera el wrapper `buildApiError` (`errorCode` + crudo en `cause`)
   * igual que el handler de `order-details-page`.
   */
  readonly cashGateMessage = computed<string | null>(() => {
    const error = this.paymentError();
    if (!error) return null;
    const wrapped = error as { errorCode?: unknown; cause?: unknown } | null;
    const directCode =
      typeof wrapped?.errorCode === 'string' ? wrapped.errorCode : null;
    const code =
      directCode ?? parseApiError(wrapped?.cause ?? error).errorCode;
    return code === CASH_SESSION_REQUIRED_CODE
      ? CASH_SESSION_REQUIRED_MESSAGE
      : null;
  });

  /** Compare at money precision; cash received can exceed this and return
   * change, but the abono itself must not exceed the debt. */
  creditAmountExceedsBalance(amount: number): boolean {
    return this.isCreditOrder() &&
      Math.round(Number(amount) * 100) > Math.round(this.remainingBalance() * 100);
  }

  /**
   * Fase 2 (paso 8): el cobro manual tampoco supera el saldo (`amount` ≤
   * saldo; el vuelto sale de `amount_received`, no del monto). Misma
   * precisión monetaria que el tope del abono.
   */
  manualAmountExceedsBalance(amount: number): boolean {
    return !this.isCreditOrder() &&
      this.manualPaymentPending() &&
      Math.round(Number(amount) * 100) > Math.round(this.chargeAmount() * 100);
  }

  /** Saldo que queda pendiente después de cobrar `amount` (≥ 0). */
  manualRemainingAfter(amount: number): number {
    return Math.max(0, Math.round((this.chargeAmount() - Number(amount || 0)) * 100) / 100);
  }

  submitPayment(submit: PaymentSubmit): void {
    if (
      this.isProcessing() ||
      this.creditAmountExceedsBalance(submit.amount) ||
      this.manualAmountExceedsBalance(submit.amount)
    ) return;
    this.paymentSubmitted.emit(submit);
  }

  close(): void {
    this.isOpenChange.emit(false);
  }
}
