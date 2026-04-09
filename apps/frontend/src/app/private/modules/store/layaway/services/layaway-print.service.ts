import { Injectable, inject } from '@angular/core';
import { CurrencyFormatService } from '../../../../../shared/pipes/currency/currency.pipe';
import { LayawayPlan, LayawayItem, LayawayInstallment } from '../interfaces/layaway.interface';

@Injectable({
  providedIn: 'root',
})
export class LayawayPrintService {
  private readonly currencyService = inject(CurrencyFormatService);

  printLayawayPlan(plan: LayawayPlan): void {
    const html = this.generateHtml(plan);
    this.printHtml(html);
  }

  private generateHtml(plan: LayawayPlan): string {
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
      active: 'Activo',
      completed: 'Completado',
      cancelled: 'Cancelado',
      overdue: 'Vencido',
      defaulted: 'Incumplido',
    };

    const installmentStateColors: Record<string, string> = {
      paid: '#16a34a',
      pending: '#374151',
      overdue: '#ef4444',
      cancelled: '#9ca3af',
    };

    const installmentStateLabels: Record<string, string> = {
      paid: 'Pagada',
      pending: 'Pendiente',
      overdue: 'Vencida',
      cancelled: 'Cancelada',
    };

    const createdDate = new Date(plan.created_at).toLocaleDateString('es-CO');

    const fmt = (n: number) => this.currencyService.format(n);

    const items: LayawayItem[] = plan.layaway_items || [];
    const itemsHtml = items.length > 0
      ? items
          .map(
            (item, i) => `
      <tr>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #374151; text-align: center;">${i + 1}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #374151;">
          ${item.product_name}
          ${item.variant_name ? `<br><span style="font-size: 12px; color: #6b7280;">${item.variant_name}</span>` : ''}
          ${item.sku ? `<br><span style="font-size: 11px; color: #9ca3af;">SKU: ${item.sku}</span>` : ''}
        </td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #374151; text-align: center;">${item.quantity}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #374151; text-align: right; font-family: 'Courier New', monospace;">${fmt(Number(item.unit_price))}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #374151; text-align: right; font-family: 'Courier New', monospace; font-weight: 600;">${fmt(Number(item.subtotal))}</td>
      </tr>`,
          )
          .join('')
      : `<tr><td colspan="5" style="padding: 16px; text-align: center; font-size: 13px; color: #9ca3af;">Sin artículos detallados</td></tr>`;

    const installments: LayawayInstallment[] = plan.layaway_installments || [];
    const installmentsHtml = installments.length > 0
      ? installments
          .map(
            (inst) => `
      <tr>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #374151; text-align: center;">${inst.installment_number}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #374151; text-align: center;">${new Date(inst.due_date).toLocaleDateString('es-CO')}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #374151; text-align: right; font-family: 'Courier New', monospace;">${fmt(Number(inst.amount))}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; font-weight: 600; color: ${installmentStateColors[inst.state] || '#374151'}; text-align: center;">${installmentStateLabels[inst.state] || inst.state}</td>
      </tr>`,
          )
          .join('')
      : `<tr><td colspan="4" style="padding: 16px; text-align: center; font-size: 13px; color: #9ca3af;">Sin cuotas configuradas</td></tr>`;

    return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Plan Separé ${plan.plan_number}</title>
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
        <h2 style="margin: 0; font-size: 18px; font-weight: 700; color: #111827;">PLAN SEPARÉ</h2>
        <p style="margin: 4px 0 0; font-size: 16px; font-weight: 600; color: #4f46e5;">${plan.plan_number}</p>
        <p style="margin: 4px 0 0; font-size: 12px; color: #6b7280;">Fecha: ${createdDate}</p>
        <p style="margin: 6px 0 0;">
          <span style="display: inline-block; padding: 2px 10px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; border-radius: 4px; background: #f3f4f6; color: #374151;">
            ${statusLabels[plan.state] || plan.state}
          </span>
        </p>
      </div>
    </div>

