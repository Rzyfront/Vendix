import { Injectable } from '@nestjs/common';
import { PrintFormatDefinition } from '../interfaces/print-format.interface';
import { StandardPrintDataModel } from '../interfaces/standard-print-data.model';
import { PrintTemplateCompilerService } from './print-template-compiler.service';

@Injectable()
export class PrintLayoutComposerService {
  constructor(private readonly compiler: PrintTemplateCompilerService) {}

  /**
   * Genera el HTML completo con CSS para imprimir o mostrar en preview
   */
  compose(
    definition: PrintFormatDefinition,
    data: StandardPrintDataModel,
  ): string {
    // Si la definición incluye una plantilla custom completa, se compila directamente
    if (definition.custom_template && definition.custom_template.trim().length > 0) {
      const compiledCustom = this.compiler.compile(definition.custom_template, data);
      return this.wrapInHtmlDocument(definition, compiledCustom.compiled);
    }

    // De lo contrario, se compone estructuralmente por secciones
    const sortedSections = [...(definition.sections || [])]
      .filter((s) => s.enabled)
      .sort((a, b) => (a.order || 0) - (b.order || 0));

    const renderedSections: string[] = [];

    for (const section of sortedSections) {
      const sectionHtml = this.renderSection(section, definition, data);
      if (sectionHtml) {
        renderedSections.push(sectionHtml);
      }
    }

    const bodyContent = `
      <div class="print-container ${definition.paper.is_roll ? 'is-roll' : 'is-sheet'}">
        ${renderedSections.join('\n')}
      </div>
    `;

    return this.wrapInHtmlDocument(definition, bodyContent);
  }

  private renderSection(
    section: any,
    definition: PrintFormatDefinition,
    data: StandardPrintDataModel,
  ): string {
    if (section.custom_content) {
      return `<div class="print-section section-${section.type}">${this.compiler.compile(section.custom_content, data).compiled}</div>`;
    }

    switch (section.type) {
      case 'header':
      case 'fiscal_header':
        return this.renderHeaderSection(section, data);
      case 'document_info':
        return this.renderDocumentInfoSection(section, data);
      case 'customer_info':
      case 'fiscal_buyer_info':
        return this.renderCustomerSection(section, data);
      case 'parties_info':
        return this.renderPartiesSection(section, data);
      case 'items_table':
      case 'kitchen_items':
        return this.renderItemsTableSection(section, definition, data);
      case 'totals_summary':
        return this.renderTotalsSection(section, data);
      case 'fiscal_cufe_box':
        return this.renderCufeBoxSection(data);
      case 'fiscal_tax_breakdown':
        return this.renderTaxBreakdownSection(data);
      case 'fiscal_qr_section':
        return this.renderQrSection(data);
      case 'signatures_box':
        return this.renderSignaturesSection();
      case 'footer':
        return this.renderFooterSection(section, data);
      default:
        return this.renderGenericFieldsSection(section, data);
    }
  }

  private renderHeaderSection(section: any, data: StandardPrintDataModel): string {
    const store = data.store || ({} as any);
    const logo = store.logo_url ? `<div class="store-logo"><img src="${this.compiler.escapeHtml(store.logo_url)}" alt="Logo" style="max-height: 48px; max-width: 140px;" /></div>` : '';
    const name = store.name ? `<h1 class="store-name">${this.compiler.escapeHtml(store.name)}</h1>` : '';
    const legalName = store.legal_name && store.legal_name !== store.name ? `<div class="store-legal">${this.compiler.escapeHtml(store.legal_name)}</div>` : '';
    const nit = store.tax_id ? `<div class="store-nit">NIT: ${this.compiler.escapeHtml(store.tax_id)}</div>` : '';
    const regime = store.tax_regime ? `<div class="store-regime">${this.compiler.escapeHtml(store.tax_regime)}</div>` : '';
    const addr = store.address ? `<div class="store-address">${this.compiler.escapeHtml(store.address)}${store.city ? ', ' + this.compiler.escapeHtml(store.city) : ''}</div>` : '';
    const phone = store.phone ? `<div class="store-phone">Tel: ${this.compiler.escapeHtml(store.phone)}</div>` : '';

    return `
      <div class="print-section section-header">
        ${logo}
        ${name}
        ${legalName}
        ${nit}
        ${regime}
        ${addr}
        ${phone}
      </div>
    `;
  }

