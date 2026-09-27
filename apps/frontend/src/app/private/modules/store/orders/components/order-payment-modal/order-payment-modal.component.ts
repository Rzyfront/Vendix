import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
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
  type PaymentMethod,
} from '../../../../../../shared/models/payment-method.model';
import { Order } from '../../interfaces/order.interface';
import { StorePaymentMethod } from '../../../settings/payments/interfaces/payment-methods.interface';

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
      return this.remainingBalance();
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

  /** Compare at money precision; cash received can exceed this and return
   * change, but the abono itself must not exceed the debt. */
  creditAmountExceedsBalance(amount: number): boolean {
    return this.isCreditOrder() &&
      Math.round(Number(amount) * 100) > Math.round(this.remainingBalance() * 100);
  }

  submitPayment(submit: PaymentSubmit): void {
    if (this.isProcessing() || this.creditAmountExceedsBalance(submit.amount)) return;
    this.paymentSubmitted.emit(submit);
  }

  close(): void {
    this.isOpenChange.emit(false);
  }
}