    <!-- Cliente -->
    ${plan.customer ? `
    <div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
      <h3 style="margin: 0 0 8px; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Cliente</h3>
      <p style="margin: 0; font-size: 14px; font-weight: 600; color: #111827;">${plan.customer.first_name} ${plan.customer.last_name}</p>
      ${plan.customer.email ? `<p style="margin: 2px 0 0; font-size: 13px; color: #6b7280;">${plan.customer.email}</p>` : ''}
      ${plan.customer.phone ? `<p style="margin: 2px 0 0; font-size: 13px; color: #6b7280;">Tel: ${plan.customer.phone}</p>` : ''}
    </div>` : ''}

    <!-- Resumen Financiero -->
    <div style="display: flex; gap: 16px; margin-bottom: 24px;">
      <div style="flex: 1; background: #f9fafb; border-radius: 8px; padding: 16px; text-align: center;">
        <p style="margin: 0 0 4px; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Total Plan</p>
        <p style="margin: 0; font-size: 18px; font-weight: 700; color: #111827; font-family: 'Courier New', monospace;">${fmt(Number(plan.total_amount))}</p>
        <p style="margin: 6px 0 0; font-size: 11px; color: #9ca3af;">Adelanto inicial: ${fmt(Number(plan.down_payment_amount))}</p>
      </div>
      <div style="flex: 1; background: #f0fdf4; border-radius: 8px; padding: 16px; text-align: center;">
        <p style="margin: 0 0 4px; font-size: 11px; font-weight: 700; color: #16a34a; text-transform: uppercase; letter-spacing: 0.5px;">Pagado</p>
        <p style="margin: 0; font-size: 18px; font-weight: 700; color: #16a34a; font-family: 'Courier New', monospace;">${fmt(Number(plan.paid_amount))}</p>
      </div>
      <div style="flex: 1; background: #fef2f2; border-radius: 8px; padding: 16px; text-align: center;">
        <p style="margin: 0 0 4px; font-size: 11px; font-weight: 700; color: #ef4444; text-transform: uppercase; letter-spacing: 0.5px;">Pendiente</p>
        <p style="margin: 0; font-size: 18px; font-weight: 700; color: #ef4444; font-family: 'Courier New', monospace;">${fmt(Number(plan.remaining_amount))}</p>
      </div>
    </div>

    <!-- Tabla de Artículos -->
    <h3 style="margin: 0 0 12px; font-size: 13px; font-weight: 700; color: #374151; text-transform: uppercase; letter-spacing: 0.5px;">Artículos</h3>
    <table style="width: 100%; margin-bottom: 24px; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
      <thead>
        <tr style="background: #f3f4f6;">
          <th style="padding: 10px 12px; text-align: center; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; width: 40px;">#</th>
          <th style="padding: 10px 12px; text-align: left; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase;">Descripción</th>
          <th style="padding: 10px 12px; text-align: center; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; width: 70px;">Cant.</th>
          <th style="padding: 10px 12px; text-align: right; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; width: 110px;">Precio Unit.</th>
          <th style="padding: 10px 12px; text-align: right; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; width: 110px;">Subtotal</th>
        </tr>
      </thead>
      <tbody>
        ${itemsHtml}
      </tbody>
    </table>

    <!-- Tabla de Cuotas -->
    <h3 style="margin: 0 0 12px; font-size: 13px; font-weight: 700; color: #374151; text-transform: uppercase; letter-spacing: 0.5px;">Cuotas</h3>
    <table style="width: 100%; margin-bottom: 24px; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
      <thead>
        <tr style="background: #f3f4f6;">
          <th style="padding: 10px 12px; text-align: center; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; width: 80px;">Cuota #</th>
          <th style="padding: 10px 12px; text-align: center; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; width: 120px;">Vencimiento</th>
          <th style="padding: 10px 12px; text-align: right; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase;">Monto</th>
          <th style="padding: 10px 12px; text-align: center; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; width: 110px;">Estado</th>
        </tr>
      </thead>
      <tbody>
        ${installmentsHtml}
      </tbody>
    </table>

    ${plan.notes ? `
    <div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
      <h3 style="margin: 0 0 8px; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Notas</h3>
      <p style="margin: 0; font-size: 13px; color: #374151; white-space: pre-wrap;">${plan.notes}</p>
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