  private renderDocumentInfoSection(section: any, data: StandardPrintDataModel): string {
    const doc = data.document || ({} as any);
    return `
      <div class="print-section section-doc-info">
        <div class="doc-title-box">
          <div class="doc-number">${this.compiler.escapeHtml(doc.prefix ? doc.prefix + '-' : '')}#${this.compiler.escapeHtml(doc.number)}</div>
          <div class="doc-date">${this.compiler.escapeHtml(doc.date_formatted || doc.date)} ${this.compiler.escapeHtml(doc.time || '')}</div>
        </div>
        ${doc.cashier_name ? `<div class="doc-cashier">Cajero: ${this.compiler.escapeHtml(doc.cashier_name)}</div>` : ''}
        ${doc.pos_terminal ? `<div class="doc-terminal">Caja: ${this.compiler.escapeHtml(doc.pos_terminal)}</div>` : ''}
      </div>
    `;
  }

  private renderCustomerSection(section: any, data: StandardPrintDataModel): string {
    const cust = data.customer;
    if (!cust || (!cust.name && !cust.tax_id)) return '';

    return `
      <div class="print-section section-customer">
        <div class="section-label">CLIENTE</div>
        <div class="customer-name">${this.compiler.escapeHtml(cust.name)}</div>
        ${cust.tax_id ? `<div class="customer-nit">Doc / NIT: ${this.compiler.escapeHtml(cust.tax_id)}</div>` : ''}
        ${cust.address ? `<div class="customer-address">${this.compiler.escapeHtml(cust.address)}</div>` : ''}
        ${cust.phone ? `<div class="customer-phone">Tel: ${this.compiler.escapeHtml(cust.phone)}</div>` : ''}
        ${cust.email ? `<div class="customer-email">${this.compiler.escapeHtml(cust.email)}</div>` : ''}
      </div>
    `;
  }

  private renderPartiesSection(section: any, data: StandardPrintDataModel): string {
    const store = data.store || ({} as any);
    const cust = data.customer || ({} as any);
    const doc = data.document || ({} as any);

    return `
      <div class="print-section section-parties-grid">
        <div class="party-col party-issuer">
          <div class="party-title">EMISOR</div>
          <div class="party-name">${this.compiler.escapeHtml(store.legal_name || store.name)}</div>
          <div>NIT: ${this.compiler.escapeHtml(store.tax_id || 'N/A')}</div>
          <div>${this.compiler.escapeHtml(store.address || '')}</div>
          <div>Tel: ${this.compiler.escapeHtml(store.phone || '')}</div>
        </div>
        <div class="party-col party-client">
          <div class="party-title">CLIENTE / RECEPTOR</div>
          <div class="party-name">${this.compiler.escapeHtml(cust.name || 'Consumidor Final')}</div>
          <div>Doc: ${this.compiler.escapeHtml(cust.tax_id || '222222222222')}</div>
          <div>${this.compiler.escapeHtml(cust.address || '')}</div>
          <div>${this.compiler.escapeHtml(cust.email || '')}</div>
        </div>
        <div class="party-col party-doc">
          <div class="party-title">DOCUMENTO</div>
          <div class="doc-num-highlight">#${this.compiler.escapeHtml(doc.number)}</div>
          <div>Fecha: ${this.compiler.escapeHtml(doc.date_formatted || doc.date)}</div>
          <div>Estado: ${this.compiler.escapeHtml(doc.state_label || doc.state)}</div>
        </div>
      </div>
    `;
  }

