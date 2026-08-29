import { Injectable } from '@nestjs/common';
import { print_format_type_enum } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { IDocumentDataProvider } from '../interfaces/document-data-provider.interface';
import { RecentDocumentSummary } from '../interfaces/document-index.interface';
import { StandardPrintDataModel } from '../interfaces/standard-print-data.model';
import { PrintTokenDefinition } from '../interfaces/print-format.interface';

/**
 * [print-editor-dsk P8] — Certificado de retención SUFRIDA
 * (`withholding_suffered`).
 *
 * Una retención sufrida es la que un tercero NOS RETUVO a nosotros: el
 * comprobante lo emite el tercero (proveedor) y la empresa lo archiva
 * para acreditar el saldo a favor en su declaración.
 *
 * Origen de los datos: `withholding_calculations` con `role='suffered'`
 * (mismo modelo que practicada, cambia el rol). El documento legal
 * emitido por el tercero vive en sus sistemas — nuestro lector reconstruye
 * el comprobante desde el cálculo persistido, lo que es suficiente para
 * fines de auditoría interna.
 *
 * Cast explícito en `formatType` por la misma razón que
 * `WithholdingPracticedDataProvider`.
 */
@Injectable()
export class WithholdingSufferedDataProvider implements IDocumentDataProvider {
  readonly formatType: print_format_type_enum =
    'withholding_suffered' as unknown as print_format_type_enum;

  constructor(private readonly prisma: StorePrismaService) {}

  async fetchDocumentData(
    storeId: number,
    documentId: number | string,
  ): Promise<StandardPrintDataModel> {
    const id = Number(documentId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new VendixHttpException(
        ErrorCodes.PRINT_DOCUMENT_NOT_FOUND_001,
        `Invalid withholding calculation id: ${documentId}`,
      );
    }

    const calculation = await this.prisma.withholding_calculations.findFirst({
      where: { id, store_id: storeId, role: 'suffered' },
      include: {
        concept: { select: { code: true, name: true, rate: true, withholding_type: true } },
        supplier: { select: { name: true, tax_id: true, verification_digit: true } },
        customer: { select: { first_name: true, last_name: true, document_number: true } },
        invoice: { select: { invoice_number: true, issue_date: true } },
      },
    });

    if (!calculation) {
      throw new VendixHttpException(
        ErrorCodes.PRINT_DOCUMENT_NOT_FOUND_001,
        `Withholding calculation ${id} (suffered) not found in store ${storeId}`,
      );
    }

    const counterparty =
      calculation.supplier?.name ||
      `${calculation.customer?.first_name || ''} ${calculation.customer?.last_name || ''}`.trim() ||
      'Tercero';
    const counterpartyTaxId =
      calculation.supplier?.tax_id || calculation.customer?.document_number || '';

    return {
      store: { name: '', tax_id: '' },
      document: {
        id: calculation.id,
        number: `WH-SUFR-${calculation.id}`,
        date: calculation.created_at
          ? new Date(calculation.created_at).toISOString()
          : new Date().toISOString(),
        date_formatted: new Date(calculation.created_at || new Date()).toLocaleDateString('es-CO'),
        state: 'received',
        state_label: 'Recibido del tercero',
        notes: `Periodo gravable: ${calculation.year}`,
      },
      customer: {
        name: counterparty,
        tax_id: counterpartyTaxId,
      },
      items: [],
      taxes: [
        {
          name: calculation.concept?.name || 'Retención',
          rate: Number(calculation.withholding_rate || calculation.concept?.rate || 0),
          base_amount: Number(calculation.base_amount || 0),
          tax_amount: Number(calculation.withholding_amount || 0),
          base_formatted: `$${Number(calculation.base_amount || 0).toLocaleString('es-CO')}`,
          tax_formatted: `$${Number(calculation.withholding_amount || 0).toLocaleString('es-CO')}`,
        },
      ],
      totals: {
        subtotal: Number(calculation.base_amount || 0),
        subtotal_formatted: `$${Number(calculation.base_amount || 0).toLocaleString('es-CO')}`,
        discount_total: 0,
        discount_total_formatted: '$0',
        shipping_total: 0,
        shipping_total_formatted: '$0',
        tax_total: Number(calculation.withholding_amount || 0),
        tax_total_formatted: `$${Number(calculation.withholding_amount || 0).toLocaleString('es-CO')}`,
        grand_total: Number(calculation.withholding_amount || 0),
        grand_total_formatted: `$${Number(calculation.withholding_amount || 0).toLocaleString('es-CO')}`,
      },
      custom_variables: {
        role: 'suffered',
        concept_code: calculation.concept?.code || '',
        concept_name: calculation.concept?.name || '',
        withholding_type: calculation.concept?.withholding_type || calculation.withholding_type || '',
        uvt_value_used: Number(calculation.uvt_value_used || 0),
        related_invoice_number: calculation.invoice?.invoice_number
          ? String(calculation.invoice.invoice_number)
          : '',
        related_invoice_date: calculation.invoice?.issue_date
          ? new Date(calculation.invoice.issue_date).toISOString()
          : '',
        year: calculation.year,
        counterparty_tax_id: counterpartyTaxId,
      },
    };
  }

