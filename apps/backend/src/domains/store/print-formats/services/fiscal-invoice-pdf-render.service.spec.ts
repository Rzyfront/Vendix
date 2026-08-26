import {
  FiscalInvoicePdfRenderService,
  buildFiscalInvoicePdfData,
  resolveFiscalInvoicePaperFormat,
} from './fiscal-invoice-pdf-render.service';
import {
  resolveFiscalIssuerForPrint,
} from './fiscal-issuer-identity';
import { PrintLayoutComposerService } from './print-layout-composer.service';
import { PrintTemplateCompilerService } from './print-template-compiler.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { S3Service } from '../../../../common/services/s3.service';
import { QrService } from '../../../../common/services/qr.service';
import { VendixHttpException } from 'src/common/errors';
import { mapFiscalDocumentToPrintData } from '../providers/fiscal-document-print.mapper';
import { amountToSpanishWords } from '@common/utils/amount-in-words.util';
import { PrintFormatDefinition } from '../interfaces/print-format.interface';

/**
 * COMPUERTA DEL PASO E.11 — paridad numérica HTML ↔ PDF para el MISMO fixture.
 *
 * La medición (`docs/plans/CP-INVOICE-MIRROR-E1-medicion-builder.md`) fijó que
 * la unificación sólo es fiel si los datos del PDF salen del ENSAMBLADOR del
 * builder y no del `StandardPrintDataModel`. Este spec alimenta la misma fila
 * de `invoices` por los DOS caminos — mapeador HTML y
 * `buildFiscalInvoicePdfData` → builder pdfkit — y exige que los importes, el
 * CUFE y el valor en letras CUADREN. Si alguien añade un campo a un ensamblador
 * y no al otro, esta prueba es la que suena.
 *
 * El parseo del texto del PDF no hace falta para la garantía exigible: el
 * builder imprime cada cifra desde SU `InvoicePdfData` (`drawTotals`), así que
 * igualar los dos modelos sobre el mismo fixture ES igualar lo impreso. Lo que
 * sí se ejercita binario es el Buffer: no vacío y empezando en `%PDF`.
 */
