import { Injectable, inject } from '@angular/core';
import { CurrencyFormatService } from '../../../../shared/pipes/currency';

// ============================================================================
// VOUCHER CONTRACT — structural subset of GuestOrderSummary (guest-order-summary
// component keeps its own inline interfaces; this one is structurally compatible
// so we avoid coupling the service to the component).
// ============================================================================

interface VoucherItem {
  product_name: string;
  variant_sku?: string | null;
  variant_attributes?: string | null;
  quantity: number;
  unit_price: number;
  total_price: number;
}

interface VoucherAddress {
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state_province?: string | null;
  country_code?: string | null;
  postal_code?: string | null;
}

interface VoucherPayment {
  state: string;
  amount?: number | null;
  paid_at?: string | null;
  method?: string | null;
}

interface VoucherOrder {
  order_number: string | number;
  state: string;
  created_at?: string | null;
  placed_at?: string | null;
  items: VoucherItem[];
  discount_amount: number;
  subtotal_amount: number;
  tax_amount: number;
  shipping_cost: number;
  grand_total: number;
  shipping_address?: VoucherAddress | null;
  payments?: VoucherPayment[];
}

interface VoucherCustomer {
  first_name?: string;
  last_name?: string;
  document_type?: string;
  document_number?: string;
  email?: string;
  phone?: string;
}

interface VoucherStore {
  name?: string;
  logo_url?: string;
}

export interface VoucherSummary {
  token: string;
  order: VoucherOrder;
  customer?: VoucherCustomer;
  store?: VoucherStore;
}

@Injectable({ providedIn: 'root' })
export class GuestOrderPrintService {
  private readonly currencyService = inject(CurrencyFormatService);

  printVoucher(summary: VoucherSummary): void {
    const html = this.generateVoucherHtml(summary);
    this.printHtml(html);
  }

