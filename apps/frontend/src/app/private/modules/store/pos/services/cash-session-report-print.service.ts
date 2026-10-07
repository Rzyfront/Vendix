import { Injectable, inject } from '@angular/core';
import { CurrencyFormatService } from '../../../../../shared/pipes/currency';
import { DocumentPrintService } from '../../../../../shared/services/print';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { StoreSettingsFacade } from '../../../../../core/store/store-settings/store-settings.facade';
import { formatStoreDateTime } from '../../../../../shared/utils/date.util';
import {
  CASH_OUTFLOW_LABELS,
  cashBreakdownLines,
  cashDiffLabel,
  cashMethodLabel,
  cashReportHasNew,
  cashReportReturns,
  cashReportSales,
  cashReportTaxes,
} from '../components/cash-session-report.component';
import type { CashSessionCloseReport } from './pos-cash-register.service';

const CURRENCY_WAIT_TIMEOUT_MS = 1_000;
const CURRENCY_WAIT_STEP_MS = 50;

const REPORT_PRINT_STYLES = `
  .csr { font-family: monospace; max-width: 72mm; margin: 0 auto; padding: 10px; background: #fff; color: #000; font-size: 12px; line-height: 1.45; }
  .csr h1 { font-size: 15px; text-align: center; margin: 0 0 2px; letter-spacing: 1px; }
  .csr .store { text-align: center; font-weight: bold; font-size: 13px; }
  .csr .meta { text-align: center; font-size: 11px; margin: 2px 0; }
  .csr h2 { font-size: 12px; margin: 8px 0 2px; padding-top: 4px; border-top: 1px dashed #000; text-transform: uppercase; }
  .csr table { width: 100%; border-collapse: collapse; }
  .csr td { vertical-align: top; padding: 1px 0; }
  .csr .amount { text-align: right; white-space: nowrap; padding-left: 6px; }
  .csr .note { font-size: 11px; border: 1px solid #000; padding: 2px 4px; margin-top: 4px; }
  .csr .sub td:first-child { padding-left: 8px; }
  .csr .strong td { font-weight: bold; }
  .csr .empty { font-size: 11px; }
  .csr .notes { font-size: 11px; font-style: italic; margin-top: 4px; }
  .csr .sign { margin-top: 26px; }
  .csr .sign div { border-top: 1px solid #000; text-align: center; font-size: 11px; margin-top: 26px; padding-top: 2px; }
  @media print { .csr { max-width: none; } }
`;

/**
 * Imprime el reporte consolidado de una sesión de caja como ticket
 * (`pos_ticket`: hereda papel y copias de la impresora de la tienda). Mismas
 * secciones y cifras que `CashSessionReportComponent`; solo totales.
 */
@Injectable({ providedIn: 'root' })
export class CashSessionReportPrintService {
  private readonly currencyService = inject(CurrencyFormatService);
  private readonly documentPrint = inject(DocumentPrintService);
  private readonly authFacade = inject(AuthFacade);
  private readonly settings = inject(StoreSettingsFacade);

  async print(report: CashSessionCloseReport): Promise<void> {
    await this.ensureCurrencyLoaded();
    await this.documentPrint.print({
      document: 'pos_ticket',
      body: this.buildBody(report),
      title: `Cierre de caja #${report.session.id}`,
      styles: REPORT_PRINT_STYLES,
      trigger: 'explicit',
    });
  }