describe('FiscalInvoicePdfRenderService — paridad numérica HTML↔PDF y pdf_buffer real', () => {
  /** Fila fiscalmente completa: documento electrónico aceptado por la DIAN. */
  const fila = {
    id: 41,
    invoice_number: 'QA107',
    invoice_type: 'invoice',
    issue_date: new Date('2026-08-20T15:00:00.000Z'),
    dian_status: 'accepted',
    currency: 'COP',
    subtotal_amount: 100000,
    discount_amount: 0,
    tax_amount: 19000,
    withholding_amount: 5000,
    total_amount: 119000,
    cufe: 'cufe-real-de-la-fila',
    qr_code: 'NumFac:QA107\nCUFE:cufe-real-de-la-fila',
    customer_name: null,
    customer_tax_id: '1020304050',
    customer_address: { address_line1: 'Calle 10 # 5-20', city: 'Bogotá D.C.' },
    notes: 'Paridad E.11',
    invoice_items: [
      {
        description: 'Servicio de prueba',
        quantity: 1,
        unit_price: 100000,
        discount_amount: 0,
        tax_amount: 19000,
        total_amount: 119000,
      },
    ],
    invoice_taxes: [
      { tax_name: 'IVA', tax_rate: 19, taxable_amount: 100000, tax_amount: 19000 },
    ],
    resolution: {
      resolution_number: '18760000001',
      prefix: 'QA',
      range_from: 1,
      range_to: 1000,
      resolution_date: new Date('2026-01-15'),
      valid_from: new Date('2026-01-15'),
      valid_to: new Date('2027-01-15'),
    },
    store: {
      name: 'Tienda Real',
      logo_url: null,
      addresses: [
        {
          address_line1: 'Calle 1',
          city: 'Bogotá D.C.',
          state_province: 'Cundinamarca',
          municipality_code: '11001',
        },
      ],
      store_settings: {
        settings: {
          receipts: { invoice_format: 'thermal_58' },
          fiscal_data: {
            nit: '901555333',
            legal_name: 'Tienda Real Ltda.',
            municipality_code: '11001',
            department: 'Cundinamarca',
          },
        },
      },
    },
    organization: {
      name: 'Org Real',
      legal_name: 'Org Real S.A.S.',
      tax_id: '900000000-1',
      fiscal_scope: 'STORE',
      addresses: [],
    },
    customer: { first_name: 'Ana', last_name: 'Gómez', email: 'ana@gomez.co' },
  };

  const definition: PrintFormatDefinition = {
    paper: { format: 'letter', width_mm: 216, is_roll: false, margin_mm: 10, copies: 1 },
    sections: [
      { id: 'totals', type: 'totals_summary', title: '', enabled: true, order: 1 },
      { id: 'cufe', type: 'fiscal_cufe_box', title: '', enabled: true, order: 2 },
    ],
  };

  it('los importes del modelo HTML y del InvoicePdfData cuadran sobre la MISMA fila', () => {
    const issuer = resolveFiscalIssuerForPrint(
      fila.organization,
      fila.store,
      true,
    );
    const htmlModel = mapFiscalDocumentToPrintData(fila);
    const pdfData = buildFiscalInvoicePdfData(fila, issuer, {});

    expect(pdfData.subtotal_amount).toBe(htmlModel.totals.subtotal);
    expect(pdfData.discount_amount).toBe(htmlModel.totals.discount_total);
    expect(pdfData.tax_amount).toBe(htmlModel.totals.tax_total);
    // LA brecha medida: la retención existe en los dos lados.
    expect(pdfData.withholding_amount).toBe(htmlModel.totals.withholding_total);
    expect(pdfData.withholding_amount).toBe(5000);
    expect(pdfData.total_amount).toBe(htmlModel.totals.grand_total);

    // Identidad del emisor idéntica en ambos lados — resuelta por el resolvedor
    // único, nunca por columnas crudas.
    expect(issuer.nit_display).toBe('901555333-8');
    expect(htmlModel.store.tax_id).toBe(issuer.nit_display);
    expect(htmlModel.store.legal_name).toBe(pdfData.company_name);

    // CUFE: el mismo tal cual se transmitió.
    expect(pdfData.cufe).toBe(htmlModel.fiscal?.cufe);

    // Valor en letras desde el MISMO total que imprime el builder.
    expect(htmlModel.totals.grand_total_in_words).toBe(
      amountToSpanishWords(pdfData.total_amount, { suffix: 'M/CTE' }),
    );
  });

  it('el HTML compuesto muestra las cifras pareadas: subtotal, retención, total y letras', () => {
    const composer = new PrintLayoutComposerService(new PrintTemplateCompilerService());
    const model = mapFiscalDocumentToPrintData(fila);
    const html = composer.compose(definition, model);

    expect(html).toContain('$100.000'); // subtotal
    expect(html).toContain('Retención:');
    expect(html).toContain('-$5.000'); // retención, informativa con signo
    expect(html).toContain('$19.000'); // IVA
    expect(html).toContain('$119.000'); // total
    expect(html).toContain(model.totals.grand_total_in_words!);
    expect(html).toContain('cufe-real-de-la-fila');
  });

  describe('renderBuffer — Buffer real bajo demanda, sin persistir nada', () => {
    function buildService(invoiceRow: unknown) {
      const prisma = {
        invoices: { findFirst: jest.fn().mockResolvedValue(invoiceRow) },
      };
      const s3 = { downloadImage: jest.fn().mockRejectedValue(new Error('sin logo')) };
      const service = new FiscalInvoicePdfRenderService(
        prisma as unknown as StorePrismaService,
        s3 as unknown as S3Service,
        new QrService(),
      );
      return { service, prisma };
    }

    it('devuelve un Buffer no vacío que empieza con %PDF', async () => {
      const { service } = buildService(fila);

      const buffer = await service.renderBuffer(10, 41);

      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBeGreaterThan(1000);
      expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    });

    it('un recibo interno sin identidad completa TAMBIÉN renderiza (permisivo, como generatePdf)', async () => {
      const recibo = {
        ...fila,
        dian_status: 'not_applicable',
        store: {
          ...fila.store,
          store_settings: { settings: {} },
        },
      };
      const { service } = buildService(recibo);

      const buffer = await service.renderBuffer(10, 41);

      expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    });

    it('un id inexistente en la tienda falla con PRINT_DOCUMENT_NOT_FOUND_001', async () => {
      const { service } = buildService(null);

      await expect(service.renderBuffer(10, 999999)).rejects.toMatchObject({
        errorCode: 'PRINT_DOCUMENT_NOT_FOUND_001',
      });
    });

    it('un id no numérico se rechaza antes de consultar la base', async () => {
      const { service, prisma } = buildService(fila);

      await expect(service.renderBuffer(10, 'sample')).rejects.toBeInstanceOf(
        VendixHttpException,
      );
      expect(prisma.invoices.findFirst).not.toHaveBeenCalled();
    });
  });

  it('el papel sale del setting de la tienda; un formato desconocido cae a letter', () => {
    expect(resolveFiscalInvoicePaperFormat(fila.store)).toBe('thermal_58');
    expect(
      resolveFiscalInvoicePaperFormat({
        ...fila.store,
        store_settings: { settings: { receipts: { invoice_format: 'papel-inventado' } } },
      }),
    ).toBe('letter');
  });
});
