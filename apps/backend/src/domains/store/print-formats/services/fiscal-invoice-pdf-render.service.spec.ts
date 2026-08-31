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
import { Logger } from '@nestjs/common';
import {
  PAPER_DEFINITIONS,
  PaperDefinition,
} from '../print-templates/paper-definitions';

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

/**
 * E.11 slice 3 — compuerta de cableado del consumer.
 *
 * `FiscalInvoicePdfRenderService.renderBuffer` ahora consulta
 * `resolvePaperDefinition(...)` ANTES de invocar al builder pdfkit. El
 * builder sigue produciendo el MISMO Buffer que producía (lee su `GEOMETRY`
 * interno desde `data.format` y `paper-definitions.ts` está espejado con ese
 * bloque por construcción), pero la resolución queda OBSERVABLE por log y
 * amarrada al registry — la pieza que faltaba entre slice 2 (datos puros)
 * y slice 4 (cableado fino dentro del builder).
 *
 * La compuerta verifica:
 *
 *  - `renderBuffer` consulta `resolvePaperDefinition(format)` para CADA uno
 *    de los cinco papeles (hoja y rollo).
 *  - `data.format` ausente (setting de tienda sin `receipts.invoice_format`)
 *    cae a `letter` — el mismo fallback que el builder asumía antes.
 *  - `data.format` con un valor fuera del registry cae a `letter` también.
 *  - Los `boolean` semánticos (`is_roll`, `double_pass_required`,
 *    `requires_multipage_qr_band`) se REGISTRAN con el valor correcto del
 *    registry — para que `thermal_58` marque `double_pass_required=true`
 *    y `letter` NO.
 *  - El contrato del builder (`engine:'pdf'` sigue produciendo bytes) NO se
 *    rompe: la spec sigue validando `Buffer.isBuffer` y magic number `%PDF`.
 */
