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
    mode: 'dummy' | 'tokenized' = 'dummy',
  ): string {
    // Si la definición incluye una plantilla custom completa, se compila directamente
    if (definition.custom_template && definition.custom_template.trim().length > 0) {
      const compiledCustom = this.compiler.compile(definition.custom_template, data, mode);
      return this.wrapInHtmlDocument(definition, compiledCustom.compiled);
    }

    // De lo contrario, se compone estructuralmente por secciones
    const sortedSections = [...(definition.sections || [])]
      .filter((s) => s.enabled)
      .sort((a, b) => (a.order || 0) - (b.order || 0));

    const renderedSections: string[] = [];

    for (const section of sortedSections) {
      const sectionHtml = this.renderSection(section, definition, data, mode);
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
    mode: 'dummy' | 'tokenized' = 'dummy',
  ): string {
    if (section.custom_content) {
      return `<div class="print-section section-${section.type}" data-section-id="${section.id || section.type}">${this.compiler.compile(section.custom_content, data, mode).compiled}</div>`;
    }

    switch (section.type) {
      case 'header':
      case 'fiscal_header':
        return this.renderHeaderSection(section, definition, data, mode);
      case 'document_info':
        return this.renderDocumentInfoSection(section, data, mode);
      case 'customer_info':
      case 'fiscal_buyer_info':
        return this.renderCustomerSection(section, data, mode);
      case 'parties_info':
        return this.renderPartiesSection(section, data, mode);
      case 'items_table':
      case 'kitchen_items':
        return this.renderItemsTableSection(section, definition, data, mode);
      case 'totals_summary':
        return this.renderTotalsSection(section, data, mode);
      case 'fiscal_cufe_box':
        return this.renderCufeBoxSection(data, mode);
      case 'fiscal_tax_breakdown':
        return this.renderTaxBreakdownSection(data, mode);
      case 'fiscal_qr_section':
        return this.renderQrSection(data, mode);
      case 'signatures_box':
        return this.renderSignaturesSection(mode);
      case 'footer':
        return this.renderFooterSection(section, data, mode);
      case 'dispatch_ticket':
        return this.renderDispatchTicketSection(section, data, mode);
      default:
        return this.renderGenericFieldsSection(section, data, mode);
    }
  }

  private renderHeaderSection(
    section: any,
    definition: PrintFormatDefinition,
    data: StandardPrintDataModel,
    mode: 'dummy' | 'tokenized' = 'dummy',
  ): string {
    const store = data.store || ({} as any);
    const runtimeLogo = store.logo_url as string | undefined;
    const defLogoBlock = definition.logo;
    const fallbackLogoUrl = !runtimeLogo && defLogoBlock?.url ? defLogoBlock.url : undefined;
    const defaultMonochromeLogo = '/vlogomono.png';
    const isLogoExplicitlyDisabled = defLogoBlock && (defLogoBlock as any).enabled === false;

    const logoUrl = isLogoExplicitlyDisabled
      ? undefined
      : runtimeLogo || fallbackLogoUrl || defaultMonochromeLogo;

    let logo = '';
    if (logoUrl || mode === 'tokenized') {
      const pos = defLogoBlock?.position || 'left';
      const sizeMm = typeof defLogoBlock?.size_mm === 'number' ? defLogoBlock.size_mm : 14;
      const opacity = typeof defLogoBlock?.opacity === 'number' ? defLogoBlock.opacity : 100;
      const maxPx = pos === 'full' ? '100%' : `${Math.max(8, Math.min(64, Math.round(sizeMm * 3.78)))}px`;
      const heightPx = pos === 'full' ? 'auto' : `${Math.max(8, Math.min(64, Math.round(sizeMm * 3.78)))}px`;
      const styleParts = [
        `max-height: ${heightPx}`,
        `max-width: ${maxPx}`,
        `opacity: ${Math.max(0, Math.min(100, opacity)) / 100}`,
      ];
      const alignStyle =
        pos === 'center' ? 'text-align: center;' : pos === 'right' ? 'text-align: right;' : 'text-align: left;';
      if (mode === 'tokenized') {
        logo = `<div class="store-logo" style="${alignStyle}" data-element-id="f_logo" data-section-id="sec_header" data-token="store.logo_url"><span class="vendix-token-pill" data-token="store.logo_url">&#123;&#123; store.logo_url &#125;&#125;</span></div>`;
      } else if (logoUrl) {
        logo = `<div class="store-logo" style="${alignStyle}" data-element-id="f_logo" data-section-id="sec_header" data-token="store.logo_url"><img src="${this.compiler.escapeHtml(logoUrl)}" alt="Logo" style="${styleParts.join('; ')}; object-fit: contain;" /></div>`;
      }
    }

    const isNameActive = this.isFieldActive(section, 'store_name') && this.isFieldActive(section, 'f_name');
    const isLegalActive = this.isFieldActive(section, 'store_legal_name') && this.isFieldActive(section, 'f_legal');
    const isNitActive = this.isFieldActive(section, 'store_tax_id') && this.isFieldActive(section, 'f_nit');
    const isRegimeActive = this.isFieldActive(section, 'store_regime') && this.isFieldActive(section, 'f_regime');
    const isAddrActive = this.isFieldActive(section, 'store_address') && this.isFieldActive(section, 'f_addr');
    const isPhoneActive = this.isFieldActive(section, 'store_phone') && this.isFieldActive(section, 'f_phone');

    const nitLabel = this.getFieldCustomLabel(section, 'f_nit', this.getFieldCustomLabel(section, 'store_tax_id', 'NIT'));
    const phoneLabel = this.getFieldCustomLabel(section, 'f_phone', this.getFieldCustomLabel(section, 'store_phone', 'Tel'));

    const nameVal = mode === 'tokenized' ? '<span class="vendix-token-pill" data-token="store.name">&#123;&#123; store.name &#125;&#125;</span>' : this.compiler.escapeHtml(store.name || '');
    const name = isNameActive ? `<h1 class="store-name" data-element-id="f_name" data-section-id="sec_header" data-token="store.name">${nameVal}</h1>` : '';

    const legalVal = mode === 'tokenized' ? '<span class="vendix-token-pill" data-token="store.legal_name">&#123;&#123; store.legal_name &#125;&#125;</span>' : this.compiler.escapeHtml(store.legal_name || '');
    const legalName = isLegalActive && (store.legal_name || mode === 'tokenized') ? `<div class="store-legal" data-element-id="f_legal" data-section-id="sec_header" data-token="store.legal_name">${legalVal}</div>` : '';

    const nitVal = mode === 'tokenized' ? '<span class="vendix-token-pill" data-token="store.tax_id">&#123;&#123; store.tax_id &#125;&#125;</span>' : `${nitLabel}: ${this.compiler.escapeHtml(store.tax_id || '')}`;
    const nit = isNitActive && (store.tax_id || mode === 'tokenized') ? `<div class="store-nit" data-element-id="f_nit" data-section-id="sec_header" data-token="store.tax_id">${nitVal}</div>` : '';

    const regimeVal = mode === 'tokenized' ? '<span class="vendix-token-pill" data-token="store.tax_regime">&#123;&#123; store.tax_regime &#125;&#125;</span>' : this.compiler.escapeHtml(store.tax_regime || '');
    const regime = isRegimeActive && (store.tax_regime || mode === 'tokenized') ? `<div class="store-regime" data-element-id="f_regime" data-section-id="sec_header" data-token="store.tax_regime">${regimeVal}</div>` : '';

    const addrVal = mode === 'tokenized' ? '<span class="vendix-token-pill" data-token="store.address">&#123;&#123; store.address &#125;&#125;</span>' : `${this.compiler.escapeHtml(store.address || '')}${store.city ? ', ' + this.compiler.escapeHtml(store.city) : ''}`;
    const addr = isAddrActive && (store.address || mode === 'tokenized') ? `<div class="store-address" data-element-id="f_addr" data-section-id="sec_header" data-token="store.address">${addrVal}</div>` : '';

    const phoneVal = mode === 'tokenized' ? '<span class="vendix-token-pill" data-token="store.phone">&#123;&#123; store.phone &#125;&#125;</span>' : `${phoneLabel}: ${this.compiler.escapeHtml(store.phone || '')}`;
    const phone = isPhoneActive && (store.phone || mode === 'tokenized') ? `<div class="store-phone" data-element-id="f_phone" data-section-id="sec_header" data-token="store.phone">${phoneVal}</div>` : '';

    const companyBlock = this.isFiscalDefinition(definition)
      ? this.renderCompanyBlock(definition, data, mode)
      : '';

    return `
      <div class="print-section section-header" data-section-id="sec_header">
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

  private isFieldActive(section: any, keyOrId: string): boolean {
    if (!section?.fields || !Array.isArray(section.fields) || section.fields.length === 0) return true;
    const f = section.fields.find((field: any) => field.id === keyOrId || field.key === keyOrId);
    return f ? f.enabled !== false : true;
  }

  private getFieldCustomLabel(section: any, keyOrId: string, defaultLabel: string): string {
    if (!section?.fields || !Array.isArray(section.fields)) return defaultLabel;
    const f = section.fields.find((field: any) => field.id === keyOrId || field.key === keyOrId);
    return (f?.custom_label && f.custom_label.trim().length > 0) ? f.custom_label : defaultLabel;
  }

  private renderCompanyBlock(
    definition: PrintFormatDefinition,
    data: StandardPrintDataModel,
    mode: 'dummy' | 'tokenized' = 'dummy',
  ): string {
    const fields = definition.company_block?.fields || [];
    if (fields.length === 0) return '';
    const store = (data.store || {}) as any;

    const rows = fields
      .filter((f: PrintCompanyField) => f && f.enabled)
      .map((f: PrintCompanyField) => {
        const value = this.lookupCompanyFieldValue(f.key, store);
        if (mode !== 'tokenized' && (value === undefined || value === null || value === '')) return '';
        const label = f.custom_label ? f.custom_label : f.key;
        const valHtml = mode === 'tokenized'
          ? `<span class="vendix-token-pill" data-token="store.${f.key}">&#123;&#123; store.${f.key} &#125;&#125;</span>`
          : this.compiler.escapeHtml(value);
        return `<div class="company-field" data-element-id="comp_${f.key}" data-token="store.${f.key}"><span class="label">${this.compiler.escapeHtml(label)}:</span> <span class="value">${valHtml}</span></div>`;
      })
      .filter((s) => s.length > 0)
      .join('');

    if (rows.length === 0) return '';
    return `<div class="company-block" data-section-id="sec_company_block">${rows}</div>`;
  }

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

  private renderDocumentInfoSection(section: any, data: StandardPrintDataModel, mode: 'dummy' | 'tokenized' = 'dummy'): string {
    const doc = data.document || ({} as any);

    const isNumActive = this.isFieldActive(section, 'order_number') && this.isFieldActive(section, 'f_num');
    const isDateActive = this.isFieldActive(section, 'order_date') && this.isFieldActive(section, 'f_date');
    const isCashierActive = this.isFieldActive(section, 'order_cashier') && this.isFieldActive(section, 'f_cashier');
    const isTerminalActive = this.isFieldActive(section, 'order_terminal') && this.isFieldActive(section, 'f_terminal');

    const cashierLabel = this.getFieldCustomLabel(section, 'f_cashier', this.getFieldCustomLabel(section, 'order_cashier', 'Cajero'));
    const terminalLabel = this.getFieldCustomLabel(section, 'f_terminal', this.getFieldCustomLabel(section, 'order_terminal', 'Caja'));

    const numVal = mode === 'tokenized'
      ? '<span class="vendix-token-pill" data-token="order.order_number">&#123;&#123; order.order_number &#125;&#125;</span>'
      : `${this.compiler.escapeHtml(doc.prefix ? doc.prefix + '-' : '')}#${this.compiler.escapeHtml(doc.number || '')}`;
    const dateVal = mode === 'tokenized'
      ? '<span class="vendix-token-pill" data-token="order.created_at">&#123;&#123; order.created_at &#125;&#125;</span>'
      : `${this.compiler.escapeHtml(doc.date_formatted || doc.date || '')} ${this.compiler.escapeHtml(doc.time || '')}`;
    const cashierVal = mode === 'tokenized'
      ? `${cashierLabel}: <span class="vendix-token-pill" data-token="order.cashier_name">&#123;&#123; order.cashier_name &#125;&#125;</span>`
      : (doc.cashier_name ? `${cashierLabel}: ${this.compiler.escapeHtml(doc.cashier_name)}` : '');
    const termVal = mode === 'tokenized'
      ? `${terminalLabel}: <span class="vendix-token-pill" data-token="order.pos_terminal">&#123;&#123; order.pos_terminal &#125;&#125;</span>`
      : (doc.pos_terminal ? `${terminalLabel}: ${this.compiler.escapeHtml(doc.pos_terminal)}` : '');

    return `
      <div class="print-section section-doc-info" data-section-id="sec_doc_info">
        <div class="doc-title-box">
          ${isNumActive ? `<div class="doc-number" data-element-id="f_num" data-section-id="sec_doc_info" data-token="order.order_number">${numVal}</div>` : ''}
          ${isDateActive ? `<div class="doc-date" data-element-id="f_date" data-section-id="sec_doc_info" data-token="order.created_at">${dateVal}</div>` : ''}
        </div>
        ${isCashierActive && cashierVal ? `<div class="doc-cashier" data-element-id="f_cashier" data-section-id="sec_doc_info" data-token="order.cashier_name">${cashierVal}</div>` : ''}
        ${isTerminalActive && termVal ? `<div class="doc-terminal" data-element-id="f_terminal" data-section-id="sec_doc_info" data-token="order.pos_terminal">${termVal}</div>` : ''}
      </div>
    `;
  }

  private renderCustomerSection(section: any, data: StandardPrintDataModel, mode: 'dummy' | 'tokenized' = 'dummy'): string {
    const cust = data.customer || ({} as any);
    if (mode !== 'tokenized' && !cust.name && !cust.tax_id) return '';

    const isNameActive = this.isFieldActive(section, 'customer_name') && this.isFieldActive(section, 'f_cname');
    const isNitActive = this.isFieldActive(section, 'customer_tax_id') && this.isFieldActive(section, 'f_cnit');
    const isAddrActive = this.isFieldActive(section, 'customer_address') && this.isFieldActive(section, 'f_caddr');
    const isPhoneActive = this.isFieldActive(section, 'customer_phone') && this.isFieldActive(section, 'f_cphone');
    const isEmailActive = this.isFieldActive(section, 'customer_email') && this.isFieldActive(section, 'f_cemail');

    const nitLabel = this.getFieldCustomLabel(section, 'f_cnit', this.getFieldCustomLabel(section, 'customer_tax_id', 'Doc / NIT'));
    const phoneLabel = this.getFieldCustomLabel(section, 'f_cphone', this.getFieldCustomLabel(section, 'customer_phone', 'Tel'));
    const emailLabel = this.getFieldCustomLabel(section, 'f_cemail', this.getFieldCustomLabel(section, 'customer_email', 'Email'));

    const nameVal = mode === 'tokenized'
      ? '<span class="vendix-token-pill" data-token="customer.name">&#123;&#123; customer.name &#125;&#125;</span>'
      : this.compiler.escapeHtml(cust.name || 'Consumidor Final');
    const nitVal = mode === 'tokenized'
      ? `${nitLabel}: <span class="vendix-token-pill" data-token="customer.tax_id">&#123;&#123; customer.tax_id &#125;&#125;</span>`
      : (cust.tax_id ? `${nitLabel}: ${this.compiler.escapeHtml(cust.tax_id)}` : '');
    const addrVal = mode === 'tokenized'
      ? '<span class="vendix-token-pill" data-token="customer.address">&#123;&#123; customer.address &#125;&#125;</span>'
      : (cust.address ? this.compiler.escapeHtml(cust.address) : '');
    const phoneVal = mode === 'tokenized'
      ? `${phoneLabel}: <span class="vendix-token-pill" data-token="customer.phone">&#123;&#123; customer.phone &#125;&#125;</span>`
      : (cust.phone ? `${phoneLabel}: ${this.compiler.escapeHtml(cust.phone)}` : '');
    const emailVal = mode === 'tokenized'
      ? `${emailLabel}: <span class="vendix-token-pill" data-token="customer.email">&#123;&#123; customer.email &#125;&#125;</span>`
      : (cust.email ? `${emailLabel}: ${this.compiler.escapeHtml(cust.email)}` : '');

    return `
      <div class="print-section section-customer" data-section-id="sec_customer">
        <div class="section-label">CLIENTE</div>
        ${isNameActive ? `<div class="customer-name" data-element-id="f_cname" data-section-id="sec_customer" data-token="customer.name">${nameVal}</div>` : ''}
        ${isNitActive && nitVal ? `<div class="customer-nit" data-element-id="f_cnit" data-section-id="sec_customer" data-token="customer.tax_id">${nitVal}</div>` : ''}
        ${isAddrActive && addrVal ? `<div class="customer-address" data-element-id="f_caddr" data-section-id="sec_customer" data-token="customer.address">${addrVal}</div>` : ''}
        ${isPhoneActive && phoneVal ? `<div class="customer-phone" data-element-id="f_cphone" data-section-id="sec_customer" data-token="customer.phone">${phoneVal}</div>` : ''}
        ${isEmailActive && emailVal ? `<div class="customer-email" data-element-id="f_cemail" data-section-id="sec_customer" data-token="customer.email">${emailVal}</div>` : ''}
      </div>
    `;
  }

  private renderPartiesSection(section: any, data: StandardPrintDataModel, mode: 'dummy' | 'tokenized' = 'dummy'): string {
    const store = data.store || ({} as any);
    const cust = data.customer || ({} as any);
    const doc = data.document || ({} as any);

    return `
      <div class="print-section section-parties-grid" data-section-id="sec_parties">
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
          <div class="doc-num-highlight">#${this.compiler.escapeHtml(doc.number || '')}</div>
          <div>Fecha: ${this.compiler.escapeHtml(doc.date_formatted || doc.date || '')}</div>
          <div>Estado: ${this.compiler.escapeHtml(doc.state_label || doc.state || '')}</div>
        </div>
      </div>
    `;
  }

  private renderItemsTableSection(
    section: any,
    definition: PrintFormatDefinition,
    data: StandardPrintDataModel,
    mode: 'dummy' | 'tokenized' = 'dummy',
  ): string {
    const items = data.items || [];
    const columns = (definition.columns || []).filter((c) => c.enabled);

    const theadThs = columns
      .map(
        (col) =>
          `<th data-column-id="${col.id}" data-element-id="col_${col.id}" style="width: ${col.width_percent}%; text-align: ${col.align}; cursor: pointer;">${this.compiler.escapeHtml(col.label)}</th>`,
      )
      .join('');

    const showSku = section.show_sku !== false;
    const showVariantAttr = section.show_variant_attributes !== false;
    const showNotes = section.show_notes !== false;
    const showItemDiscounts = section.show_item_discounts !== false;
    const showItemTaxes = section.show_item_taxes !== false;

    let tbodyRows = '';
    if (mode === 'tokenized') {
      const tds = columns
        .map((col) => {
          let tokenPill = '';
          switch (col.key) {
            case 'product_name':
              tokenPill = '<span class="vendix-token-pill" data-token="item.product_name">&#123;&#123; item.product_name &#125;&#125;</span>';
              break;
            case 'quantity':
              tokenPill = '<span class="vendix-token-pill" data-token="item.quantity">&#123;&#123; item.quantity &#125;&#125;</span>';
              break;
            case 'unit_price':
              tokenPill = '<span class="vendix-token-pill" data-token="item.unit_price">&#123;&#123; money item.unit_price &#125;&#125;</span>';
              break;
            case 'total_price':
              tokenPill = '<span class="vendix-token-pill" data-token="item.total_price">&#123;&#123; money item.total_price &#125;&#125;</span>';
              break;
            case 'discount_amount':
              tokenPill = '<span class="vendix-token-pill" data-token="item.discount_amount">&#123;&#123; money item.discount_amount &#125;&#125;</span>';
              break;
            case 'tax_rate':
              tokenPill = '<span class="vendix-token-pill" data-token="item.tax_rate">&#123;&#123; item.tax_rate &#125;&#125;%</span>';
              break;
            default:
              tokenPill = `<span class="vendix-token-pill" data-token="item.${col.key}">&#123;&#123; item.${col.key} &#125;&#125;</span>`;
          }
          return `<td data-column-id="${col.id}" data-element-id="col_${col.id}" style="text-align: ${col.align};">${tokenPill}</td>`;
        })
        .join('');
      tbodyRows = `<tr>${tds}</tr>`;
    } else {
      if (items.length === 0) {
        tbodyRows = `<tr><td colspan="${columns.length}" style="text-align:center;padding:8px;color:#888;">Sin ítems registrados</td></tr>`;
      } else {
        tbodyRows = items
          .map((item, idx) => {
            const tds = columns
              .map((col) => {
                let val: any = '';
                switch (col.key) {
                  case 'index':
                    val = item.index || idx + 1;
                    break;
                  case 'product_name': {
                    let sublines = '';
                    if (showSku && item.variant_sku) {
                      sublines += `<br><small class="item-sub item-sku">SKU: ${this.compiler.escapeHtml(item.variant_sku)}</small>`;
                    }
                    if (showVariantAttr && item.variant_attributes) {
                      sublines += `<br><small class="item-sub item-variants">${this.compiler.escapeHtml(item.variant_attributes)}</small>`;
                    }
                    if (showNotes && item.notes) {
                      sublines += `<br><small class="item-note">Nota: ${this.compiler.escapeHtml(item.notes)}</small>`;
                    }
                    if (showItemDiscounts && item.discount_amount && Number(item.discount_amount) > 0) {
                      sublines += `<br><small class="item-sub item-discount" style="color: #ef4444;">Desc: -${item.discount_formatted || `$${Number(item.discount_amount).toLocaleString('es-CO')}`}</small>`;
                    }
                    if (showItemTaxes && item.tax_rate !== undefined && Number(item.tax_rate) > 0) {
                      sublines += `<br><small class="item-sub item-tax" style="color: #6b7280;">IVA: ${item.tax_rate}%</small>`;
                    }
                    val = `${this.compiler.escapeHtml(item.product_name)}${sublines}`;
                    return `<td data-column-id="${col.id}" data-element-id="col_${col.id}" style="text-align: ${col.align};">${val}</td>`;
                  }
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
                return `<td data-column-id="${col.id}" data-element-id="col_${col.id}" style="text-align: ${col.align};">${this.compiler.escapeHtml(val)}</td>`;
              })
              .join('');

            return `<tr>${tds}</tr>`;
          })
          .join('');
      }
    }

    return `
      <div class="print-section section-items" data-section-id="sec_items">
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

  private renderTotalsSection(section: any, data: StandardPrintDataModel, mode: 'dummy' | 'tokenized' = 'dummy'): string {
    const totals = data.totals || ({} as any);
    const doc = data.document || ({} as any);

    const subVal = mode === 'tokenized'
      ? '<span class="vendix-token-pill" data-token="order.subtotal_amount">&#123;&#123; money order.subtotal_amount &#125;&#125;</span>'
      : this.compiler.escapeHtml(totals.subtotal_formatted || `$${Number(totals.subtotal || 0).toLocaleString('es-CO')}`);

    const discVal = mode === 'tokenized'
      ? '<span class="vendix-token-pill" data-token="order.discount_amount">&#123;&#123; money order.discount_amount &#125;&#125;</span>'
      : `-${this.compiler.escapeHtml(totals.discount_total_formatted || `$${Number(totals.discount_total).toLocaleString('es-CO')}`)}`;

    const taxVal = mode === 'tokenized'
      ? '<span class="vendix-token-pill" data-token="order.tax_amount">&#123;&#123; money order.tax_amount &#125;&#125;</span>'
      : this.compiler.escapeHtml(totals.tax_total_formatted || `$${Number(totals.tax_total).toLocaleString('es-CO')}`);

    const grandVal = mode === 'tokenized'
      ? '<span class="vendix-token-pill" data-token="order.grand_total">&#123;&#123; money order.grand_total &#125;&#125;</span>'
      : this.compiler.escapeHtml(totals.grand_total_formatted || `$${Number(totals.grand_total || 0).toLocaleString('es-CO')}`);

    const paymVal = mode === 'tokenized'
      ? '<span class="vendix-token-pill" data-token="order.amount_received">&#123;&#123; money order.amount_received &#125;&#125;</span>'
      : this.compiler.escapeHtml(doc.amount_received_formatted || `$${Number(doc.amount_received || totals.grand_total).toLocaleString('es-CO')}`);

    const chgVal = mode === 'tokenized'
      ? '<span class="vendix-token-pill" data-token="order.change_due">&#123;&#123; money order.change_due &#125;&#125;</span>'
      : this.compiler.escapeHtml(doc.change_due_formatted || `$${Number(doc.change_due).toLocaleString('es-CO')}`);

    return `
      <div class="print-section section-totals" data-section-id="sec_totals">
        <div class="totals-table-wrapper">
          <table class="totals-table">
            <tr data-element-id="f_sub" data-section-id="sec_totals" data-token="order.subtotal_amount">
              <td class="total-label">Subtotal:</td>
              <td class="total-val">${subVal}</td>
            </tr>
            ${mode === 'tokenized' || Number(totals.discount_total) > 0 ? `
            <tr data-element-id="f_disc" data-section-id="sec_totals" data-token="order.discount_amount">
              <td class="total-label">Descuento:</td>
              <td class="total-val discount">${discVal}</td>
            </tr>` : ''}
            ${mode === 'tokenized' || Number(totals.tax_total) > 0 ? `
            <tr data-element-id="f_tax" data-section-id="sec_totals" data-token="order.tax_amount">
              <td class="total-label">Impuestos (IVA):</td>
              <td class="total-val">${taxVal}</td>
            </tr>` : ''}
            <tr class="grand-total-row" data-element-id="f_tot" data-section-id="sec_totals" data-token="order.grand_total">
              <td class="total-label">TOTAL:</td>
              <td class="total-val grand-total">${grandVal}</td>
            </tr>
            ${mode === 'tokenized' || doc.payment_method ? `
            <tr class="payment-info-row" data-element-id="f_paym" data-section-id="sec_totals" data-token="order.payment_method">
              <td class="total-label">Pago (${mode === 'tokenized' ? 'Método' : this.compiler.escapeHtml(doc.payment_method)}):</td>
              <td class="total-val">${paymVal}</td>
            </tr>` : ''}
            ${mode === 'tokenized' || Number(doc.change_due) > 0 ? `
            <tr class="change-info-row" data-element-id="f_chg" data-section-id="sec_totals" data-token="order.change_due">
              <td class="total-label">Cambio:</td>
              <td class="total-val">${chgVal}</td>
            </tr>` : ''}
          </table>
        </div>
      </div>
    `;
  }

  private renderCufeBoxSection(data: StandardPrintDataModel, mode: 'dummy' | 'tokenized' = 'dummy'): string {
    const fiscal = data.fiscal;
    if (mode !== 'tokenized' && !fiscal?.cufe && !fiscal?.cude) return '';
    const codeLabel = fiscal?.cufe ? 'CUFE' : 'CUDE';
    const codeVal = mode === 'tokenized'
      ? '<span class="vendix-token-pill" data-token="fiscal.cufe">&#123;&#123; fiscal.cufe &#125;&#125;</span>'
      : this.compiler.escapeHtml(fiscal?.cufe || fiscal?.cude || '');

    return `
      <div class="print-section section-cufe-box" data-section-id="sec_cufe">
        <div class="cufe-label">${codeLabel}:</div>
        <div class="cufe-value" data-element-id="f_cufe" data-token="fiscal.cufe">${codeVal}</div>
      </div>
    `;
  }

  private renderTaxBreakdownSection(data: StandardPrintDataModel, mode: 'dummy' | 'tokenized' = 'dummy'): string {
    const taxes = data.taxes || [];
    if (mode !== 'tokenized' && taxes.length === 0) return '';

    const rows = (taxes.length > 0 ? taxes : [{ name: 'IVA', rate: 19, base_amount: 100000, tax_amount: 19000 }])
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
      <div class="print-section section-taxes" data-section-id="sec_taxes">
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

  private renderQrSection(data: StandardPrintDataModel, mode: 'dummy' | 'tokenized' = 'dummy'): string {
    const fiscal = data.fiscal;
    if (mode !== 'tokenized' && !fiscal?.qr_code_png_base64 && !fiscal?.qr_code_content) return '';

    const qrImg = fiscal?.qr_code_png_base64
      ? `<img src="data:image/png;base64,${fiscal.qr_code_png_base64}" alt="QR Fiscal" style="width: 110px; height: 110px;" />`
      : `<div style="display:inline-block;width:100px;height:100px;border:1px dashed #3b82f6;line-height:100px;font-size:10px;color:#3b82f6;"><span class="vendix-token-pill" data-token="fiscal.qr_code">&#123;&#123; QR Fiscal &#125;&#125;</span></div>`;

    return `
      <div class="print-section section-qr-fiscal" data-section-id="sec_qr" style="text-align: center; margin-top: 10px;">
        ${qrImg}
        <div style="font-size: 8pt; color: #666; margin-top: 4px;">Validación DIAN de Documento Electrónico</div>
      </div>
    `;
  }

  private renderSignaturesSection(mode: 'dummy' | 'tokenized' = 'dummy'): string {
    return `
      <div class="print-section section-signatures" data-section-id="sec_signatures" style="display: flex; justify-content: space-between; margin-top: 35px; padding-top: 15px;">
        <div style="width: 45%; border-top: 1px solid #000; text-align: center; font-size: 8pt;">
          Entregado por / Conductor
        </div>
        <div style="width: 45%; border-top: 1px solid #000; text-align: center; font-size: 8pt;">
          Recibido a conformidad (Firma y C.C.)
        </div>
      </div>
    `;
  }

  private renderFooterSection(section: any, data: StandardPrintDataModel, mode: 'dummy' | 'tokenized' = 'dummy'): string {
    const receipts = (data as any).receipts || ({} as any);
    const msgVal = mode === 'tokenized'
      ? '<span class="vendix-token-pill" data-token="receipts.receipt_footer">&#123;&#123; receipts.receipt_footer &#125;&#125;</span>'
      : (receipts.receipt_footer ? this.compiler.escapeHtml(receipts.receipt_footer) : '¡Gracias por su compra!');
    const poweredVal = mode === 'tokenized'
      ? '<span class="vendix-token-pill" data-token="system.powered_by">&#123;&#123; system.powered_by &#125;&#125;</span>'
      : 'Generado por Vendix';

    return `
      <div class="print-section section-footer" data-section-id="sec_footer">
        <div class="footer-msg" data-element-id="f_msg" data-section-id="sec_footer" data-token="receipts.receipt_footer">${msgVal}</div>
        <div class="powered-by" data-element-id="f_powered" data-section-id="sec_footer" data-token="system.powered_by">${poweredVal}</div>
      </div>
    `;
  }

  private renderDispatchTicketSection(
    _section: any,
    data: StandardPrintDataModel,
    mode: 'dummy' | 'tokenized' = 'dummy',
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
      <div class="print-section section-dispatch-ticket" data-section-id="sec_dispatch_ticket">
        ${header}
        ${customerBlock}
        ${itemsTable}
        ${footer}
      </div>
    `;
  }

  private renderGenericFieldsSection(section: any, data: StandardPrintDataModel, mode: 'dummy' | 'tokenized' = 'dummy'): string {
    const fields = (section.fields || []).filter((f: any) => f.enabled);
    if (fields.length === 0) return '';

    const fieldsHtml = fields
      .map((f: any) => {
        const val = this.compiler.resolvePath(data, f.key);
        if (mode !== 'tokenized' && (val === undefined || val === null)) return '';
        const valHtml = mode === 'tokenized'
          ? `<span class="vendix-token-pill" data-token="${f.key}">&#123;&#123; ${f.key} &#125;&#125;</span>`
          : this.compiler.escapeHtml(val);
        return `<div class="field-row" data-element-id="${f.id || f.key}" data-token="${f.key}"><span class="field-label">${this.compiler.escapeHtml(f.label)}:</span> <span class="field-val">${valHtml}</span></div>`;
      })
      .join('');

    return `<div class="print-section section-generic" data-section-id="${section.id || section.type}">${fieldsHtml}</div>`;
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

    const defaultMm = paper.is_roll ? 0 : 10;
    const mTop = paper.margin_top_mm ?? paper.margin_mm ?? defaultMm;
    const mRight = paper.margin_right_mm ?? paper.margin_mm ?? defaultMm;
    const mBottom = paper.margin_bottom_mm ?? paper.margin_mm ?? defaultMm;
    const mLeft = paper.margin_left_mm ?? paper.margin_mm ?? defaultMm;
    const maxMargin = Math.max(mTop, mRight, mBottom, mLeft);

    let pageSize: string;
    if (paper.format === 'custom') {
      const w = Number(paper.width_mm) || 80;
      const h = Number(paper.height_mm) || w;
      pageSize = `${w}mm ${h}mm`;
    } else {
      try {
        pageSize = resolvePaperDefinition(paper.format).css_page_size;
      } catch {
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
  <title></title>
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

    /* Token pills and interactive canvas outline styles */
    .vendix-token-pill {
      display: inline-block;
      background: #eff6ff;
      color: #1d4ed8;
      border: 1px dashed #3b82f6;
      border-radius: 4px;
      padding: 1px 5px;
      font-size: 8pt;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-weight: 600;
      white-space: nowrap;
      cursor: pointer;
    }
    .vendix-token-pill:hover {
      background: #dbeafe;
      border-color: #2563eb;
    }
    [data-element-id] {
      position: relative;
      cursor: pointer;
      transition: outline 0.15s ease-in-out, background-color 0.15s ease-in-out;
    }
    [data-element-id]:hover {
      outline: 1.5px dashed #3b82f6 !important;
      outline-offset: 1px;
    }
  </style>
</head>
<body>
  ${bodyContent}
  <script>
    document.addEventListener('click', function(e) {
      var target = e.target;
      var el = target.closest('[data-element-id]');
      var sec = target.closest('[data-section-id]');
      var tokenEl = target.closest('[data-token]');
      if (el || sec || tokenEl) {
        var payload = {
          type: 'VENDIX_PRINT_ELEMENT_CLICKED',
          elementId: el ? el.getAttribute('data-element-id') : null,
          sectionId: sec ? sec.getAttribute('data-section-id') : null,
          token: tokenEl ? tokenEl.getAttribute('data-token') : null,
          columnId: el ? el.getAttribute('data-column-id') : null
        };
        window.parent.postMessage(payload, '*');
      }
    });
  </script>
</body>
</html>`;
  }
}
