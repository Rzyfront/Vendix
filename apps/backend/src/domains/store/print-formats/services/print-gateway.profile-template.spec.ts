import { Test, TestingModule } from '@nestjs/testing';
import { PrintGatewayService } from './print-gateway.service';
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
});
