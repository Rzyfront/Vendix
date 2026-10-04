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
  // Canales de reembolso (`refunds.refund_method`).
  original_payment: 'Medio de pago original',
  original: 'Medio de pago original',
  store_credit: 'Saldo a favor',
  unknown: 'Sin especificar',
};

export function cashMethodLabel(method: string): string {
  return CASH_METHOD_LABELS[method] ?? method;
}

/** Devoluciones normalizadas: usa `returns` y cae a `refunds` con backend viejo. */
export function cashReportReturns(r: CashSessionCloseReport) {
  const ret = r.returns;
  return {
    refundsCount: ret?.refunds_count ?? r.refunds.count,
    refundsTotal: ret?.refunds_total ?? r.refunds.total,
    refundsTax: ret?.refunds_tax ?? 0,
    cancelledCount: ret?.payments_cancelled_count ?? r.refunds.payment_cancellations.count,
    cancelledTotal: ret?.payments_cancelled_total ?? r.refunds.payment_cancellations.total,
  };
}

/** Impuestos de venta separados; con backend viejo cae al total único. */
export function cashReportTaxes(r: CashSessionCloseReport) {
  const sl = cashReportSales(r);
  const hasSplit = sl.product_taxes != null;
  return {
    hasSplit,
    product: hasSplit ? Number(sl.product_taxes) : sl.taxes,
    shipping: Number(sl.shipping_taxes ?? 0),
  };
}

export const CASH_OUTFLOW_LABELS: Record<string, string> = {
  refund: 'Reembolso',
  cancellation: 'Anulación',
  withdrawal: 'Retiro',
};

/** Líneas de «Cómo se llega al efectivo»; omite las que están en 0 salvo apertura y total. */
export function cashBreakdownLines(r: CashSessionCloseReport) {
  const b = r.cash_breakdown;
  if (!b) return [];
  const lines: { label: string; amount: number; sign: '+' | '−' | '='; strong?: boolean }[] = [
    { label: 'Base de apertura', amount: b.opening, sign: '+' },
    { label: 'Ventas en efectivo', amount: b.sales, sign: '+' },
    { label: 'Ingresos manuales', amount: b.cash_in, sign: '+' },
    { label: 'Reembolsos', amount: b.refunds, sign: '−' },
    { label: 'Anulaciones / cancelaciones', amount: b.cancellations, sign: '−' },
    { label: 'Retiros', amount: b.withdrawals, sign: '−' },
  ];
  return lines.filter((l, i) => i === 0 || Number(l.amount) !== 0);
}

/** Ventas: `sales_summary` si existe, si no `sales`. */
export function cashReportSales(r: CashSessionCloseReport) {
  return r.sales_summary ?? r.sales;
}

/** Hay rediseño solo si el backend manda consolidado y desglose de efectivo. */
export function cashReportHasNew(r: CashSessionCloseReport): boolean {
  return !!r.consolidated && !!r.cash_breakdown;
}

