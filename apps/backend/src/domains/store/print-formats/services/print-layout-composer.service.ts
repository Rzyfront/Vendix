import { Injectable } from '@nestjs/common';
import {
  PrintFormatDefinition,
  PrintCompanyField,
} from '../interfaces/print-format.interface';
import { StandardPrintDataModel } from '../interfaces/standard-print-data.model';
import { PrintTemplateCompilerService } from './print-template-compiler.service';
import { getPaperGeometry, PaperFormat } from '../lib/page-geometry';
import { resolvePaperDefinition } from '../print-templates/paper-defaults';
import { FISCAL_FORMATS } from './print-fiscal-validator.service';

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
        return this.renderHeaderSection(section, definition, data);
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
      case 'dispatch_ticket':
        // CP-DTLP-20260827 (Phase B.5): el undécimo formato del Hub usa una
        // composición dedicada (no reutiliza header/items_table del resto
        // porque el contenido es logístico, no fiscal: cliente + dirección +
        // cant.pedida/cant.despachada). Ver dispatchTicketStyles abajo.
        return this.renderDispatchTicketSection(section, data);
      default:
        return this.renderGenericFieldsSection(section, data);
    }
  }

  private renderHeaderSection(
    section: any,
    definition: PrintFormatDefinition,
    data: StandardPrintDataModel,
  ): string {
    const store = data.store || ({} as any);
    // [print-editor-dsk P1.3] v2: `definition.logo` es el fallback estático
    // cuando la tienda no ha subido un logo propio. Si `data.store.logo_url`
    // está presente, gana el runtime (igual que antes); sólo cuando el
    // runtime está vacío recurrimos al `definition.logo.url` firmado por el
    // controller. Honra `position` y `size_mm`/`opacity`.
    const runtimeLogo = store.logo_url as string | undefined;
    const defLogoBlock = definition.logo;
    const fallbackLogoUrl = !runtimeLogo && defLogoBlock?.url ? defLogoBlock.url : undefined;

    const logoUrl = runtimeLogo || fallbackLogoUrl;
    let logo = '';
    if (logoUrl) {
      const pos = defLogoBlock?.position || 'left';
      const sizeMm = typeof defLogoBlock?.size_mm === 'number' ? defLogoBlock.size_mm : 12;
      const opacity = typeof defLogoBlock?.opacity === 'number' ? defLogoBlock.opacity : 100;
      // `size_mm` para imágenes de logo: convertimos a px (1mm ≈ 3.78px @96dpi)
      // y aplicamos max-height/max-width razonables. `position: full` ignora el
      // tamaño y estira el logo al ancho del contenedor.
      const maxPx = pos === 'full' ? '100%' : `${Math.max(8, Math.min(48, Math.round(sizeMm * 3.78)))}px`;
      const heightPx = pos === 'full' ? 'auto' : `${Math.max(8, Math.min(48, Math.round(sizeMm * 3.78)))}px`;
      const styleParts = [
        `max-height: ${heightPx}`,
        `max-width: ${maxPx}`,
        `opacity: ${Math.max(0, Math.min(100, opacity)) / 100}`,
      ];
      const alignStyle =
        pos === 'center' ? 'text-align: center;' : pos === 'right' ? 'text-align: right;' : 'text-align: left;';
      logo = `<div class="store-logo" style="${alignStyle}"><img src="${this.compiler.escapeHtml(logoUrl)}" alt="Logo" style="${styleParts.join('; ')};" /></div>`;
    }
    const name = store.name ? `<h1 class="store-name">${this.compiler.escapeHtml(store.name)}</h1>` : '';
    const legalName = store.legal_name && store.legal_name !== store.name ? `<div class="store-legal">${this.compiler.escapeHtml(store.legal_name)}</div>` : '';
    const nit = store.tax_id ? `<div class="store-nit">NIT: ${this.compiler.escapeHtml(store.tax_id)}</div>` : '';
    const regime = store.tax_regime ? `<div class="store-regime">${this.compiler.escapeHtml(store.tax_regime)}</div>` : '';
    const addr = store.address ? `<div class="store-address">${this.compiler.escapeHtml(store.address)}${store.city ? ', ' + this.compiler.escapeHtml(store.city) : ''}</div>` : '';
    const phone = store.phone ? `<div class="store-phone">Tel: ${this.compiler.escapeHtml(store.phone)}</div>` : '';

    // [print-editor-dsk P1.3] v2: el `company_block` se renderiza después del
    // header SOLO cuando la definición es fiscal. Detectamos fiscal por la
    // presencia de secciones tipo `fiscal_*` (única señal que el composer
    // tiene: el `formatType` no se le pasa). El bloque respeta `enabled` por
    // campo y aplica `custom_label` sobre el label por defecto.
    const companyBlock = this.isFiscalDefinition(definition)
      ? this.renderCompanyBlock(definition, data)
      : '';

    return `
      <div class="print-section section-header">
        ${logo}
        ${name}
        ${legalName}
        ${nit}
        ${regime}
        ${addr}
        ${phone}
        ${companyBlock}
      </div>
    `;
  }

  /**
   * [print-editor-dsk P1.3] v2 NEW — bloque de empresa (NIT, dirección, etc.)
   * tipado. Sólo se invoca cuando `definition.company_block?.fields` está
   * presente Y la definición es fiscal. Los campos se emiten en el orden
   * declarado, respetando `enabled` y `custom_label`. La fuente de cada valor
   * es `data.store` (los StandardPrintParty tienen todos los campos que el
   * PrintCompanyFieldKey enum declara).
   */
  private renderCompanyBlock(
    definition: PrintFormatDefinition,
    data: StandardPrintDataModel,
  ): string {
    const fields = definition.company_block?.fields || [];
    if (fields.length === 0) return '';
    const store = (data.store || {}) as any;

    const rows = fields
      .filter((f: PrintCompanyField) => f && f.enabled)
      .map((f: PrintCompanyField) => {
        const value = this.lookupCompanyFieldValue(f.key, store);
        if (value === undefined || value === null || value === '') return '';
        const label = f.custom_label ? f.custom_label : f.key;
        return `<div class="company-field"><span class="label">${this.compiler.escapeHtml(label)}:</span> <span class="value">${this.compiler.escapeHtml(value)}</span></div>`;
      })
      .filter((s) => s.length > 0)
      .join('');

    if (rows.length === 0) return '';
    return `<div class="company-block">${rows}</div>`;
  }

  /**
   * Resolución del valor de un PrintCompanyFieldKey contra el `data.store`.
   * Sólo fiscales pueden llevar este bloque, así que la fuente es siempre
   * `data.store` (StandardPrintParty) — el emisor del documento.
   */
  private lookupCompanyFieldValue(
    key: PrintCompanyField['key'],
    store: any,
  ): string | undefined {
    switch (key) {
      case 'NIT':
        return store.tax_id;
      case 'DV':
        return store.tax_id_dv || store.verification_digit;
      case 'regimen':
        return store.tax_regime;
      case 'address':
        return store.address;
      case 'phone':
        return store.phone;
      case 'email':
        return store.email;
      case 'website':
        return store.website || store.web || store.url;
      default:
        return undefined;
    }
  }

  /**
   * [print-editor-dsk P1.3] v2 — Inferencia de "definición fiscal" para el
   * composer. El `compose()` no recibe `formatType`; lo único que sabe es
   * la `definition`. Cualquier sección de tipo `fiscal_*` (header, buyer,
   * cufe/cude, tax breakdown, qr) identifica inequívocamente un formato
   * del set `FISCAL_FORMATS` (fiscal_electronic_invoice, fiscal_credit_note).
   * Usamos la presencia de esas secciones como proxy declarativo — es la
   * MISMA guarda que `PrintFiscalValidatorService.assertFiscalCompliance`
   * aplica antes de validar el contenido, así que el bloque se renderiza
   * exactamente para los mismos formatos que el validador exige.
   */
  private isFiscalDefinition(definition: PrintFormatDefinition): boolean {
    const sections = definition.sections || [];
    return sections.some((s) => {
      const t = (s && s.type) || '';
      return (
        t === 'fiscal_header' ||
        t === 'fiscal_cufe_box' ||
        t === 'fiscal_qr_section' ||
        t === 'fiscal_buyer_info' ||
        t === 'fiscal_tax_breakdown'
      );
    });
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
            ${
              // E.11 casilla 1 — la retención ya llega en el modelo (antes el
              // mapeador la ignoraba y desaparecía del papel, mientras el PDF
              // legal sí imprime «Retencion:»). Fila INFORMATIVA con signo
              // negativo de presentación: NO descuenta del total, igual que
              // `invoice-pdf.builder.ts` drawTotals.
              Number(totals.withholding_total) > 0 ? `
            <tr>
              <td class="total-label">Retención:</td>
              <td class="total-val">-${this.compiler.escapeHtml(totals.withholding_total_formatted || `$${Number(totals.withholding_total).toLocaleString('es-CO')}`)}</td>
            </tr>` : ''
            }
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

  /**
   * CP-DTLP-20260827 (Phase B.5) — Renderiza la sección de tipo
   * `dispatch_ticket`. Estructura:
   *  1. Header: logo (si existe) + nombre tienda + número de orden + fecha
   *  2. Customer block: nombre + dirección (líneas 1 y 2) + ciudad
   *  3. Items table: 4 cols (#, SKU/Descripción, Cant.pedida, Cant.despachada)
   *  4. Footer: línea de firma "Despachado por: ___________"
   *
   * Sin totales fiscales (no es formato fiscal). Sin QR (la firma del
   * recibido se reserva al formato `dispatch_note` que ya existe).
   *
   * El HTML producido se inyecta dentro de wrapInHtmlDocument, que añade
   * el @page { size: 80mm auto; margin: 0 } y los estilos base. Los
   * estilos específicos del tiquete viven en `dispatchTicketStyles`
   * (exportados aparte como DISPATCH_TICKET_PRINT_STYLES por si un caller
   * externo — p.ej. un endpoint de descarga PDF — quiere usarlos solos).
   */
  private renderDispatchTicketSection(
    _section: any,
    data: StandardPrintDataModel,
  ): string {
    const store = data.store || ({} as any);
    const customer = data.customer || ({} as any);
    const doc = data.document || ({} as any);
    const items = data.items || [];

    const logo = store.logo_url
      ? `<div class="dt-logo"><img src="${this.compiler.escapeHtml(store.logo_url)}" alt="Logo" /></div>`
      : '';
    const header = `
      <div class="dt-header">
        ${logo}
        <div class="dt-store-name">${this.compiler.escapeHtml(store.name || 'Vendix')}</div>
        <div class="dt-doc-number">Tiquete #${this.compiler.escapeHtml(String(doc.number || ''))}</div>
        <div class="dt-doc-date">${this.compiler.escapeHtml(doc.date_formatted || doc.date || '')}${doc.time ? ' ' + this.compiler.escapeHtml(doc.time) : ''}</div>
      </div>
    `;

    const customerBlock = `
      <div class="dt-customer">
        <div class="dt-section-label">CLIENTE</div>
        <div class="dt-customer-name">${this.compiler.escapeHtml(customer.name || 'Cliente')}</div>
        ${customer.address_line1 ? `<div class="dt-addr-line">${this.compiler.escapeHtml(customer.address_line1)}</div>` : ''}
        ${customer.address_line2 ? `<div class="dt-addr-line">${this.compiler.escapeHtml(customer.address_line2)}</div>` : ''}
        ${customer.city ? `<div class="dt-addr-city">${this.compiler.escapeHtml(customer.city)}</div>` : ''}
      </div>
    `;

    const itemsTable = items.length === 0
      ? '<div class="dt-empty">Sin productos registrados</div>'
      : `
        <table class="dt-items">
          <thead>
            <tr>
              <th class="col-idx">#</th>
              <th class="col-desc">SKU / Descripción</th>
              <th class="col-qty">Cant. Pedida</th>
              <th class="col-qty">Cant. Despachada</th>
            </tr>
          </thead>
          <tbody>
            ${items
              .map(
                (it) => `
              <tr>
                <td class="col-idx">${this.compiler.escapeHtml(String(it.index ?? ''))}</td>
                <td class="col-desc">
                  ${it.variant_sku ? `<div class="dt-sku">${this.compiler.escapeHtml(it.variant_sku)}</div>` : ''}
                  <div>${this.compiler.escapeHtml(it.product_name || '')}</div>
                </td>
                <td class="col-qty">${this.compiler.escapeHtml(String(it.quantity ?? 0))}</td>
                <td class="col-qty">${this.compiler.escapeHtml(String(it.dispatched_qty ?? 0))}</td>
              </tr>`,
              )
              .join('')}
          </tbody>
        </table>
      `;

    const footer = `
      <div class="dt-footer">
        <div class="dt-dispatched-by">Despachado por:</div>
        <div class="dt-signature"></div>
        <div class="dt-powered">Generado por Vendix</div>
      </div>
    `;

    return `
      <div class="print-section section-dispatch-ticket">
        ${header}
        ${customerBlock}
        ${itemsTable}
        ${footer}
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

    // [print-editor-dsk P1.3] v2: márgenes por lado. La precedencia es:
    //   1) per-side (`margin_top_mm`, etc.) si están definidos;
    //   2) `margin_mm` legacy (uniforme en los 4 lados);
    //   3) fallback por tipo de papel: 0 en rollo, 10 mm en hoja.
    // CSS `@page margin` sólo acepta un valor único, así que pasamos el
    // MÁXIMO de los 4 lados (fidelidad de impresión: ningún lado se sale del
    // cuadro). Los 4 lados reales se aplican en `body { padding }` para que
    // el contenido respete cada margen (sobre todo en hojas A4/letter, donde
    // el binding izquierdo suele necesitar más margen que el derecho).
    const defaultMm = paper.is_roll ? 0 : 10;
    const mTop = paper.margin_top_mm ?? paper.margin_mm ?? defaultMm;
    const mRight = paper.margin_right_mm ?? paper.margin_mm ?? defaultMm;
    const mBottom = paper.margin_bottom_mm ?? paper.margin_mm ?? defaultMm;
    const mLeft = paper.margin_left_mm ?? paper.margin_mm ?? defaultMm;
    const maxMargin = Math.max(mTop, mRight, mBottom, mLeft);

    // [print-editor-dsk P1.3] v2: `@page size` se resuelve desde PAPER_DEFINITIONS
    // (vía `page-geometry.ts`). El fallback legacy era `paper.format` crudo,
    // que sólo funciona para los formatos CSS nativos (`A4`, `letter`) pero
    // falla para `thermal_80` (que necesita `80mm auto`). El lookup nos da
    // siempre el `css_page_size` canónico. Para `custom` caemos a la
    // expresión `${width_mm}mm ${height_mm}mm` del pliego declarado.
    //
    // E.11 slice 2 — paso 8 del plan de cierre: el composer lee PAPER_DEFINITIONS
    // (vía `resolvePaperDefinition`), no `page-geometry.ts`. PAPER_DEFINITIONS es la
    // fuente única: el renderBuffer ya consume de aquí (`fiscal-invoice-pdf-render.
    // service.ts:358`); los `width_mm` del composer pasan a coincidir bit a bit con
    // los del PDF (216 vs 215.9 mm en letter — ver `paper-definitions.ts`, tabla
    // de divergencias conocidas). `getPaperGeometry` queda como DEPRECATED para
    // consumidores que ya no lean de aquí.
    let pageSize: string;
    if (paper.format === 'custom') {
      const w = Number(paper.width_mm) || 80;
      const h = Number(paper.height_mm) || w;
      pageSize = `${w}mm ${h}mm`;
    } else {
      try {
        pageSize = resolvePaperDefinition(paper.format).css_page_size;
      } catch {
        // PAPER_DEFINITIONS no conoce el formato (p.ej. `custom` ya filtrado).
        // Roll-paper fallback: emite `${width_mm}mm auto`. Si el formato
        // existe en `page-geometry.ts` pero NO en PAPER_DEFINITIONS, lo
        // aceptamos para no romper consumidores legacy — pero el log de
        // arriba deja la divergencia visible.
        try {
          pageSize = getPaperGeometry(paper.format as PaperFormat).css_page_size;
        } catch {
          pageSize = paper.is_roll ? `${paper.width_mm}mm auto` : paper.format;
        }
      }
    }
    const margin = maxMargin > 0 ? `${maxMargin}mm` : '0';

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
      /* [print-editor-dsk P1.3] v2: padding per-side refleja los 4 márgenes
         reales (top/right/bottom/left). El @page margin usa el máximo para
         que ningún lado se salga del cuadro físico. */
      padding: ${mTop}mm ${mRight}mm ${mBottom}mm ${mLeft}mm;
      background: #fff;
      line-height: 1.35;
    }
    .print-container {
      width: 100%;
      max-width: ${paper.is_roll ? `${paper.width_mm}mm` : '100%'};
      margin: 0 auto;
      padding: ${paper.is_roll ? '4px' : '8px'};
    }
    /* [print-editor-dsk P1.3] v2 — company-block styling. Las clases
       .company-field / .label / .value se aplican por cada campo del
       PrintCompanyBlock (NIT, telefono, direccion, etc.). Tipografia menor
       que el header principal para no competir con el nombre del emisor.
       Sin acentos graves: viven DENTRO de un template literal, y una
       comilla invertida cerraria la plantilla — el error que tsc reporta
       entonces es "'; expected" en una linea de CSS intacta. */
    .company-block {
      margin-top: 4px;
      font-size: ${fontSize - 1}pt;
      line-height: 1.3;
    }
    .company-block .company-field {
      display: block;
    }
    .company-block .label {
      font-weight: 600;
      color: ${primaryColor};
      margin-right: 4px;
    }
    .company-block .value {
      color: #111827;
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
    /*
     * CP-DTLP-20260827 (Phase B.5.b) — estilos específicos del Tiquete de
     * Despacho. Se inyectan siempre que el wrapInHtmlDocument se llame con
     * un definition que tenga al menos una sección tipo dispatch_ticket,
     * pero como no son intrusivos (clases con prefijo dt-), conviven con
     * los otros 10 formatos sin pisar nada.
     */
    .section-dispatch-ticket .dt-header {
      text-align: center;
      border-bottom: 1px dashed #000;
      padding-bottom: 4px;
      margin-bottom: 6px;
    }
    .section-dispatch-ticket .dt-logo img {
      max-height: 30mm;
      max-width: 70mm;
      display: block;
      margin: 0 auto 2px;
    }
    .section-dispatch-ticket .dt-store-name {
      font-size: 11pt;
      font-weight: bold;
    }
    .section-dispatch-ticket .dt-doc-number,
    .section-dispatch-ticket .dt-doc-date {
      font-size: 8pt;
    }
    .section-dispatch-ticket .dt-customer {
      margin: 6px 0;
      font-size: 8pt;
    }
    .section-dispatch-ticket .dt-section-label {
      font-weight: bold;
      font-size: 7pt;
      letter-spacing: 0.5px;
      border-bottom: 1px solid #000;
      margin-bottom: 2px;
    }
    .section-dispatch-ticket .dt-customer-name {
      font-weight: bold;
      font-size: 9pt;
    }
    .section-dispatch-ticket .dt-addr-line,
    .section-dispatch-ticket .dt-addr-city {
      font-size: 8pt;
    }
    .section-dispatch-ticket table.dt-items {
      width: 100%;
      border-collapse: collapse;
      margin-top: 4px;
    }
    .section-dispatch-ticket table.dt-items th,
    .section-dispatch-ticket table.dt-items td {
      border: 1px solid #000;
      padding: 1px 3px;
      font-size: 7.5pt;
      vertical-align: top;
    }
    .section-dispatch-ticket table.dt-items th {
      background: #f0f0f0;
      font-weight: bold;
      text-align: center;
    }
    .section-dispatch-ticket .col-idx { width: 8%; text-align: center; }
    .section-dispatch-ticket .col-desc { width: 54%; text-align: left; }
    .section-dispatch-ticket .col-qty { width: 19%; text-align: center; }
    .section-dispatch-ticket .dt-sku {
      font-size: 7pt;
      color: #444;
    }
    .section-dispatch-ticket .dt-footer {
      margin-top: 10px;
      padding-top: 6px;
      border-top: 1px dashed #000;
      font-size: 7.5pt;
    }
    .section-dispatch-ticket .dt-dispatched-by {
      font-weight: bold;
      margin-bottom: 18px;
    }
    .section-dispatch-ticket .dt-signature {
      display: inline-block;
      width: 90%;
      border-top: 1px solid #000;
      margin-top: 16px;
    }
    .section-dispatch-ticket .dt-powered {
      text-align: center;
      font-size: 7pt;
      color: #6b7280;
      margin-top: 6px;
    }
    .section-dispatch-ticket .dt-empty {
      text-align: center;
      font-size: 8pt;
      color: #6b7280;
      margin: 6px 0;
    }
  </style>
</head>
<body>
  ${bodyContent}
</body>
</html>`;
  }
}
