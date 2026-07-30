import { Test, TestingModule } from '@nestjs/testing';
import { ProductsBulkEditService } from './products-bulk-edit.service';
import { ProductsService } from './products.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { ErrorCodes, VendixHttpException } from 'src/common/errors';
import { BulkArchiveProductsDto, BulkEditProductsDto } from './dto';
import { ProductState, ProductType } from './dto/product-enums';

/**
 * Métodos de escritura vigilados en el mock de Prisma. `preview()` es
 * estrictamente read-only: `ProductsService.update()` borra objetos de S3 en
 * fire-and-forget FUERA de la transacción y puede regenerar el link/QR de compra
 * online, así que un dry-run transaccional NO sería reversible.
 */
const WRITE_METHODS = [
  'create',
  'createMany',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
] as const;

const MOCKED_MODELS = [
  'products',
  'stock_reservations',
  'product_variants',
  'recipes',
  'stores',
  // Archivado masivo: pedidos abiertos, insumo de receta activa y promoción
  // vigente. Se añaden al mismo array para que las aserciones de "ninguna
  // escritura" también los cubran.
  'order_items',
  'recipe_items',
  'promotion_products',
] as const;

type MockModel = Record<string, jest.Mock>;
type MockPrisma = Record<string, MockModel> & { $transaction: jest.Mock };

function buildMockPrisma(): MockPrisma {
  const prisma: Record<string, unknown> = {
    $transaction: jest.fn(),
  };
  for (const model of MOCKED_MODELS) {
    const methods: MockModel = {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
    };
    for (const write of WRITE_METHODS) {
      methods[write] = jest.fn();
    }
    prisma[model] = methods;
  }
  return prisma as MockPrisma;
}

/**
 * Fila de `products` con los valores por defecto del schema, para que el diff
 * compare contra algo realista. Los precios se dejan como `number` (el mock no
 * fabrica `Decimal`); el servicio normaliza ambos casos.
 */
function makeProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    store_id: 10,
    name: 'Producto de prueba',
    sku: 'SKU-1',
    state: ProductState.ACTIVE,
    product_type: ProductType.PHYSICAL,
    pricing_type: 'unit',
    is_sellable: true,
    is_ingredient: false,
    is_combo: false,
    is_batch_produced: false,
    track_inventory: true,
    requires_serial_numbers: false,
    base_price: 15000,
    cost_price: 9000,
    profit_margin: null,
    is_on_sale: false,
    sale_price: null,
    allow_pos_price_override: false,
    has_multiple_price_tiers: false,
    available_for_ecommerce: true,
    is_featured: false,
    weight: null,
    dimensions: null,
    stock_uom_id: null,
    purchase_uom_id: null,
    service_duration_minutes: null,
    service_modality: null,
    service_pricing_type: null,
    requires_booking: false,
    booking_mode: 'provider_required',
    is_recurring: false,
    service_instructions: null,
    preparation_time_minutes: null,
    is_consultation: false,
    send_preconsultation: false,
    consultation_template_id: null,
    preconsultation_template_id: null,
    online_purchase_url: null,
    ...overrides,
  };
}

function makeDto(
  ids: number[],
  changes: Record<string, unknown>,
): BulkEditProductsDto {
  return { ids, changes } as BulkEditProductsDto;
}

function makeArchiveDto(ids: number[]): BulkArchiveProductsDto {
  return { ids } as BulkArchiveProductsDto;
}

