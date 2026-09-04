import { Injectable, Logger } from '@nestjs/common';
import { print_format_type_enum } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { QrService } from '../../../../common/services/qr.service';
import { S3Service } from '../../../../common/services/s3.service';
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

/**
 * Tipos de `invoices.invoice_type` que ESTE formato puede imprimir.
 *
 * La compuerta no es defensiva por costumbre: sin ella, pasar el id de una
 * factura de venta imprimiría la factura con el encabezado y las etiquetas de
 * una nota de crédito, y quien la reciba tendría en la mano un documento que
 * dice ser algo que no es. `credit-notes.service.ts:250` escribe las notas en la
 * misma tabla `invoices` con `invoice_type` = `credit_note`, así que el id de
 * una factura y el de una nota viven en el mismo espacio de numeración interna y
 * confundirlos es un error de un dígito.
 */
const CREDIT_NOTE_TYPES = ['credit_note'] as const;

@Injectable()
export class FiscalCreditNoteDataProvider implements IDocumentDataProvider {
  readonly formatType: print_format_type_enum = 'fiscal_credit_note';
  private readonly logger = new Logger(FiscalCreditNoteDataProvider.name);

  // `s3Service` opcional: `real-print-path.spec.ts` y `document-number-format.spec.ts`
  // instancian este provider con 2 argumentos; Nest inyecta el tercero en
  // runtime (`print-formats.module.ts` importa `S3Module`).
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly qrService: QrService,
    private readonly s3Service?: S3Service,
  ) {}

  /**
   * Lee la nota de crédito REAL.
   *
   * Antes del 2026-08-24 esto era `return this.getSampleData(storeId)`, y el
   * `documentId` se ignoraba. Como `print-gateway.service.ts:174` lo alcanza por
   * el carril de impresión real (no por la previsualización), imprimir una nota
   * de crédito entregaba al cliente un documento fiscal con el adquiriente, el
   * NIT, el CUFE y la resolución de la muestra —datos de un tercero
   * inexistente— con formato impecable. Un documento falso con apariencia de
   * legítimo es peor que un formato que no existe.
   *
   * Que falle es seguro para la previsualización: `print-gateway.service.ts:280`
   * envuelve `fetchDocumentData` en un `try/catch` y cae a `getSampleData`, que
   * es para lo que la muestra existe.
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
      where: {
        id,
        store_id: storeId,
        invoice_type: { in: [...CREDIT_NOTE_TYPES] },
      },
      include: FISCAL_DOCUMENT_PRINT_INCLUDE,
    });

    if (!note) {
      throw new VendixHttpException(ErrorCodes.PRINT_DOCUMENT_NOT_FOUND_001);
    }

    // La factura corregida se lee aparte y NO se incluye en la consulta
    // anterior: `related_invoice_id` es opcional en el esquema, y un `include`
    // anidado sobre la misma tabla arrastraría otra vez ítems, impuestos y
    // direcciones para usar un solo campo.
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

    let qrBase64: string | undefined;
    if (note.qr_code) {
      try {
        const qrBuffer = await this.qrService.generateBuffer(note.qr_code, 240);
        qrBase64 = qrBuffer.toString('base64');
      } catch (e) {
        // El QR es ilustrativo: su contenido de texto ya va en `qr_code_content`
        // y el documento sigue siendo verificable sin la imagen.
      }
    }

    const signedLogoUrl = await signStoreLogoUrl(this.s3Service, resolveRawLogoKey(note), this.logger);

    return mapFiscalDocumentToPrintData(note, {
      qrBase64,
      acceptedLabel: 'Nota crédito aprobada por DIAN',
      pendingLabel: 'Nota crédito pendiente',
      referenceDocumentNumber,
      signedLogoUrl,
    });
  }

  async getSampleData(storeId?: number): Promise<StandardPrintDataModel> {
    return {
      store: {
        name: 'Vendix Enterprise Solutions',
        legal_name: 'Vendix Facturación Electrónica S.A.S.',
        tax_id: '901.555.333-2',
        phone: '+57 601 310 9900',
        email: 'fe@vendix.com',
        address: 'Calle 93B # 13-40, Oficina 502',
        city: 'Bogotá D.C.',
        tax_regime: 'Responsable de IVA',
      },
      customer: {
        name: 'Compañía Minera y Comercial del Pacífico S.A.',
        tax_id: '800.123.987-6',
        phone: '+57 602 888 1234',
        email: 'facturaelectronica@pacificomin.com',
        // CP-print-token-flow A.2 — paridad muestra/real (ADR-2).
        address: 'Avenida Colombia # 1-50, Cali',
        address_line1: 'Avenida Colombia # 1-50',
        city: 'Cali',
      },
      document: {
        id: 999,
        // Mismo motivo que en fiscal-invoice.provider.ts: con `prefix` poblado
        // la muestra rendia `NC-SETP-#NC-SETP-0012`.
        number: 'NC-SETP-0012',
        date: new Date().toISOString(),
        date_formatted: new Date().toLocaleDateString('es-CO'),
        state: 'accepted',
        state_label: 'Aprobada por DIAN',
        reference_document_number: 'SETP-990001',
        notes: 'Anulación parcial por descuento comercial acordado posterior a la emisión.',
      },
      fiscal: {
        cude: 'c1d2e3f4a5b67890123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0',
      },
      items: [
        {
          index: 1,
          product_name: 'Ajuste de Tarifa Consultoría Arquitectura Cloud',
          quantity: 1,
          unit_price: 500000,
          unit_price_formatted: '$500.000',
          tax_rate: 19,
          tax_amount: 95000,
          total_price: 500000,
          total_price_formatted: '$500.000',
        },
      ],
      taxes: [
        {
          name: 'IVA 19%',
          rate: 19,
          base_amount: 500000,
          tax_amount: 95000,
          base_formatted: '$500.000',
          tax_formatted: '$95.000',
        },
      ],
      totals: {
        subtotal: 500000,
        subtotal_formatted: '$500.000',
        discount_total: 0,
        discount_total_formatted: '$0',
        shipping_total: 0,
        shipping_total_formatted: '$0',
        tax_total: 95000,
        tax_total_formatted: '$95.000',
        grand_total: 595000,
        grand_total_formatted: '$595.000',
      },
    };
  }

  getAvailableTokens(): PrintTokenDefinition[] {
    return [
      { token: '{{fiscal.cude}}', path: 'fiscal.cude', description: 'Código Único de Documento Electrónico (CUDE)', example: 'c1d2e3f4...' },
      { token: '{{document.reference_document_number}}', path: 'document.reference_document_number', description: 'Factura electrónica afectada', example: 'SETP-990001' },
      { token: '{{customer.address}}', path: 'customer.address', description: 'Dirección del adquirente', example: 'Avenida Colombia # 1-50, Cali' },
      { token: '{{totals.grand_total}}', path: 'totals.grand_total_formatted', description: 'Monto total acreditado', example: '$595.000' },
    ];
  }

  /**
   * [print-editor-dsk P3.1] — Nota crédito fiscal: filtra por
   * `invoice_type='credit_note'`. La compuerta ya existe en
   * `fetchDocumentData` y se replica aquí para que el picker no mezcle
   * facturas con notas y el preview renderice las etiquetas correctas.
   */
  async listRecent(
    storeId: number,
    limit: number,
  ): Promise<RecentDocumentSummary[]> {
    const rows = await this.prisma.invoices.findMany({
      where: { store_id: storeId, invoice_type: 'credit_note' },
      orderBy: { issue_date: 'desc' },
      take: limit,
      select: {
        id: true,
        invoice_number: true,
        issue_date: true,
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
      date_formatted: r.issue_date ? fmt.format(new Date(r.issue_date)) : '',
      total_formatted: cop.format(Number(r.total_amount || 0)),
    }));
  }
}
