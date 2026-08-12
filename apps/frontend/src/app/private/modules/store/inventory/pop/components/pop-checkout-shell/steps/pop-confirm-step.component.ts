import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { CurrencyFormatService, CurrencyPipe } from '../../../../../../../../shared/pipes/currency/currency.pipe';
import { IconComponent } from '../../../../../../../../shared/components/icon/icon.component';
import { PopCartState } from '../../../interfaces/pop-cart.interface';
import { PopPaymentPlan } from './pop-payment-step.component';

/**
 * Paso Confirmación del wizard POP: resumen final de la compra.
 *
 * Muestra qué se compra (productos/cantidades), cuánto se paga hoy, cuánto
 * queda debiendo y en qué fechas (plan de pago vigente del paso Pago). Puro
 * display — no valida nada: la validación vive en el paso de pago.
 */
@Component({
  selector: 'app-pop-confirm-step',
  standalone: true,
  imports: [CurrencyPipe, DatePipe, IconComponent],
  templateUrl: './pop-confirm-step.component.html',
  styleUrl: './pop-confirm-step.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PopConfirmStepComponent {
  private readonly currencyService = inject(CurrencyFormatService);

  readonly cartState = input<PopCartState | null>(null);
  readonly supplierName = input('');
  readonly locationName = input('');
  readonly actionType = input<'create' | 'create-receive'>('create');
  readonly plan = input<PopPaymentPlan | null>(null);
  readonly ackReceive = input(false);
  /** Ref de la OC pendiente de recepción (reintento) → banner en vez de resumen normal. */
  readonly retryOrderRef = input<string | null>(null);

  readonly orderTotal = computed<number>(
    () => Math.round(Number(this.cartState()?.summary?.total ?? 0) * 100) / 100,
  );

  readonly isRetry = computed<boolean>(() => !!this.retryOrderRef());

  readonly modeLabel = computed<string>(() => {
    const mode = this.plan()?.payment_plan;
    switch (mode) {
      case 'partial':
        return 'Abono parcial';
      case 'deferred':
        return 'Pago diferido';
      case 'installments':
        return 'Crédito con cuotas';
      default:
        return 'Pago inmediato';
    }
  });

  /**
   * Lo que se paga hoy: en `immediate` el TOTAL (el pago se registra completo);
   * en `partial` el abono; en diferido/cuotas 0.
   */
  readonly downPaymentToday = computed<number>(() => {
    const plan = this.plan();
    if (plan?.payment_plan === 'immediate') return this.orderTotal();
    return Math.round(Number(plan?.down_payment_amount ?? 0) * 100) / 100;
  });

  /** Lo que queda debiendo tras el pago de hoy. */
  readonly pendingBalance = computed<number>(
    () => Math.round((this.orderTotal() - this.downPaymentToday()) * 100) / 100,
  );

  /** Fechas/montos pendientes: cuotas del plan o la única fecha del diferido. */
  readonly schedules = computed<Array<{ date: string; amount: number }>>(() => {
    const plan = this.plan();
    if (!plan) return [];
    if (plan.payment_plan === 'installments') {
      return (plan.payment_installments ?? []).map((row) => ({
        date: row.scheduled_date,
        amount: Math.round(Number(row.amount ?? 0) * 100) / 100,
      }));
    }
    if (plan.payment_plan === 'deferred' && plan.payment_due_date) {
      return [{ date: plan.payment_due_date, amount: this.pendingBalance() }];
    }
    return [];
  });

  /** True cuando el plan deja algo pendiente por fechar (abono parcial sin diferido). */
  readonly hasUndatedBalance = computed<boolean>(
    () =>
      this.plan()?.payment_plan === 'partial' &&
      this.pendingBalance() > 0.005,
  );

  /**
   * Montos del PLAN DE PAGO (cuotas, abono, saldo): 2 decimales cuando el monto
   * no es entero, 0 cuando es entero. El `| currency` del proyecto formatea con
   * los decimales de la moneda (COP = 0) y redondearía 1.50 → $2; el paso Pago
   * muestra esos montos con 2 decimales (app-input `currencyDecimals=2`), así
   * que el resumen debe respetar la misma precisión. Los totales de la orden
   * (subtotal/total) siguen con `| currency` — convención COP sin decimales.
   */
  formatPlanMoney(amount: number): string {
    return this.currencyService.format(amount, Number.isInteger(amount) ? 0 : 2);
  }

  constructor() {
    // La moneda debe estar cargada para formatPlanMoney (ídem paso Pago).
    this.currencyService.loadCurrency();
  }
}