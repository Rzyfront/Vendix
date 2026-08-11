import { Injectable, inject } from '@angular/core';
import { CurrencyFormatService } from '../../../../../shared/pipes/currency/currency.pipe';
import { DocumentPrintService } from '../../../../../shared/services/print';
import {
  WithholdingCertificateData,
  SufferedWithholdingCertificateData,
  EmployeeIncomeCertificateData,
} from '../interfaces/withholding.interface';

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
 * Document CSS shared by the three certificates in this file. The `@page` rule
 * is NOT here: paper, margin and copies belong to
 * `receipts.printing.withholding_certificate` and are resolved by the engine.
 */
const WITHHOLDING_CERTIFICATE_PRINT_STYLES = `
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

/**
 * Printable "Certificado de Retención en la Fuente" (art. 381 Estatuto
 * Tributario). Builds the document body with the store data read from
 * localStorage and hands it to `DocumentPrintService`, which owns the paper.
 *
 * Three distinct documents live here — practiced, suffered and the employee
 * Formulario 220 — and all three print under the same `withholding_certificate`
 * configuration key.
 */
@Injectable({
  providedIn: 'root',
})
export class WithholdingCertificatePrintService {
  private readonly currencyService = inject(CurrencyFormatService);
  private readonly documentPrint = inject(DocumentPrintService);

  async printCertificate(
    certificate: WithholdingCertificateData,
  ): Promise<void> {
    await this.print(
      this.generateCertificateBody(certificate),
      `Certificado de Retención en la Fuente ${certificate.year} - ${certificate.supplier_name}`,
    );
  }

  /** Certificado de retención "sufrida" (customer/supplier retuvo al tenant). */
  async printSufferedCertificate(
    certificate: SufferedWithholdingCertificateData,
  ): Promise<void> {
    await this.print(
      this.generateSufferedCertificateBody(certificate),
      `Certificado de Retención Sufrida ${certificate.year} - ${certificate.counterparty_name}`,
    );
  }

  /** Certificado de Ingresos y Retenciones (Formulario 220 DIAN) por empleado. */
  async printEmployeeCertificate(
    certificate: EmployeeIncomeCertificateData,
  ): Promise<void> {
    await this.print(
      this.generateEmployeeCertificateBody(certificate),
      `Certificado de Ingresos y Retenciones ${certificate.year} - ${certificate.employee_name}`,
    );
  }

  private async print(body: string, title: string): Promise<void> {
    await this.documentPrint.print({
      document: 'withholding_certificate',
      body,
      title,
      styles: WITHHOLDING_CERTIFICATE_PRINT_STYLES,
    });
  }

  /** Reads store branding info from localStorage (same pattern as QuotationPrintService). */
  private readStoreInfo(): {
    storeName: string;
    storeAddress: string;
    storeCity: string;
    storeTaxId: string;
    storeLogo: string;
  } {
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

    return { storeName, storeAddress, storeCity, storeTaxId, storeLogo };
  }

  private generateCertificateBody(cert: WithholdingCertificateData): string {
    const { storeName, storeAddress, storeCity, storeTaxId, storeLogo } =
      this.readStoreInfo();

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
  </div>`;
  }

  private generateSufferedCertificateBody(
    cert: SufferedWithholdingCertificateData,
  ): string {
    const { storeName, storeAddress, storeCity, storeTaxId, storeLogo } =
      this.readStoreInfo();
    const issuedAt = new Date().toLocaleDateString('es-CO');

    const rowsHtml = cert.monthly_breakdown
      .map(
        (row) => `
      <tr>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #374151;">${MONTH_LABELS[row.month - 1] || row.month}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #374151;">${row.concept}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #374151; text-transform: uppercase;">${row.withholding_type}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #374151; text-align: right; font-family: 'Courier New', monospace;">${this.currencyService.format(Number(row.base) || 0)}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #374151; text-align: right;">${((Number(row.rate) || 0) * 100).toFixed(2)}%</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #374151; text-align: right; font-family: 'Courier New', monospace; font-weight: 600;">${this.currencyService.format(Number(row.amount) || 0)}</td>
      </tr>`,
      )
      .join('');

    const counterpartyLabel =
      cert.counterparty_type === 'customer' ? 'Cliente' : 'Proveedor';

    return `
  <div class="container">
    <!-- Header -->
    <div style="text-align: center; border-bottom: 3px solid #111827; padding-bottom: 20px; margin-bottom: 24px;">
      ${storeLogo ? `<img src="${storeLogo}" style="max-height: 50px; margin-bottom: 8px;" alt="Logo" />` : ''}
      <h1 style="margin: 0; font-size: 20px; font-weight: 700; text-transform: uppercase;">Certificado de Retención Sufrida</h1>
      <p style="margin: 6px 0 0; font-size: 13px; color: #6b7280;">Año Gravable ${cert.year} · Art. 381 Estatuto Tributario</p>
    </div>

    <!-- Parties -->
    <div style="display: flex; gap: 16px; margin-bottom: 24px;">
      <div style="flex: 1; background: #f9fafb; border-radius: 8px; padding: 16px;">
        <h3 style="margin: 0 0 8px; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Sujeto de Retención (Beneficiario)</h3>
        <p style="margin: 0; font-size: 14px; font-weight: 600; color: #111827;">${storeName}</p>
        ${storeTaxId ? `<p style="margin: 2px 0 0; font-size: 13px; color: #6b7280;">NIT: ${storeTaxId}</p>` : ''}
        ${storeAddress ? `<p style="margin: 2px 0 0; font-size: 12px; color: #6b7280;">${storeAddress}</p>` : ''}
      </div>
      <div style="flex: 1; background: #f9fafb; border-radius: 8px; padding: 16px;">
        <h3 style="margin: 0 0 8px; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Agente Retenedor (${counterpartyLabel})</h3>
        <p style="margin: 0; font-size: 14px; font-weight: 600; color: #111827;">${cert.counterparty_name}</p>
        ${cert.counterparty_nit ? `<p style="margin: 2px 0 0; font-size: 13px; color: #6b7280;">NIT/CC: ${cert.counterparty_nit}</p>` : ''}
      </div>
    </div>

    <!-- Monthly Breakdown -->
    <table style="width: 100%; margin-bottom: 24px; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
      <thead>
        <tr style="background: #f3f4f6;">
          <th style="padding: 10px 12px; text-align: left; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; width: 90px;">Mes</th>
          <th style="padding: 10px 12px; text-align: left; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase;">Concepto</th>
          <th style="padding: 10px 12px; text-align: left; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; width: 100px;">Tipo</th>
          <th style="padding: 10px 12px; text-align: right; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; width: 120px;">Base</th>
          <th style="padding: 10px 12px; text-align: right; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; width: 80px;">Tarifa</th>
          <th style="padding: 10px 12px; text-align: right; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; width: 120px;">Valor Retenido</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml || `
        <tr>
          <td colspan="6" style="padding: 16px 12px; font-size: 13px; color: #9ca3af; text-align: center;">Sin retenciones sufridas registradas en el período</td>
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
        Certificado informativo de retenciones practicadas por el ${counterpartyLabel.toLowerCase()} sobre operaciones con ${storeName},
        con base en los registros propios de retención sufrida (art. 381 ET). No sustituye el certificado oficial expedido por el agente retenedor.
      </p>
    </div>

    <!-- Footer -->
    <div style="text-align: center; padding-top: 24px; border-top: 1px solid #e5e7eb; margin-top: 32px;">
      <p style="margin: 0; font-size: 11px; color: #9ca3af;">
        Generado por ${storeName} · Powered by Vendix
      </p>
    </div>
  </div>`;
  }

  private generateEmployeeCertificateBody(
    cert: EmployeeIncomeCertificateData,
  ): string {
    const { storeLogo } = this.readStoreInfo();
    const issuedAt = new Date().toLocaleDateString('es-CO');

    const rowsHtml = cert.monthly_breakdown
      .map(
        (row) => `
      <tr>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #374151;">${MONTH_LABELS[row.month - 1] || row.month}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #374151; text-align: right; font-family: 'Courier New', monospace;">${this.currencyService.format(Number(row.salary) || 0)}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #374151; text-align: right; font-family: 'Courier New', monospace;">${this.currencyService.format(Number(row.health_deduction) || 0)}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #374151; text-align: right; font-family: 'Courier New', monospace;">${this.currencyService.format(Number(row.pension_deduction) || 0)}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #374151; text-align: right; font-family: 'Courier New', monospace; font-weight: 600;">${this.currencyService.format(Number(row.withholding) || 0)}</td>
      </tr>`,
      )
      .join('');

    return `
  <div class="container">
    <!-- Header -->
    <div style="text-align: center; border-bottom: 3px solid #111827; padding-bottom: 20px; margin-bottom: 24px;">
      ${storeLogo ? `<img src="${storeLogo}" style="max-height: 50px; margin-bottom: 8px;" alt="Logo" />` : ''}
      <h1 style="margin: 0; font-size: 20px; font-weight: 700; text-transform: uppercase;">Certificado de Ingresos y Retenciones</h1>
      <p style="margin: 6px 0 0; font-size: 13px; color: #6b7280;">Formulario 220 DIAN · Año Gravable ${cert.year}</p>
    </div>

    <!-- Parties -->
    <div style="display: flex; gap: 16px; margin-bottom: 24px;">
      <div style="flex: 1; background: #f9fafb; border-radius: 8px; padding: 16px;">
        <h3 style="margin: 0 0 8px; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Agente Retenedor (Empleador)</h3>
        <p style="margin: 0; font-size: 14px; font-weight: 600; color: #111827;">${cert.employer_name}</p>
        ${cert.employer_nit ? `<p style="margin: 2px 0 0; font-size: 13px; color: #6b7280;">NIT: ${cert.employer_nit}</p>` : ''}
      </div>
      <div style="flex: 1; background: #f9fafb; border-radius: 8px; padding: 16px;">
        <h3 style="margin: 0 0 8px; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Beneficiario (Empleado)</h3>
        <p style="margin: 0; font-size: 14px; font-weight: 600; color: #111827;">${cert.employee_name}</p>
        ${cert.employee_document_number ? `<p style="margin: 2px 0 0; font-size: 13px; color: #6b7280;">${(cert.employee_document_type || 'CC').toUpperCase()}: ${cert.employee_document_number}</p>` : ''}
      </div>
    </div>

    <!-- Monthly Breakdown -->
    <table style="width: 100%; margin-bottom: 24px; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
      <thead>
        <tr style="background: #f3f4f6;">
          <th style="padding: 10px 12px; text-align: left; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; width: 100px;">Mes</th>
          <th style="padding: 10px 12px; text-align: right; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase;">Salario</th>
          <th style="padding: 10px 12px; text-align: right; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase;">Aporte Salud</th>
          <th style="padding: 10px 12px; text-align: right; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase;">Aporte Pensión</th>
          <th style="padding: 10px 12px; text-align: right; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase;">Retefuente</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml || `
        <tr>
          <td colspan="5" style="padding: 16px 12px; font-size: 13px; color: #9ca3af; text-align: center;">Sin nómina registrada en el período</td>
        </tr>`}
      </tbody>
    </table>

    <!-- Totals -->
    <div style="display: flex; justify-content: flex-end; margin-bottom: 24px;">
      <div style="width: 340px;">
        <div style="display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px;">
          <span style="color: #6b7280;">Total Ingresos Salariales</span>
          <span style="font-family: 'Courier New', monospace; color: #374151;">${this.currencyService.format(Number(cert.total_salaries) || 0)}</span>
        </div>
        <div style="display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px;">
          <span style="color: #6b7280;">Total Aportes a Salud</span>
          <span style="font-family: 'Courier New', monospace; color: #374151;">${this.currencyService.format(Number(cert.total_health_deduction) || 0)}</span>
        </div>
        <div style="display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px;">
          <span style="color: #6b7280;">Total Aportes a Pensión</span>
          <span style="font-family: 'Courier New', monospace; color: #374151;">${this.currencyService.format(Number(cert.total_pension_deduction) || 0)}</span>
        </div>
        <div style="display: flex; justify-content: space-between; padding: 10px 0 0; margin-top: 6px; border-top: 2px solid #111827; font-size: 16px; font-weight: 700;">
          <span>Total Retención en la Fuente</span>
          <span style="font-family: 'Courier New', monospace;">${this.currencyService.format(Number(cert.total_withholding) || 0)}</span>
        </div>
      </div>
    </div>

    <!-- Issue date -->
    <div style="margin-bottom: 16px;">
      <p style="margin: 0; font-size: 13px; color: #374151;">
        Expedido a los ${issuedAt}.
      </p>
    </div>

    <!-- Legal note -->
    <div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
      <p style="margin: 0; font-size: 12px; color: #6b7280;">
        Certificado de Ingresos y Retenciones expedido según el artículo 378 del Estatuto Tributario (Formulario 220 DIAN).
        Este certificado no requiere firma autógrafa de conformidad con el artículo 10 del Decreto 836 de 1991.
      </p>
    </div>

    <!-- Footer -->
    <div style="text-align: center; padding-top: 24px; border-top: 1px solid #e5e7eb; margin-top: 32px;">
      <p style="margin: 0; font-size: 11px; color: #9ca3af;">
        Generado por ${cert.employer_name} · Powered by Vendix
      </p>
    </div>
  </div>`;
  }
}
