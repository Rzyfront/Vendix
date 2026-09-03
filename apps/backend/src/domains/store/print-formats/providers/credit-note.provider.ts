import { Injectable, Logger } from '@nestjs/common';
import { print_format_type_enum } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { S3Service } from '../../../../common/services/s3.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { IDocumentDataProvider } from '../interfaces/document-data-provider.interface';
import { RecentDocumentSummary } from '../interfaces/document-index.interface';
import { StandardPrintDataModel } from '../interfaces/standard-print-data.model';
import { PrintTokenDefinition } from '../interfaces/print-format.interface';
import {
  FISCAL_DOCUMENT_PRINT_INCLUDE,
  mapFiscalDocumentToPrintData,
  resolveRawLogoKey,
} from './fiscal-document-print.mapper';
import { signStoreLogoUrl } from '../lib/print-logo.util';

@Injectable()
export class CreditNoteDataProvider implements IDocumentDataProvider {
  readonly formatType: print_format_type_enum = 'credit_note';
  private readonly logger = new Logger(CreditNoteDataProvider.name);

  // `s3Service` opcional: `real-print-path.spec.ts` instancia con 1 solo
  // argumento; Nest inyecta el segundo en runtime (`S3Module` ya importado
  // por `print-formats.module.ts`).
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly s3Service?: S3Service,
  ) {}

  /**
   * Lee la nota de crédito REAL, por la misma proyección que el formato fiscal.
   *
   * Antes del 2026-08-24 devolvía la muestra e ignoraba el `documentId`, igual
   * que su gemelo fiscal. Este formato no es fiscal, así que el daño era
   * operativo y no legal —una nota de crédito que enumera ítems que no son los
   * de la nota—, pero es el mismo defecto y el arreglo es el mismo: la nota vive
   * en `invoices` con `invoice_type` = `credit_note`.
   *
   * Comparte el mapeador con el formato fiscal a propósito. Los tokens fiscales
   * que el mapeador rellena (CUFE, resolución) simplemente no aparecen en la
   * plantilla no fiscal; tener dos proyecciones de la misma tabla sería la
   * duplicación que este cambio vino a quitar.
   */
  async fetchDocumentData(
    storeId: number,
    documentId: number | string,
  ): Promise<StandardPrintDataModel> {
    const id = Number(documentId);
    if (!Number.isFinite(id)) {
      throw new VendixHttpException(ErrorCodes.PRINT_DOCUMENT_NOT_FOUND_001);
    }

    const note = await this.prisma.invoices.findFirst({
      where: { id, store_id: storeId, invoice_type: 'credit_note' },
      include: FISCAL_DOCUMENT_PRINT_INCLUDE,
    });

    if (!note) {
      throw new VendixHttpException(ErrorCodes.PRINT_DOCUMENT_NOT_FOUND_001);
    }

    let referenceDocumentNumber: string | undefined;
    if (note.related_invoice_id) {
      const related = await this.prisma.invoices.findFirst({
        where: { id: note.related_invoice_id, store_id: storeId },
        select: { invoice_number: true },
      });
      referenceDocumentNumber = related?.invoice_number
        ? String(related.invoice_number)
        : undefined;
    }

    const signedLogoUrl = await signStoreLogoUrl(this.s3Service, resolveRawLogoKey(note), this.logger);

    return mapFiscalDocumentToPrintData(note, {
      acceptedLabel: 'Nota crédito aplicada',
      pendingLabel: 'Nota crédito en borrador',
      referenceDocumentNumber,
      signedLogoUrl,
    });
  }

  async getSampleData(storeId?: number): Promise<StandardPrintDataModel> {
    return {
      store: {
        name: 'Vendix Retail Store',
        legal_name: 'Vendix Retail S.A.S.',
        tax_id: '900.555.444-3',
        phone: '+57 301 222 3344',
        email: 'atencionalcliente@vendix.com',
        address: 'Centro Comercial Unicentro, Local 215',
        city: 'Medellín',
      },
      customer: {
        name: 'María Fernanda Restrepo',
        tax_id: '43.999.888',
        phone: '+57 314 777 8899',
        email: 'mafe.restrepo@gmail.com',
      },
      document: {
        id: 901,
        number: 'NC-2026-0034',
        date: new Date().toISOString(),
        date_formatted: new Date().toLocaleDateString('es-CO'),
        state: 'applied',
        state_label: 'Aplicada',
        reference_document_number: 'ORD-2026-0089',
        notes: 'Devolución de producto por cambio de talla solicitado por el cliente.',
      },
      items: [
        {
          index: 1,
          product_name: 'Zapatos Deportivos Running Pro (Devolución)',
          variant_sku: 'ZAP-RUN-NEG-38',
          quantity: 1,
          unit_price: 240000,
          unit_price_formatted: '$240.000',
          total_price: 240000,
          total_price_formatted: '$240.000',
        },
      ],
      taxes: [],
      totals: {
        subtotal: 240000,
        subtotal_formatted: '$240.000',
        discount_total: 0,
        discount_total_formatted: '$0',
        shipping_total: 0,
        shipping_total_formatted: '$0',
        tax_total: 0,
        tax_total_formatted: '$0',
        grand_total: 240000,
        grand_total_formatted: '$240.000',
      },
    };
  }

  getAvailableTokens(): PrintTokenDefinition[] {
    return [
      { token: '{{document.number}}', path: 'document.number', description: 'Número de la nota crédito', example: 'NC-0012' },
      { token: '{{document.reference_document_number}}', path: 'document.reference_document_number', description: 'Factura u orden referenciada', example: 'ORD-1002' },
      { token: '{{customer.name}}', path: 'customer.name', description: 'Nombre del cliente', example: 'María Restrepo' },
      { token: '{{totals.grand_total}}', path: 'totals.grand_total_formatted', description: 'Monto total acreditado', example: '$240.000' },
    ];
  }

  /**
   * [print-editor-dsk P3.1] — Notas crédito no fiscales: viven en
   * `invoices` con `invoice_type='credit_note'`. Sin el filtro, el
   * picker del Hub mezclaría facturas y notas y el preview pintaría la
   * cabecera equivocada.
   */
  async listRecent(
    storeId: number,
    limit: number,
  ): Promise<RecentDocumentSummary[]> {
    const rows = await this.prisma.invoices.findMany({
      where: { store_id: storeId, invoice_type: 'credit_note' },
      orderBy: { created_at: 'desc' },
      take: limit,
      select: {
        id: true,
        invoice_number: true,
        created_at: true,
        total_amount: true,
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
      number: String(r.invoice_number),
      date_formatted: r.created_at ? fmt.format(new Date(r.created_at)) : '',
      total_formatted: cop.format(Number(r.total_amount || 0)),
    }));
  }
}
