import { Test, TestingModule } from '@nestjs/testing';
import { PrintGatewayService } from './print-gateway.service';
import { FiscalInvoicePdfRenderService } from './fiscal-invoice-pdf-render.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { DocumentDataProviderRegistry } from '../providers/document-data-provider.registry';
import { PrintLayoutComposerService } from './print-layout-composer.service';
import { PrintFiscalValidatorService } from './print-fiscal-validator.service';
import { PrintFormatDefinition } from '../interfaces/print-format.interface';

/**
 * La plantilla de impresión que congela el perfil de facturación.
 *
 * Lo que se prueba acá no es «que el render use una plantilla»: es que la use
 * SÓLO cuando el documento realmente la trae congelada, y que la consulta que
 * la trae no cruce organizaciones. Un id de plantilla resuelto sin filtro de
 * dueño imprimiría el diseño —encabezado, NIT, pie— de otra empresa sobre una
 * factura fiscal propia.
 */
describe('PrintGatewayService — plantilla congelada por el perfil', () => {
  const templateDefinition = (name: string): PrintFormatDefinition => ({
    paper: { format: 'letter', width_mm: 216, is_roll: false, margin_mm: 10, copies: 1 },
    sections: [{ id: name, type: 'custom', order: 1, visible: true } as never],
  });

  /** Prisma de mentira que registra los `where` con que se lo consulta. */
  function buildPrisma(overrides: {
    storeConfig?: unknown;
    invoiceTemplateId?: number | null;
    templates?: { id: number; organization_id: number | null; is_system: boolean; format_type: string }[];
  }) {
    const calls: { model: string; where: Record<string, unknown> }[] = [];
    const templates = overrides.templates ?? [];

    return {
      calls,
      client: {
        store_print_format_configs: {
          findFirst: jest.fn().mockResolvedValue(overrides.storeConfig ?? null),
        },
        stores: {
          findFirst: jest.fn().mockResolvedValue({ organization_id: 7 }),
        },
        print_templates: {
          findFirst: jest.fn().mockImplementation(({ where }: { where: Record<string, any> }) => {
            calls.push({ model: 'print_templates', where });
            const owners = (where.OR ?? []) as { is_system?: boolean; organization_id?: number }[];
            const found = templates.find((t) => {
              if (where.id !== undefined && t.id !== where.id) return false;
              if (where.format_type !== undefined && t.format_type !== where.format_type) return false;
              if (where.is_system !== undefined && t.is_system !== where.is_system) return false;
              if (owners.length === 0) return true;
              return owners.some(
                (o) =>
                  (o.is_system === true && t.is_system) ||
                  (o.organization_id !== undefined && t.organization_id === o.organization_id),
              );
            });
            return Promise.resolve(
              found ? { ...found, definition: templateDefinition(`t${found.id}`) } : null,
            );
          }),
        },
        invoices: {
          findFirst: jest.fn().mockResolvedValue(
            overrides.invoiceTemplateId === undefined
              ? null
              : {
                  profile_snapshot: {
                    config: { format: { template_id: overrides.invoiceTemplateId } },
                  },
                },
          ),
        },
      },
    };
  }

  async function build(prismaStub: unknown): Promise<PrintGatewayService> {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrintGatewayService,
        { provide: StorePrismaService, useValue: prismaStub },
        { provide: DocumentDataProviderRegistry, useValue: { getProvider: jest.fn() } },
        { provide: PrintLayoutComposerService, useValue: { compose: jest.fn() } },
        { provide: PrintFiscalValidatorService, useValue: { assertFiscalCompliance: jest.fn() } },
        // E.11 — el motor PDF bajo demanda es dependencia del gateway; estos
        // casos no lo ejercitan (ver print-gateway.engine-pdf.spec.ts).
        { provide: FiscalInvoicePdfRenderService, useValue: { renderBuffer: jest.fn() } },
      ],
    }).compile();
    return module.get(PrintGatewayService);
  }

  it('la plantilla explícita gana sobre la activa de la tienda', async () => {
    const prisma = buildPrisma({
      storeConfig: {
        id: 1,
        is_active: true,
        gateway_enabled: true,
        overrides: null,
        template: { definition: templateDefinition('de-la-tienda') },
      },
      templates: [
        { id: 55, organization_id: 7, is_system: false, format_type: 'fiscal_electronic_invoice' },
      ],
    });
    const service = await build(prisma.client);

    const effective = await service.resolveEffectiveConfig(10, 'fiscal_electronic_invoice', 55);

    expect(effective.definition.sections[0].id).toBe('t55');
  });

  it('los overrides de la tienda NO se aplican sobre una plantilla explícita', async () => {
    // Se escribieron contra otra base. Mezclarlos produciría un documento que
    // nadie diseñó, y en un documento fiscal eso es un campo obligatorio movido
    // de lugar o desaparecido.
    const prisma = buildPrisma({
      storeConfig: {
        id: 1,
        is_active: true,
        gateway_enabled: true,
        overrides: { paper: { width_mm: 58, is_roll: true } },
        template: { definition: templateDefinition('de-la-tienda') },
      },
      templates: [
        { id: 55, organization_id: 7, is_system: false, format_type: 'fiscal_electronic_invoice' },
      ],
    });
    const service = await build(prisma.client);

    const effective = await service.resolveEffectiveConfig(10, 'fiscal_electronic_invoice', 55);

    expect(effective.definition.paper.width_mm).toBe(216);
    expect(effective.definition.paper.is_roll).toBe(false);
  });

  it('la consulta de la plantilla filtra por tipo de formato y por dueño', async () => {
    const prisma = buildPrisma({
      templates: [
        { id: 55, organization_id: 7, is_system: false, format_type: 'fiscal_electronic_invoice' },
      ],
    });
    const service = await build(prisma.client);

    await service.resolveEffectiveConfig(10, 'fiscal_electronic_invoice', 55);

    const call = prisma.calls.find((c) => c.where.id === 55);
    expect(call).toBeDefined();
    expect(call!.where.format_type).toBe('fiscal_electronic_invoice');
    expect(call!.where.OR).toEqual([{ is_system: true }, { organization_id: 7 }]);
  });

  it('una plantilla de OTRA organización no se resuelve: cae a la de la tienda', async () => {
    const prisma = buildPrisma({
      storeConfig: {
        id: 1,
        is_active: true,
        gateway_enabled: true,
        overrides: null,
        template: { definition: templateDefinition('de-la-tienda') },
      },
      templates: [
        { id: 99, organization_id: 4242, is_system: false, format_type: 'fiscal_electronic_invoice' },
      ],
    });
    const service = await build(prisma.client);

    const effective = await service.resolveEffectiveConfig(10, 'fiscal_electronic_invoice', 99);

    expect(effective.definition.sections[0].id).toBe('de-la-tienda');
  });

  it('una plantilla de otro tipo de formato no se resuelve', async () => {
    // Renderizar una factura con la plantilla de una comanda de cocina es un
    // documento sin CUFE ni QR: el validador fiscal lo rechazaría por ausencias
    // que nadie relacionaría con la plantilla elegida en el perfil.
    const prisma = buildPrisma({
      storeConfig: {
        id: 1,
        is_active: true,
        gateway_enabled: true,
        overrides: null,
        template: { definition: templateDefinition('de-la-tienda') },
      },
      templates: [{ id: 55, organization_id: 7, is_system: false, format_type: 'kitchen_ticket' }],
    });
    const service = await build(prisma.client);

    const effective = await service.resolveEffectiveConfig(10, 'fiscal_electronic_invoice', 55);

    expect(effective.definition.sections[0].id).toBe('de-la-tienda');
  });

  it('sin plantilla explícita se conserva el comportamiento anterior', async () => {
    const prisma = buildPrisma({
      storeConfig: {
        id: 1,
        is_active: true,
        gateway_enabled: true,
        overrides: null,
        template: { definition: templateDefinition('de-la-tienda') },
      },
    });
    const service = await build(prisma.client);

    const effective = await service.resolveEffectiveConfig(10, 'fiscal_electronic_invoice');

    expect(effective.definition.sections[0].id).toBe('de-la-tienda');
    expect(prisma.calls).toHaveLength(0);
  });

  /**
   * E.1 — el camino REAL (`renderDocument`), no sólo `resolveEffectiveConfig`.
   *
   * La fixture `invoices` de `buildPrisma()` (el parámetro `invoiceTemplateId`)
   * ya existía en este archivo desde que se escribió, pero ningún `it()` la
   * ejercitaba: los 6 casos de arriba llaman `resolveEffectiveConfig` con el
   * override YA resuelto a mano, nunca `renderDocument`, que es lo único que
   * de verdad llama a `resolveProfileTemplateId` y por lo tanto a
   * `this.prisma.invoices.findFirst`. Infraestructura de prueba construida y
   * sin un solo consumidor — el mismo patrón que KG-10 en B.1.
   */
  describe('renderDocument — el template_id congelado en el perfil llega al render real', () => {
    async function buildForRender(prismaStub: unknown) {
      const composeSpy = jest.fn().mockReturnValue('<html></html>');
      const fetchDocumentDataSpy = jest.fn().mockResolvedValue({});
      const getProviderSpy = jest.fn().mockReturnValue({
        fetchDocumentData: fetchDocumentDataSpy,
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
          // E.11 — motor PDF bajo demanda, no ejercitado en este archivo.
          { provide: FiscalInvoicePdfRenderService, useValue: { renderBuffer: jest.fn() } },
        ],
      }).compile();

      return { service: module.get(PrintGatewayService) as PrintGatewayService, composeSpy, fetchDocumentDataSpy };
    }

    it('una factura fiscal con template_id congelado en el perfil se renderiza con ESA plantilla', async () => {
      const prisma = buildPrisma({
        storeConfig: {
          id: 1,
          is_active: true,
          gateway_enabled: true,
          overrides: null,
          template: { definition: templateDefinition('de-la-tienda') },
        },
        invoiceTemplateId: 55,
        templates: [
          { id: 55, organization_id: 7, is_system: false, format_type: 'fiscal_electronic_invoice' },
        ],
      });
      const { service, composeSpy } = await buildForRender(prisma.client);

      await service.renderDocument(10, 'fiscal_electronic_invoice', 168);

      expect(composeSpy).toHaveBeenCalledTimes(1);
      const [definitionArg] = composeSpy.mock.calls[0];
      expect(definitionArg.sections[0].id).toBe('t55');
    });

    it('sin template_id en el snapshot del perfil, renderDocument cae a la plantilla activa de la tienda', async () => {
      const prisma = buildPrisma({
        storeConfig: {
          id: 1,
          is_active: true,
          gateway_enabled: true,
          overrides: null,
          template: { definition: templateDefinition('de-la-tienda') },
        },
        invoiceTemplateId: null,
      });
      const { service, composeSpy } = await buildForRender(prisma.client);

      await service.renderDocument(10, 'fiscal_electronic_invoice', 168);

      const [definitionArg] = composeSpy.mock.calls[0];
      expect(definitionArg.sections[0].id).toBe('de-la-tienda');
    });

    it('un formato que no es factura fiscal nunca consulta `invoices`: el perfil sólo congela plantilla para facturación', async () => {
      const prisma = buildPrisma({
        storeConfig: {
          id: 1,
          is_active: true,
          gateway_enabled: true,
          overrides: null,
          template: { definition: templateDefinition('de-la-tienda') },
        },
        invoiceTemplateId: 55, // presente en el stub; este caso no debe alcanzarlo
      });
      const { service } = await buildForRender(prisma.client);

      await service.renderDocument(10, 'quotation', 168);

      expect((prisma.client.invoices.findFirst as jest.Mock)).not.toHaveBeenCalled();
    });

    it('un documentId no numérico no dispara la consulta de perfil (se descarta antes de tocar la base)', async () => {
      const prisma = buildPrisma({
        storeConfig: {
          id: 1,
          is_active: true,
          gateway_enabled: true,
          overrides: null,
          template: { definition: templateDefinition('de-la-tienda') },
        },
        invoiceTemplateId: 55,
      });
      const { service } = await buildForRender(prisma.client);

      await service.renderDocument(10, 'fiscal_electronic_invoice', 'sample-not-a-number');

      expect((prisma.client.invoices.findFirst as jest.Mock)).not.toHaveBeenCalled();
    });
  });
});