export function cashDiffLabel(diff: number | null | undefined): string {
  return diff == null ? 'Diferencia' : diff > 0 ? 'Sobrante' : diff < 0 ? 'Faltante' : 'Diferencia';
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

      @if (hasNew()) {
        <!-- Lo que debe haber -->
        <section class="csr-sec csr-main">
          <h3 class="csr-title">Lo que debe haber</h3>
          @for (m of consolidatedRows(); track m.method) {
            <div class="csr-method">
              <div class="csr-row csr-strong-plain">
                <span>{{ label(m.method) }}</span>
                <span class="csr-num">{{ m.expected | currency }}</span>
              </div>
              <div class="csr-row csr-sub">
                <span>Entró {{ m.entered | currency }} · Salió {{ m.exited | currency }}</span>
              </div>
              @if (m.counted !== null) {
                <div class="csr-row csr-sub">
                  <span>Contado {{ m.counted | currency }}</span>
                  @if (m.difference !== null) {
                    <span
                      class="csr-num"
                      [class.csr-plus]="m.difference > 0"
                      [class.csr-minus]="m.difference < 0"
                    >Diferencia {{ m.difference | currency }}</span>
                  }
                </div>
              }
            </div>
          }
          @let tot = r.consolidated!.totals;
          <div class="csr-row csr-strong csr-highlight">
            <span>TOTAL</span><span class="csr-num">{{ tot.expected | currency }}</span>
          </div>
          <div class="csr-row csr-sub">
            <span>Entró {{ tot.entered | currency }} · Salió {{ tot.exited | currency }}</span>
          </div>
        </section>
        @if (r.integrity && !r.integrity.sales_match) {
          <section class="csr-sec csr-warning" role="status">
            @for (n of r.integrity.notes; track $index) {
              <p class="csr-note-line">{{ n }}</p>
            } @empty {
              <p class="csr-note-line">Las ventas no cuadran con los pagos de la sesión.</p>
            }
          </section>
        }

        <!-- Cómo se llega al efectivo -->
        <section class="csr-sec">
          <h3 class="csr-title">Cómo se llega al efectivo</h3>
          @for (l of breakdownLines(); track l.label) {
            <div class="csr-row">
              <span>{{ l.sign }} {{ l.label }}</span>
              <span class="csr-num">{{ l.amount | currency }}</span>
            </div>
          }
          <div class="csr-row csr-strong">
            <span>= Debe tener</span><span class="csr-num">{{ r.cash_breakdown!.expected | currency }}</span>
          </div>
          @if (r.cash_breakdown!.counted !== null) {
            <div class="csr-row csr-strong">
              <span>Contado</span><span class="csr-num">{{ r.cash_breakdown!.counted | currency }}</span>
            </div>
          }
          @if (r.cash_breakdown!.difference !== null) {
            <div
              class="csr-row csr-strong"
              [class.csr-plus]="r.cash_breakdown!.difference! > 0"
              [class.csr-minus]="r.cash_breakdown!.difference! < 0"
            >
              <span>{{ diffLabelNew() }}</span>
              <span class="csr-num">{{ r.cash_breakdown!.difference | currency }}</span>
            </div>
          }
        </section>

        <!-- Salidas de la sesión -->
        <section class="csr-sec">
          <h3 class="csr-title">Salidas de la sesión</h3>
          @for (o of outflowItems(); track o.id) {
            <div class="csr-out">
              <div class="csr-row">
                <span>{{ o.time }} · {{ o.kindLabel }}{{ o.order ? ' · ' + o.order : '' }}</span>
                <span class="csr-num">{{ o.amount | currency }}</span>
              </div>
              <div class="csr-row csr-sub">
                <span>{{ o.methodLabel }}{{ o.detail ? ' · ' + o.detail : '' }}</span>
              </div>
            </div>
          } @empty {
            <p class="csr-empty">Sin salidas</p>
          }
        </section>
      } @else {
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

      }

      <!-- Ventas -->
      @let sl = sales();
      <section class="csr-sec">
        <h3 class="csr-title">{{ hasNew() ? 'Ventas' : 'Ventas cobradas' }}</h3>
        <div class="csr-row"><span>Órdenes</span><span class="csr-num">{{ sl.orders_count }}</span></div>
        <div class="csr-row"><span>Pagos</span><span class="csr-num">{{ sl.payments_count }}</span></div>
        <div class="csr-row"><span>Subtotal</span><span class="csr-num">{{ sl.subtotal | currency }}</span></div>
        <div class="csr-row"><span>Descuentos</span><span class="csr-num">{{ sl.discounts | currency }}</span></div>
        <div class="csr-row">
          <span>{{ taxes().hasSplit ? 'Impuestos productos' : 'Impuestos' }}</span>
          <span class="csr-num">{{ taxes().product | currency }}</span>
        </div>
        @if (taxes().shipping > 0) {
          <div class="csr-row"><span>Impuesto domicilios</span><span class="csr-num">{{ taxes().shipping | currency }}</span></div>
        }
        <div class="csr-row"><span>Envíos</span><span class="csr-num">{{ sl.shipping | currency }}</span></div>
        <div class="csr-row"><span>Propinas</span><span class="csr-num">{{ sl.tips | currency }}</span></div>
        <div class="csr-row csr-strong csr-highlight"><span>Total cobrado</span><span class="csr-num">{{ sl.grand_total | currency }}</span></div>
        @if (sl.tips > 0) {
          <div class="csr-row csr-strong">
            <span>Ventas netas negocio</span>
            <span class="csr-num">{{ (sl.net_sales != null ? sl.net_sales : (sl.grand_total - sl.tips)) | currency }}</span>
          </div>
        }
        <div class="csr-row"><span>Ticket promedio</span><span class="csr-num">{{ sl.average_ticket | currency }}</span></div>
        @if (cancelled(); as c) {
          <div class="csr-row"><span>Canceladas / reembolsadas ({{ c.count }})</span><span class="csr-num">{{ c.total | currency }}</span></div>
        }
      </section>

      <!-- Propinas -->
      @if (sl.tips > 0) {
        <section class="csr-sec">
          <h3 class="csr-title">Propinas ({{ sl.tips_summary?.mode_label || 'Recaudo' }})</h3>
          <div class="csr-row csr-strong">
            <span>Total propinas</span>
            <span class="csr-num">{{ sl.tips | currency }}</span>
          </div>
          @if (sl.tips_summary?.by_waiter?.length) {
            @for (w of sl.tips_summary!.by_waiter; track (w.waiter_id ?? w.waiter_name)) {
              <div class="csr-row csr-sub">
                <span>{{ w.waiter_name }}</span>
                <span class="csr-num">{{ w.total | currency }}</span>
              </div>
            }
          }
        </section>
      }

      @if (!hasNew()) {
      <!-- Devoluciones -->
      @if (hasReturns()) {
        @let ret = returns();
        <section class="csr-sec">
          <h3 class="csr-title">Devoluciones</h3>
          <div class="csr-row">
            <span>Reembolsos ({{ ret.refundsCount }})</span>
            <span class="csr-num">{{ ret.refundsTotal | currency }}</span>
          </div>
          @for (m of r.refunds.by_method; track m.method) {
            <div class="csr-row csr-sub">
              <span>{{ label(m.method) }} ({{ m.count }})</span>
              <span class="csr-num">{{ m.total | currency }}</span>
            </div>
          }
          <div class="csr-row"><span>Impuesto reembolsado</span><span class="csr-num">{{ ret.refundsTax | currency }}</span></div>
          <div class="csr-row">
            <span>Pagos anulados ({{ ret.cancelledCount }})</span>
            <span class="csr-num">{{ ret.cancelledTotal | currency }}</span>
          </div>
        </section>
      }

      <!-- Neto -->
      @if (r.net) {
        <section class="csr-sec">
          <h3 class="csr-title">Neto</h3>
          <div class="csr-row csr-strong csr-highlight"><span>Ventas netas</span><span class="csr-num">{{ r.net.net_sales | currency }}</span></div>
          @if (r.net.net_business_sales != null && sl.tips > 0) {
            <div class="csr-row csr-strong"><span>Neto negocio (sin propinas)</span><span class="csr-num">{{ r.net.net_business_sales | currency }}</span></div>
          }
          <div class="csr-row"><span>Impuesto neto</span><span class="csr-num">{{ r.net.net_taxes | currency }}</span></div>
        </section>
      }

      <!-- Pendientes por cobrar -->
      @if (r.pending_collection && r.pending_collection.count > 0) {
        <section class="csr-sec csr-warning" role="status">
          {{ r.pending_collection.count }}
          {{ r.pending_collection.count === 1 ? 'orden entregada o despachada con saldo por cobrar' : 'órdenes entregadas o despachadas con saldo por cobrar' }}:
          <strong class="csr-num">{{ r.pending_collection.total | currency }}</strong>
        </section>
      }

      }

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
      .csr-highlight { font-size: 15px; }
      .csr-warning {
        font-size: 13px;
        color: var(--color-warning-800, #92400e);
        background: var(--color-warning-50, #fffbeb);
        border-color: var(--color-warning-300, #fcd34d);
      }
      .csr-main { border-color: var(--color-primary, #2563eb); }
      .csr-strong-plain { font-weight: 600; }
      .csr-note-line { margin: 0; }
      .csr-sub { flex-wrap: wrap; }
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
  readonly hasNew = computed(() => cashReportHasNew(this.report()));
  readonly sales = computed(() => cashReportSales(this.report()));
  readonly cancelled = computed(() => {
    const c = this.report().sales_summary?.cancelled;
    return c && c.count > 0 ? c : null;
  });
  readonly consolidatedRows = computed(() => this.report().consolidated?.rows ?? []);
  readonly breakdownLines = computed(() => cashBreakdownLines(this.report()));
  readonly diffLabelNew = computed(() => cashDiffLabel(this.report().cash_breakdown?.difference));
  readonly outflowItems = computed(() => {
    const tz = this.settings.timezone();
    return (this.report().outflows ?? []).map((o) => ({
      id: o.id,
      time: formatStoreDateTime(o.at, tz),
      kindLabel: CASH_OUTFLOW_LABELS[o.kind] ?? o.kind,
      order: o.order_number ? `#${o.order_number}` : o.order_id ? `#${o.order_id}` : '',
      methodLabel: cashMethodLabel(o.payment_method),
      amount: o.amount,
      detail: [o.reason, o.user_name].filter(Boolean).join(' · '),
    }));
  });
  readonly taxes = computed(() => cashReportTaxes(this.report()));
  readonly returns = computed(() => cashReportReturns(this.report()));
  readonly hasReturns = computed(() => {
    const x = this.returns();
    return (
      x.refundsCount > 0 || x.refundsTotal > 0 || x.refundsTax > 0 ||
      x.cancelledCount > 0 || x.cancelledTotal > 0
    );
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
