import { Injectable, inject } from '@angular/core';
import { CurrencyFormatService } from '../../../../../shared/pipes/currency';
import { DocumentPrintService } from '../../../../../shared/services/print';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { StoreSettingsFacade } from '../../../../../core/store/store-settings/store-settings.facade';
import { computeSuggestedTip } from '../../../../../core/utils/tip-policy.util';
import type { CartState } from './pos-cart.service';

/** Modelo neutro de pre-cuenta (POS o mesa). */
export interface PreCuentaDoc {
  title?: string;
  customerName?: string | null;
  customerDocument?: string | null;
  lines: { qty: number; name: string; total: number }[];
  subtotal: number;
  discount: number;
  taxAmount: number;
  withholding: number;
  total: number;
  tipAlreadyCharged?: boolean;
}

/**
 * PSVERSION0001 paso 6 — impresión de Pre-cuenta.
 *
 * Imprime un snapshot de SOLO LECTURA del carrito abierto con la leyenda
 * "PRE-CUENTA — documento no fiscal". No crea orden, no toca el backend
 * (cero POST /store/orders) y no muta el carrito: `CartState` se lee y se
 * formatea a HTML local.
 *
 * La tubería de impresión es la misma del tiquete POS (`DocumentPrintService`:
 * iframe oculto, `@page` y copias desde `receipts.printing.pos_ticket`), con
 * plantilla propia porque la pre-cuenta no es un comprobante de venta.
 */
const PRE_CUENTA_PRINT_STYLES = `
  .precuenta { font-family: monospace; max-width: 72mm; margin: 0 auto; padding: 10px; background: #fff; color: #000; font-size: 12px; line-height: 1.45; }
  .precuenta h1 { font-size: 16px; text-align: center; margin: 0 0 2px; letter-spacing: 1px; }
  .precuenta .store { text-align: center; font-weight: bold; font-size: 13px; }
  .precuenta .meta { text-align: center; font-size: 11px; margin: 2px 0 6px; }
  .precuenta .legend { text-align: center; font-weight: bold; border-top: 1px dashed #000; border-bottom: 1px dashed #000; padding: 4px 0; margin: 6px 0; font-size: 12px; }
  .precuenta table { width: 100%; border-collapse: collapse; }
  .precuenta td { vertical-align: top; padding: 1px 0; }
  .precuenta .qty { white-space: nowrap; padding-right: 6px; }
  .precuenta .amount { text-align: right; white-space: nowrap; }
  .precuenta .totals { margin-top: 6px; border-top: 1px dashed #000; padding-top: 4px; }
  .precuenta .total-row td { font-weight: bold; font-size: 14px; }
  .precuenta .foot { text-align: center; font-size: 11px; margin-top: 8px; }
  @media print { .precuenta { max-width: none; } }
`;

@Injectable({ providedIn: 'root' })
export class PosPreCuentaPrintService {
  private readonly currencyService = inject(CurrencyFormatService);
  private readonly documentPrint = inject(DocumentPrintService);
  private readonly authFacade = inject(AuthFacade);
  private readonly storeSettings = inject(StoreSettingsFacade);

  /**
   * Imprime la pre-cuenta del `state` dado. El estado se clona mentalmente a
   * HTML en el acto: lecturas posteriores del carrito no afectan al papel y
   * el papel no afecta al carrito.
   */
  async printPreCuenta(state: CartState): Promise<void> {
    await this.documentPrint.print({
      document: 'pos_ticket',
      body: this.buildBody(state),
      title: 'Pre-cuenta',
      styles: PRE_CUENTA_PRINT_STYLES,
    });
  }

  /** Imprime una pre-cuenta armada desde un modelo neutro (p. ej. mesa). */
  async printPreCuentaDoc(doc: PreCuentaDoc): Promise<void> {
    await this.documentPrint.print({
      document: 'pos_ticket',
      body: this.buildDocBody(doc),
      title: 'Pre-cuenta',
      styles: PRE_CUENTA_PRINT_STYLES,
    });
  }

  /** Plantilla local de pre-cuenta (solo lectura, sin red ni mutaciones). */
  buildBody(state: CartState): string {
    const customer = state.customer;
    const summary = state.summary;
    const withholding = Number(summary?.withholdingAmount ?? 0) || 0;
    const customerName =
      customer?.name?.trim() ||
      [customer?.first_name, customer?.last_name].filter(Boolean).join(' ').trim() ||
      (customer as any)?.legal_name?.trim() ||
      customer?.email?.trim() ||
      '';
    return this.buildDocBody({
      customerName,
      customerDocument: customer?.document_number ?? null,
      lines: state.items.map((item) => ({
        qty: item.quantity,
        name:
          item.itemType === 'custom'
            ? (item.description ?? 'Ítem personalizado')
            : (item.product?.name ?? 'Ítem'),
        total: Number(item.totalPrice ?? 0) || 0,
      })),
      subtotal: Number(summary?.subtotal ?? 0) || 0,
      discount: Number(summary?.discountAmount ?? 0) || 0,
      taxAmount: Number(summary?.taxAmount ?? 0) || 0,
      withholding,
      total: Math.max(0, (Number(summary?.total ?? 0) || 0) - withholding),
    });
  }

