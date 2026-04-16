import { Injectable, inject } from '@angular/core';
import { CurrencyFormatService } from '../../../../../shared/pipes/currency/currency.pipe';
import { Booking } from '../interfaces/reservation.interface';

@Injectable({
  providedIn: 'root',
})
export class ReservationPrintService {
  private readonly currencyService = inject(CurrencyFormatService);

  printReservation(booking: Booking): void {
    const html = this.generateReservationHtml(booking);
    this.printHtml(html);
  }

  private generateReservationHtml(booking: Booking): string {
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
      pending: 'Pendiente',
      confirmed: 'Confirmada',
      in_progress: 'En Progreso',
      completed: 'Completada',
      cancelled: 'Cancelada',
      no_show: 'No Presentado',
    };

    const channelLabels: Record<string, string> = {
      pos: 'POS',
      ecommerce: 'Tienda Online',
      whatsapp: 'WhatsApp',
    };

    const fmt = (n: number) => this.currencyService.format(n);

    const createdAt = new Date(booking.created_at).toLocaleDateString('es-CO');
    const bookingDate = new Date(booking.date).toLocaleDateString('es-CO', { timeZone: 'UTC' });
    const startTime = booking.start_time.substring(0, 5);
    const endTime = booking.end_time.substring(0, 5);
    const statusLabel = statusLabels[booking.status] || booking.status;
    const channelLabel = channelLabels[booking.channel] || booking.channel;

    const providerName = booking.provider
      ? booking.provider.display_name ||
        (booking.provider.employee
          ? `${booking.provider.employee.first_name} ${booking.provider.employee.last_name}`
          : 'N/A')
      : null;

    return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Comprobante de Reserva ${booking.booking_number}</title>
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
        <h2 style="margin: 0; font-size: 18px; font-weight: 700; color: #111827;">COMPROBANTE DE RESERVA</h2>
        <p style="margin: 4px 0 0; font-size: 16px; font-weight: 600; color: #4f46e5;">${booking.booking_number}</p>
        <p style="margin: 4px 0 0; font-size: 12px; color: #6b7280;">Fecha: ${createdAt}</p>
        <p style="margin: 6px 0 0;">
          <span style="display: inline-block; padding: 2px 10px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; border-radius: 4px; background: #f3f4f6; color: #374151;">
            ${statusLabel}
          </span>
        </p>
      </div>
    </div>

    <!-- Info principal de la reserva -->
    <div style="display: flex; gap: 16px; margin-bottom: 24px;">
      <div style="flex: 1; background: #f9fafb; border-radius: 8px; padding: 16px; text-align: center;">
        <p style="margin: 0 0 4px; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Fecha</p>
        <p style="margin: 0; font-size: 14px; font-weight: 600; color: #111827;">${bookingDate}</p>
      </div>
      <div style="flex: 1; background: #f9fafb; border-radius: 8px; padding: 16px; text-align: center;">
        <p style="margin: 0 0 4px; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Hora</p>
        <p style="margin: 0; font-size: 14px; font-weight: 600; color: #111827;">${startTime} - ${endTime}</p>
      </div>
      <div style="flex: 1; background: #f9fafb; border-radius: 8px; padding: 16px; text-align: center;">
        <p style="margin: 0 0 4px; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Canal</p>
        <p style="margin: 0; font-size: 14px; font-weight: 600; color: #111827;">${channelLabel}</p>
      </div>
    </div>

    <!-- Cliente -->
    ${booking.customer ? `
    <div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
      <h3 style="margin: 0 0 8px; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Cliente</h3>
      <p style="margin: 0; font-size: 14px; font-weight: 600; color: #111827;">${booking.customer.first_name} ${booking.customer.last_name}</p>
      ${booking.customer.email ? `<p style="margin: 2px 0 0; font-size: 13px; color: #6b7280;">${booking.customer.email}</p>` : ''}
      ${booking.customer.phone ? `<p style="margin: 2px 0 0; font-size: 13px; color: #6b7280;">${booking.customer.phone}</p>` : ''}
    </div>` : ''}

    <!-- Servicio -->
    ${booking.product ? `
    <div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
      <h3 style="margin: 0 0 8px; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Servicio</h3>
      <p style="margin: 0; font-size: 14px; font-weight: 600; color: #111827;">${booking.product.name}</p>
      ${booking.product.service_duration_minutes ? `<p style="margin: 4px 0 0; font-size: 13px; color: #6b7280;">Duración: ${booking.product.service_duration_minutes} min</p>` : ''}
      ${booking.product.base_price != null ? `<p style="margin: 4px 0 0; font-size: 13px; color: #6b7280;">Precio base: ${fmt(booking.product.base_price)}</p>` : ''}
    </div>` : ''}

    <!-- Profesional -->
    ${providerName ? `
    <div style="border-radius: 8px; padding: 16px; margin-bottom: 24px; border: 1px solid #e5e7eb;">
      <h3 style="margin: 0 0 8px; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Profesional</h3>
      <p style="margin: 0; font-size: 14px; font-weight: 600; color: #111827;">${providerName}</p>
    </div>` : ''}

    <!-- Orden asociada -->
    ${booking.order ? `
    <div style="padding: 12px 16px; margin-bottom: 24px; border-left: 3px solid #4f46e5;">
      <p style="margin: 0; font-size: 13px; color: #374151;">Orden de venta: <span style="font-weight: 600; color: #4f46e5;">#${booking.order.order_number}</span></p>
    </div>` : ''}

    <!-- Notas -->
    ${booking.notes ? `
    <div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
      <h3 style="margin: 0 0 8px; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Notas</h3>
      <p style="margin: 0; font-size: 13px; color: #374151; white-space: pre-wrap;">${booking.notes}</p>
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
