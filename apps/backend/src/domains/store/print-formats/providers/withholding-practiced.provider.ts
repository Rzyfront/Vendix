import { Injectable } from '@nestjs/common';
import { print_format_type_enum } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { IDocumentDataProvider } from '../interfaces/document-data-provider.interface';
import { RecentDocumentSummary } from '../interfaces/document-index.interface';
import { StandardPrintDataModel } from '../interfaces/standard-print-data.model';
import { PrintTokenDefinition } from '../interfaces/print-format.interface';
import { mapUserAddress } from '../lib/customer-address';

/**
 * [print-editor-dsk P8] — Certificado de retención PRACTICADA
 * (`withholding_practiced`).
 *
 * Una retención practicada es la que la empresa RETUVO a un tercero
 * (proveedor o cliente): el comprobante lo emite la propia empresa hacia
 * el tercero para que éste lo acredite en su declaración.
 *
 * Origen de los datos: `withholding_calculations` con `role='practiced'`
 * (esquema: `withholding_calculations`). El modelo `withholding_certificates`
 * —que tendría el documento legal con sello, numeración consecutiva y
 * resolución DIAN— NO EXISTE en el esquema actual; el comprobante real se
 * compone agregando conceptos por periodo desde `withholding_calculations`.
 *
 * Mientras no exista un modelo `withholding_certificates` con numeración
 * propia, el lector rechaza cualquier id que no corresponda a un cálculo
 * existente y deja explícito que el documento legal debe generarse a
 * partir del agregado de cálculos — eso es knowledge gap documentado en
 * el plan.
 *
 * Cast explícito en `formatType` por la misma razón que en
 * `DispatchTicketDataProvider` y `DispatchRouteDataProvider`.
 */
@Injectable()
export class WithholdingPracticedDataProvider implements IDocumentDataProvider {
  readonly formatType: print_format_type_enum =
    'withholding_practiced' as unknown as print_format_type_enum;

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
      where: { id, store_id: storeId, role: 'practiced' },
      include: {
        concept: { select: { code: true, name: true, rate: true, withholding_type: true } },
        supplier: { select: { name: true, tax_id: true, verification_digit: true } },
        // CP-print-token-flow A.3 — dirección solo si la contraparte es el cliente.
        customer: { select: { first_name: true, last_name: true, document_number: true, addresses: { take: 1, select: { address_line1: true, address_line2: true, city: true, state_province: true, country: true } } } },
        invoice: { select: { invoice_number: true, issue_date: true } },
      },
    });

    if (!calculation) {
      throw new VendixHttpException(
        ErrorCodes.PRINT_DOCUMENT_NOT_FOUND_001,
        `Withholding calculation ${id} (practiced) not found in store ${storeId}`,
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
        number: `WH-PRAC-${calculation.id}`,
        date: calculation.created_at
          ? new Date(calculation.created_at).toISOString()
          : new Date().toISOString(),
        date_formatted: new Date(calculation.created_at || new Date()).toLocaleDateString('es-CO'),
        state: 'issued',
        state_label: 'Emitido',
        notes: `Periodo gravable: ${calculation.year}`,
      },
      customer: {
        name: counterparty,
        tax_id: counterpartyTaxId,
        // Solo del cliente: si la contraparte es el proveedor, `suppliers`
        // no tiene columna de dirección y no se inventa nada.
        ...(!calculation.supplier?.name ? mapUserAddress(calculation.customer?.addresses?.[0]) : {}),
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
        role: 'practiced',
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
        number: 'WH-PRAC-2026-0001',
        date: new Date().toISOString(),
        date_formatted: new Date().toLocaleDateString('es-CO'),
        state: 'issued',
        state_label: 'Emitido',
      },
      customer: {
        name: 'Proveedor Demo S.A.S.',
        tax_id: '800.555.444-9',
        // CP-print-token-flow A.3 — paridad muestra/real (ADR-2).
        address: 'Calle 100 # 15-20, Bogotá D.C.',
        city: 'Bogotá D.C.',
      },
      items: [],
      taxes: [
        {
          name: 'Retención en la fuente',
          rate: 2.5,
          base_amount: 1000000,
          tax_amount: 25000,
          base_formatted: '$1.000.000',
          tax_formatted: '$25.000',
        },
      ],
      totals: {
        subtotal: 1000000,
        subtotal_formatted: '$1.000.000',
        discount_total: 0,
        discount_total_formatted: '$0',
        shipping_total: 0,
        shipping_total_formatted: '$0',
        tax_total: 25000,
        tax_total_formatted: '$25.000',
        grand_total: 25000,
        grand_total_formatted: '$25.000',
      },
      custom_variables: {
        role: 'practiced',
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
      { token: '{{ document.number }}', path: 'document.number', description: 'Número del certificado', example: 'WH-PRAC-0001' },
      { token: '{{ customer.name }}', path: 'customer.name', description: 'Tercero retenido', example: 'Proveedor Demo' },
      { token: '{{ customer.address }}', path: 'customer.address', description: 'Dirección del tercero (solo si es cliente)', example: 'Calle 100 # 15-20, Bogotá D.C.' },
      { token: '{{ customer.tax_id }}', path: 'customer.tax_id', description: 'NIT del tercero', example: '800.555.444-9' },
      { token: '{{ concept_code }}', path: 'custom_variables.concept_code', description: 'Código del concepto', example: 'RETEFTE' },
      { token: '{{ totals.grand_total }}', path: 'totals.grand_total_formatted', description: 'Valor retenido', example: '$25.000' },
    ];
  }

  async listRecent(
    storeId: number,
    limit: number,
  ): Promise<RecentDocumentSummary[]> {
    const rows = await this.prisma.withholding_calculations.findMany({
      where: { store_id: storeId, role: 'practiced' },
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
      number: `WH-PRAC-${r.id}`,
      date_formatted: r.created_at ? fmt.format(new Date(r.created_at)) : '',
      total_formatted: cop.format(Number(r.withholding_amount || 0)),
    }));
  }
}