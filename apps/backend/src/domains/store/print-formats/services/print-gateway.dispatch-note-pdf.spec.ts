import { Test, TestingModule } from '@nestjs/testing';
import { PrintGatewayService } from './print-gateway.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { DocumentDataProviderRegistry } from '../providers/document-data-provider.registry';
import { DocumentPdfRendererRegistry } from '../providers/document-pdf-renderer.registry';
import { PrintLayoutComposerService } from './print-layout-composer.service';
import { PrintFiscalValidatorService } from './print-fiscal-validator.service';
import { PrintFormatDefinition } from '../interfaces/print-format.interface';

/**
 * ADR-15 §4 (CP-pos-exclusive-tax-double-charge, unificación
 * remisión-gateway) — `POST /store/dispatch-notes/:id/pdf` deja de llamar a
 * `DispatchNotePdfService` directo y pasa por `PrintGatewayService.renderDocument`
 * con `engine:'pdf'`.
 *
 * `renderDocument` corre, ANTES de renderizar, cosas que el riel suelto que
 * este endpoint reemplaza NUNCA corría: `resolveEffectiveConfig` (que puede
 * auto-sembrar la fila de config) y el gate `is_active`. Requisito duro:
 * ninguna tienda puede perder la capacidad de imprimir una remisión sólo
 * porque el transporte se unificó. Estas pruebas fijan que:
 *
 * 1. Una tienda SIN fila propia de `dispatch_note` (auto-siembra) igual
 *    imprime — `is_active` por defecto es `true`.
 * 2. Una tienda con `is_active:false` YA GUARDADO para `dispatch_note` (el
 *    toggle real y alcanzable desde el Hub — "Activar/Desactivar todos")
 *    IGUAL imprime en PDF: ese riel nunca miró el flag y unificar el
 *    transporte no puede retirar la capacidad de golpe.
 * 3. Ese bypass es ESTRECHO: `dispatch_note` en `engine:'html'` sigue
 *    respetando `is_active` sin cambios (riel A, sin tocar), y los formatos
 *    fiscales respetan `is_active` en CUALQUIER motor, PDF incluido — el
 *    bypass no se filtró por accidente a otro formato.
 */
