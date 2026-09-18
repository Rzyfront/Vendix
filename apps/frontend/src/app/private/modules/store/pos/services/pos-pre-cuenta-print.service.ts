import { Injectable, inject } from '@angular/core';
import { CurrencyFormatService } from '../../../../../shared/pipes/currency';
import { DocumentPrintService } from '../../../../../shared/services/print';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import type { CartState } from './pos-cart.service';

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

  /** Plantilla local de pre-cuenta (solo lectura, sin red ni mutaciones). */
  buildBody(state: CartState): string {
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
    const customer = state.customer as {
      name?: string;
      document_number?: string;
    } | null;
    const summary = state.summary;
    const discount = Number(summary?.discountAmount ?? 0) || 0;
    const withholding = Number(summary?.withholdingAmount ?? 0) || 0;
    const total = Math.max(
      0,
      (Number(summary?.total ?? 0) || 0) - withholding,
    );
    const date = new Date().toLocaleString();

    const lines = state.items
      .map((item) => {
        const name =
          item.itemType === 'custom'
            ? (item.description ?? 'Ítem personalizado')
            : (item.product?.name ?? 'Ítem');
        return (
          `<tr><td class="qty">${this.esc(String(item.quantity))} x</td>` +
          `<td>${this.esc(name)}</td>` +
          `<td class="amount">${this.esc(fmt(item.totalPrice))}</td></tr>`
        );
      })
      .join('');

    const customerRow =
      customer?.name != null && customer.name !== ''
        ? `<div class="meta">Cliente: ${this.esc(customer.name)}${customer.document_number ? ` · ${this.esc(customer.document_number)}` : ''}</div>`
        : '';

    const discountRow =
      discount > 0
        ? `<tr><td colspan="2">Descuento aplicado</td><td class="amount">-${this.esc(fmt(discount))}</td></tr>`
        : '';
    const withholdingRow =
      withholding > 0
        ? `<tr><td colspan="2">Retención</td><td class="amount">-${this.esc(fmt(withholding))}</td></tr>`
        : '';

    return (
      `<div class="precuenta">` +
      `<h1>PRE-CUENTA</h1>` +
      (storeName !== '' ? `<div class="store">${this.esc(storeName)}</div>` : '') +
      `<div class="meta">${this.esc(date)}${cashier !== '' ? ` · ${this.esc(cashier)}` : ''}</div>` +
      customerRow +
      `<div class="legend">PRE-CUENTA — documento no fiscal</div>` +
      `<table>${lines}</table>` +
      `<table class="totals">` +
      `<tr><td colspan="2">Subtotal</td><td class="amount">${this.esc(fmt(summary?.subtotal))}</td></tr>` +
      discountRow +
      `<tr><td colspan="2">Impuestos</td><td class="amount">${this.esc(fmt(summary?.taxAmount))}</td></tr>` +
      withholdingRow +
      `<tr class="total-row"><td colspan="2">TOTAL</td><td class="amount">${this.esc(fmt(total))}</td></tr>` +
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