  buildBody(r: CashSessionCloseReport): string {
    const tz = this.settings.timezone();
    const fmt = (n: number | null | undefined): string =>
      this.esc(this.currencyService.format(Number(n ?? 0) || 0));
    const user = this.authFacade.user() as {
      store?: { name?: string };
      first_name?: string;
      last_name?: string;
      name?: string;
    } | null;
    const storeName = user?.store?.name ?? '';
    const printedBy =
      [user?.first_name, user?.last_name].filter(Boolean).join(' ') ||
      user?.name ||
      '';
    const printedAt = formatStoreDateTime(new Date(), tz);

    const row = (label: string, amount: string, cls = ''): string =>
      `<tr class="${cls}"><td>${this.esc(label)}</td><td class="amount">${amount}</td></tr>`;
    const empty = (text: string): string => `<div class="empty">${this.esc(text)}</div>`;
    const section = (title: string, inner: string): string =>
      `<h2>${this.esc(title)}</h2>${inner}`;
    const table = (rows: string): string => `<table>${rows}</table>`;

    const methods =
      r.payment_methods.length > 0
        ? table(
            r.payment_methods
              .map((m) => row(`${cashMethodLabel(m.method)} (${m.count})`, fmt(m.total)))
              .join(''),
          )
        : empty('Sin pagos registrados');

    const diff = r.cash.difference;
    const diffLabel = diff == null ? '' : diff > 0 ? 'Sobrante' : diff < 0 ? 'Faltante' : 'Diferencia';
    const cash = table(
      row('Apertura', fmt(r.cash.opening)) +
        row('Ventas en efectivo', fmt(r.cash.cash_sales)) +
        row(`Entradas (${r.cash.cash_in.count})`, fmt(r.cash.cash_in.total)) +
        row(`Salidas (${r.cash.cash_out.count})`, fmt(r.cash.cash_out.total)) +
        row(`Reembolsos en efectivo (${r.cash.cash_refunds.count})`, fmt(r.cash.cash_refunds.total)) +
        row('Esperado', fmt(r.cash.expected), 'strong') +
        (r.cash.declared != null ? row('Declarado', fmt(r.cash.declared), 'strong') : '') +
        (diff != null ? row(diffLabel, fmt(Math.abs(diff)), 'strong') : ''),
    );

    const tx = cashReportTaxes(r);
    const sl = cashReportSales(r);
    const cancelled = r.sales_summary?.cancelled;
    const sales = table(
      row('Órdenes', String(sl.orders_count)) +
        row('Pagos', String(sl.payments_count)) +
        row('Subtotal', fmt(sl.subtotal)) +
        row('Descuentos', fmt(sl.discounts)) +
        row(tx.hasSplit ? 'Impuestos productos' : 'Impuestos', fmt(tx.product)) +
        (tx.shipping > 0 ? row('Impuesto domicilios', fmt(tx.shipping)) : '') +
        row('Envíos', fmt(sl.shipping)) +
        row('Propinas', fmt(sl.tips)) +
        row('Total cobrado', fmt(sl.grand_total), 'strong') +
        row('Ticket promedio', fmt(sl.average_ticket)) +
        (cancelled && cancelled.count > 0
          ? row(`Canceladas / reembolsadas (${cancelled.count})`, fmt(cancelled.total))
          : ''),
    );

    const ret = cashReportReturns(r);
    const hasReturns =
      ret.refundsCount > 0 || ret.refundsTotal > 0 || ret.refundsTax > 0 ||
      ret.cancelledCount > 0 || ret.cancelledTotal > 0;
    const returnsSection = hasReturns
      ? section(
          'Devoluciones',
          table(
            row(`Reembolsos (${ret.refundsCount})`, fmt(ret.refundsTotal)) +
              r.refunds.by_method
                .map((m) => row(`${cashMethodLabel(m.method)} (${m.count})`, fmt(m.total), 'sub'))
                .join('') +
              row('Impuesto reembolsado', fmt(ret.refundsTax)) +
              row(`Pagos anulados (${ret.cancelledCount})`, fmt(ret.cancelledTotal)),
          ),
        )
      : '';

    const netSection = r.net
      ? section(
          'Neto',
          table(
            row('Ventas netas', fmt(r.net.net_sales), 'strong') +
              row('Impuesto neto', fmt(r.net.net_taxes)),
          ),
        )
      : '';

    const pc = r.pending_collection;
    const pendingSection =
      pc && pc.count > 0
        ? `<div class="notes"><b>${this.esc(
            `${pc.count} ${pc.count === 1 ? 'orden entregada o despachada con saldo por cobrar' : 'órdenes entregadas o despachadas con saldo por cobrar'}: `,
          )}${fmt(pc.total)}</b></div>`
        : '';

    const d = r.discounts;
    const discountsRows =
      row(`Total (${d.orders_with_discount} órdenes)`, fmt(d.total), 'strong') +
      d.promotions.map((p) => row(`Promoción: ${p.name} (${p.count})`, fmt(p.total), 'sub')).join('') +
      d.coupons.map((c) => row(`Cupón: ${c.code} (${c.count})`, fmt(c.total), 'sub')).join('') +
      (d.other.count > 0 ? row(`Otros descuentos (${d.other.count})`, fmt(d.other.total), 'sub') : '');
    const discounts =
      table(discountsRows) +
      (d.promotions.length === 0 ? empty('Sin promociones') : '') +
      (d.coupons.length === 0 ? empty('Sin cupones') : '');

    const s = r.session;
    const header =
      `<h1>CIERRE DE CAJA</h1>` +
      (storeName !== '' ? `<div class="store">${this.esc(storeName)}</div>` : '') +
      `<div class="meta">${this.esc(s.register?.name || 'Caja')} · Sesión #${s.id}</div>` +
      `<div class="meta">Abrió: ${this.esc(s.opened_by?.name || '—')} · ${this.esc(formatStoreDateTime(s.opened_at, tz))}</div>` +
      `<div class="meta">Cerró: ${this.esc(s.closed_by?.name || '—')} · ${s.closed_at ? this.esc(formatStoreDateTime(s.closed_at, tz)) : '—'}</div>` +
      (s.closing_notes ? `<div class="notes">${this.esc(s.closing_notes)}</div>` : '');

    const hasNew = cashReportHasNew(r);
    let top: string;
    if (hasNew) {
      const c = r.consolidated!;
      const b = r.cash_breakdown!;
      const consolidated =
        c.rows
          .map((m) => {
            const dif = m.difference;
            return (
              table(row(cashMethodLabel(m.method), fmt(m.expected), 'strong')) +
              `<div class="empty">Entró ${fmt(m.entered)} · Salió ${fmt(m.exited)}</div>` +
              (m.counted != null
                ? `<div class="empty">Contado ${fmt(m.counted)}${dif != null ? ` · ${this.esc(cashDiffLabel(dif))} ${fmt(dif)}` : ''}</div>`
                : '')
            );
          })
          .join('') +
        table(row('TOTAL', fmt(c.totals.expected), 'strong')) +
        `<div class="empty">Entró ${fmt(c.totals.entered)} · Salió ${fmt(c.totals.exited)}</div>`;
      const integrity =
        r.integrity && !r.integrity.sales_match
          ? `<div class="note">${(r.integrity.notes.length > 0
              ? r.integrity.notes
              : ['Las ventas no cuadran con los pagos de la sesión.']
            )
              .map((n) => this.esc(n))
              .join('<br>')}</div>`
          : '';
      const lines = cashBreakdownLines(r)
        .map((l) => row(`${l.sign} ${l.label}`, fmt(l.amount)))
        .join('');
      const breakdown = table(
        lines +
          row('= Debe tener', fmt(b.expected), 'strong') +
          (b.counted != null ? row('Contado', fmt(b.counted), 'strong') : '') +
          (b.difference != null ? row(cashDiffLabel(b.difference), fmt(b.difference), 'strong') : ''),
      );
      const outflows = r.outflows ?? [];
      const outflowsHtml =
        outflows.length > 0
          ? outflows
              .map((o) => {
                const ord = o.order_number ? ` #${o.order_number}` : o.order_id ? ` #${o.order_id}` : '';
                const detail = [o.reason, o.user_name].filter(Boolean).join(' · ');
                return (
                  table(
                    row(
                      `${formatStoreDateTime(o.at, tz)} ${CASH_OUTFLOW_LABELS[o.kind] ?? o.kind}${ord}`,
                      fmt(o.amount),
                    ),
                  ) +
                  `<div class="empty">${this.esc(cashMethodLabel(o.payment_method))}${detail ? ` · ${this.esc(detail)}` : ''}</div>`
                );
              })
              .join('')
          : empty('Sin salidas');
      top =
        section('Lo que debe haber', consolidated) +
        integrity +
        section('Cómo se llega al efectivo', breakdown) +
        section('Salidas de la sesión', outflowsHtml) +
        section('Ventas', sales);
    } else {
      top =
        section('Métodos de pago', methods) +
        section('Efectivo', cash) +
        section('Ventas cobradas', sales) +
        returnsSection +
        netSection +
        pendingSection;
    }

    return (
      `<div class="csr">` +
      header +
      top +
      section('Descuentos', discounts) +
      `<div class="meta" style="margin-top:8px">Impreso: ${this.esc(printedAt)}${printedBy !== '' ? ` · ${this.esc(printedBy)}` : ''}</div>` +
      `<div class="sign"><div>Firma cajero</div><div>Firma supervisor</div></div>` +
      `</div>`
    );
  }

  private async ensureCurrencyLoaded(): Promise<void> {
    if (this.currencyService.currentCurrency()) return;
    try {
      await this.currencyService.loadCurrency();
    } catch {
      // Se imprime con el símbolo de respaldo antes que abortar el ticket.
    }
    for (
      let waited = 0;
      waited < CURRENCY_WAIT_TIMEOUT_MS &&
      !this.currencyService.currentCurrency() &&
      this.currencyService.loading();
      waited += CURRENCY_WAIT_STEP_MS
    ) {
      await new Promise<void>((resolve) => setTimeout(resolve, CURRENCY_WAIT_STEP_MS));
    }
  }

  private esc(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
