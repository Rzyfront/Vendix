import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';

import {
  PaymentModalComponent,
  type PaymentSubmit,
} from '../../../../../../shared/components';
import {
  fromStorePaymentMethod,
  type PaymentMethod,
} from '../../../../../../shared/models/payment-method.model';
import { Order } from '../../interfaces/order.interface';
import { StorePaymentMethod } from '../../../settings/payments/interfaces/payment-methods.interface';

/**
 * Order payment / abono modal — thin wrapper around the shared
 * `app-payment-modal` (charge-consolidation Phase 4).
 *
 * The shared collector owns the payment-method grid, the cash keypad, the
 * optional amount override (used for a credit abono) and the existing-installment
 * selector. This wrapper only adapts the order's data to the collector inputs and
 * RE-EMITS the normalized {@link PaymentSubmit} upward. The parent
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
  imports: [PaymentModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './order-payment-modal.component.html',
})
export class OrderPaymentModalComponent {
  // ── Signal Inputs ───────────────────────────────────────────
  readonly isOpen = input<boolean>(false);
  readonly order = input<Order | null>(null);
  readonly paymentMethods = input<StorePaymentMethod[]>([]);
  readonly isCreditOrder = input<boolean>(false);
  readonly remainingBalance = input<number>(0);
  readonly installments = input<any[]>([]);
  readonly creditType = input<string>('');
  readonly preSelectedInstallment = input<any>(null);
  readonly isProcessing = input<boolean>(false);

  // ── Signal Outputs ──────────────────────────────────────────
  readonly isOpenChange = output<boolean>();
  readonly closed = output<void>();
  /** Normalized submit forwarded up; the page maps it to `PayOrderDto`. */
  readonly paymentSubmitted = output<PaymentSubmit>();

  // ── Derived ─────────────────────────────────────────────────
  /**
   * Suggested charge: the full order total for a regular order, the remaining
   * balance for a credit abono (the collector still lets the operator override it
   * when `allowAmountOverride` is on).
   */
  readonly chargeAmount = computed<number>(() => {
    if (this.isCreditOrder()) {
      return this.remainingBalance() || Number(this.order()?.grand_total) || 0;
    }
    return Number(this.order()?.grand_total) || 0;
  });

  /** Only feed a remaining balance to the collector for credit abonos. */
  readonly collectorRemaining = computed<number | undefined>(() =>
    this.isCreditOrder() ? this.remainingBalance() : undefined,
  );

  readonly modalSubtitle = computed<string>(() => {
    const num = this.order()?.order_number;
    return num ? 'Orden #' + num : '';
  });

  readonly submitLabel = computed<string>(() =>
    this.isCreditOrder() ? 'Registrar Abono' : 'Confirmar Pago',
  );

  readonly modalTitle = computed<string>(() =>
    this.isCreditOrder() ? 'Registrar Abono' : 'Procesar Pago',
  );

  /** Adapt the store payment-method rows to the collector's canonical shape. */
  readonly collectorMethods = computed<PaymentMethod[]>(() =>
    (this.paymentMethods() ?? []).map((m) => fromStorePaymentMethod(m)),
  );
}
