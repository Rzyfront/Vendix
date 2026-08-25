import { Test, TestingModule } from '@nestjs/testing';
import { PrintFormatsService, ALL_FORMAT_TYPES } from './print-formats.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { OrganizationPrismaService } from '../../../../prisma/services/organization-prisma.service';
import { PrintGatewayService } from './print-gateway.service';
import { PrintFiscalValidatorService } from './print-fiscal-validator.service';
import { DocumentDataProviderRegistry } from '../providers/document-data-provider.registry';
import { PrintFormatDefinition } from '../interfaces/print-format.interface';

/**
 * E.1 «Distintos formatos de vista» — el contrato de lectura/persistencia que
 * el selector de formato de la factura y de la vista de detalle necesitan:
 *
 *   1. `listStoreFormats`  → «leer los formatos disponibles» (con el estado
 *      real de la tienda, no un catálogo estático).
 *   2. `getStoreFormatDetail` → «cuál es el de la tienda por defecto» (el
 *      `template_id` efectivo que el selector debe preseleccionar).
 *   3. `updateStoreFormat` → «que un template_id elegido viaje», pero a nivel
 *      de PERSISTENCIA: el valor que el selector guarda sí llega a la fila de
 *      `store_print_format_configs`, no sólo a la respuesta HTTP.
 *
 * Antes de este spec, `PrintFormatsService` — el servicio detrás de
 * `GET /store/print-formats`, `GET /store/print-formats/:formatType` y
 * `PUT /store/print-formats/:formatType` — no tenía NINGUNA prueba directa.
 * Los 5 suites existentes del dominio cubren proveedores, el compilador de
 * plantillas, el validador fiscal y el enlace perfil↔plantilla dentro del
 * gateway, pero ninguno pasa por este servicio.
 */