describe('ProductsBulkEditService', () => {
  let service: ProductsBulkEditService;
  let prisma: MockPrisma;
  let productsService: { update: jest.Mock; remove: jest.Mock };

  beforeEach(async () => {
    prisma = buildMockPrisma();
    productsService = { update: jest.fn(), remove: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsBulkEditService,
        { provide: StorePrismaService, useValue: prisma },
        { provide: ProductsService, useValue: productsService },
      ],
    }).compile();

    service = module.get<ProductsBulkEditService>(ProductsBulkEditService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('preview()', () => {
    it('marca error INV_STOCK_001 cuando el producto tiene reservas de stock activas', async () => {
      prisma.products.findMany.mockResolvedValue([makeProduct({ id: 1 })]);
      prisma.stock_reservations.findMany.mockResolvedValue([{ product_id: 1 }]);

      const result = await service.preview(
        makeDto([1], { state: ProductState.INACTIVE }),
      );

      expect(result.total).toBe(1);
      expect(result.errors).toBe(1);
      expect(result.ok).toBe(0);
      expect(result.items[0].status).toBe('error');
      expect(result.items[0].code).toBe('INV_STOCK_001');
      expect(result.items[0].message).toContain('active stock reservations');
      // La consulta replica el bloqueo del servicio individual: reservas del
      // propio producto (product_variant_id null) en estado activo.
      expect(prisma.stock_reservations.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            product_variant_id: null,
            status: 'active',
          }),
        }),
      );
    });

    it('marca warning cuando se pide is_ingredient=true en una tienda retail', async () => {
      prisma.products.findMany.mockResolvedValue([
        makeProduct({ id: 1, store_id: 10 }),
      ]);
      prisma.stores.findMany.mockResolvedValue([
        { id: 10, industries: ['retail'] },
      ]);

      const result = await service.preview(makeDto([1], { is_ingredient: true }));

      expect(result.warnings).toBe(1);
      expect(result.errors).toBe(0);
      expect(result.items[0].status).toBe('warning');
      expect(result.items[0].message).toContain('no admiten insumos');
      // El flag se neutraliza, así que no queda cambio real que aplicar.
      expect(result.items[0].changes).toEqual([]);
    });

    it('no consulta las industrias de la tienda cuando el payload no pide is_ingredient', async () => {
      prisma.products.findMany.mockResolvedValue([makeProduct({ id: 1 })]);

      await service.preview(makeDto([1], { is_featured: true }));

      expect(prisma.stores.findMany).not.toHaveBeenCalled();
    });

    it('marca error PROD_SVC_HAS_VARIANTS_001 al pasar a servicio un producto con variantes', async () => {
      prisma.products.findMany.mockResolvedValue([
        makeProduct({ id: 1, product_type: ProductType.PHYSICAL }),
      ]);
      prisma.product_variants.findMany.mockResolvedValue([{ product_id: 1 }]);

      const result = await service.preview(
        makeDto([1], { product_type: ProductType.SERVICE }),
      );

      expect(result.errors).toBe(1);
      expect(result.items[0].status).toBe('error');
      expect(result.items[0].code).toBe('PROD_SVC_HAS_VARIANTS_001');
      expect(result.items[0].message).toContain('variantes existentes');
    });

    it('no ejecuta NINGUNA escritura en Prisma', async () => {
      prisma.products.findMany.mockResolvedValue([
        makeProduct({ id: 1, store_id: 10 }),
        makeProduct({ id: 2, store_id: 10, sku: 'SKU-2' }),
      ]);
      prisma.stores.findMany.mockResolvedValue([
        { id: 10, industries: ['restaurant'] },
      ]);
      prisma.stock_reservations.findMany.mockResolvedValue([{ product_id: 2 }]);

      await service.preview(
        makeDto([1, 2], {
          is_ingredient: true,
          is_sellable: false,
          base_price: 500,
        }),
      );

      for (const model of MOCKED_MODELS) {
        for (const write of WRITE_METHODS) {
          expect(prisma[model][write]).not.toHaveBeenCalled();
        }
      }
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(productsService.update).not.toHaveBeenCalled();
    });

    it('reporta error PROD_FIND_001 para ids inexistentes o archivados', async () => {
      prisma.products.findMany.mockResolvedValue([
        makeProduct({ id: 2, state: ProductState.ARCHIVED, name: 'Archivado' }),
      ]);

      const result = await service.preview(
        makeDto([1, 2], { is_featured: true }),
      );

      expect(result.errors).toBe(2);
      expect(result.items[0]).toMatchObject({
        id: 1,
        status: 'error',
        code: 'PROD_FIND_001',
      });
      expect(result.items[1]).toMatchObject({
        id: 2,
        name: 'Archivado',
        status: 'error',
        code: 'PROD_FIND_001',
      });
    });

    it('el diff solo trae los campos que realmente cambian', async () => {
      prisma.products.findMany.mockResolvedValue([
        makeProduct({ id: 1, is_featured: false, base_price: 15000 }),
      ]);

      const result = await service.preview(
        makeDto([1], {
          // ya vale false ⇒ no entra al diff
          is_on_sale: false,
          // cambia ⇒ entra
          is_featured: true,
          // mismo valor numérico ⇒ no entra
          base_price: 15000,
        }),
      );

      expect(result.items[0].status).toBe('ok');
      expect(result.items[0].changes).toEqual([
        { field: 'is_featured', current: false, next: true },
      ]);
    });

    it('normaliza Decimal de Prisma para no producir diffs falsos en precios', async () => {
      // Doble de `Prisma.Decimal`: el servicio lo detecta por `toNumber()`.
      const decimal = { toNumber: () => 15000 };
      prisma.products.findMany.mockResolvedValue([
        makeProduct({ id: 1, base_price: decimal }),
      ]);

      const result = await service.preview(makeDto([1], { base_price: 15000 }));

      expect(result.items[0].status).toBe('ok');
      expect(result.items[0].changes).toEqual([]);
    });

    it('avisa cuando el insumo puro anula precios y flags de venta', async () => {
      prisma.products.findMany.mockResolvedValue([
        makeProduct({
          id: 1,
          store_id: 10,
          base_price: 15000,
          available_for_ecommerce: true,
        }),
      ]);
      prisma.stores.findMany.mockResolvedValue([
        { id: 10, industries: ['restaurant'] },
      ]);

      const result = await service.preview(
        makeDto([1], { is_ingredient: true, is_sellable: false }),
      );

      expect(result.items[0].status).toBe('warning');
      expect(result.items[0].message).toContain('Insumo puro');
      // Las neutralizaciones del sanitizer son cambios reales: deben verse.
      const diffByField = new Map(
        result.items[0].changes.map((change) => [change.field, change]),
      );
      expect(diffByField.get('base_price')).toEqual({
        field: 'base_price',
        current: 15000,
        next: 0,
      });
      expect(diffByField.get('available_for_ecommerce')).toEqual({
        field: 'available_for_ecommerce',
        current: true,
        next: false,
      });
    });

    it('avisa cuando se marca como preparado un producto sin receta activa', async () => {
      prisma.products.findMany.mockResolvedValue([
        makeProduct({ id: 1 }),
        makeProduct({ id: 2, sku: 'SKU-2' }),
      ]);
      prisma.recipes.findMany.mockResolvedValue([{ product_id: 2 }]);

      const result = await service.preview(
        makeDto([1, 2], { product_type: ProductType.PREPARED }),
      );

      expect(result.items[0].status).toBe('warning');
      expect(result.items[0].message).toContain('receta activa');
      expect(result.items[1].status).toBe('ok');
    });

    it('rechaza el lote cuando el payload de servicio trae atributos físicos', async () => {
      await expect(
        service.preview(
          makeDto([1], { product_type: ProductType.SERVICE, weight: 5 }),
        ),
      ).rejects.toMatchObject({ errorCode: 'PROD_SVC_001' });

      // Falla antes de tocar la base: es un defecto del payload compartido.
      expect(prisma.products.findMany).not.toHaveBeenCalled();
    });

    it('fuerza track_inventory=false al pasar a servicio', async () => {
      prisma.products.findMany.mockResolvedValue([
        makeProduct({ id: 1, track_inventory: true }),
      ]);

      const result = await service.preview(
        makeDto([1], { product_type: ProductType.SERVICE }),
      );

      expect(result.items[0].status).toBe('ok');
      expect(result.items[0].changes).toEqual(
        expect.arrayContaining([
          { field: 'track_inventory', current: true, next: false },
        ]),
      );
    });

    it('marca error cuando is_consultation=true sobre un producto que no es servicio', async () => {
      prisma.products.findMany.mockResolvedValue([
        makeProduct({ id: 1, product_type: ProductType.PHYSICAL }),
      ]);

      const result = await service.preview(
        makeDto([1], { is_consultation: true }),
      );

      expect(result.items[0].status).toBe('error');
      expect(result.items[0].code).toBe('PROD_VALIDATE_001');
      expect(result.items[0].message).toBe(
        'Solo los servicios pueden ser consultas',
      );
    });

    it('resuelve las reglas de consulta con el valor efectivo (payload ?? producto)', async () => {
      prisma.products.findMany.mockResolvedValue([
        makeProduct({
          id: 1,
          product_type: ProductType.SERVICE,
          requires_booking: true,
          consultation_template_id: 7,
        }),
      ]);

      const result = await service.preview(
        makeDto([1], { is_consultation: true }),
      );

      expect(result.items[0].status).toBe('ok');
    });
  });

  describe('apply()', () => {
    it('un fallo intermedio no aborta el lote', async () => {
      prisma.products.findMany.mockResolvedValue([
        { id: 1, name: 'Uno' },
        { id: 2, name: 'Dos' },
        { id: 3, name: 'Tres' },
      ]);
      productsService.update
        .mockResolvedValueOnce({ id: 1, name: 'Uno', sku: 'SKU-1' })
        .mockRejectedValueOnce(
          new VendixHttpException(
            ErrorCodes.INV_STOCK_001,
            'Cannot modify product with active stock reservations. Release reservations first.',
          ),
        )
        .mockResolvedValueOnce({ id: 3, name: 'Tres', sku: 'SKU-3' });

      const result = await service.apply(
        makeDto([1, 2, 3], { is_featured: true }),
      );

      expect(result.total).toBe(3);
      expect(result.successful).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.results).toHaveLength(3);
      expect(result.results.map((row) => row.id)).toEqual([1, 2, 3]);
      expect(result.results[0]).toMatchObject({
        id: 1,
        name: 'Uno',
        status: 'ok',
      });
      expect(result.results[1]).toMatchObject({
        id: 2,
        name: 'Dos',
        status: 'error',
        code: 'INV_STOCK_001',
      });
      expect(result.results[1].message).toContain('active stock reservations');
      expect(result.results[2]).toMatchObject({ id: 3, status: 'ok' });
      expect(productsService.update).toHaveBeenCalledTimes(3);
    });

    it('delega en update() con lean:true y el payload de cambios tal cual', async () => {
      prisma.products.findMany.mockResolvedValue([{ id: 1, name: 'Uno' }]);
      productsService.update.mockResolvedValue({
        id: 1,
        name: 'Uno',
        sku: 'SKU-1',
      });

      const dto = makeDto([1], { state: ProductState.INACTIVE });
      await service.apply(dto);

      expect(productsService.update).toHaveBeenCalledWith(1, dto.changes, {
        lean: true,
      });
    });

    it('no escribe Prisma directamente: toda la escritura es de update()', async () => {
      prisma.products.findMany.mockResolvedValue([{ id: 1, name: 'Uno' }]);
      productsService.update.mockResolvedValue({ id: 1, name: 'Uno' });

      await service.apply(makeDto([1], { is_featured: true }));

      for (const model of MOCKED_MODELS) {
        for (const write of WRITE_METHODS) {
          expect(prisma[model][write]).not.toHaveBeenCalled();
        }
      }
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('registra un fallo sin error_code con el mensaje crudo', async () => {
      prisma.products.findMany.mockResolvedValue([{ id: 1, name: 'Uno' }]);
      productsService.update.mockRejectedValue(new Error('boom'));

      const result = await service.apply(makeDto([1], { is_featured: true }));

      expect(result.failed).toBe(1);
      expect(result.results[0]).toMatchObject({
        id: 1,
        name: 'Uno',
        status: 'error',
        message: 'boom',
      });
      expect(result.results[0].code).toBeUndefined();
    });

    it('deduplica ids repetidos para no aplicar dos veces el mismo producto', async () => {
      prisma.products.findMany.mockResolvedValue([{ id: 1, name: 'Uno' }]);
      productsService.update.mockResolvedValue({ id: 1, name: 'Uno' });

      const result = await service.apply(
        makeDto([1, 1, 1], { is_featured: true }),
      );

      expect(productsService.update).toHaveBeenCalledTimes(1);
      expect(result.total).toBe(1);
    });
  });

  describe('previewArchive()', () => {
    it('marca error INV_STOCK_001 cuando el producto tiene reservas de stock activas', async () => {
      prisma.products.findMany.mockResolvedValue([makeProduct({ id: 1 })]);
      prisma.stock_reservations.findMany.mockResolvedValue([{ product_id: 1 }]);

      const result = await service.previewArchive(makeArchiveDto([1]));

      expect(result.total).toBe(1);
      expect(result.errors).toBe(1);
      expect(result.ok).toBe(0);
      expect(result.items[0].status).toBe('error');
      // Mismo código que el bloqueo del servicio individual en `update()`.
      expect(result.items[0].code).toBe('INV_STOCK_001');
      expect(result.items[0].message).toContain('reservas de stock activas');
      // Desviación deliberada frente a `update()`: NO se filtra
      // `product_variant_id: null`. Archivar retira también las variantes, así
      // que una reserva de variante también debe bloquear.
      const where = prisma.stock_reservations.findMany.mock.calls[0][0].where;
      expect(where).toEqual({
        product_id: { in: [1] },
        status: 'active',
      });
      expect(where).not.toHaveProperty('product_variant_id');
    });

    it('marca error cuando el producto está en un pedido abierto', async () => {
      prisma.products.findMany.mockResolvedValue([makeProduct({ id: 1 })]);
      prisma.order_items.findMany.mockResolvedValue([{ product_id: 1 }]);

      const result = await service.previewArchive(makeArchiveDto([1]));

      expect(result.errors).toBe(1);
      expect(result.items[0].status).toBe('error');
      expect(result.items[0].code).toBe('PROD_VALIDATE_001');
      expect(result.items[0].message).toContain('pedidos abiertos');
      // "Abierto" = todo lo que no sea terminal. Réplica de
      // `orders.service.ts:378` y de `order-flow.service.ts:2314`.
      expect(prisma.order_items.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            product_id: { in: [1] },
            orders: {
              state: { notIn: ['finished', 'cancelled', 'refunded'] },
            },
          }),
        }),
      );
    });

    it('marca warning cuando el producto es insumo de una receta activa', async () => {
      prisma.products.findMany.mockResolvedValue([makeProduct({ id: 1 })]);
      prisma.recipe_items.findMany.mockResolvedValue([
        { component_product_id: 1 },
      ]);

      const result = await service.previewArchive(makeArchiveDto([1]));

      expect(result.warnings).toBe(1);
      expect(result.errors).toBe(0);
      expect(result.items[0].status).toBe('warning');
      expect(result.items[0].message).toContain('insumo de una receta activa');
      // Los warnings no llevan código: no son errores.
      expect(result.items[0].code).toBeUndefined();
      // La pregunta es la INVERSA a la del preview de edición: se mira
      // `component_product_id`, no `recipes.product_id`.
      expect(prisma.recipe_items.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            component_product_id: { in: [1] },
            recipe: { is_active: true },
          }),
        }),
      );
    });

    it('marca warning cuando el producto está en una promoción vigente', async () => {
      prisma.products.findMany.mockResolvedValue([makeProduct({ id: 1 })]);
      prisma.promotion_products.findMany.mockResolvedValue([{ product_id: 1 }]);

      const result = await service.previewArchive(makeArchiveDto([1]));

      expect(result.warnings).toBe(1);
      expect(result.items[0].status).toBe('warning');
      expect(result.items[0].message).toContain('promoción vigente');
      // Misma ventana de vigencia que el motor de promociones al cotizar un
      // carrito (`promotion-engine.service.ts:373-375`): `end_date` nulo =
      // sin caducidad, y el límite es inclusivo.
      const where = prisma.promotion_products.findMany.mock.calls[0][0].where;
      expect(where.promotions.state).toEqual({ in: ['active', 'scheduled'] });
      expect(where.promotions.start_date.lte).toBeInstanceOf(Date);
      expect(where.promotions.OR).toEqual([
        { end_date: null },
        { end_date: { gte: where.promotions.start_date.lte } },
      ]);
    });

    it('marca ok un producto sin reservas, pedidos, recetas ni promociones', async () => {
      prisma.products.findMany.mockResolvedValue([makeProduct({ id: 1 })]);

      const result = await service.previewArchive(makeArchiveDto([1]));

      expect(result.total).toBe(1);
      expect(result.ok).toBe(1);
      expect(result.warnings).toBe(0);
      expect(result.errors).toBe(0);
      expect(result.items[0]).toEqual({
        id: 1,
        name: 'Producto de prueba',
        sku: 'SKU-1',
        status: 'ok',
      });
    });

    it('acumula los dos avisos cuando el producto es insumo y está en promoción', async () => {
      prisma.products.findMany.mockResolvedValue([makeProduct({ id: 1 })]);
      prisma.recipe_items.findMany.mockResolvedValue([
        { component_product_id: 1 },
      ]);
      prisma.promotion_products.findMany.mockResolvedValue([{ product_id: 1 }]);

      const result = await service.previewArchive(makeArchiveDto([1]));

      expect(result.items[0].status).toBe('warning');
      expect(result.items[0].message).toContain('insumo de una receta activa');
      expect(result.items[0].message).toContain('promoción vigente');
    });

    it('el bloqueo gana al aviso cuando coinciden en el mismo producto', async () => {
      prisma.products.findMany.mockResolvedValue([makeProduct({ id: 1 })]);
      prisma.stock_reservations.findMany.mockResolvedValue([{ product_id: 1 }]);
      prisma.promotion_products.findMany.mockResolvedValue([{ product_id: 1 }]);

      const result = await service.previewArchive(makeArchiveDto([1]));

      expect(result.items[0].status).toBe('error');
      expect(result.items[0].code).toBe('INV_STOCK_001');
    });

    it('reporta error PROD_FIND_001 para ids inexistentes o ya archivados', async () => {
      prisma.products.findMany.mockResolvedValue([
        makeProduct({ id: 2, state: ProductState.ARCHIVED, name: 'Archivado' }),
      ]);

      const result = await service.previewArchive(makeArchiveDto([1, 2]));

      expect(result.errors).toBe(2);
      expect(result.items[0]).toMatchObject({
        id: 1,
        status: 'error',
        code: 'PROD_FIND_001',
      });
      expect(result.items[1]).toMatchObject({
        id: 2,
        name: 'Archivado',
        status: 'error',
        code: 'PROD_FIND_001',
        message: 'El producto ya está archivado',
      });
    });

    it('no consulta las restricciones cuando ningún id es archivable', async () => {
      prisma.products.findMany.mockResolvedValue([
        makeProduct({ id: 1, state: ProductState.ARCHIVED }),
      ]);

      await service.previewArchive(makeArchiveDto([1]));

      expect(prisma.stock_reservations.findMany).not.toHaveBeenCalled();
      expect(prisma.order_items.findMany).not.toHaveBeenCalled();
      expect(prisma.recipe_items.findMany).not.toHaveBeenCalled();
      expect(prisma.promotion_products.findMany).not.toHaveBeenCalled();
    });

    it('no ejecuta NINGUNA escritura en Prisma', async () => {
      prisma.products.findMany.mockResolvedValue([
        makeProduct({ id: 1 }),
        makeProduct({ id: 2, sku: 'SKU-2' }),
      ]);
      prisma.stock_reservations.findMany.mockResolvedValue([{ product_id: 2 }]);
      prisma.recipe_items.findMany.mockResolvedValue([
        { component_product_id: 1 },
      ]);
      prisma.promotion_products.findMany.mockResolvedValue([{ product_id: 1 }]);

      await service.previewArchive(makeArchiveDto([1, 2]));

      for (const model of MOCKED_MODELS) {
        for (const write of WRITE_METHODS) {
          expect(prisma[model][write]).not.toHaveBeenCalled();
        }
      }
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(productsService.remove).not.toHaveBeenCalled();
      expect(productsService.update).not.toHaveBeenCalled();
    });
  });

  describe('archive()', () => {
    it('un fallo intermedio no aborta el lote', async () => {
      prisma.products.findMany.mockResolvedValue([
        makeProduct({ id: 1, name: 'Uno' }),
        makeProduct({ id: 2, name: 'Dos' }),
        makeProduct({ id: 3, name: 'Tres' }),
      ]);
      productsService.remove
        .mockResolvedValueOnce({ id: 1, name: 'Uno' })
        .mockRejectedValueOnce(
          new VendixHttpException(ErrorCodes.PROD_FIND_001),
        )
        .mockResolvedValueOnce({ id: 3, name: 'Tres' });

      const result = await service.archive(makeArchiveDto([1, 2, 3]));

      expect(result.total).toBe(3);
      expect(result.successful).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.results).toHaveLength(3);
      expect(result.results.map((row) => row.id)).toEqual([1, 2, 3]);
      expect(result.results[0]).toMatchObject({
        id: 1,
        name: 'Uno',
        status: 'ok',
      });
      expect(result.results[1]).toMatchObject({
        id: 2,
        name: 'Dos',
        status: 'error',
        code: 'PROD_FIND_001',
      });
      expect(result.results[2]).toMatchObject({ id: 3, status: 'ok' });
      expect(productsService.remove).toHaveBeenCalledTimes(3);
    });

    it('delega en remove() y no escribe Prisma directamente', async () => {
      prisma.products.findMany.mockResolvedValue([
        makeProduct({ id: 1, name: 'Uno' }),
      ]);
      productsService.remove.mockResolvedValue({ id: 1, name: 'Uno' });

      await service.archive(makeArchiveDto([1]));

      // El soft-delete es la primitiva de `remove()`; el bulk no reescribe
      // `state:'archived'` por su cuenta.
      expect(productsService.remove).toHaveBeenCalledWith(1);
      expect(productsService.remove).toHaveBeenCalledTimes(1);
      for (const model of MOCKED_MODELS) {
        for (const write of WRITE_METHODS) {
          expect(prisma[model][write]).not.toHaveBeenCalled();
        }
      }
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(productsService.update).not.toHaveBeenCalled();
    });

    it('re-verifica los bloqueos y no archiva un producto con reservas activas', async () => {
      // El preview pudo calcularse minutos antes: `remove()` no valida nada, así
      // que la re-verificación es la única barrera en el momento de escribir.
      prisma.products.findMany.mockResolvedValue([
        makeProduct({ id: 1, name: 'Uno' }),
        makeProduct({ id: 2, name: 'Dos' }),
      ]);
      prisma.stock_reservations.findMany.mockResolvedValue([{ product_id: 2 }]);
      productsService.remove.mockResolvedValue({ id: 1, name: 'Uno' });

      const result = await service.archive(makeArchiveDto([1, 2]));

      expect(result.successful).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.results[1]).toMatchObject({
        id: 2,
        name: 'Dos',
        status: 'error',
        code: 'INV_STOCK_001',
      });
      expect(productsService.remove).toHaveBeenCalledTimes(1);
      expect(productsService.remove).toHaveBeenCalledWith(1);
    });

    it('no bloquea por avisos: insumo de receta y promoción vigente sí se archivan', async () => {
      prisma.products.findMany.mockResolvedValue([
        makeProduct({ id: 1, name: 'Uno' }),
      ]);
      prisma.recipe_items.findMany.mockResolvedValue([
        { component_product_id: 1 },
      ]);
      prisma.promotion_products.findMany.mockResolvedValue([{ product_id: 1 }]);
      productsService.remove.mockResolvedValue({ id: 1, name: 'Uno' });

      const result = await service.archive(makeArchiveDto([1]));

      expect(result.successful).toBe(1);
      expect(result.failed).toBe(0);
      expect(productsService.remove).toHaveBeenCalledWith(1);
    });

    it('registra un fallo sin error_code con el mensaje crudo', async () => {
      prisma.products.findMany.mockResolvedValue([
        makeProduct({ id: 1, name: 'Uno' }),
      ]);
      productsService.remove.mockRejectedValue(new Error('boom'));

      const result = await service.archive(makeArchiveDto([1]));

      expect(result.failed).toBe(1);
      expect(result.results[0]).toMatchObject({
        id: 1,
        name: 'Uno',
        status: 'error',
        message: 'boom',
      });
      expect(result.results[0].code).toBeUndefined();
    });

    it('deduplica ids repetidos para no archivar dos veces el mismo producto', async () => {
      prisma.products.findMany.mockResolvedValue([
        makeProduct({ id: 1, name: 'Uno' }),
      ]);
      productsService.remove.mockResolvedValue({ id: 1, name: 'Uno' });

      const result = await service.archive(makeArchiveDto([1, 1, 1]));

      expect(productsService.remove).toHaveBeenCalledTimes(1);
      expect(result.total).toBe(1);
    });
  });
});
