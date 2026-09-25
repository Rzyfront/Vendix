import { Injectable, inject } from '@angular/core';
import { CurrencyFormatService } from '../../../../shared/pipes/currency';
import { DocumentPrintService } from '../../../../shared/services/print';

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
  // Paso 8 (roku-shop-checkout): paridad con la vista (cocina por plato).
  kitchen_status?: string | null;
  preparation_time_minutes?: number | null;
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
  // Paso 8 (roku-shop-checkout): paridad con la vista (ETA + entrega).
  estimated_ready_at?: string | null;
  estimated_delivered_at?: string | null;
  prep_minutes_max?: number | null;
  delivery_type?: string | null;
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
  /**
   * C.7 (CP-pos-exclusive-tax-double-charge, ADR-12) — gate fiscal resuelto
   * por el backend. Sin esto en `true` el comprobante impreso no desglosa
   * Subtotal/Impuestos (regla anti-huérfana §5.3: o van juntos, o ninguno).
   */
  prints_vat_breakdown?: boolean;
}

/**
 * Document CSS handed to `DocumentPrintService`. The `@page` rule is NOT here:
 * paper, margin and copies belong to `receipts.printing.guest_order` and are
 * resolved by the engine.
 */
const GUEST_ORDER_PRINT_STYLES = `
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
`;

@Injectable({ providedIn: 'root' })
export class GuestOrderPrintService {
  private readonly currencyService = inject(CurrencyFormatService);
  private readonly documentPrint = inject(DocumentPrintService);

  async printVoucher(summary: VoucherSummary): Promise<void> {
    await this.documentPrint.print({
      document: 'guest_order',
      body: this.generateVoucherBody(summary),
      title: `Comprobante de compra #${this.esc(summary.order.order_number)}`,
      styles: GUEST_ORDER_PRINT_STYLES,
    });
  }

  private generateVoucherBody(summary: VoucherSummary): string {
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
      pending_delivery: 'Pendiente de entrega',
      delivered: 'Entregada',
      finished: 'Finalizada',
      cancelled: 'Cancelada',
      refunded: 'Reembolsada',
    };

    // Paso 8 (roku-shop-checkout): mapa completo de 8 estados, idéntico a la
    // vista guest (`getPaymentStateLabel`).
    const paymentStateLabels: Record<string, string> = {
      pending: 'Pendiente de confirmación',
      authorized: 'Autorizado',
      succeeded: 'Pagado',
      captured: 'Pagado',
      paid: 'Pagado',
      failed: 'Fallido',
      partially_refunded: 'Reembolso parcial',
      refunded: 'Reembolsado',
      cancelled: 'Cancelado',
      partial: 'Parcial',
    };

    // Paso 8: 5 labels ES de cocina, idénticos a la vista guest.
    const kitchenStateLabels: Record<string, string> = {
      pending: 'Pendiente',
      in_preparation: 'En preparación',
      ready: 'Listo',
      delivered: 'Entregado',
      cancelled: 'Cancelado',
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

    // ---- ETA block (paso 8: paridad con la vista) ----
    const etaMinutes =
      typeof order.prep_minutes_max === 'number' &&
      Number.isFinite(order.prep_minutes_max)
        ? order.prep_minutes_max
        : null;
    const etaReadyTime = this.formatTime(order.estimated_ready_at);
    const etaParts: string[] = [];
    if (etaMinutes != null) etaParts.push(`~${etaMinutes} min`);
    if (etaReadyTime) etaParts.push(`listo aprox. ${etaReadyTime}`);
    const etaHtml = etaParts.length
      ? `
    <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 12px 16px; margin-bottom: 24px;">
      <p style="margin: 0; font-size: 13px; color: #1e40af;"><strong>Tiempo estimado:</strong> ${this.esc(etaParts.join(' · '))}</p>
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
              // Paso 8: badge "Cocina: <estado>" en paridad con la vista.
              const kitchenLine = item.kitchen_status
                ? `<br><span style="font-size: 11px; color: #6b7280;">Cocina: ${this.esc(kitchenStateLabels[item.kitchen_status] || item.kitchen_status)}</span>`
                : '';
              return `
      <tr>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #374151;">${this.esc(item.product_name)}${variantLine}${kitchenLine}</td>
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

    // ---- Payment block (paso 8: multipago peor-primero, paridad vista) ----
    const severityOrder = [
      'failed',
      'pending',
      'authorized',
      'partially_refunded',
      'cancelled',
      'refunded',
      'succeeded',
    ];
    const severityAlias: Record<string, string> = {
      captured: 'succeeded',
      paid: 'succeeded',
      partial: 'partially_refunded',
    };
    const sortedPayments = [...(order.payments ?? [])].sort((a, b) => {
      const ia = severityOrder.indexOf(severityAlias[a.state] ?? a.state);
      const ib = severityOrder.indexOf(severityAlias[b.state] ?? b.state);
      return (
        (ia === -1 ? severityOrder.length : ia) -
        (ib === -1 ? severityOrder.length : ib)
      );
    });
    const paymentHtml =
      sortedPayments.length > 0
        ? sortedPayments
            .map(
              (payment) => `
    <div style="display: flex; justify-content: space-between; align-items: center; background: #f9fafb; border-radius: 8px; padding: 12px 16px; margin-bottom: 12px;">
      <span style="font-size: 13px; font-weight: 600; color: #111827;">${this.esc(payment.method || 'Pago')}</span>
      <span style="display: inline-block; padding: 2px 10px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; border-radius: 4px; background: #f3f4f6; color: #374151;">
        ${this.esc(paymentStateLabels[payment.state] || payment.state)}
      </span>
    </div>`,
            )
            .join('') + `<div style="margin-bottom: 12px;"></div>`
        : '';

    return `
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

    ${etaHtml}

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
    <!-- C.7 (§5.3, base taxable): sin impuesto, Subtotal solo alcanza. Con
         impuesto, Subtotal e Impuestos van JUNTOS o NINGUNO — nunca un
         Subtotal huérfano sin su fila de IVA al lado — gateado ahora por
         prints_vat_breakdown (backend, C.7). -->
    <div style="display: flex; justify-content: flex-end; margin-bottom: 24px;">
      <div style="width: 260px;">
        ${
          Number(order.tax_amount || 0) === 0
            ? `
        <div style="display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px;">
          <span style="color: #6b7280;">Subtotal</span>
          <span style="font-family: 'Courier New', monospace; color: #374151;">${fmt(Number(order.subtotal_amount))}</span>
        </div>`
            : summary.prints_vat_breakdown
              ? `
        <div style="display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px;">
          <span style="color: #6b7280;">Subtotal</span>
          <span style="font-family: 'Courier New', monospace; color: #374151;">${fmt(Number(order.subtotal_amount))}</span>
        </div>
        <div style="display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px;">
          <span style="color: #6b7280;">Impuestos</span>
          <span style="font-family: 'Courier New', monospace; color: #374151;">${fmt(Number(order.tax_amount))}</span>
        </div>`
              : ''
        }
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
  </div>`;
  }

  /**
   * Paso 8: `estimated_ready_at` es un instante — hora local del lector,
   * igual que la vista guest (`formatReadyTime`).
   */
  private formatTime(iso?: string | null): string {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleTimeString('es-CO', {
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
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
}
