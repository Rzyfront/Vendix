import { Injectable } from '@angular/core';
import {
  PrintAnnexValidationRule,
  PrintAnnexValidationSummary,
  PrintFormatDefinition,
  PrintFormatType,
} from '../../../../../../core/models/print-formats.model';

@Injectable({
  providedIn: 'root',
})
export class PrintAnnexValidatorService {
  /**
   * Evaluates a print format definition against Colombian DIAN Anexo Técnico 1.9
   * and Estatuto Tributario Art. 617 requirements.
   */
  validate(
    definition: PrintFormatDefinition,
    formatType: PrintFormatType,
  ): PrintAnnexValidationSummary {
    const isFiscal =
      formatType === 'fiscal_electronic_invoice' ||
      formatType === 'fiscal_credit_note' ||
      formatType === 'pos_sale_ticket' ||
      formatType === 'sales_order_invoice';

    const isElectronicInvoice =
      formatType === 'fiscal_electronic_invoice' ||
      formatType === 'fiscal_credit_note';

    const sections = definition.sections || [];
    const columns = definition.columns || [];
    const companyFields = definition.companyBlock?.fields || [];

    const isFieldEnabled = (fieldKey: string): boolean => {
      for (const sec of sections) {
        if (!sec.enabled) continue;
        const f = sec.fields?.find((field) => field.key === fieldKey || field.id === fieldKey);
        if (f) return f.enabled !== false;
      }
      const compField = companyFields.find((cf: any) => cf.key === fieldKey);
      if (compField) return compField.enabled;
      return false;
    };

    const isSectionTypeEnabled = (type: string): boolean => {
      const s = sections.find((sec) => sec.type === type || sec.id === type);
      return Boolean(s && s.enabled !== false);
    };

    const isColumnEnabled = (colKey: string): boolean => {
      const c = columns.find((col) => col.key === colKey || col.id === colKey);
      return Boolean(c && c.enabled !== false);
    };

    const rules: PrintAnnexValidationRule[] = [];

    // ─────────────────────────────────────────────────────────
    // 1. Emisor (Obligado a facturar) — Art. 617 lit a, b, d
    // ─────────────────────────────────────────────────────────
    rules.push({
      id: 'emisor_name',
      category: 'emisor',
      name: 'Razón Social / Nombre Comercial',
      description: 'Debe figurar la denominación o razón social y nombre comercial del emisor.',
      reference: 'Art. 617 lit. a) E.T. / Anexo 1.9 §8.1.1',
      severity: 'error',
      passed: isSectionTypeEnabled('header') || isFieldEnabled('store.name') || isFieldEnabled('store.legal_name') || isFieldEnabled('f_name'),
      fixAction: { label: 'Activar cabecera de tienda', sectionId: 'sec_header' },
    });

    rules.push({
      id: 'emisor_nit',
      category: 'emisor',
      name: 'NIT y Dígito de Verificación',
      description: 'Debe incluirse el NIT del obligado a facturar con su dígito de verificación (DV).',
      reference: 'Art. 617 lit. b) E.T. / Anexo 1.9 §8.1.1',
      severity: 'error',
      passed: isFieldEnabled('NIT') || isFieldEnabled('store.tax_id') || isFieldEnabled('f_nit') || isSectionTypeEnabled('header'),
      fixAction: { label: 'Activar NIT en cabecera', sectionId: 'sec_header', fieldKey: 'f_nit' },
    });

    rules.push({
      id: 'emisor_regime',
      category: 'emisor',
      name: 'Régimen Fiscal / Responsabilidad Tributaria',
      description: 'Identificación de la calidad de responsable del IVA o no responsable.',
      reference: 'Anexo Técnico 1.9 DIAN §8.1.1',
      severity: isFiscal ? 'warning' : 'info',
      passed: isFieldEnabled('regimen') || isFieldEnabled('store.tax_regime') || isFieldEnabled('f_regime') || isSectionTypeEnabled('header'),
      fixAction: { label: 'Activar Régimen Fiscal', sectionId: 'sec_header', fieldKey: 'f_regime' },
    });

    rules.push({
      id: 'emisor_address',
      category: 'emisor',
      name: 'Dirección y Municipio del Emisor',
      description: 'Lugar de expedición con dirección física y ciudad/departamento.',
      reference: 'Art. 617 lit. d) E.T. / Anexo 1.9 §8.1.1',
      severity: 'warning',
      passed: isFieldEnabled('address') || isFieldEnabled('store.address') || isFieldEnabled('f_addr') || isSectionTypeEnabled('header'),
      fixAction: { label: 'Activar Dirección', sectionId: 'sec_header', fieldKey: 'f_addr' },
    });

    // ─────────────────────────────────────────────────────────
    // 2. Documento y Numeración — Art. 617 lit c
    // ─────────────────────────────────────────────────────────
    rules.push({
      id: 'doc_number',
      category: 'documento',
      name: 'Consecutivo y Prefijo de Facturación',
      description: 'Número consecutivo autorizado correspondiente al sistema de numeración.',
      reference: 'Art. 617 lit. c) E.T. / Anexo 1.9 §8.1.3',
      severity: 'error',
      passed: isSectionTypeEnabled('doc_info') || isFieldEnabled('order.order_number') || isFieldEnabled('document.number') || isFieldEnabled('f_num'),
      fixAction: { label: 'Activar número de factura', sectionId: 'sec_doc_info' },
    });

    rules.push({
      id: 'doc_date',
      category: 'documento',
      name: 'Fecha y Hora de Expedición',
      description: 'Fecha y hora exacta en que se genera y expide el documento.',
      reference: 'Art. 617 lit. c) E.T. / Anexo 1.9 §8.1.3',
      severity: 'error',
      passed: isSectionTypeEnabled('doc_info') || isFieldEnabled('order.created_at') || isFieldEnabled('document.date') || isFieldEnabled('f_date'),
      fixAction: { label: 'Activar fecha de expedición', sectionId: 'sec_doc_info' },
    });

    rules.push({
      id: 'doc_payment',
      category: 'documento',
      name: 'Forma y Medio de Pago',
      description: 'Indicación de si es pago de contado o crédito, junto con el medio de pago utilizado.',
      reference: 'Anexo Técnico 1.9 DIAN §8.1.4',
      severity: 'warning',
      passed: isSectionTypeEnabled('payment_methods') || isFieldEnabled('order.payment_method') || isFieldEnabled('document.payment_method') || isSectionTypeEnabled('doc_info'),
      fixAction: { label: 'Activar sección de medios de pago', sectionId: 'sec_payments' },
    });

    // ─────────────────────────────────────────────────────────
    // 3. Adquirente / Cliente — Art. 617 lit c
    // ─────────────────────────────────────────────────────────
    if (isFiscal) {
      rules.push({
        id: 'customer_info',
        category: 'adquirente',
        name: 'Identificación del Adquirente',
        description: 'Nombre o razón social y NIT/Cédula del comprador (o Consumidor Final).',
        reference: 'Art. 617 lit. c) E.T. / Anexo 1.9 §8.1.2',
        severity: isElectronicInvoice ? 'error' : 'warning',
        passed: isSectionTypeEnabled('customer_info') || isSectionTypeEnabled('fiscal_buyer_info') || isFieldEnabled('customer.name'),
        fixAction: { label: 'Activar datos del cliente', sectionId: 'sec_customer' },
      });
    }

    // ─────────────────────────────────────────────────────────
    // 4. Detalle de Bienes / Servicios — Art. 617 lit f, g
    // ─────────────────────────────────────────────────────────
    rules.push({
      id: 'line_description',
      category: 'lineas',
      name: 'Descripción de Artículos o Servicios',
      description: 'Descripción específica de los bienes vendidos o servicios prestados.',
      reference: 'Art. 617 lit. f) E.T. / Anexo 1.9 §8.1.5',
      severity: 'error',
      passed: isColumnEnabled('product_name') || isColumnEnabled('description') || isColumnEnabled('col_desc') || columns.length > 0,
      fixAction: { label: 'Activar columna descripción', columnKey: 'col_desc' },
    });

    rules.push({
      id: 'line_quantity',
      category: 'lineas',
      name: 'Cantidad de Bienes / Servicios',
      description: 'Cantidad de unidades despachadas de cada artículo o servicio.',
      reference: 'Art. 617 lit. f) E.T. / Anexo 1.9 §8.1.5',
      severity: 'error',
      passed: isColumnEnabled('quantity') || isColumnEnabled('col_qty') || columns.length > 0,
      fixAction: { label: 'Activar columna cantidad', columnKey: 'col_qty' },
    });

    rules.push({
      id: 'line_unit_price',
      category: 'lineas',
      name: 'Precio Unitario',
      description: 'Valor comercial unitario antes de tributos de cada ítem.',
      reference: 'Art. 617 lit. g) E.T. / Anexo 1.9 §8.1.5',
      severity: 'warning',
      passed: isColumnEnabled('unit_price') || isColumnEnabled('col_price') || columns.length > 0,
      fixAction: { label: 'Activar columna precio unitario', columnKey: 'col_price' },
    });

    rules.push({
      id: 'line_total',
      category: 'lineas',
      name: 'Valor Total por Línea',
      description: 'Importe total liquidado para cada artículo de la tabla.',
      reference: 'Anexo Técnico 1.9 DIAN §8.1.5',
      severity: 'error',
      passed: isColumnEnabled('total_price') || isColumnEnabled('col_total') || columns.length > 0,
      fixAction: { label: 'Activar columna total línea', columnKey: 'col_total' },
    });

    // ─────────────────────────────────────────────────────────
    // 5. Impuestos y Totales — Art. 617 lit e, g
    // ─────────────────────────────────────────────────────────
    rules.push({
      id: 'totals_taxes_breakdown',
      category: 'impuestos',
      name: 'Discriminación del IVA e Impuestos',
      description: 'Desglose de bases gravables y valor liquidado de impuestos (IVA, INC, etc.).',
      reference: 'Art. 617 lit. e) E.T. / Anexo 1.9 §8.1.5 (FAU04, FAU06)',
      severity: isFiscal ? 'error' : 'warning',
      passed: isSectionTypeEnabled('taxes_breakdown') || isSectionTypeEnabled('fiscal_tax_breakdown') || isSectionTypeEnabled('totals'),
      fixAction: { label: 'Activar desglose de impuestos', sectionId: 'sec_taxes' },
    });

    rules.push({
      id: 'totals_grand_total',
      category: 'impuestos',
      name: 'Valor Total a Pagar',
      description: 'Importe final liquidado a pagar por la operación en moneda legal.',
      reference: 'Art. 617 lit. g) E.T. / Anexo 1.9 §8.1.5 (FAU14)',
      severity: 'error',
      passed: isSectionTypeEnabled('totals') || isFieldEnabled('order.grand_total') || isFieldEnabled('order.total'),
      fixAction: { label: 'Activar total del documento', sectionId: 'sec_totals' },
    });

    // ─────────────────────────────────────────────────────────
    // 6. Requisitos Fiscales DIAN (CUFE, QR, Resolución)
    // ─────────────────────────────────────────────────────────
    if (isElectronicInvoice) {
      rules.push({
        id: 'dian_cufe',
        category: 'fiscal_dian',
        name: 'Código Único de Factura Electrónica (CUFE / CUDE)',
        description: 'Huella criptográfica SHA-384 calculada conforme al Anexo Técnico 1.9 §11.2.',
        reference: 'Resolución DIAN 000165 / Anexo 1.9 §11.2',
        severity: 'error',
        passed: isSectionTypeEnabled('fiscal_cufe_box') || isSectionTypeEnabled('cufe_box') || isFieldEnabled('fiscal.cufe'),
        fixAction: { label: 'Activar caja de CUFE', sectionId: 'sec_cufe' },
      });

      rules.push({
        id: 'dian_qr',
        category: 'fiscal_dian',
        name: 'Código Bidimensional QR',
        description: 'Código QR de validación con URL de consulta oficial en servidores DIAN.',
        reference: 'Resolución DIAN 000165 / Anexo 1.9 §11.3',
        severity: 'error',
        passed: isSectionTypeEnabled('fiscal_qr_section') || isSectionTypeEnabled('qr_code') || isFieldEnabled('fiscal.qr_code_content'),
        fixAction: { label: 'Activar código QR DIAN', sectionId: 'sec_qr' },
      });

      rules.push({
        id: 'dian_resolution',
        category: 'fiscal_dian',
        name: 'Resolución de Autorización DIAN',
        description: 'Texto legal con número de resolución, prefijo, rango de numeración y vigencia.',
        reference: 'Resolución DIAN 000165 / Anexo 1.9 §8.1.3',
        severity: 'error',
        passed: isSectionTypeEnabled('fiscal_resolution_box') || isSectionTypeEnabled('resolution') || isFieldEnabled('fiscal.resolution_number') || isSectionTypeEnabled('footer'),
        fixAction: { label: 'Activar caja de Resolución', sectionId: 'sec_resolution' },
      });

      rules.push({
        id: 'dian_software',
        category: 'fiscal_dian',
        name: 'Pie de Imprenta / Software Autorizado',
        description: 'Identificación del software de facturación y proveedor tecnológico.',
        reference: 'Anexo Técnico 1.9 DIAN §8.1.8',
        severity: 'info',
        passed: isSectionTypeEnabled('footer') || isFieldEnabled('system.software_provider'),
        fixAction: { label: 'Activar pie de página', sectionId: 'sec_footer' },
      });
    }

    const totalRules = rules.length;
    const passedCount = rules.filter((r) => r.passed).length;
    const errorCount = rules.filter((r) => !r.passed && r.severity === 'error').length;
    const warningCount = rules.filter((r) => !r.passed && r.severity === 'warning').length;
    const score = Math.round((passedCount / Math.max(1, totalRules)) * 100);
    const isCompliant = errorCount === 0;

    return {
      score,
      totalRules,
      passedCount,
      errorCount,
      warningCount,
      isCompliant,
      rules,
    };
  }
}
