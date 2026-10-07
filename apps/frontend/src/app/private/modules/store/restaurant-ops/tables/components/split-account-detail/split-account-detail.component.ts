import { Component, computed, input, model, output } from '@angular/core';
import {
  BadgeComponent,
  ButtonComponent,
  ModalComponent,
} from '../../../../../../../shared/components';
import { CurrencyPipe } from '../../../../../../../shared/pipes';
import { formatStoreDateTime } from '../../../../../../../shared/utils/date.util';
import type {
  SplitAccountPayment,
  SplitFinancialAccount,
  SplitResultMode,
} from '../../interfaces';
import {
  STATUS_BADGE,
  STATUS_LABEL,
  accountStatus,
  invoiceStatusLabel,
  money,
  paymentNextUrl,
  paymentStateLabel,
  primaryAction,
  type SplitPrimaryAction,
} from './split-account-view.util';

/** Detalle de solo lectura de una cuenta independiente; la acción la ejecuta el panel. */
@Component({
  selector: 'app-split-account-detail',
  standalone: true,
  imports: [ModalComponent, BadgeComponent, ButtonComponent, CurrencyPipe],
  templateUrl: './split-account-detail.component.html',
})
export class SplitAccountDetailComponent {
  readonly isOpen = model(false);
  readonly account = input.required<SplitFinancialAccount>();
  readonly mode = input<SplitResultMode | null>(null);
  readonly currency = input('');
  readonly canPay = input(false);
  readonly canInvoice = input(false);
  readonly electronicInvoicingLive = input(false);
  readonly timezone = input('America/Bogota');
  readonly busy = input(false);
  readonly actionRequested = output<SplitPrimaryAction>();

  readonly money = money;
  readonly status = computed(() => accountStatus(this.account()));
  readonly statusLabel = computed(() => STATUS_LABEL[this.status()]);
  readonly statusVariant = computed(() => STATUS_BADGE[this.status()]);
  readonly balance = computed(() => money(this.account().remaining_balance));
  readonly total = computed(() => money(this.account().grand_total));
  readonly payAmount = computed(() => money(this.account().available_to_pay));
  readonly isItemsMode = computed(() => this.mode() === 'items');
  readonly title = computed(() =>
    this.account().role === 'paid_original'
      ? 'Pagos hechos antes de dividir'
      : this.account().label,
  );
  readonly customerName = computed(() => {
    const a = this.account();
    return a.customer_name || a.customer_alias || 'Consumidor final';
  });
  readonly action = computed(() =>
    primaryAction(this.account(), {
      canPay: this.canPay(),
      canInvoice: this.canInvoice(),
      electronicInvoicingLive: this.electronicInvoicingLive(),
    }),
  );
  readonly invoiceHint = computed(() => {
    const a = this.account();
    if (a.invoice) return '';
    return this.status() === 'paid'
      ? 'La cuenta está cobrada y lista para facturar.'
      : 'Cobra la cuenta para poder facturarla.';
  });
  readonly invoiceStatus = computed(() => invoiceStatusLabel(this.account().invoice));
  readonly breakdown = computed(() => {
    const a = this.account();
    return [
      { label: 'Base', value: money(a.subtotal_amount), negative: false },
      { label: 'Descuento', value: money(a.discount_amount), negative: true },
      { label: 'Impuestos', value: money(a.tax_amount), negative: false },
      { label: 'Envío', value: money(a.shipping_cost), negative: false },
      { label: 'Propina', value: money(a.tip_amount), negative: false },
    ];
  });
  readonly shares = computed(() =>
    this.account().lines.map((line) => ({
      id: line.id,
      name: this.lineName(line),
      percent: Math.round(Number(line.share_ratio) * 10000) / 100,
      total: money(line.total),
    })),
  );
  readonly itemLines = computed(() =>
    this.account().lines.map((line) => {
      const qty = Number(line.original_quantity ?? 0);
      return {
        id: line.id,
        name: this.lineName(line),
        quantity: qty,
        unitPrice: qty > 0 ? money(line.subtotal) / qty : money(line.subtotal),
        tax: money(line.tax),
        total: money(line.total),
      };
    }),
  );
  readonly payments = computed(() =>
    this.account().payments.map((p: SplitAccountPayment) => ({
      id: p.id,
      method: p.payment_method_name || 'Medio de pago',
      date: p.created_at
        ? formatStoreDateTime(p.created_at, this.timezone())
        : '',
      amount: money(p.amount),
      state: paymentStateLabel(p.state),
      continueUrl: paymentNextUrl(p),
      canConfirm: !!p.can_confirm && this.canPay(),
      paymentId: p.id,
    })),
  );

  private lineName(line: { product_name: string; variant_name: string | null }): string {
    return line.variant_name
      ? `${line.product_name} · ${line.variant_name}`
      : line.product_name;
  }
  confirmPayment(paymentId: number): void {
    this.actionRequested.emit({ kind: 'confirm', label: 'Confirmar recibido', paymentId });
  }
  runAction(): void {
    const action = this.action();
    if (action) this.actionRequested.emit(action);
  }
}
