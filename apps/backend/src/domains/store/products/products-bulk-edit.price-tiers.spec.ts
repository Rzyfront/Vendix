import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ProductsBulkEditService } from './products-bulk-edit.service';
import { ProductsService } from './products.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { AutoEntryService } from '../accounting/auto-entries/auto-entry.service';
import { ErrorCodes, VendixHttpException } from 'src/common/errors';
import { BulkEditProductsDto } from './dto';
import { ProductState } from './dto/product-enums';
import { RequestContextService } from '@common/context/request-context.service';

/**
 * Acción masiva de tarifas (`price_tier_action`): resolución compartida
 * preview/apply, flag multi-tarifa, validaciones de lote y scope de tienda.
 */
const MODELS = [
  'products',
  'stock_reservations',
  'product_variants',
  'recipes',
  'stores',
  'kds',
  'units_of_measure',
  'price_tiers',
  'product_price_tier_assignments',
] as const;

type MockPrisma = Record<string, Record<string, jest.Mock>>;

function buildMockPrisma(): MockPrisma {
  const prisma: MockPrisma = {};
  for (const model of MODELS) {
    prisma[model] = {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn(),
      createMany: jest.fn(),
      deleteMany: jest.fn(),
    };
  }
  return prisma;
}

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    store_id: 10,
    name: 'Arroz',
    sku: 'ARZ',
    state: ProductState.ACTIVE,
    product_type: 'physical',
    is_sellable: true,
    is_ingredient: false,
    has_multiple_price_tiers: false,
    track_inventory: true,
    usage_nature: null,
    ...overrides,
  };
}

const tier = (id: number, name: string, is_active = true) => ({
  id,
  name,
  is_active,
});

const dto = (ids: number[], changes: Record<string, unknown>) =>
  ({ ids, changes }) as BulkEditProductsDto;