  private generateVoucherHtml(summary: VoucherSummary): string {
    const order = summary.order;
    const store = summary.store;
    const customer = summary.customer;

    const fmt = (n: number) => this.currencyService.format(Number(n || 0));

    const orderStateLabels: Record<string, string> = {
      draft: 'Borrador',
      created: 'Creada',
      pending_payment: 'Pendiente de pago',
      processing: 'En proceso',
      shipped: 'Enviada',
      delivered: 'Entregada',
      finished: 'Finalizada',
      cancelled: 'Cancelada',
      refunded: 'Reembolsada',
    };

    const paymentStateLabels: Record<string, string> = {
      paid: 'Pagado',
      pending: 'Pendiente',
      partial: 'Parcial',
      failed: 'Fallido',
      refunded: 'Reembolsado',
    };

    const storeName = store?.name || 'Tienda';
    const orderDate = this.formatDate(order.created_at || order.placed_at);
    const orderStateLabel = orderStateLabels[order.state] || order.state;

    // ---- Customer block ----
    const customerName = [customer?.first_name, customer?.last_name]
      .filter(Boolean)
      .join(' ')
      .trim();
    const documentLine = [customer?.document_type, customer?.document_number]
      .filter(Boolean)
      .join(' ');
    const customerRows: string[] = [];
    if (customerName) {
      customerRows.push(
        `<p style="margin: 0; font-size: 14px; font-weight: 600; color: #111827;">${this.esc(customerName)}</p>`,
      );
    }
    if (documentLine) {
      customerRows.push(
        `<p style="margin: 2px 0 0; font-size: 13px; color: #6b7280;">${this.esc(documentLine)}</p>`,
      );
    }
    if (customer?.email) {
      customerRows.push(
        `<p style="margin: 2px 0 0; font-size: 13px; color: #6b7280;">${this.esc(customer.email)}</p>`,
      );
    }
    if (customer?.phone) {
      customerRows.push(
        `<p style="margin: 2px 0 0; font-size: 13px; color: #6b7280;">Tel: ${this.esc(customer.phone)}</p>`,
      );
    }
    const customerHtml = customerRows.length
      ? `
    <div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
      <h3 style="margin: 0 0 8px; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Cliente</h3>
      ${customerRows.join('\n      ')}
    </div>`
      : '';

    // ---- Shipping address block ----
    const addr = order.shipping_address;
    const addressStr = addr
      ? [
          addr.address_line1,
          addr.address_line2,
          addr.city,
          addr.state_province,
          addr.postal_code,
        ]
          .filter(Boolean)
          .join(', ')
      : '';
    const addressHtml = addressStr
      ? `
    <div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
      <h3 style="margin: 0 0 8px; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Direccion de envio</h3>
      <p style="margin: 0; font-size: 13px; color: #374151;">${this.esc(addressStr)}</p>
    </div>`
      : '';

    // ---- Items table ----
    const items = order.items || [];
    const itemsHtml =
      items.length > 0
        ? items
            .map((item) => {
              const variantParts: string[] = [];
              if (item.variant_sku)
                variantParts.push(`SKU: ${this.esc(item.variant_sku)}`);
              if (item.variant_attributes)
                variantParts.push(this.esc(item.variant_attributes));
              const variantLine = variantParts.length
                ? `<br><span style="font-size: 11px; color: #9ca3af;">${variantParts.join(' · ')}</span>`
                : '';
              return `
      <tr>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #374151;">${this.esc(item.product_name)}${variantLine}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #374151; text-align: center;">${this.esc(item.quantity)}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #374151; text-align: right; font-family: 'Courier New', monospace;">${fmt(Number(item.unit_price))}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #374151; text-align: right; font-family: 'Courier New', monospace; font-weight: 600;">${fmt(Number(item.total_price))}</td>
      </tr>`;
            })
            .join('')
        : `
      <tr>
        <td colspan="4" style="padding: 20px 12px; text-align: center; font-size: 13px; color: #9ca3af;">Sin detalle de items</td>
      </tr>`;

    // ---- Payment block ----
    const payment = order.payments?.length ? order.payments[0] : null;
    const paymentHtml = payment
      ? `
    <div style="display: flex; justify-content: space-between; align-items: center; background: #f9fafb; border-radius: 8px; padding: 12px 16px; margin-bottom: 24px;">
      <span style="font-size: 13px; font-weight: 600; color: #111827;">${this.esc(payment.method || 'Pago')}</span>
      <span style="display: inline-block; padding: 2px 10px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; border-radius: 4px; background: #f3f4f6; color: #374151;">
        ${this.esc(paymentStateLabels[payment.state] || payment.state)}
      </span>
    </div>`
      : '';

    return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Comprobante de compra #${this.esc(order.order_number)}</title>
  <style>
    @page { size: A4; margin: 20mm; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: #111827;
      margin: 0;
      padding: 0;
      background: #fff;
    }
    .container {
      max-width: 210mm;
      margin: 0 auto;
      padding: 24px;
    }
    table { border-collapse: collapse; }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #111827; padding-bottom: 20px; margin-bottom: 24px;">
      <div>
        ${store?.logo_url ? `<img src="${this.esc(store.logo_url)}" style="max-height: 50px; margin-bottom: 8px;" alt="Logo" />` : ''}
        <h1 style="margin: 0; font-size: 22px; font-weight: 700;">${this.esc(storeName)}</h1>
      </div>
      <div style="text-align: right;">
        <h2 style="margin: 0; font-size: 18px; font-weight: 700; color: #111827;">COMPROBANTE DE COMPRA</h2>
        <p style="margin: 4px 0 0; font-size: 16px; font-weight: 600; color: #4f46e5;">Pedido #${this.esc(order.order_number)}</p>
        ${orderDate ? `<p style="margin: 4px 0 0; font-size: 12px; color: #6b7280;">Fecha: ${this.esc(orderDate)}</p>` : ''}
        <p style="margin: 6px 0 0;">
          <span style="display: inline-block; padding: 2px 10px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; border-radius: 4px; background: #f3f4f6; color: #374151;">
            ${this.esc(orderStateLabel)}
          </span>
        </p>
      </div>
    </div>

    ${customerHtml}

    ${addressHtml}

    <!-- Items Table -->
    <table style="width: 100%; margin-bottom: 24px; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
      <thead>
        <tr style="background: #f3f4f6;">
          <th style="padding: 10px 12px; text-align: left; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase;">Producto</th>
          <th style="padding: 10px 12px; text-align: center; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; width: 60px;">Cant.</th>
          <th style="padding: 10px 12px; text-align: right; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; width: 110px;">P. Unitario</th>
          <th style="padding: 10px 12px; text-align: right; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; width: 110px;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${itemsHtml}
      </tbody>
    </table>

    ${paymentHtml}

    <!-- Totals -->
    <div style="display: flex; justify-content: flex-end; margin-bottom: 24px;">
      <div style="width: 260px;">
        <div style="display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px;">
          <span style="color: #6b7280;">Subtotal</span>
          <span style="font-family: 'Courier New', monospace; color: #374151;">${fmt(Number(order.subtotal_amount))}</span>
        </div>
        ${
          Number(order.discount_amount) > 0
            ? `
        <div style="display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px;">
          <span style="color: #6b7280;">Descuento</span>
          <span style="font-family: 'Courier New', monospace; color: #16a34a;">-${fmt(Number(order.discount_amount))}</span>
        </div>`
            : ''
        }
        <div style="display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px;">
          <span style="color: #6b7280;">Envio</span>
          <span style="font-family: 'Courier New', monospace; color: #374151;">${Number(order.shipping_cost) === 0 ? 'Gratis' : fmt(Number(order.shipping_cost))}</span>
        </div>
        <div style="display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px;">
          <span style="color: #6b7280;">IVA / Impuestos</span>
          <span style="font-family: 'Courier New', monospace; color: #374151;">${fmt(Number(order.tax_amount))}</span>
        </div>
        <div style="display: flex; justify-content: space-between; padding: 10px 0 0; margin-top: 6px; border-top: 2px solid #111827; font-size: 18px; font-weight: 700;">
          <span>TOTAL</span>
          <span style="font-family: 'Courier New', monospace; color: #4f46e5;">${fmt(Number(order.grand_total))}</span>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div style="text-align: center; padding-top: 24px; border-top: 1px solid #e5e7eb; margin-top: 32px;">
      <p style="margin: 0; font-size: 11px; color: #9ca3af;">
        Generado por ${this.esc(storeName)} · Powered by Vendix
      </p>
    </div>
  </div>
</body>
</html>`;
  }

  private formatDate(iso?: string | null): string {
    if (!iso) return '';
    try {
      // created_at es un instante, no una fecha civil: se muestra en la hora
      // local del lector (quien imprime el comprobante), no en UTC crudo.
      return new Date(iso).toLocaleString('es-CO', {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
    } catch {
      return '';
    }
  }

  private esc(value: unknown): string {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private printHtml(html: string): void {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = 'none';
    iframe.style.opacity = '0';
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (doc) {
      doc.open();
      doc.write(html);
      doc.close();
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    }
    setTimeout(() => iframe.remove(), 1000);
  }
}