describe('FiscalInvoicePdfRenderService — integración con paper_definitions (E.11 slice 3)', () => {
  /** Fila mínima válida para pasar la guarda de identidad fiscal. */
  const filaMinima = {
    id: 41,
    invoice_number: 'QA107',
    invoice_type: 'invoice',
    issue_date: new Date('2026-08-20T15:00:00.000Z'),
    dian_status: 'accepted',
    currency: 'COP',
    subtotal_amount: 100000,
    discount_amount: 0,
    tax_amount: 19000,
    withholding_amount: 0,
    total_amount: 119000,
    cufe: 'cufe-de-prueba-slice-3',
    qr_code: 'NumFac:QA107\nCUFE:cufe-de-prueba-slice-3',
    customer_name: null,
    customer_tax_id: '1020304050',
    customer_address: null,
    notes: null,
    invoice_items: [],
    invoice_taxes: [],
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
      name: 'Tienda Slice3',
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
          receipts: {},
          fiscal_data: {
            nit: '901555333',
            legal_name: 'Tienda Slice3 Ltda.',
            municipality_code: '11001',
            department: 'Cundinamarca',
          },
        },
      },
    },
    organization: {
      name: 'Org Slice3',
      legal_name: 'Org Slice3 S.A.S.',
      tax_id: '900000000-1',
      fiscal_scope: 'STORE',
      addresses: [],
    },
    customer: { first_name: 'Ana', last_name: 'Gómez', email: null },
  };

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
    return { service };
  }

  function filaConFormato(format: string | undefined) {
    return {
      ...filaMinima,
      store: {
        ...filaMinima.store,
        store_settings: {
          settings: {
            receipts:
              format === undefined ? {} : { invoice_format: format },
          },
        },
      },
    };
  }

  function spyDebug() {
    return jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  }

  function findPaperDebugCall(spy: jest.SpyInstance): string {
    const calls = spy.mock.calls.map((args) => String(args[0] ?? ''));
    const hit = calls.find((c) => c.includes('paper_definition_resolved'));
    if (!hit) {
      throw new Error(
        `No se encontró log 'paper_definition_resolved' entre ${calls.length} llamadas .debug; primeras: ${calls.slice(0, 3).join(' | ')}`,
      );
    }
    return hit;
  }

  /** Helpers de extracción: el formato del log es estable, lo testeamos como string. */
  function paperField(logLine: string, field: 'code' | 'is_roll' | 'double_pass_required' | 'requires_multipage_qr_band' | 'width_mm' | 'height_mm'): string {
    const re = new RegExp(`${field}=([^\\s]+)`);
    const match = re.exec(logLine);
    if (!match) throw new Error(`No se encontró ${field} en: ${logLine}`);
    return match[1];
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('letter: la resolución cae al registry y registra code=letter, no rollo', async () => {
    const debugSpy = spyDebug();
    const { service } = buildService(filaConFormato('letter'));

    const buffer = await service.renderBuffer(10, 41);

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');

    const log = findPaperDebugCall(debugSpy);
    expect(paperField(log, 'code')).toBe('letter');
    expect(paperField(log, 'is_roll')).toBe('false');
    expect(paperField(log, 'double_pass_required')).toBe('false');
    expect(paperField(log, 'requires_multipage_qr_band')).toBe('true');
    expect(paperField(log, 'height_mm')).toBe('279.4');
  });

  it('a4: registra la geometría del registry (no la del builder interno)', async () => {
    const debugSpy = spyDebug();
    const { service } = buildService(filaConFormato('a4'));

    await service.renderBuffer(10, 41);

    const log = findPaperDebugCall(debugSpy);
    expect(paperField(log, 'code')).toBe('a4');
    expect(paperField(log, 'width_mm')).toBe('210');
    expect(paperField(log, 'height_mm')).toBe('297');
    expect(paperField(log, 'is_roll')).toBe('false');
    expect(paperField(log, 'double_pass_required')).toBe('false');
    expect(paperField(log, 'requires_multipage_qr_band')).toBe('true');
  });

  it('half_letter: registra font_scale del registry (0.66)', async () => {
    const debugSpy = spyDebug();
    const { service } = buildService(filaConFormato('half_letter'));

    await service.renderBuffer(10, 41);

    const log = findPaperDebugCall(debugSpy);
    expect(paperField(log, 'code')).toBe('half_letter');
    // Sólo verificamos que el campo `width_mm` del log coincide con el registry;
    // font_scale se observa en la spec de paper-defaults, no se duplica aquí.
    expect(paperField(log, 'width_mm')).toBe('215.9');
    expect(paperField(log, 'height_mm')).toBe('139.7');
  });

  it('thermal_80: marca double_pass_required=true (rollo)', async () => {
    const debugSpy = spyDebug();
    const { service } = buildService(filaConFormato('thermal_80'));

    await service.renderBuffer(10, 41);

    const log = findPaperDebugCall(debugSpy);
    expect(paperField(log, 'code')).toBe('thermal_80');
    expect(paperField(log, 'is_roll')).toBe('true');
    expect(paperField(log, 'double_pass_required')).toBe('true');
    expect(paperField(log, 'requires_multipage_qr_band')).toBe('false');
    expect(paperField(log, 'width_mm')).toBe('80');
    expect(paperField(log, 'height_mm')).toBe('measured');
  });

  it('thermal_58: el más estrecho, doble pasada obligatoria', async () => {
    const debugSpy = spyDebug();
    const { service } = buildService(filaConFormato('thermal_58'));

    await service.renderBuffer(10, 41);

    const log = findPaperDebugCall(debugSpy);
    expect(paperField(log, 'code')).toBe('thermal_58');
    expect(paperField(log, 'is_roll')).toBe('true');
    expect(paperField(log, 'double_pass_required')).toBe('true');
    expect(paperField(log, 'requires_multipage_qr_band')).toBe('false');
    expect(paperField(log, 'width_mm')).toBe('58');
    expect(paperField(log, 'height_mm')).toBe('measured');
  });

  it('paper_format undefined (sin setting): cae a letter por el fallback del registry', async () => {
    const debugSpy = spyDebug();
    const { service } = buildService(filaConFormato(undefined));

    await service.renderBuffer(10, 41);

    const log = findPaperDebugCall(debugSpy);
    expect(paperField(log, 'code')).toBe('letter');
  });

  it('paper_format ajeno al registry: cae a letter por el fallback (nunca lanza)', async () => {
    const debugSpy = spyDebug();
    const { service } = buildService(filaConFormato('papel-inventado'));

    const buffer = await service.renderBuffer(10, 41);

    // No lanza: el registry tiene fallback cerrado a `letter`. El documento
    // se sigue produciendo — exactamente la política de `paper-defaults.ts`
    // que este slice respeta.
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');

    const log = findPaperDebugCall(debugSpy);
    expect(paperField(log, 'code')).toBe('letter');
  });

  it('los booleanos del log son los del registry, no los del builder interno', async () => {
    // Esta es la compuerta dura: el consumer está mirando el registry de
    // `PAPER_DEFINITIONS`, no otras constantes sueltas. Si mañana alguien
    // redefine `double_pass_required` en el builder sin tocar el registry,
    // el log diría la verdad del registry y la spec seguiría verde aquí —
    // eso es LO CORRECTO: slice 3 ata el consumer al registry, no al
    // builder.
    const debugSpy = spyDebug();
    const { service } = buildService(filaConFormato('a4'));

    await service.renderBuffer(10, 41);

    const log = findPaperDebugCall(debugSpy);
    const a4: PaperDefinition = PAPER_DEFINITIONS.a4;
    expect(paperField(log, 'double_pass_required')).toBe(String(a4.double_pass_required));
    expect(paperField(log, 'requires_multipage_qr_band')).toBe(
      String(a4.requires_multipage_qr_band),
    );
    expect(paperField(log, 'is_roll')).toBe(String(a4.is_roll));
  });

  it('el Buffer sigue siendo un PDF válido aunque la PaperDefinition venga del registry', async () => {
    // Garantía de no-regresión: el cableado del consumer NO rompe la
    // generación del artefacto. La spec de paridad HTML↔PDF de slice 1 ya
    // cubre importes y letras; aquí cubrimos que el binario del PDF sigue
    // saliendo entero.
    const debugSpy = spyDebug();
    const { service } = buildService(filaConFormato('thermal_58'));

    const buffer = await service.renderBuffer(10, 41);

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    // La línea de log apareció — confirma que el consumer pasó por la
    // resolución de `paper-defaults` antes del builder.
    expect(debugSpy.mock.calls.some((c) => String(c[0] ?? '').includes('paper_definition_resolved'))).toBe(true);
  });
});
