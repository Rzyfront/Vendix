import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { StoreSettingsFacade } from '../../../../../core/store/store-settings/store-settings.facade';
import { CurrencyPipe } from '../../../../../shared/pipes/currency';
import { formatStoreDateTime } from '../../../../../shared/utils/date.util';
import { CashSessionCloseReport } from '../services/pos-cash-register.service';

/**
 * Etiquetas de método de pago: el backend manda `method` crudo, sin label.
 * Compartido por la vista, el ticket impreso y el modal de cierre para que los
 * tres hablen igual.
 */
export const CASH_METHOD_LABELS: Record<string, string | undefined> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  bank_transfer: 'Transferencia',
  voucher: 'Datáfono',
  wompi: 'Wompi',
  wallet: 'Wallet',
  paypal: 'PayPal',
};

export function cashMethodLabel(method: string): string {
  return CASH_METHOD_LABELS[method] ?? method;
}

/**
 * Reporte consolidado de una sesión de caja. Presentacional: solo totales,
 * nunca movimientos uno a uno. El ticket impreso
 * (`CashSessionReportPrintService`) replica estas mismas secciones y cifras.
 */
@Component({
  selector: 'app-cash-session-report',
  standalone: true,
  imports: [CurrencyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let r = report();
    <div class="csr">
      <!-- Encabezado -->
      <section class="csr-sec">
        <p class="csr-head-title">
          {{ r.session.register?.name || 'Caja' }}
          <span class="csr-muted">· Sesión #{{ r.session.id }}</span>
        </p>
        <div class="csr-grid">
          <span class="csr-label">Abrió</span>
          <span class="csr-val">{{ r.session.opened_by?.name || '—' }}</span>
          <span class="csr-label">Apertura</span>
          <span class="csr-val">{{ openedAt() }}</span>
          <span class="csr-label">Cerró</span>
          <span class="csr-val">{{ r.session.closed_by?.name || '—' }}</span>
          <span class="csr-label">Cierre</span>
          <span class="csr-val">{{ closedAt() || '—' }}</span>
        </div>
        @if (r.session.closing_notes) {
          <p class="csr-notes">{{ r.session.closing_notes }}</p>
        }
      </section>

      <!-- Métodos de pago -->
      <section class="csr-sec">
        <h3 class="csr-title">Métodos de pago</h3>
        @for (m of r.payment_methods; track m.method) {
          <div class="csr-row">
            <span>{{ label(m.method) }} ({{ m.count }})</span>
            <span class="csr-num">{{ m.total | currency }}</span>
          </div>
        } @empty {
          <p class="csr-empty">Sin pagos registrados</p>
        }
      </section>

      <!-- Efectivo -->
      <section class="csr-sec">
        <h3 class="csr-title">Efectivo</h3>
        <div class="csr-row"><span>Apertura</span><span class="csr-num">{{ r.cash.opening | currency }}</span></div>
        <div class="csr-row"><span>Ventas en efectivo</span><span class="csr-num">{{ r.cash.cash_sales | currency }}</span></div>
        <div class="csr-row">
          <span>Entradas ({{ r.cash.cash_in.count }})</span>
          <span class="csr-num">{{ r.cash.cash_in.total | currency }}</span>
        </div>
        <div class="csr-row">
          <span>Salidas ({{ r.cash.cash_out.count }})</span>
          <span class="csr-num">{{ r.cash.cash_out.total | currency }}</span>
        </div>
        <div class="csr-row">
          <span>Reembolsos en efectivo ({{ r.cash.cash_refunds.count }})</span>
          <span class="csr-num">{{ r.cash.cash_refunds.total | currency }}</span>
        </div>
        <div class="csr-row csr-strong">
          <span>Esperado</span><span class="csr-num">{{ r.cash.expected | currency }}</span>
        </div>
        @if (r.cash.declared !== null) {
          <div class="csr-row csr-strong">
            <span>Declarado</span><span class="csr-num">{{ r.cash.declared | currency }}</span>
          </div>
        }
        @if (r.cash.difference !== null) {
          <div
            class="csr-row csr-strong"
            [class.csr-plus]="r.cash.difference > 0"
            [class.csr-minus]="r.cash.difference < 0"
          >
            <span>{{ differenceLabel() }}</span>
            <span class="csr-num">{{ absDifference() | currency }}</span>
          </div>
        }
      </section>

      <!-- Ventas -->
      <section class="csr-sec">
        <h3 class="csr-title">Ventas</h3>
        <div class="csr-row"><span>Órdenes</span><span class="csr-num">{{ r.sales.orders_count }}</span></div>
        <div class="csr-row"><span>Pagos</span><span class="csr-num">{{ r.sales.payments_count }}</span></div>
        <div class="csr-row"><span>Subtotal</span><span class="csr-num">{{ r.sales.subtotal | currency }}</span></div>
        <div class="csr-row"><span>Descuentos</span><span class="csr-num">{{ r.sales.discounts | currency }}</span></div>
        <div class="csr-row"><span>Impuestos</span><span class="csr-num">{{ r.sales.taxes | currency }}</span></div>
        <div class="csr-row"><span>Propinas</span><span class="csr-num">{{ r.sales.tips | currency }}</span></div>
        <div class="csr-row csr-strong"><span>Total</span><span class="csr-num">{{ r.sales.grand_total | currency }}</span></div>
        <div class="csr-row"><span>Ticket promedio</span><span class="csr-num">{{ r.sales.average_ticket | currency }}</span></div>
      </section>

      <!-- Reembolsos -->
      <section class="csr-sec">
        <h3 class="csr-title">Reembolsos</h3>
        <div class="csr-row csr-strong">
          <span>Total ({{ r.refunds.count }})</span>
          <span class="csr-num">{{ r.refunds.total | currency }}</span>
        </div>
        @for (m of r.refunds.by_method; track m.method) {
          <div class="csr-row csr-sub">
            <span>{{ label(m.method) }} ({{ m.count }})</span>
            <span class="csr-num">{{ m.total | currency }}</span>
          </div>
        } @empty {
          <p class="csr-empty">Sin reembolsos</p>
        }
        @if (r.refunds.payment_cancellations.count > 0) {
          <div class="csr-row">
            <span>Anulaciones de pago ({{ r.refunds.payment_cancellations.count }})</span>
            <span class="csr-num">{{ r.refunds.payment_cancellations.total | currency }}</span>
          </div>
        }
      </section>

      <!-- Descuentos -->
      <section class="csr-sec">
        <h3 class="csr-title">Descuentos</h3>
        <div class="csr-row csr-strong">
          <span>Total ({{ r.discounts.orders_with_discount }} órdenes)</span>
          <span class="csr-num">{{ r.discounts.total | currency }}</span>
        </div>
        @for (p of r.discounts.promotions; track p.name) {
          <div class="csr-row csr-sub">
            <span>Promoción: {{ p.name }} ({{ p.count }})</span>
            <span class="csr-num">{{ p.total | currency }}</span>
          </div>
        } @empty {
          <p class="csr-empty">Sin promociones</p>
        }
        @for (c of r.discounts.coupons; track c.code) {
          <div class="csr-row csr-sub">
            <span>Cupón: {{ c.code }} ({{ c.count }})</span>
            <span class="csr-num">{{ c.total | currency }}</span>
          </div>
        } @empty {
          <p class="csr-empty">Sin cupones</p>
        }
        @if (r.discounts.other.count > 0) {
          <div class="csr-row csr-sub">
            <span>Otros descuentos ({{ r.discounts.other.count }})</span>
            <span class="csr-num">{{ r.discounts.other.total | currency }}</span>
          </div>
        }
      </section>
    </div>
  `,
  styles: [
    `
      :host { display: block; }
      .csr { display: flex; flex-direction: column; gap: 12px; }
      .csr-sec {
        border: 1px solid var(--color-border, #e5e7eb);
        border-radius: 10px;
        padding: 12px;
        background: var(--color-surface, #fff);
      }
      .csr-title {
        margin: 0 0 6px;
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--color-neutral-600, #4b5563);
      }
      .csr-head-title { margin: 0 0 8px; font-size: 16px; font-weight: 700; color: var(--color-text-primary); }
      .csr-muted { font-weight: 400; color: var(--color-neutral-600, #4b5563); font-size: 13px; }
      .csr-grid { display: grid; grid-template-columns: auto 1fr; gap: 2px 12px; font-size: 13px; }
      .csr-label { color: var(--color-neutral-600, #4b5563); }
      .csr-val { color: var(--color-text-primary); text-align: right; }
      .csr-notes { margin: 8px 0 0; font-size: 12px; font-style: italic; color: var(--color-neutral-600, #4b5563); }
      .csr-row {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        padding: 3px 0;
        font-size: 13px;
        color: var(--color-text-primary);
      }
      .csr-sub { padding-left: 10px; font-size: 12px; }
      .csr-strong { font-weight: 700; border-top: 1px dashed var(--color-border, #e5e7eb); margin-top: 3px; padding-top: 5px; }
      .csr-num { white-space: nowrap; font-variant-numeric: tabular-nums; }
      .csr-empty { margin: 2px 0; font-size: 12px; color: var(--color-neutral-600, #4b5563); }
      .csr-plus { color: var(--color-success-700, #15803d); }
      .csr-minus { color: var(--color-error-700, #b91c1c); }
    `,
  ],
})
export class CashSessionReportComponent {
  readonly report = input.required<CashSessionCloseReport>();

  private readonly settings = inject(StoreSettingsFacade);

  readonly openedAt = computed(() =>
    formatStoreDateTime(this.report().session.opened_at, this.settings.timezone()),
  );
  readonly closedAt = computed(() => {
    const closed = this.report().session.closed_at;
    return closed ? formatStoreDateTime(closed, this.settings.timezone()) : '';
  });
  readonly differenceLabel = computed(() => {
    const diff = this.report().cash.difference ?? 0;
    return diff > 0 ? 'Sobrante' : diff < 0 ? 'Faltante' : 'Diferencia';
  });
  readonly absDifference = computed(() => Math.abs(this.report().cash.difference ?? 0));

  label(method: string): string {
    return cashMethodLabel(method);
  }
}
