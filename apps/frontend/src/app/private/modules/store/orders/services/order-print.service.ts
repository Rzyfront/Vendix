import { Injectable, inject } from '@angular/core';
import { CurrencyFormatService } from '../../../../../shared/pipes/currency/currency.pipe';
import { formatVariantAttributes } from '../../../../../shared/utils';
import { Order } from '../interfaces/order.interface';

@Injectable({ providedIn: 'root' })
export class OrderPrintService {
  private readonly currencyService = inject(CurrencyFormatService);

  printOrder(order: Order): void {
    const html = this.generateOrderHtml(order);
    this.printHtml(html);
  }

  private generateOrderHtml(order: Order): string {
    let storeName = 'Vendix';
    let storeAddress = '';
    let storePhone = '';
    let storeTaxId = '';
    let storeLogo = '';

    try {
      const authState = localStorage.getItem('vendix_auth_state');
      if (authState) {
        const parsed = JSON.parse(authState);
        const user = parsed.user;
        if (user?.store) {
          storeName = user.store.name || storeName;
          storePhone = user.store.phone || '';
        }
        if (user?.organizations) {
          storeTaxId = user.organizations.taxId || '';
        }
        if (user?.addresses?.length > 0) {
          const addr = user.addresses[0];
          storeAddress = `${addr.address_line1}${addr.address_line2 ? ', ' + addr.address_line2 : ''}, ${addr.city}`;
        }
      }
      const appConfig = localStorage.getItem('vendix_app_config');
      if (appConfig) {
        const parsed = JSON.parse(appConfig);
        if (parsed.branding?.logo?.url) {
          storeLogo = parsed.branding.logo.url;
        }
      }
    } catch (e) {
      console.error('Error reading store config:', e);
    }

    const statusLabels: Record<string, string> = {
      created: 'Creada',
      pending_payment: 'Pago Pendiente',
      processing: 'Procesando',
      shipped: 'Enviada',
      delivered: 'Entregada',
      cancelled: 'Cancelada',
      refunded: 'Reembolsada',
      finished: 'Finalizada',
    };

    const channelLabels: Record<string, string> = {
      pos: 'POS',
      ecommerce: 'Tienda Online',
      agent: 'IA',
      whatsapp: 'WhatsApp',
      marketplace: 'Marketplace',
    };

    const orderDate = new Date(order.created_at).toLocaleDateString('es-CO');

    const customerName =
      (order as any).customer_name ||
      (order.users
        ? `${order.users.first_name} ${order.users.last_name}`
        : 'Consumidor Final');

    const shippingAddr = order.addresses_orders_shipping_address_idToaddresses;
    const shippingAddrStr = shippingAddr
      ? [
          shippingAddr.address_line1,
          shippingAddr.address_line2,
          shippingAddr.city,
          shippingAddr.state_province,
          shippingAddr.country_code,
        ]
          .filter(Boolean)
          .join(', ')
      : '';

    const fmt = (n: number) => this.currencyService.format(n);

    const items = order.order_items || [];
    const itemsHtml =
      items.length > 0
        ? items
            .map(
              (item, i) => `
      <tr>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #374151; text-align: center;">${i + 1}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #374151;">
          ${item.product_name}
          ${item.variant_sku ? `<br><span style="font-size: 11px; color: #9ca3af;">SKU: ${item.variant_sku}</span>` : ''}
          ${(() => { const v = formatVariantAttributes(item.variant_attributes, ', '); return v ? `<br><span style="font-size: 11px; color: #9ca3af;">${v}</span>` : ''; })()}
        </td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #374151; text-align: center;">${item.quantity}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #374151; text-align: right; font-family: 'Courier New', monospace;">${fmt(Number(item.unit_price))}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #374151; text-align: right; font-family: 'Courier New', monospace; font-weight: 600;">${fmt(Number(item.total_price))}</td>
      </tr>`,
            )
            .join('')
        : `
      <tr>
        <td colspan="5" style="padding: 20px 12px; text-align: center; font-size: 13px; color: #9ca3af;">Sin detalle de items</td>
      </tr>`;

    return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Orden de Venta #${order.order_number}</title>
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
        ${storeLogo ? `<img src="${storeLogo}" style="max-height: 50px; margin-bottom: 8px;" alt="Logo" />` : ''}
        <h1 style="margin: 0; font-size: 22px; font-weight: 700;">${storeName}</h1>
        ${storeAddress ? `<p style="margin: 4px 0 0; font-size: 12px; color: #6b7280;">${storeAddress}</p>` : ''}
        ${storeTaxId ? `<p style="margin: 2px 0 0; font-size: 12px; color: #6b7280;">NIT: ${storeTaxId}</p>` : ''}
        ${storePhone ? `<p style="margin: 2px 0 0; font-size: 12px; color: #6b7280;">Tel: ${storePhone}</p>` : ''}
      </div>
      <div style="text-align: right;">
        <h2 style="margin: 0; font-size: 18px; font-weight: 700; color: #111827;">ORDEN DE VENTA</h2>
        <p style="margin: 4px 0 0; font-size: 16px; font-weight: 600; color: #4f46e5;">#${order.order_number}</p>
        <p style="margin: 4px 0 0; font-size: 12px; color: #6b7280;">Fecha: ${orderDate}</p>
        <p style="margin: 6px 0 0;">
          <span style="display: inline-block; padding: 2px 10px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; border-radius: 4px; background: #f3f4f6; color: #374151;">
            ${statusLabels[order.state] || order.state}
          </span>
        </p>
        ${order.channel ? `<p style="margin: 4px 0 0; font-size: 12px; color: #6b7280;">${channelLabels[order.channel] || order.channel}</p>` : ''}
      </div>
    </div>

    <!-- Customer -->
    <div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
      <h3 style="margin: 0 0 8px; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Cliente</h3>
      <p style="margin: 0; font-size: 14px; font-weight: 600; color: #111827;">${customerName}</p>
      ${order.users?.email ? `<p style="margin: 2px 0 0; font-size: 13px; color: #6b7280;">${order.users.email}</p>` : ''}
      ${order.users?.phone ? `<p style="margin: 2px 0 0; font-size: 13px; color: #6b7280;">Tel: ${order.users.phone}</p>` : ''}
      ${shippingAddrStr ? `<p style="margin: 4px 0 0; font-size: 13px; color: #6b7280;">Dir. Envio: ${shippingAddrStr}</p>` : ''}
    </div>

    <!-- Items Table -->
    <table style="width: 100%; margin-bottom: 24px; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
      <thead>
        <tr style="background: #f3f4f6;">
          <th style="padding: 10px 12px; text-align: center; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; width: 40px;">#</th>
          <th style="padding: 10px 12px; text-align: left; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase;">Descripcion</th>
          <th style="padding: 10px 12px; text-align: center; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; width: 60px;">Cant.</th>
          <th style="padding: 10px 12px; text-align: right; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; width: 110px;">Precio Unit.</th>
          <th style="padding: 10px 12px; text-align: right; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; width: 110px;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${itemsHtml}
      </tbody>
    </table>

    <!-- Totals -->
    <div style="display: flex; justify-content: flex-end; margin-bottom: 24px;">
      <div style="width: 250px;">
        <div style="display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px;">
          <span style="color: #6b7280;">Subtotal</span>
          <span style="font-family: 'Courier New', monospace; color: #374151;">${fmt(Number(order.subtotal_amount))}</span>
        </div>
        ${Number(order.discount_amount) > 0 ? `
        <div style="display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px;">
          <span style="color: #6b7280;">Descuento</span>
          <span style="font-family: 'Courier New', monospace; color: #16a34a;">-${fmt(Number(order.discount_amount))}</span>
        </div>` : ''}
        ${Number(order.shipping_cost) > 0 ? `
        <div style="display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px;">
          <span style="color: #6b7280;">Envio</span>
          <span style="font-family: 'Courier New', monospace; color: #374151;">${fmt(Number(order.shipping_cost))}</span>
        </div>` : ''}
        <div style="display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px;">
          <span style="color: #6b7280;">IVA</span>
          <span style="font-family: 'Courier New', monospace; color: #374151;">${fmt(Number(order.tax_amount))}</span>
        </div>
        <div style="display: flex; justify-content: space-between; padding: 10px 0 0; margin-top: 6px; border-top: 2px solid #111827; font-size: 18px; font-weight: 700;">
          <span>Total</span>
          <span style="font-family: 'Courier New', monospace;">${fmt(Number(order.grand_total))}</span>
        </div>
      </div>
    </div>

    ${order.internal_notes ? `
    <div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
      <h3 style="margin: 0 0 8px; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase;">Notas Internas</h3>
      <p style="margin: 0; font-size: 13px; color: #374151; white-space: pre-wrap;">${order.internal_notes}</p>
    </div>` : ''}

    <!-- Footer -->
    <div style="text-align: center; padding-top: 24px; border-top: 1px solid #e5e7eb; margin-top: 32px;">
      <p style="margin: 0; font-size: 11px; color: #9ca3af;">
        Generado por ${storeName} · Powered by Vendix
      </p>
    </div>
  </div>
</body>
</html>`;
  }

  private printHtml(html: string): void {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
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
