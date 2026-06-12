import { Injectable, inject } from '@angular/core';
import { CurrencyFormatService } from '../../../../../shared/pipes/currency/currency.pipe';
import { WithholdingCertificateData } from '../interfaces/withholding.interface';

const MONTH_LABELS = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

/**
 * Printable "Certificado de Retención en la Fuente" (art. 381 Estatuto
 * Tributario). Same pattern as QuotationPrintService: build a self-contained
 * HTML document with the store data read from localStorage and print it
 * through a hidden iframe.
 */
@Injectable({
  providedIn: 'root',
})
export class WithholdingCertificatePrintService {
  private readonly currencyService = inject(CurrencyFormatService);

  printCertificate(certificate: WithholdingCertificateData): void {
    const html = this.generateCertificateHtml(certificate);
    this.printHtml(html);
  }

  private generateCertificateHtml(cert: WithholdingCertificateData): string {
    // Get store info from localStorage (same pattern as QuotationPrintService)
    let storeName = 'Vendix';
    let storeAddress = '';
    let storeCity = '';
    let storeTaxId = '';
    let storeLogo = '';

    try {
      const authState = localStorage.getItem('vendix_auth_state');
      if (authState) {
        const parsed = JSON.parse(authState);
        const user = parsed.user;
        if (user?.store) {
          storeName = user.store.name || storeName;
        }
        if (user?.organizations) {
          storeTaxId = user.organizations.taxId || '';
        }
        if (user?.addresses?.length > 0) {
          const addr = user.addresses[0];
          storeCity = addr.city || '';
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

    const issuedAt = new Date().toLocaleDateString('es-CO');

    const rowsHtml = cert.monthly_breakdown
      .map(
        (row) => `
      <tr>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #374151;">${MONTH_LABELS[row.month - 1] || row.month}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #374151;">${row.concept}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #374151; text-align: right; font-family: 'Courier New', monospace;">${this.currencyService.format(Number(row.base) || 0)}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #374151; text-align: right;">${((Number(row.rate) || 0) * 100).toFixed(2)}%</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #374151; text-align: right; font-family: 'Courier New', monospace; font-weight: 600;">${this.currencyService.format(Number(row.amount) || 0)}</td>
      </tr>`,
      )
      .join('');

    return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Certificado de Retención en la Fuente ${cert.year} - ${cert.supplier_name}</title>
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
    <div style="text-align: center; border-bottom: 3px solid #111827; padding-bottom: 20px; margin-bottom: 24px;">
      ${storeLogo ? `<img src="${storeLogo}" style="max-height: 50px; margin-bottom: 8px;" alt="Logo" />` : ''}
      <h1 style="margin: 0; font-size: 20px; font-weight: 700; text-transform: uppercase;">Certificado de Retención en la Fuente</h1>
      <p style="margin: 6px 0 0; font-size: 13px; color: #6b7280;">Año Gravable ${cert.year}</p>
    </div>

    <!-- Parties -->
    <div style="display: flex; gap: 16px; margin-bottom: 24px;">
      <div style="flex: 1; background: #f9fafb; border-radius: 8px; padding: 16px;">
        <h3 style="margin: 0 0 8px; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Agente Retenedor</h3>
        <p style="margin: 0; font-size: 14px; font-weight: 600; color: #111827;">${storeName}</p>
        ${storeTaxId ? `<p style="margin: 2px 0 0; font-size: 13px; color: #6b7280;">NIT: ${storeTaxId}</p>` : ''}
        ${storeAddress ? `<p style="margin: 2px 0 0; font-size: 12px; color: #6b7280;">${storeAddress}</p>` : ''}
      </div>
      <div style="flex: 1; background: #f9fafb; border-radius: 8px; padding: 16px;">
        <h3 style="margin: 0 0 8px; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Beneficiario (Sujeto de Retención)</h3>
        <p style="margin: 0; font-size: 14px; font-weight: 600; color: #111827;">${cert.supplier_name}</p>
        ${cert.supplier_nit ? `<p style="margin: 2px 0 0; font-size: 13px; color: #6b7280;">NIT: ${cert.supplier_nit}</p>` : ''}
      </div>
    </div>

    <!-- Monthly Breakdown -->
    <table style="width: 100%; margin-bottom: 24px; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
      <thead>
        <tr style="background: #f3f4f6;">
          <th style="padding: 10px 12px; text-align: left; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; width: 100px;">Mes</th>
          <th style="padding: 10px 12px; text-align: left; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase;">Concepto</th>
          <th style="padding: 10px 12px; text-align: right; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; width: 120px;">Base</th>
          <th style="padding: 10px 12px; text-align: right; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; width: 80px;">Tarifa</th>
          <th style="padding: 10px 12px; text-align: right; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; width: 120px;">Valor Retenido</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml || `
        <tr>
          <td colspan="5" style="padding: 16px 12px; font-size: 13px; color: #9ca3af; text-align: center;">Sin retenciones registradas en el período</td>
        </tr>`}
      </tbody>
    </table>

    <!-- Totals -->
    <div style="display: flex; justify-content: flex-end; margin-bottom: 24px;">
      <div style="width: 300px;">
        <div style="display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px;">
          <span style="color: #6b7280;">Total Base</span>
          <span style="font-family: 'Courier New', monospace; color: #374151;">${this.currencyService.format(Number(cert.total_base) || 0)}</span>
        </div>
        <div style="display: flex; justify-content: space-between; padding: 10px 0 0; margin-top: 6px; border-top: 2px solid #111827; font-size: 16px; font-weight: 700;">
          <span>Total Retenido</span>
          <span style="font-family: 'Courier New', monospace;">${this.currencyService.format(Number(cert.total_withheld) || 0)}</span>
        </div>
      </div>
    </div>

    <!-- Issue place/date -->
    <div style="margin-bottom: 16px;">
      <p style="margin: 0; font-size: 13px; color: #374151;">
        Expedido en ${storeCity || 'Colombia'}, a los ${issuedAt}.
      </p>
    </div>

    <!-- Legal note -->
    <div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
      <p style="margin: 0; font-size: 12px; color: #6b7280;">
        Certificado expedido según Art. 381 del Estatuto Tributario.
        Este certificado no requiere firma autógrafa de conformidad con el artículo 10 del Decreto 836 de 1991.
      </p>
    </div>

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