  private renderItemsTableSection(
    section: any,
    definition: PrintFormatDefinition,
    data: StandardPrintDataModel,
  ): string {
    const items = data.items || [];
    const columns = (definition.columns || []).filter((c) => c.enabled);

    if (items.length === 0) {
      return `<div class="print-section"><div class="empty-items">Sin ítems registrados</div></div>`;
    }

    const theadThs = columns
      .map(
        (col) =>
          `<th style="width: ${col.width_percent}%; text-align: ${col.align};">${this.compiler.escapeHtml(col.label)}</th>`,
      )
      .join('');

    const tbodyRows = items
      .map((item, idx) => {
        const tds = columns
          .map((col) => {
            let val: any = '';
            switch (col.key) {
              case 'index':
                val = item.index || idx + 1;
                break;
              case 'product_name':
                val = `${this.compiler.escapeHtml(item.product_name)}${item.variant_sku ? `<br><small class="item-sub">SKU: ${this.compiler.escapeHtml(item.variant_sku)}</small>` : ''}${item.variant_attributes ? `<br><small class="item-sub">${this.compiler.escapeHtml(item.variant_attributes)}</small>` : ''}${item.notes ? `<br><small class="item-note">Nota: ${this.compiler.escapeHtml(item.notes)}</small>` : ''}`;
                return `<td style="text-align: ${col.align};">${val}</td>`;
              case 'variant_sku':
                val = item.variant_sku || '';
                break;
              case 'quantity':
                val = item.quantity;
                break;
              case 'unit_price':
                val = item.unit_price_formatted || `$${Number(item.unit_price).toLocaleString('es-CO')}`;
                break;
              case 'discount_amount':
                val = item.discount_formatted || (item.discount_amount ? `-$${Number(item.discount_amount).toLocaleString('es-CO')}` : '-');
                break;
              case 'tax_rate':
                val = item.tax_rate !== undefined ? `${item.tax_rate}%` : '-';
                break;
              case 'total_price':
                val = item.total_price_formatted || `$${Number(item.total_price).toLocaleString('es-CO')}`;
                break;
              default:
                val = (item as any)[col.key] || '';
            }
            return `<td style="text-align: ${col.align};">${this.compiler.escapeHtml(val)}</td>`;
          })
          .join('');

        return `<tr>${tds}</tr>`;
      })
      .join('');

    return `
      <div class="print-section section-items">
        <table class="print-table">
          <thead>
            <tr>${theadThs}</tr>
          </thead>
          <tbody>
            ${tbodyRows}
          </tbody>
        </table>
      </div>
    `;
  }

  private renderTotalsSection(section: any, data: StandardPrintDataModel): string {
    const totals = data.totals || ({} as any);
    const doc = data.document || ({} as any);

    return `
      <div class="print-section section-totals">
        <div class="totals-table-wrapper">
          <table class="totals-table">
            <tr>
              <td class="total-label">Subtotal:</td>
              <td class="total-val">${this.compiler.escapeHtml(totals.subtotal_formatted || `$${Number(totals.subtotal || 0).toLocaleString('es-CO')}`)}</td>
            </tr>
            ${Number(totals.discount_total) > 0 ? `
            <tr>
              <td class="total-label">Descuento:</td>
              <td class="total-val discount">-${this.compiler.escapeHtml(totals.discount_total_formatted || `$${Number(totals.discount_total).toLocaleString('es-CO')}`)}</td>
            </tr>` : ''}
            ${Number(totals.tax_total) > 0 ? `
            <tr>
              <td class="total-label">Impuestos (IVA):</td>
              <td class="total-val">${this.compiler.escapeHtml(totals.tax_total_formatted || `$${Number(totals.tax_total).toLocaleString('es-CO')}`)}</td>
            </tr>` : ''}
            ${Number(totals.shipping_total) > 0 ? `
            <tr>
              <td class="total-label">Envío:</td>
              <td class="total-val">${this.compiler.escapeHtml(totals.shipping_total_formatted || `$${Number(totals.shipping_total).toLocaleString('es-CO')}`)}</td>
            </tr>` : ''}
            <tr class="grand-total-row">
              <td class="total-label">TOTAL:</td>
              <td class="total-val grand-total">${this.compiler.escapeHtml(totals.grand_total_formatted || `$${Number(totals.grand_total || 0).toLocaleString('es-CO')}`)}</td>
            </tr>
            ${doc.payment_method ? `
            <tr class="payment-info-row">
              <td class="total-label">Pago (${this.compiler.escapeHtml(doc.payment_method)}):</td>
              <td class="total-val">${this.compiler.escapeHtml(doc.amount_received_formatted || `$${Number(doc.amount_received || totals.grand_total).toLocaleString('es-CO')}`)}</td>
            </tr>` : ''}
            ${Number(doc.change_due) > 0 ? `
            <tr class="change-info-row">
              <td class="total-label">Cambio:</td>
              <td class="total-val">${this.compiler.escapeHtml(doc.change_due_formatted || `$${Number(doc.change_due).toLocaleString('es-CO')}`)}</td>
            </tr>` : ''}
          </table>
        </div>
        ${totals.grand_total_in_words ? `
        <div class="total-in-words">
          <span class="total-in-words-label">Valor en letras:</span>
          <span class="total-in-words-value">${this.compiler.escapeHtml(totals.grand_total_in_words)}</span>
        </div>` : ''}
      </div>
    `;
  }