  private buildDocBody(doc: PreCuentaDoc): string {
    const fmt = (n: number | null | undefined): string =>
      this.currencyService.format(Number(n ?? 0) || 0);
    const user = this.authFacade.user() as {
      store?: { name?: string };
      first_name?: string;
      last_name?: string;
      name?: string;
    } | null;
    const storeName = user?.store?.name ?? '';
    const cashier =
      [user?.first_name, user?.last_name].filter(Boolean).join(' ') ||
      user?.name ||
      '';
    const discount = doc.discount;
    const withholding = doc.withholding;
    const total = doc.total;
    // Locale explícito (patrón date.util.ts): el toLocaleString() pelado
    // varía según el entorno del navegador.
    const date = new Date().toLocaleString('es-CO', {
      dateStyle: 'short',
      timeStyle: 'short',
    });

    const lines = doc.lines
      .map((line) => {
        return (
          `<tr><td class="qty">${this.esc(String(line.qty))} x</td>` +
          `<td>${this.esc(line.name)}</td>` +
          `<td class="amount">${this.esc(fmt(line.total))}</td></tr>`
        );
      })
      .join('');

    const customerName = doc.customerName?.trim() ?? '';
    const customerRow =
      customerName !== ''
        ? `<div class="meta">Cliente: ${this.esc(customerName)}${doc.customerDocument ? ` · ${this.esc(doc.customerDocument)}` : ''}</div>`
        : '';

    const discountRow =
      discount > 0
        ? `<tr><td colspan="2">Descuento aplicado</td><td class="amount">-${this.esc(fmt(discount))}</td></tr>`
        : '';
    // Propina sugerida: base = productos brutos (subtotal + impuestos, antes
    // de descuento, sin envío), igual que el backend.
    const policy = this.storeSettings.tipPolicy();
    const grossBase = doc.subtotal + doc.taxAmount;
    const suggestedTip =
      !doc.tipAlreadyCharged && policy.suggested && grossBase > 0
        ? computeSuggestedTip(policy, grossBase)
        : 0;
    const hasTip = suggestedTip > 0;
    const tipLabel =
      policy.suggested?.type === 'percentage'
        ? `Propina sugerida (${policy.suggested.value} %)`
        : 'Propina sugerida';
    const tipRows = hasTip
      ? `<tr><td colspan="2">${this.esc(tipLabel)}</td><td class="amount">${this.esc(fmt(suggestedTip))}</td></tr>` +
        `<tr class="total-row"><td colspan="2">Total con propina</td><td class="amount">${this.esc(fmt(total + suggestedTip))}</td></tr>`
      : '';
    const withholdingRow =
      withholding > 0
        ? `<tr><td colspan="2">Retención</td><td class="amount">-${this.esc(fmt(withholding))}</td></tr>`
        : '';

    return (
      `<div class="precuenta">` +
      `<h1>${this.esc(doc.title ?? 'PRE-CUENTA')}</h1>` +
      (storeName !== '' ? `<div class="store">${this.esc(storeName)}</div>` : '') +
      `<div class="meta">${this.esc(date)}${cashier !== '' ? ` · ${this.esc(cashier)}` : ''}</div>` +
      customerRow +
      `<div class="legend">PRE-CUENTA — documento no fiscal</div>` +
      `<table>${lines}</table>` +
      `<table class="totals">` +
      `<tr><td colspan="2">Subtotal</td><td class="amount">${this.esc(fmt(doc.subtotal))}</td></tr>` +
      discountRow +
      `<tr><td colspan="2">Impuestos</td><td class="amount">${this.esc(fmt(doc.taxAmount))}</td></tr>` +
      withholdingRow +
      `<tr class="total-row"><td colspan="2">${hasTip ? 'Total sin propina' : 'TOTAL'}</td><td class="amount">${this.esc(fmt(total))}</td></tr>` +
      tipRows +
      `</table>` +
      `<div class="foot">Cuenta abierta sujeta a cambios.<br>No constituye factura ni comprobante fiscal.</div>` +
      `</div>`
    );
  }

  private esc(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
