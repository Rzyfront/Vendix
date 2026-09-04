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
 * [print-editor-dsk P8] — Certificado laboral de retención al empleado
 * (`withholding_employee_certificate`).
 *
 * Es el comprobante que se entrega al empleado al cierre del periodo
 * gravable (típicamente anual) para que lo presente en su declaración de
 * renta. La fuente operativa es la misma tabla `withholding_calculations`
 * con un `concept` cuyo `withholding_type` apunta al procedimiento laboral
 * (retefuente sobre renta de trabajo).
 *
 * No existe aún un modelo dedicado (`employee_withholding_certificates` o
 * similar) con numeración consecutiva y resolución propia — el certificado
 * se reconstruye desde el agregado de cálculos del año. Cuando exista,
 * este provider se conecta a esa tabla y mantiene el mismo contrato
 * `fetchDocumentData / listRecent / getAvailableTokens`.
 *
 * Cast explícito en `formatType` por la misma razón que
 * `WithholdingPracticedDataProvider`.
 */
@Injectable()
export class WithholdingEmployeeCertificateDataProvider implements IDocumentDataProvider {
  readonly formatType: print_format_type_enum =
    'withholding_employee_certificate' as unknown as print_format_type_enum;

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

    // Filtro operativo: cálculo practicado a un empleado. En el modelo actual
    // el "cliente" del cálculo es la persona a la que se le retuvo — cuando
    // se introduzca el modelo dedicado se reemplaza esta consulta sin
    // cambiar la interfaz pública.
    const calculation = await this.prisma.withholding_calculations.findFirst({
      where: {
        id,
        store_id: storeId,
        role: 'practiced',
        // Sólo retenciones laborales — practicadas a clientes naturales.
        counterparty_type: 'employee',
      },
      include: {
        concept: { select: { code: true, name: true, rate: true, withholding_type: true } },
        customer: {
          select: {
            first_name: true,
            last_name: true,
            document_number: true,
            email: true,
            // CP-print-token-flow A.3 — dirección del empleado.
            addresses: { take: 1, select: { address_line1: true, address_line2: true, city: true, state_province: true, country: true } },
          },
        },
        invoice: { select: { invoice_number: true, issue_date: true } },
      },
    });

    if (!calculation) {
      throw new VendixHttpException(
        ErrorCodes.PRINT_DOCUMENT_NOT_FOUND_001,
        `Employee withholding calculation ${id} not found in store ${storeId}`,
      );
    }

    const employee = calculation.customer || {};
    const employeeName =
      `${employee.first_name || ''} ${employee.last_name || ''}`.trim() || 'Empleado';

    return {
      store: { name: '', tax_id: '' },
      document: {
        id: calculation.id,
        number: `WH-EMP-${calculation.year}-${calculation.id}`,
        date: calculation.created_at
          ? new Date(calculation.created_at).toISOString()
          : new Date().toISOString(),
        date_formatted: new Date(calculation.created_at || new Date()).toLocaleDateString('es-CO'),
        state: 'issued',
        state_label: 'Emitido al empleado',
        notes: `Periodo gravable: ${calculation.year}`,
      },
      customer: {
        name: employeeName,
        tax_id: employee.document_number || '',
        email: employee.email,
        ...mapUserAddress(employee.addresses?.[0]),
      },
      items: [],
      taxes: [
        {
          name: calculation.concept?.name || 'Retención en la fuente',
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
        counterparty: 'employee',
        concept_code: calculation.concept?.code || '',
        concept_name: calculation.concept?.name || '',
        withholding_type: calculation.concept?.withholding_type || calculation.withholding_type || '',
        uvt_value_used: Number(calculation.uvt_value_used || 0),
        year: calculation.year,
      },
    };
  }

  async getSampleData(_storeId?: number): Promise<StandardPrintDataModel> {
    return {
      store: { name: 'Vendix S.A.S.', tax_id: '900.123.456-7' },
      document: {
        id: 0,
        number: 'WH-EMP-2026-0001',
        date: new Date().toISOString(),
        date_formatted: new Date().toLocaleDateString('es-CO'),
        state: 'issued',
        state_label: 'Emitido al empleado',
      },
      customer: {
        name: 'Empleado Demo',
        tax_id: '79.123.456',
        email: 'empleado@demo.co',
        // CP-print-token-flow A.3 — paridad muestra/real (ADR-2).
        address: 'Calle 80 # 10-20, Bogotá D.C.',
        city: 'Bogotá D.C.',
      },
      items: [],
      taxes: [
        {
          name: 'Retención en la fuente sobre ingresos laborales',
          rate: 10,
          base_amount: 36000000,
          tax_amount: 1500000,
          base_formatted: '$36.000.000',
          tax_formatted: '$1.500.000',
        },
      ],
      totals: {
        subtotal: 36000000,
        subtotal_formatted: '$36.000.000',
        discount_total: 0,
        discount_total_formatted: '$0',
        shipping_total: 0,
        shipping_total_formatted: '$0',
        tax_total: 1500000,
        tax_total_formatted: '$1.500.000',
        grand_total: 1500000,
        grand_total_formatted: '$1.500.000',
      },
      custom_variables: {
        role: 'practiced',
        counterparty: 'employee',
        concept_code: 'RETEFTE-LAB',
        concept_name: 'Retención en la fuente sobre ingresos laborales',
        withholding_type: 'retefuente',
        uvt_value_used: 47065,
        year: 2026,
      },
    };
  }

  getAvailableTokens(): PrintTokenDefinition[] {
    return [
      { token: '{{ document.number }}', path: 'document.number', description: 'Número del certificado laboral', example: 'WH-EMP-2026-0001' },
      { token: '{{ customer.name }}', path: 'customer.name', description: 'Nombre del empleado', example: 'Juan Pérez' },
      { token: '{{ customer.address }}', path: 'customer.address', description: 'Dirección del empleado', example: 'Calle 80 # 10-20, Bogotá D.C.' },
      { token: '{{ customer.tax_id }}', path: 'customer.tax_id', description: 'Cédula del empleado', example: '79.123.456' },
      { token: '{{ totals.grand_total }}', path: 'totals.grand_total_formatted', description: 'Total retenido al empleado', example: '$1.500.000' },
      { token: '{{ year }}', path: 'custom_variables.year', description: 'Periodo gravable', example: '2026' },
    ];
  }

  async listRecent(
    storeId: number,
    limit: number,
  ): Promise<RecentDocumentSummary[]> {
    const rows = await this.prisma.withholding_calculations.findMany({
      where: {
        store_id: storeId,
        role: 'practiced',
        counterparty_type: 'employee',
      },
      orderBy: { created_at: 'desc' },
      take: limit,
      select: {
        id: true,
        created_at: true,
        withholding_amount: true,
        year: true,
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
      number: `WH-EMP-${r.year}-${r.id}`,
      date_formatted: r.created_at ? fmt.format(new Date(r.created_at)) : '',
      total_formatted: cop.format(Number(r.withholding_amount || 0)),
    }));
  }
}