  private renderCufeBoxSection(data: StandardPrintDataModel): string {
    const fiscal = data.fiscal;
    if (!fiscal?.cufe && !fiscal?.cude) return '';
    const codeLabel = fiscal.cufe ? 'CUFE' : 'CUDE';
    const codeVal = fiscal.cufe || fiscal.cude || '';

    return `
      <div class="print-section section-cufe-box">
        <div class="cufe-label">${codeLabel}:</div>
        <div class="cufe-value">${this.compiler.escapeHtml(codeVal)}</div>
      </div>
    `;
  }

  private renderTaxBreakdownSection(data: StandardPrintDataModel): string {
    const taxes = data.taxes || [];
    if (taxes.length === 0) return '';

    const rows = taxes
      .map(
        (t) => `
      <tr>
        <td>${this.compiler.escapeHtml(t.name)} (${t.rate}%)</td>
        <td style="text-align: right;">${this.compiler.escapeHtml(t.base_formatted || `$${Number(t.base_amount).toLocaleString('es-CO')}`)}</td>
        <td style="text-align: right;">${this.compiler.escapeHtml(t.tax_formatted || `$${Number(t.tax_amount).toLocaleString('es-CO')}`)}</td>
      </tr>`,
      )
      .join('');

    return `
      <div class="print-section section-taxes">
        <div class="section-label">DISCRIMINACIÓN DE IMPUESTOS</div>
        <table class="tax-breakdown-table">
          <thead>
            <tr><th>Tarifa</th><th style="text-align: right;">Base</th><th style="text-align: right;">Impuesto</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  private renderQrSection(data: StandardPrintDataModel): string {
    const fiscal = data.fiscal;
    if (!fiscal?.qr_code_png_base64 && !fiscal?.qr_code_content) return '';

    const qrImg = fiscal.qr_code_png_base64
      ? `<img src="data:image/png;base64,${fiscal.qr_code_png_base64}" alt="QR Fiscal" style="width: 110px; height: 110px;" />`
      : '';

    return `
      <div class="print-section section-qr-fiscal" style="text-align: center; margin-top: 10px;">
        ${qrImg}
        <div style="font-size: 8pt; color: #666; margin-top: 4px;">Validación DIAN de Documento Electrónico</div>
      </div>
    `;
  }

  private renderSignaturesSection(): string {
    return `
      <div class="print-section section-signatures" style="display: flex; justify-content: space-between; margin-top: 35px; padding-top: 15px;">
        <div style="width: 45%; border-top: 1px solid #000; text-align: center; font-size: 8pt;">
          Entregado por / Conductor
        </div>
        <div style="width: 45%; border-top: 1px solid #000; text-align: center; font-size: 8pt;">
          Recibido a conformidad (Firma y C.C.)
        </div>
      </div>
    `;
  }

  private renderFooterSection(section: any, data: StandardPrintDataModel): string {
    return `
      <div class="print-section section-footer">
        <div class="footer-msg">¡Gracias por su compra!</div>
        <div class="powered-by">Generado por Vendix</div>
      </div>
    `;
  }

  private renderGenericFieldsSection(section: any, data: StandardPrintDataModel): string {
    const fields = (section.fields || []).filter((f: any) => f.enabled);
    if (fields.length === 0) return '';

    const fieldsHtml = fields
      .map((f: any) => {
        const val = this.compiler.resolvePath(data, f.key);
        if (val === undefined || val === null) return '';
        return `<div class="field-row"><span class="field-label">${this.compiler.escapeHtml(f.label)}:</span> <span class="field-val">${this.compiler.escapeHtml(val)}</span></div>`;
      })
      .join('');

    return `<div class="print-section section-generic">${fieldsHtml}</div>`;
  }

  private wrapInHtmlDocument(
    definition: PrintFormatDefinition,
    bodyContent: string,
  ): string {
    const paper = definition.paper;
    const styles = definition.styles || {};
    const primaryColor = styles.primary_color || '#111827';
    const font = styles.font_family || "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    const fontSize = styles.font_size_base_pt || (paper.is_roll ? 9 : 10);
    const pageSize = paper.is_roll ? `${paper.width_mm}mm auto` : paper.format;
    const margin = paper.margin_mm > 0 ? `${paper.margin_mm}mm` : '0';

    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Documento de Impresión</title>
  <style>
    @page {
      size: ${pageSize};
      margin: ${margin};
    }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; background: #fff !important; }
    }
    * { box-sizing: border-box; }
    body {
      font-family: ${font};
      font-size: ${fontSize}pt;
      color: #111827;
      margin: 0;
      padding: 0;
      background: #fff;
      line-height: 1.35;
    }
    .print-container {
      width: 100%;
      max-width: ${paper.is_roll ? `${paper.width_mm}mm` : '100%'};
      margin: 0 auto;
      padding: ${paper.is_roll ? '4px' : '8px'};
    }
    .print-section {
      margin-bottom: 8px;
    }
    .section-header {
      text-align: ${styles.header_alignment || (paper.is_roll ? 'center' : 'left')};
      border-bottom: ${paper.is_roll ? '1px dashed #000' : `2px solid ${primaryColor}`};
      padding-bottom: 8px;
    }
    .store-name {
      margin: 2px 0;
      font-size: ${fontSize + 3}pt;
      font-weight: bold;
      color: ${primaryColor};
    }
    .doc-number {
      font-weight: bold;
      font-size: ${fontSize + 2}pt;
    }
    .print-table, .tax-breakdown-table {
      width: 100%;
      border-collapse: collapse;
      margin: 6px 0;
    }
    .print-table th, .tax-breakdown-table th {
      border-bottom: 1px solid #111827;
      padding: 4px 2px;
      font-size: ${fontSize - 1}pt;
      text-transform: uppercase;
    }
    .print-table td, .tax-breakdown-table td {
      border-bottom: 1px solid #e5e7eb;
      padding: 4px 2px;
    }
    .totals-table {
      width: ${paper.is_roll ? '100%' : '260px'};
      margin-left: auto;
      border-collapse: collapse;
    }
    .totals-table td {
      padding: 3px 0;
    }
    .total-label { text-align: left; }
    .total-val { text-align: right; font-weight: 500; }
    .grand-total { font-weight: bold; font-size: ${fontSize + 2}pt; color: ${primaryColor}; }
    /*
     * El valor en letras va a ancho completo y NO dentro de .totals-table
     * (260px en hoja): la frase de un importe de nueve cifras se rompería en
     * cuatro líneas dentro de esa columna. clear:both porque la tabla de
     * totales flota a la derecha con margin-left:auto.
     *
     * Sin acentos graves en este comentario: vive DENTRO de un template
     * literal, y una comilla invertida aquí cierra la plantilla — el error que
     * tsc reporta entonces es «';' expected» en una línea de CSS intacta.
     */
    .total-in-words {
      clear: both;
      margin-top: 6px;
      font-size: ${fontSize - 1}pt;
      line-height: 1.35;
      text-align: right;
    }
    .total-in-words-label { text-transform: uppercase; color: #6b7280; }
    .total-in-words-value { font-weight: 600; }
    .section-cufe-box {
      background: #f3f4f6;
      padding: 6px;
      border-radius: 4px;
      font-size: 7.5pt;
      word-break: break-all;
    }
    .section-footer {
      text-align: center;
      font-size: ${fontSize - 1.5}pt;
      color: #6b7280;
      margin-top: 12px;
      border-top: 1px dashed #e5e7eb;
      padding-top: 6px;
    }
    .section-parties-grid {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      background: #f9fafb;
      padding: 10px;
      border-radius: 6px;
      font-size: ${fontSize - 0.5}pt;
    }
    .party-col { flex: 1; }
    .party-title { font-weight: bold; color: ${primaryColor}; font-size: ${fontSize - 1}pt; margin-bottom: 3px; }
  </style>
</head>
<body>
  ${bodyContent}
</body>
</html>`;
  }
}
