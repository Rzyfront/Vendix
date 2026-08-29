import { Test, TestingModule } from '@nestjs/testing';
import { PrintGatewayService, RenderResult } from './print-gateway.service';
import { FiscalInvoicePdfRenderService } from './fiscal-invoice-pdf-render.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { DocumentDataProviderRegistry } from '../providers/document-data-provider.registry';
import { PrintLayoutComposerService } from './print-layout-composer.service';
import { PrintFiscalValidatorService } from './print-fiscal-validator.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { PrintFormatDefinition } from '../interfaces/print-format.interface';

/**
 * E.11 casilla 4 (slice 1) — `engine:'pdf'` deja de ser aceptado-e-ignorado.
 *
 * Hasta hoy `RenderResult.pdf_buffer` estaba declarado y JAMÁS lleno: el DTO
 * aceptaba `engine:'pdf'` y el cuerpo de `renderDocument` producía siempre
 * HTML. Estas pruebas fijan el nuevo contrato:
 *
 * 1. `fiscal_electronic_invoice` + `engine:'pdf'` → Buffer real en
 *    `pdf_buffer`, junto al HTML de la plantilla congelada.
 * 2. Default `'html'` → sin Buffer (no se paga el render si no se pidió).
 * 3. Otro formato + `engine:'pdf'` → 422 explícito, nunca un HTML que haga
 *    pasar por PDF — negarse ES parte de dejar de mentir.
 * 4. Los errores tipados del motor (documento ausente, identidad fiscal
 *    incompleta) conservan su código; los anónimos se envuelven en
 *    `PRINT_GATEWAY_RENDER_FAILED_001`.
 */
describe('PrintGatewayService — engine pdf llena RenderResult.pdf_buffer', () => {
  const definition: PrintFormatDefinition = {
    paper: { format: 'letter', width_mm: 216, is_roll: false, margin_mm: 10, copies: 2 },
    sections: [{ id: 'totals', type: 'totals_summary', title: '', enabled: true, order: 1 }],
  };

  const storeConfig = {
    id: 1,
    is_active: true,
    gateway_enabled: true,
    overrides: null,
    template: { definition },
  };

  function buildPrisma() {
    return {
      store_print_format_configs: {
        findFirst: jest.fn().mockResolvedValue(storeConfig),
      },
      stores: { findFirst: jest.fn().mockResolvedValue({ organization_id: 7 }) },
      print_templates: { findFirst: jest.fn().mockResolvedValue(null) },
      invoices: { findFirst: jest.fn().mockResolvedValue(null) },
    };
  }

  async function build(prismaStub: unknown, renderBuffer: jest.Mock) {
    const composeSpy = jest.fn().mockReturnValue('<html>plantilla-del-perfil</html>');
    const getProviderSpy = jest.fn().mockReturnValue({
      fetchDocumentData: jest.fn().mockResolvedValue({ totals: {} }),
      getSampleData: jest.fn(),
      getAvailableTokens: jest.fn().mockReturnValue([]),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrintGatewayService,
        { provide: StorePrismaService, useValue: prismaStub },
        { provide: DocumentDataProviderRegistry, useValue: { getProvider: getProviderSpy } },
        { provide: PrintLayoutComposerService, useValue: { compose: composeSpy } },
        { provide: PrintFiscalValidatorService, useValue: { assertFiscalCompliance: jest.fn() } },
        { provide: FiscalInvoicePdfRenderService, useValue: { renderBuffer } },
      ],
    }).compile();

    return { service: module.get(PrintGatewayService) as PrintGatewayService };
  }

  it('fiscal_electronic_invoice + engine pdf → pdf_buffer con bytes y html también presente', async () => {
    const pdf = Buffer.from('%PDF-1.4 documento-de-prueba');
    const renderBuffer = jest.fn().mockResolvedValue(pdf);
    const { service } = await build(buildPrisma(), renderBuffer);

    const result: RenderResult = await service.renderDocument(
      10,
      'fiscal_electronic_invoice',
      168,
      'pdf',
    );

    expect(renderBuffer).toHaveBeenCalledTimes(1);
    // [print-editor-dsk P8] — `renderBuffer` ahora recibe `formatType` para
    // distinguir `fiscal_electronic_invoice` de `fiscal_credit_note` por la
    // columna `invoices.invoice_type`.
    expect(renderBuffer).toHaveBeenCalledWith(10, 168, 'fiscal_electronic_invoice');
    expect(Buffer.isBuffer(result.pdf_buffer)).toBe(true);
    expect(result.pdf_buffer!.length).toBeGreaterThan(0);
    expect(result.pdf_buffer!.toString('latin1').startsWith('%PDF')).toBe(true);
    expect(result.html).toBe('<html>plantilla-del-perfil</html>');
    expect(result.copies).toBe(2);
    expect(result.is_roll).toBe(false);
  });

  it('engine html (default) NO llama al motor ni llena pdf_buffer', async () => {
    const renderBuffer = jest.fn();
    const { service } = await build(buildPrisma(), renderBuffer);

    const result = await service.renderDocument(10, 'fiscal_electronic_invoice', 168);

    expect(renderBuffer).not.toHaveBeenCalled();
    expect(result.pdf_buffer).toBeUndefined();
    expect(result.html).toBeTruthy();
  });

  it('otro formato + engine pdf → 422 SYS_VALIDATION_001 antes de tocar nada', async () => {
    const renderBuffer = jest.fn();
    const prisma = buildPrisma();
    const { service } = await build(prisma, renderBuffer);

    await expect(
      service.renderDocument(10, 'quotation', 5, 'pdf'),
    ).rejects.toMatchObject({ errorCode: 'SYS_VALIDATION_001' });

    // El rechazo es temprano: ni consulta de plantilla ni motor ni provider.
    expect(renderBuffer).not.toHaveBeenCalled();
    expect(prisma.invoices.findFirst).not.toHaveBeenCalled();
  });

  it('un error tipado del motor conserva su código y su HTTP status', async () => {
    const tipado = new VendixHttpException(
      ErrorCodes.FISCAL_IDENTITY_INCOMPLETE,
      'No hay municipio DIAN',
    );
    const { service } = await build(buildPrisma(), jest.fn().mockRejectedValue(tipado));

    await expect(
      service.renderDocument(10, 'fiscal_electronic_invoice', 168, 'pdf'),
    ).rejects.toBe(tipado); // MISMA instancia: sin reenvoltura
  });

  it('un fallo anónimo del motor sale como PRINT_GATEWAY_RENDER_FAILED_001, no como 500 pelado', async () => {
    const { service } = await build(
      buildPrisma(),
      jest.fn().mockRejectedValue(new TypeError('Cannot read properties of undefined')),
    );

    await expect(
      service.renderDocument(10, 'fiscal_electronic_invoice', 168, 'pdf'),
    ).rejects.toMatchObject({ errorCode: 'PRINT_GATEWAY_RENDER_FAILED_001' });
  });
});