describe('ProductsBulkEditService — price_tier_action', () => {
  let service: ProductsBulkEditService;
  let prisma: MockPrisma;
  let productsService: { update: jest.Mock };

  beforeEach(async () => {
    prisma = buildMockPrisma();
    productsService = {
      update: jest.fn().mockImplementation(async (id: number) => ({
        id,
        name: `P${id}`,
      })),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsBulkEditService,
        { provide: StorePrismaService, useValue: prisma },
        { provide: ProductsService, useValue: productsService },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        {
          provide: AutoEntryService,
          useValue: { validateProductAccountCodes: jest.fn() },
        },
      ],
    }).compile();
    service = module.get(ProductsBulkEditService);
    jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(10);
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      organization_id: 6,
      store_id: 10,
      user_id: 1,
    } as any);
  });

  afterEach(() => jest.restoreAllMocks());

  /** Dos productos: 1 sin tarifas (flag off), 2 con la tarifa 7 (flag on). */
  function seedTwoProducts() {
    prisma.products.findMany.mockResolvedValue([
      product({ id: 1, has_multiple_price_tiers: false }),
      product({ id: 2, name: 'Frijol', has_multiple_price_tiers: true }),
    ]);
    prisma.product_price_tier_assignments.findMany.mockResolvedValue([
      { product_id: 2, price_tier_id: 7, price_tier: { name: 'Mayorista' } },
    ]);
  }

  describe('validaciones de lote', () => {
    it('ids duplicados ⇒ 400 PROD_VALIDATE_001 para todo el lote', async () => {
      await expect(
        service.preview(
          dto([1], { price_tier_action: { mode: 'add', ids: [7, 7] } }),
        ),
      ).rejects.toMatchObject({
        errorCode: ErrorCodes.PROD_VALIDATE_001.code,
      });
    });

    it('tarifa de otra tienda o inexistente ⇒ 400 y consulta scoped por store_id', async () => {
      prisma.price_tiers.findMany.mockResolvedValue([tier(7, 'Mayorista')]);
      const err = await service
        .apply(dto([1], { price_tier_action: { mode: 'add', ids: [7, 99] } }))
        .catch((e) => e);
      expect(err).toBeInstanceOf(VendixHttpException);
      expect(err.errorCode).toBe(ErrorCodes.PROD_VALIDATE_001.code);
      expect(prisma.price_tiers.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: [7, 99] }, store_id: 10 },
        }),
      );
      expect(productsService.update).not.toHaveBeenCalled();
    });

    it('tarifa inactiva en add/replace ⇒ 400 con su nombre', async () => {
      prisma.price_tiers.findMany.mockResolvedValue([
        tier(7, 'Mayorista', false),
      ]);
      await expect(
        service.preview(
          dto([1], { price_tier_action: { mode: 'replace', ids: [7] } }),
        ),
      ).rejects.toThrow(/Mayorista/);
    });

    it('tarifa inactiva en remove ⇒ permitido (limpieza)', async () => {
      prisma.price_tiers.findMany.mockResolvedValue([
        tier(7, 'Mayorista', false),
      ]);
      seedTwoProducts();
      const result = await service.preview(
        dto([1, 2], { price_tier_action: { mode: 'remove', ids: [7] } }),
      );
      expect(result.errors).toBe(0);
    });

    it('flag false explícito + add ⇒ 400 contradictorio', async () => {
      await expect(
        service.preview(
          dto([1], {
            has_multiple_price_tiers: false,
            price_tier_action: { mode: 'add', ids: [7] },
          }),
        ),
      ).rejects.toMatchObject({
        errorCode: ErrorCodes.PROD_VALIDATE_001.code,
      });
    });

    it('sin store en el contexto ⇒ nunca consulta tarifas sin scope', async () => {
      (RequestContextService.getStoreId as jest.Mock).mockReturnValue(
        undefined,
      );
      await service
        .preview(dto([1], { price_tier_action: { mode: 'add', ids: [7] } }))
        .catch(() => undefined);
      expect(prisma.price_tiers.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: [7] }, store_id: -1 },
        }),
      );
    });
  });

  describe('preview y apply comparten resolución', () => {
    beforeEach(() => {
      // Como Prisma: devuelve solo las tarifas pedidas en `where.id.in`.
      const catalog = [tier(7, 'Mayorista'), tier(8, 'Distribuidor')];
      prisma.price_tiers.findMany.mockImplementation(
        async (args: { where: { id: { in: number[] } } }) =>
          catalog.filter((t) => args.where.id.in.includes(t.id)),
      );
      seedTwoProducts();
    });

    it('add: preview cuenta lo mismo que aplica apply y envía has_multiple_price_tiers: true', async () => {
      const changes = { price_tier_action: { mode: 'add', ids: [8] } };
      const preview = await service.preview(dto([1, 2], changes));

      expect(preview.price_tier_changes).toBe(2);
      const item1 = preview.items.find((i) => i.id === 1)!;
      expect(item1.changes).toEqual(
        expect.arrayContaining([
          { field: 'has_multiple_price_tiers', current: false, next: true },
          {
            field: 'price_tiers',
            current: [],
            next: [{ id: 8, name: 'Distribuidor' }],
          },
        ]),
      );

      const result = await service.apply(dto([1, 2], changes));
      expect(result.price_tier_changes).toBe(preview.price_tier_changes);
      expect(productsService.update).toHaveBeenCalledWith(
        1,
        { enabled_price_tier_ids: [8], has_multiple_price_tiers: true },
        expect.anything(),
      );
      // El producto 2 ya tenía el flag: solo cambia el conjunto.
      expect(productsService.update).toHaveBeenCalledWith(
        2,
        { enabled_price_tier_ids: [7, 8] },
        expect.anything(),
      );
    });

    it('replace idempotente: reaplicar no escribe y ambos cuentan 0', async () => {
      prisma.products.findMany.mockResolvedValue([
        product({ id: 2, has_multiple_price_tiers: true }),
      ]);
      const changes = { price_tier_action: { mode: 'replace', ids: [7] } };
      const preview = await service.preview(dto([2], changes));
      const result = await service.apply(dto([2], changes));

      expect(preview.price_tier_changes).toBe(0);
      expect(result.price_tier_changes).toBe(0);
      expect(result.successful).toBe(1);
      expect(productsService.update).not.toHaveBeenCalled();
    });

    it('remove que deja el conjunto vacío no apaga el flag y avisa', async () => {
      const changes = { price_tier_action: { mode: 'remove', ids: [7] } };
      const preview = await service.preview(dto([1, 2], changes));
      const item2 = preview.items.find((i) => i.id === 2)!;
      expect(item2.status).toBe('warning');
      expect(preview.price_tier_changes).toBe(1);

      const result = await service.apply(dto([1, 2], changes));
      expect(result.price_tier_changes).toBe(1);
      expect(productsService.update).toHaveBeenCalledTimes(1);
      expect(productsService.update).toHaveBeenCalledWith(
        2,
        { enabled_price_tier_ids: [] },
        expect.anything(),
      );
    });

    it('producto con variantes sin multi-tarifa ⇒ error en preview y no cuenta', async () => {
      prisma.product_variants.findMany.mockResolvedValue([
        { product_id: 1 },
        { product_id: 1 },
      ]);
      const preview = await service.preview(
        dto([1, 2], { price_tier_action: { mode: 'add', ids: [8] } }),
      );
      const item1 = preview.items.find((i) => i.id === 1)!;
      expect(item1.status).toBe('error');
      expect(item1.code).toBe(
        ErrorCodes.PRODUCT_TIERS_VARIANTS_EXCLUSIVE.code,
      );
      expect(preview.price_tier_changes).toBe(1);
    });

    it('insumo puro neutraliza las tarifas: no se anuncian ni se envían', async () => {
      const changes = {
        is_ingredient: true,
        is_sellable: false,
        price_tier_action: { mode: 'add', ids: [8] },
      };
      prisma.stores.findMany.mockResolvedValue([
        { id: 10, industries: ['restaurant'] },
      ]);
      const preview = await service.preview(dto([1], changes));
      expect(preview.price_tier_changes).toBe(0);
      expect(
        preview.items[0].changes.find((c) => c.field === 'price_tiers'),
      ).toBeUndefined();

      const result = await service.apply(dto([1], changes));
      expect(result.price_tier_changes).toBe(0);
      const payload = productsService.update.mock.calls[0][1];
      expect(payload).not.toHaveProperty('enabled_price_tier_ids');
    });

    it('producto archivado ⇒ apply delega en update() (que lanza) en vez de saltarlo', async () => {
      prisma.products.findMany.mockResolvedValue([
        product({
          id: 2,
          has_multiple_price_tiers: true,
          state: ProductState.ARCHIVED,
        }),
      ]);
      productsService.update.mockRejectedValue(
        new VendixHttpException(ErrorCodes.PROD_FIND_001),
      );
      const result = await service.apply(
        dto([2], { price_tier_action: { mode: 'replace', ids: [7] } }),
      );
      expect(result.failed).toBe(1);
    });
  });

  describe('DTO', () => {
    it('rechaza ids vacíos y modo inválido', async () => {
      const instance = plainToInstance(BulkEditProductsDto, {
        ids: [1],
        changes: { price_tier_action: { mode: 'merge', ids: [] } },
      });
      const errors = await validate(instance);
      expect(JSON.stringify(errors)).toMatch(/al menos una tarifa/);
      expect(JSON.stringify(errors)).toMatch(/add, remove o replace/);
    });
  });
});