describe('PrintFormatsService — contrato de lectura y persistencia del selector de formato', () => {
  const baseDefinition: PrintFormatDefinition = {
    paper: { format: 'letter', width_mm: 216, is_roll: false, margin_mm: 10, copies: 1 },
    sections: [],
  };

  function buildStorePrismaStub(overrides: {
    configs?: unknown[];
    findFirstConfig?: unknown;
  }) {
    return {
      store_print_format_configs: {
        findMany: jest.fn().mockResolvedValue(overrides.configs ?? []),
        findFirst: jest.fn().mockResolvedValue(overrides.findFirstConfig ?? null),
        create: jest.fn().mockResolvedValue({ id: 1 }),
        update: jest.fn().mockResolvedValue({ id: 1 }),
        delete: jest.fn().mockResolvedValue({ id: 1 }),
      },
    };
  }

  async function build(
    storePrismaStub: ReturnType<typeof buildStorePrismaStub>,
  ): Promise<PrintFormatsService> {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrintFormatsService,
        { provide: StorePrismaService, useValue: storePrismaStub },
        { provide: OrganizationPrismaService, useValue: {} },
        {
          provide: PrintGatewayService,
          useValue: {
            resolveEffectiveConfig: jest.fn().mockResolvedValue({
              definition: baseDefinition,
              is_active: true,
              gateway_enabled: false,
              is_customized: false,
            }),
          },
        },
        { provide: PrintFiscalValidatorService, useValue: { assertFiscalCompliance: jest.fn() } },
        {
          provide: DocumentDataProviderRegistry,
          useValue: { getProvider: jest.fn().mockReturnValue({ getAvailableTokens: jest.fn().mockReturnValue([]) }) },
        },
      ],
    }).compile();

    return module.get(PrintFormatsService);
  }

  describe('listStoreFormats — catálogo de 10 formatos con el estado real de la tienda', () => {
    it('sin configuración guardada, cada formato cae al default: activo, sin gateway, plantilla del sistema', async () => {
      const prisma = buildStorePrismaStub({ configs: [] });
      const service = await build(prisma);

      const formats = await service.listStoreFormats(10, 3);

      expect(formats).toHaveLength(ALL_FORMAT_TYPES.length);
      const invoiceFormat = formats.find((f) => f.format_type === 'fiscal_electronic_invoice');
      expect(invoiceFormat).toMatchObject({
        is_configured: false,
        is_active: true,
        gateway_enabled: false,
        template_name: 'Por defecto del sistema',
      });
    });

    it('con configuración guardada, expone la plantilla y el estado real de la tienda para ese formato', async () => {
      const prisma = buildStorePrismaStub({
        configs: [
          {
            format_type: 'fiscal_electronic_invoice',
            is_active: false,
            gateway_enabled: true,
            template: { name: 'Factura DIAN — Minimalista' },
            overrides: null,
            updated_at: new Date('2026-08-20'),
          },
        ],
      });
      const service = await build(prisma);

      const formats = await service.listStoreFormats(10, 3);
      const invoiceFormat = formats.find((f) => f.format_type === 'fiscal_electronic_invoice');

      expect(invoiceFormat).toMatchObject({
        is_configured: true,
        is_active: false,
        gateway_enabled: true,
        template_name: 'Factura DIAN — Minimalista',
      });

      // El resto de los 9 formatos no tiene fila propia: siguen en default.
      const untouched = formats.filter((f) => f.format_type !== 'fiscal_electronic_invoice');
      expect(untouched.every((f) => f.is_configured === false)).toBe(true);
    });

    it('overrides sin template asignado se anuncia como "Personalizado (Overrides)"', async () => {
      const prisma = buildStorePrismaStub({
        configs: [
          {
            format_type: 'quotation',
            is_active: true,
            gateway_enabled: true,
            template: null,
            overrides: { styles: { primary_color: '#000000' } },
            updated_at: new Date('2026-08-20'),
          },
        ],
      });
      const service = await build(prisma);

      const formats = await service.listStoreFormats(10, 3);
      const quotation = formats.find((f) => f.format_type === 'quotation');

      expect(quotation?.template_name).toBe('Personalizado (Overrides)');
    });
  });

  describe('getStoreFormatDetail — el formato "por defecto de la tienda" que el selector precarga', () => {
    it('devuelve el template_id y template_name que la tienda tiene configurado', async () => {
      const prisma = buildStorePrismaStub({
        findFirstConfig: {
          template_id: 55,
          template: { name: 'Factura DIAN — Minimalista' },
          overrides: null,
        },
      });
      const service = await build(prisma);

      const detail = await service.getStoreFormatDetail(10, 'fiscal_electronic_invoice');

      expect(detail.format_type).toBe('fiscal_electronic_invoice');
      expect(detail.template_id).toBe(55);
      expect(detail.template_name).toBe('Factura DIAN — Minimalista');
    });

    it('sin configuración de tienda, el template_id es null: el selector debe leerlo como "plantilla del sistema"', async () => {
      const prisma = buildStorePrismaStub({ findFirstConfig: null });
      const service = await build(prisma);

      const detail = await service.getStoreFormatDetail(10, 'quotation');

      expect(detail.template_id).toBeNull();
      expect(detail.template_name).toBeNull();
    });
  });

  describe('updateStoreFormat — el template_id elegido se persiste en la fila de la tienda', () => {
    it('crea la fila de configuración con el template_id elegido cuando la tienda no tenía una', async () => {
      const prisma = buildStorePrismaStub({ findFirstConfig: null });
      const service = await build(prisma);

      await service.updateStoreFormat(10, 3, 'fiscal_electronic_invoice', { template_id: 55 });

      expect(prisma.store_print_format_configs.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            store_id: 10,
            organization_id: 3,
            format_type: 'fiscal_electronic_invoice',
            template_id: 55,
          }),
        }),
      );
    });

    it('actualiza el template_id existente cuando la tienda ya tenía configuración para ese formato', async () => {
      const prisma = buildStorePrismaStub({
        findFirstConfig: { id: 1, is_active: true, gateway_enabled: false, template_id: 9, overrides: null },
      });
      const service = await build(prisma);

      await service.updateStoreFormat(10, 3, 'fiscal_electronic_invoice', { template_id: 77 });

      expect(prisma.store_print_format_configs.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: expect.objectContaining({ template_id: 77 }),
        }),
      );
    });

    it('un template_id no enviado en el DTO conserva el que la tienda ya tenía, no lo borra', async () => {
      const prisma = buildStorePrismaStub({
        findFirstConfig: { id: 1, is_active: true, gateway_enabled: false, template_id: 9, overrides: null },
      });
      const service = await build(prisma);

      await service.updateStoreFormat(10, 3, 'fiscal_electronic_invoice', { is_active: false });

      expect(prisma.store_print_format_configs.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ template_id: 9, is_active: false }),
        }),
      );
    });
  });
});