  async getSampleData(_storeId?: number): Promise<StandardPrintDataModel> {
    return {
      store: { name: 'Vendix S.A.S.', tax_id: '900.123.456-7' },
      document: {
        id: 0,
        number: 'WH-SUFR-2026-0001',
        date: new Date().toISOString(),
        date_formatted: new Date().toLocaleDateString('es-CO'),
        state: 'received',
        state_label: 'Recibido del tercero',
      },
      customer: {
        name: 'Tercero Demo S.A.S.',
        tax_id: '800.999.888-1',
      },
      items: [],
      taxes: [
        {
          name: 'Retención en la fuente',
          rate: 2.5,
          base_amount: 2000000,
          tax_amount: 50000,
          base_formatted: '$2.000.000',
          tax_formatted: '$50.000',
        },
      ],
      totals: {
        subtotal: 2000000,
        subtotal_formatted: '$2.000.000',
        discount_total: 0,
        discount_total_formatted: '$0',
        shipping_total: 0,
        shipping_total_formatted: '$0',
        tax_total: 50000,
        tax_total_formatted: '$50.000',
        grand_total: 50000,
        grand_total_formatted: '$50.000',
      },
      custom_variables: {
        role: 'suffered',
        concept_code: 'RETEFTE',
        concept_name: 'Retención en la fuente',
        withholding_type: 'retefuente',
        uvt_value_used: 47065,
        year: 2026,
      },
    };
  }

  getAvailableTokens(): PrintTokenDefinition[] {
    return [
      { token: '{{ document.number }}', path: 'document.number', description: 'Número del certificado recibido', example: 'WH-SUFR-0001' },
      { token: '{{ customer.name }}', path: 'customer.name', description: 'Tercero que retuvo', example: 'Tercero Demo' },
      { token: '{{ customer.tax_id }}', path: 'customer.tax_id', description: 'NIT del tercero', example: '800.999.888-1' },
      { token: '{{ concept_code }}', path: 'custom_variables.concept_code', description: 'Código del concepto', example: 'RETEFTE' },
      { token: '{{ totals.grand_total }}', path: 'totals.grand_total_formatted', description: 'Valor sufrido', example: '$50.000' },
    ];
  }

  async listRecent(
    storeId: number,
    limit: number,
  ): Promise<RecentDocumentSummary[]> {
    const rows = await this.prisma.withholding_calculations.findMany({
      where: { store_id: storeId, role: 'suffered' },
      orderBy: { created_at: 'desc' },
      take: limit,
      select: {
        id: true,
        created_at: true,
        withholding_amount: true,
      },
    });
    const fmt = new Intl.DateTimeFormat('es-CO', {
      dateStyle: 'short',
      timeStyle: 'short',
    });
    const cop = new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    });
    return rows.map((r) => ({
      id: r.id,
      number: `WH-SUFR-${r.id}`,
      date_formatted: r.created_at ? fmt.format(new Date(r.created_at)) : '',
      total_formatted: cop.format(Number(r.withholding_amount || 0)),
    }));
  }
}