describe('PrintGatewayService — dispatch_note por el motor pdf (unificación remisión-gateway)', () => {
  const dispatchDefinition: PrintFormatDefinition = {
    paper: { format: 'a4', width_mm: 210, is_roll: false, margin_mm: 15, copies: 2 },
    sections: [{ id: 'sec_items', type: 'items_table', title: '', enabled: true, order: 1 }],
  };

  // Completa a propósito: `assertFiscalCompliance` (real, sin mockear en
  // este spec) exige estas 5 secciones habilitadas para cualquier formato en
  // `FISCAL_FORMATS`. Si faltara una, el test de `fiscal_credit_note` de
  // abajo fallaría por PRINT_FISCAL_STRUCTURE_VIOLATION_001, no por lo que
  // se quiere probar (ruteo del registro).
  const fiscalDefinition: PrintFormatDefinition = {
    paper: { format: 'letter', width_mm: 216, is_roll: false, margin_mm: 10, copies: 1 },
    sections: [
      { id: 'header', type: 'header', title: '', enabled: true, order: 1 },
      { id: 'doc_info', type: 'document_info', title: '', enabled: true, order: 2 },
      { id: 'qr', type: 'fiscal_qr_section', title: '', enabled: true, order: 3 },
      { id: 'items', type: 'items_table', title: '', enabled: true, order: 4 },
      { id: 'totals', type: 'totals_summary', title: '', enabled: true, order: 5 },
    ],
  };

  async function build(prismaStub: unknown, dispatchRenderBuffer: jest.Mock) {
    const composeSpy = jest.fn().mockReturnValue('<html>remision</html>');
    const getProviderSpy = jest.fn().mockReturnValue({
      fetchDocumentData: jest.fn().mockResolvedValue({}),
      getSampleData: jest.fn(),
      getAvailableTokens: jest.fn().mockReturnValue([]),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrintGatewayService,
        { provide: StorePrismaService, useValue: prismaStub },
        { provide: DocumentDataProviderRegistry, useValue: { getProvider: getProviderSpy } },
        { provide: PrintLayoutComposerService, useValue: { compose: composeSpy } },
        // No-op real: `dispatch_note` no está en `FISCAL_FORMATS`, así que esto
        // es fiel al comportamiento real, no un stub que oculte una regla.
        PrintFiscalValidatorService,
        DocumentPdfRendererRegistry,
      ],
    }).compile();

    // Misma forma que `print-formats.module.ts#onModuleInit`: dos claves
    // fiscales apuntando a UN renderizador, y `dispatch_note` a otro.
    const pdfRendererRegistry = module.get(DocumentPdfRendererRegistry);
    const fiscalRenderBuffer = jest.fn().mockResolvedValue(Buffer.from('%PDF-fiscal'));
    pdfRendererRegistry.register('fiscal_electronic_invoice', { renderBuffer: fiscalRenderBuffer });
    pdfRendererRegistry.register('fiscal_credit_note', { renderBuffer: fiscalRenderBuffer });
    pdfRendererRegistry.register('dispatch_note', { renderBuffer: dispatchRenderBuffer });

    return {
      service: module.get(PrintGatewayService) as PrintGatewayService,
      fiscalRenderBuffer,
    };
  }

  it('tienda SIN fila propia de dispatch_note (auto-siembra): el PDF sale igual', async () => {
    const dispatchRenderBuffer = jest.fn().mockResolvedValue(Buffer.from('%PDF-remision'));
    const createdRow = {
      id: 10,
      is_active: true,
      gateway_enabled: false,
      overrides: null,
      template: { definition: dispatchDefinition },
    };

    const prisma = {
      // Primera consulta de `resolveEffectiveConfig`: la tienda nunca configuró
      // este formato en el Hub.
      store_print_format_configs: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(createdRow),
      },
      stores: { findFirst: jest.fn().mockResolvedValue({ organization_id: 7 }) },
      print_templates: {
        // La plantilla de sistema SÍ existe (seed) — por eso la auto-siembra
        // puede completar la fila en vez de lanzar PRINT_FORMAT_NOT_FOUND_001.
        findFirst: jest.fn().mockResolvedValue({ id: 55, definition: dispatchDefinition }),
      },
      invoices: { findFirst: jest.fn() },
    };

    const { service } = await build(prisma, dispatchRenderBuffer);

    const result = await service.renderDocument(1, 'dispatch_note', 220, 'pdf');

    expect(prisma.store_print_format_configs.create).toHaveBeenCalledTimes(1);
    expect(dispatchRenderBuffer).toHaveBeenCalledWith(1, 220, 'dispatch_note');
    expect(Buffer.isBuffer(result.pdf_buffer)).toBe(true);
    expect(result.pdf_buffer!.toString('latin1').startsWith('%PDF')).toBe(true);
  });

  it('tienda con is_active:false YA GUARDADO para dispatch_note: engine pdf igual imprime', async () => {
    const dispatchRenderBuffer = jest.fn().mockResolvedValue(Buffer.from('%PDF-remision'));
    const disabledRow = {
      id: 10,
      is_active: false,
      gateway_enabled: false,
      overrides: null,
      template: { definition: dispatchDefinition },
    };

    const prisma = {
      store_print_format_configs: { findFirst: jest.fn().mockResolvedValue(disabledRow) },
      stores: { findFirst: jest.fn().mockResolvedValue({ organization_id: 7 }) },
      print_templates: { findFirst: jest.fn().mockResolvedValue(null) },
      invoices: { findFirst: jest.fn() },
    };

    const { service } = await build(prisma, dispatchRenderBuffer);

    const result = await service.renderDocument(1, 'dispatch_note', 220, 'pdf');

    expect(dispatchRenderBuffer).toHaveBeenCalledWith(1, 220, 'dispatch_note');
    expect(Buffer.isBuffer(result.pdf_buffer)).toBe(true);
  });

  it('el bypass NO se filtra al render HTML de dispatch_note (riel A sigue respetando is_active)', async () => {
    const dispatchRenderBuffer = jest.fn();
    const disabledRow = {
      id: 10,
      is_active: false,
      gateway_enabled: false,
      overrides: null,
      template: { definition: dispatchDefinition },
    };

    const prisma = {
      store_print_format_configs: { findFirst: jest.fn().mockResolvedValue(disabledRow) },
      stores: { findFirst: jest.fn().mockResolvedValue({ organization_id: 7 }) },
      print_templates: { findFirst: jest.fn().mockResolvedValue(null) },
      invoices: { findFirst: jest.fn() },
    };

    const { service } = await build(prisma, dispatchRenderBuffer);

    await expect(
      service.renderDocument(1, 'dispatch_note', 220, 'html'),
    ).rejects.toMatchObject({ errorCode: 'SYS_FORBIDDEN_001' });
    expect(dispatchRenderBuffer).not.toHaveBeenCalled();
  });

  it('el bypass NO se filtra a los formatos fiscales (is_active:false sigue bloqueando su PDF)', async () => {
    const dispatchRenderBuffer = jest.fn();
    const disabledFiscalRow = {
      id: 20,
      is_active: false,
      gateway_enabled: false,
      overrides: null,
      template: { definition: fiscalDefinition },
    };

    const prisma = {
      store_print_format_configs: { findFirst: jest.fn().mockResolvedValue(disabledFiscalRow) },
      stores: { findFirst: jest.fn().mockResolvedValue({ organization_id: 7 }) },
      print_templates: { findFirst: jest.fn().mockResolvedValue(null) },
      invoices: { findFirst: jest.fn().mockResolvedValue(null) },
    };

    const { service, fiscalRenderBuffer } = await build(prisma, dispatchRenderBuffer);

    await expect(
      service.renderDocument(1, 'fiscal_electronic_invoice', 168, 'pdf'),
    ).rejects.toMatchObject({ errorCode: 'SYS_FORBIDDEN_001' });
    expect(fiscalRenderBuffer).not.toHaveBeenCalled();
  });

  it('fiscal_credit_note resuelve al MISMO renderizador fiscal — sin regresión de ruteo', async () => {
    const dispatchRenderBuffer = jest.fn();
    const activeFiscalRow = {
      id: 21,
      is_active: true,
      gateway_enabled: true,
      overrides: null,
      template: { definition: fiscalDefinition },
    };

    const prisma = {
      store_print_format_configs: { findFirst: jest.fn().mockResolvedValue(activeFiscalRow) },
      stores: { findFirst: jest.fn().mockResolvedValue({ organization_id: 7 }) },
      print_templates: { findFirst: jest.fn().mockResolvedValue(null) },
      invoices: { findFirst: jest.fn().mockResolvedValue(null) },
    };

    const { service, fiscalRenderBuffer } = await build(prisma, dispatchRenderBuffer);

    const result = await service.renderDocument(1, 'fiscal_credit_note', 300, 'pdf');

    expect(fiscalRenderBuffer).toHaveBeenCalledWith(1, 300, 'fiscal_credit_note');
    expect(Buffer.isBuffer(result.pdf_buffer)).toBe(true);
  });
});
