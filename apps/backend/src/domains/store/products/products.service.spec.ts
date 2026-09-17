import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
// The products domain throws typed VendixHttpException (PROD_*): the HTTP status
// travels in the error code, not the exception class.
import { VendixHttpException } from '../../../common/errors/vendix-http.exception';
import { ErrorCodes } from '../../../common/errors/error-codes';
import { ProductsService, MAX_PRODUCT_IDS } from './products.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { ProductVariantService } from './services/product-variant.service';
import { RequestContextService } from '@common/context/request-context.service';
import { InventoryIntegrationService } from '../inventory/shared/services/inventory-integration.service';
import { LocationsService } from '../inventory/locations/locations.service';
import { StockLevelManager } from '../inventory/shared/services/stock-level-manager.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { S3Service } from '@common/services/s3.service';
import { QrService } from '@common/services/qr.service';
import { RemoteImageService } from '@common/services/remote-image.service';
import { S3PathHelper } from '@common/helpers/s3-path.helper';
import { AIEngineService } from '../../../ai-engine/ai-engine.service';
import { PromotionEngineService } from '../promotions/promotion-engine/promotion-engine.service';
import { SettingsService } from '../settings/settings.service';
import { AutoEntryService } from '../accounting/auto-entries/auto-entry.service';
import { InventoryAdjustmentsService } from '../inventory/adjustments/inventory-adjustments.service';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { PosSearchFlagsService } from '../settings/pos-smart-search/pos-search-flags.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  CreateProductDto,
  UpdateProductDto,
  CreateProductVariantDto,
  UpdateProductVariantDto,
  ProductImageDto,
  ProductQueryDto,
  ProductState,
  StockByLocationDto,
} from './dto';

describe('ProductsService', () => {

  // RequestContextService is consumed STATICALLY (RequestContextService.getContext()),
  // so registering it as a Nest provider has no effect — the static must be spied.
  // Without it every write dies on STORE_CONTEXT_001 before reaching its rule.
  beforeEach(() => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 1, organization_id: 1, user_id: 1 } as any);
    jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(1);
    jest
      .spyOn(RequestContextService, 'getOrganizationId')
      .mockReturnValue(1 as any);
    // QUI-727 — default sin roles: el dinero viaja (los tests de cocina lo
    // reprograman a ['kitchen'] por caso).
    jest.spyOn(RequestContextService, 'getRoles').mockReturnValue([]);
  });
  let service: ProductsService;
  let prismaService: StorePrismaService;
  let variantService: ProductVariantService;

  const mockPrismaService = {
    products: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    product_variants: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    product_images: {
      create: jest.fn(),
      delete: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    product_categories: {
      createMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    product_tax_assignments: {
      createMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    stock_levels: {
      createMany: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    // D.8 — la fila de auditoría del archivado se escribe DENTRO de la misma
    // transacción que el castigo y el cambio de estado: si falla, no hay
    // archivado. Por eso el modelo tiene que existir en el doble.
    audit_logs: {
      create: jest.fn(),
    },
    inventory_locations: {
      findMany: jest.fn(),
    },
    categories: {
      findUnique: jest.fn(),
      count: jest.fn(),
    },
    brands: {
      findUnique: jest.fn(),
      count: jest.fn(),
    },
    tax_categories: {
      findMany: jest.fn(),
    },
    domain_settings: {
      findFirst: jest.fn(),
    },
    store_settings: {
      findFirst: jest.fn(),
    },
    stores: {
      findUnique: jest.fn(),
    },
    // Modelos que `ProductsService` toca en los caminos de escritura y que la
    // fixture original no declaraba (el suite fallaba con
    // "Cannot read properties of undefined").
    stock_reservations: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    units_of_measure: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    promotion_products: {
      findMany: jest.fn(),
      createMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    product_price_tier_assignments: {
      createMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    order_items: {
      updateMany: jest.fn(),
    },
    invoice_items: {
      updateMany: jest.fn(),
    },
    quotation_items: {
      updateMany: jest.fn(),
    },
    layaway_items: {
      updateMany: jest.fn(),
    },
    dispatch_note_items: {
      updateMany: jest.fn(),
    },
    inventory_adjustments: {
      updateMany: jest.fn(),
    },
    inventory_transactions: {
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockVariantService = {
    // ProductVariantService exposes *Variant-suffixed methods; the bare
    // create/update/remove names below are legacy and never called.
    createVariant: jest.fn(),
    updateVariant: jest.fn(),
    removeVariant: jest.fn(),
    findByProductId: jest.fn(),
    checkSkuAvailability: jest.fn(),
  };

  const mockInventoryIntegrationService = {
    // Add any methods used by ProductsService
  };

  const mockLocationsService = {
    getDefaultLocation: jest.fn(),
  };

  const mockStockLevelManager = {
    updateStock: jest.fn(),
    initializeStockLevelsForProduct: jest.fn(),
  };

  const mockEventEmitter = {
    emit: jest.fn(),
  };

  const mockS3Service = {
    signUrl: jest.fn((url) => Promise.resolve(url)),
    getPresignedUrl: jest.fn((url) => Promise.resolve(url)),
    uploadBase64: jest.fn(),
    deleteFile: jest.fn(),
  };

  const mockQrService = {
    generateDataUrl: jest.fn((content) =>
      Promise.resolve(
        `data:image/png;base64,${Buffer.from(content).toString('base64')}`,
      ),
    ),
  };

  const mockRemoteImageService = {
    fetchPreview: jest.fn(),
  };

  const mockS3PathHelper = {
    buildProductPath: jest.fn(
      () => 'organizations/org-1/stores/store-1/products',
    ),
  };

  const mockAIEngineService = {
    run: jest.fn(),
  };

  const mockPromotionEngineService = {
    findActiveAutoPromotionsForProducts: jest.fn().mockResolvedValue(new Map()),
  };

  const mockSettingsService = {
    getFiscalData: jest.fn().mockResolvedValue(null),
  };

  /**
   * `ProductsService.create/update` valida la subcuenta PUC del producto contra
   * `chart_of_accounts` antes de escribirla. El doble APRUEBA: si devolviera
   * `undefined` desde un `{}` el servicio reventaría con «is not a function», y
   * si rechazara, todos los casos de creación fallarían por una razón que estos
   * tests no están probando. La validación de la cuenta tiene sus propios casos
   * en `auto-entry.service.spec.ts`.
   */
  const mockAutoEntryService = {
    validateProductAccountCodes: jest.fn().mockResolvedValue(undefined),
  };

  // D.4 — el castigo de inventario del archivado. `createAdjustmentInTransaction`
  // es la primitiva que `remove()` invoca DENTRO de su propia transacción; la
  // emisión del evento contable queda fuera, ya commiteada.
  const mockInventoryAdjustments = {
    createAdjustmentInTransaction: jest.fn(),
    emitInventoryAdjusted: jest.fn(),
  };

  // D.4 — SOLO LECTURA: el detector de existencias fuera del alcance de la
  // tienda (bodega central de la organización u otra tienda). Por defecto no
  // ve nada, que es el caso sano.
  const mockGlobalPrisma = {
    stock_levels: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };

  // B.3 — el @Optional() de `searchFlags` ya no es la única red: el harness
  // provee el servicio mockeado (default-off) y cada test smart lo programa.
  const mockSearchFlags = {
    resolveSearchFlags: jest.fn(),
    resolveSearchPathFor: jest.fn(),
  };

  // B.3 — extraído a const para poder programar hits/miss per-store.
  const mockCacheManager = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn(),
    del: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        {
          provide: StorePrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: ProductVariantService,
          useValue: mockVariantService,
        },
        {
          provide: RequestContextService,
          useValue: {
            getContext: jest.fn().mockReturnValue({
              organization_id: 1,
              store_id: 1,
              user_id: 1,
              is_super_admin: false,
              is_owner: true,
            }),
          },
        },
        {
          provide: InventoryIntegrationService,
          useValue: mockInventoryIntegrationService,
        },
        {
          provide: LocationsService,
          useValue: mockLocationsService,
        },
        {
          provide: StockLevelManager,
          useValue: mockStockLevelManager,
        },
        {
          provide: EventEmitter2,
          useValue: mockEventEmitter,
        },
        {
          provide: S3Service,
          useValue: mockS3Service,
        },
        {
          provide: QrService,
          useValue: mockQrService,
        },
        {
          provide: RemoteImageService,
          useValue: mockRemoteImageService,
        },
        {
          provide: S3PathHelper,
          useValue: mockS3PathHelper,
        },
        {
          provide: AIEngineService,
          useValue: mockAIEngineService,
        },
        {
          provide: PromotionEngineService,
          useValue: mockPromotionEngineService,
        },
        {
          provide: SettingsService,
          useValue: mockSettingsService,
        },
        {
          provide: AutoEntryService,
          useValue: mockAutoEntryService,
        },
        {
          provide: InventoryAdjustmentsService,
          useValue: mockInventoryAdjustments,
        },
        {
          provide: GlobalPrismaService,
          useValue: mockGlobalPrisma,
        },
        // El ranking de más vendidos del POS se cachea 24h por tienda
        // (products.service.ts:237); sin este doble, Nest no resuelve
        // CACHE_MANAGER y el módulo de prueba muere antes de "should be
        // defined". Mismo patrón que organizations.service.spec.ts.
        {
          provide: CACHE_MANAGER,
          useValue: mockCacheManager,
        },
        // B.3 — flags Tier-1 mockeados (default-off en el beforeEach).
        {
          provide: PosSearchFlagsService,
          useValue: mockSearchFlags,
        },
      ],
    }).compile();

    service = module.get<ProductsService>(ProductsService);
    prismaService = module.get<StorePrismaService>(StorePrismaService);
    variantService = module.get<ProductVariantService>(ProductVariantService);
    mockPrismaService.store_settings.findFirst.mockResolvedValue({
      settings: { inventory: { low_stock_threshold: 10 } },
    });
    // `products.findFirst` serves three roles: the duplicate-name guard, the
    // duplicate-SKU guard and every scoped read. Its default has to be "nothing
    // found" — `jest.clearAllMocks()` wipes call history but keeps the
    // implementation, so a row left behind by one test makes the next `create`
    // die on PROD_DUP_001 in a completely unrelated describe.
    mockPrismaService.products.findFirst.mockResolvedValue(null);
    // D.4 — `buildArchiveWriteOffPlans` lee `stock_levels` para saber QUÉ se va
    // a destruir. Sin default, el doble devuelve `undefined` y el plan revienta
    // antes de llegar a la regla que el test quiere probar.
    mockPrismaService.stock_levels.findMany.mockResolvedValue([]);
    mockGlobalPrisma.stock_levels.findMany.mockResolvedValue([]);
    // B.3 — default-off: sin programar, el harness resuelve legacy (mismo
    // comportamiento que cuando el provider no existía).
    mockSearchFlags.resolveSearchFlags.mockResolvedValue({
      l1: false,
      l2: false,
      trigram: false,
    });
    mockSearchFlags.resolveSearchPathFor.mockResolvedValue({
      flags: { l1: false, l2: false, trigram: false },
      trigramCapable: false,
      killSwitch: false,
      path: 'legacy',
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    const createProductDto: CreateProductDto = {
      name: 'Test Product',
      base_price: 99.99,
      sku: 'TEST-001',
      description: 'Test product description',
      store_id: 1,
    };

    it('should create a product successfully', async () => {
      const expectedProduct = {
        id: 1,
        ...createProductDto,
        state: ProductState.ACTIVE,
        slug: 'test-product',
        created_at: new Date(),
        updated_at: new Date(),
        stores: {
          id: 1,
          name: 'Test Store',
          slug: 'test-store',
          organization_id: 1,
        },
        brands: null,
        product_categories: [],
        product_tax_assignments: [],
        product_images: [],
        product_variants: [],
        reviews: [],
        stock_levels: [],
        _count: { product_variants: 0, product_images: 0, reviews: 0 },
        stock_quantity: 0,
        total_stock_available: 0,
        total_stock_reserved: 0,
        stock_by_location: [],
      };

      mockPrismaService.products.create.mockResolvedValue(expectedProduct);
      mockPrismaService.products.findUnique.mockResolvedValue(expectedProduct);
      mockPrismaService.$transaction.mockImplementation((callback) => {
        return callback(mockPrismaService);
      });

      const result = await service.create(createProductDto);

      expect(result).toBeDefined();
      expect(mockPrismaService.products.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: createProductDto.name,
          base_price: createProductDto.base_price,
          sku: createProductDto.sku,
          description: createProductDto.description,
          store_id: createProductDto.store_id,
        }),
      });
    });

    it('should default state to active when caller does not pass one', async () => {
      // FIX — el schema Prisma tiene `@default(active)` (cambiado desde
      // `@default(inactive)` en la migración 20260910200000), pero además el
      // servicio lo fuerza explícitamente para defense in depth: cualquier
      // path que cree productos sin especificar state (CSV import, seed
      // script, mobile) debe terminar con state='active' para que aparezca
      // en el filtro default del listado admin.
      const expectedProduct = {
        id: 1,
        ...createProductDto,
        state: ProductState.ACTIVE,
        slug: 'test-product',
        created_at: new Date(),
        updated_at: new Date(),
        stores: {
          id: 1,
          name: 'Test Store',
          slug: 'test-store',
          organization_id: 1,
        },
        brands: null,
        product_categories: [],
        product_tax_assignments: [],
        product_images: [],
        product_variants: [],
        reviews: [],
        stock_levels: [],
        product_price_tier_assignments: [],
      };

      mockPrismaService.products.create.mockResolvedValue(expectedProduct);

      await service.create(createProductDto as CreateProductDto);

      expect(mockPrismaService.products.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          state: ProductState.ACTIVE,
        }),
      });
    });

    it('should generate slug automatically if not provided', async () => {
      const productWithoutSlug = {
        ...createProductDto,
      };

      delete productWithoutSlug.sku;

      const expectedProduct = {
        id: 1,
        ...productWithoutSlug,
        state: ProductState.ACTIVE,
        slug: 'test-product',
        stores: {
          id: 1,
          name: 'Test Store',
          slug: 'test-store',
          organization_id: 1,
        },
        brands: null,
        product_categories: [],
        product_tax_assignments: [],
        product_images: [],
        product_variants: [],
        reviews: [],
        stock_levels: [],
        _count: { product_variants: 0, product_images: 0, reviews: 0 },
        stock_quantity: 0,
        total_stock_available: 0,
        total_stock_reserved: 0,
        stock_by_location: [],
      };

      mockPrismaService.products.create.mockResolvedValue(expectedProduct);
      mockPrismaService.products.findUnique.mockResolvedValue(expectedProduct);
      mockPrismaService.$transaction.mockImplementation((callback) => {
        return callback(mockPrismaService);
      });

      const result: any = await service.create(productWithoutSlug);

      expect(result).toBeDefined();
      expect(result.slug).toBeDefined();
    });

    it('should throw error if SKU already exists', async () => {
      mockPrismaService.products.findFirst.mockResolvedValue({ id: 1 });
      mockPrismaService.$transaction.mockImplementation((callback) => {
        return callback(mockPrismaService);
      });

      await expect(service.create(createProductDto)).rejects.toThrow(
        VendixHttpException,
      );
    });

    it('should handle product with categories and tax assignments', async () => {
      const productWithCategories: CreateProductDto = {
        ...createProductDto,
        category_ids: [1, 2],
        tax_category_ids: [3, 4],
      };

      const expectedProduct = {
        id: 1,
        ...productWithCategories,
        state: ProductState.ACTIVE,
        stock_levels: [],
        product_variants: [],
        product_images: [],
        _count: { product_variants: 0, product_images: 0, reviews: 0 },
      };

      mockPrismaService.products.create.mockResolvedValue(expectedProduct);
      mockPrismaService.products.findUnique.mockResolvedValue(expectedProduct);
      // Existence pre-check for the tax categories: create() compares the rows
      // it found against the requested ids and names the missing ones, so an
      // unmocked findMany makes it fail on `.length` of undefined before ever
      // reaching product_tax_assignments.createMany.
      mockPrismaService.tax_categories.findMany.mockResolvedValue([
        { id: 3 },
        { id: 4 },
      ]);
      mockPrismaService.$transaction.mockImplementation((callback) => {
        return callback(mockPrismaService);
      });

      await service.create(productWithCategories);

      expect(
        mockPrismaService.product_categories.createMany,
      ).toHaveBeenCalledWith({
        data: [
          { category_id: 1, product_id: 1 },
          { category_id: 2, product_id: 1 },
        ],
      });

      expect(
        mockPrismaService.product_tax_assignments.createMany,
      ).toHaveBeenCalledWith({
        data: [
          { tax_category_id: 3, product_id: 1 },
          { tax_category_id: 4, product_id: 1 },
        ],
      });
    });
  });

  describe('findAll', () => {
    const query: ProductQueryDto = {
      page: 1,
      limit: 10,
      search: 'test',
    };

    it('should return paginated products', async () => {
      const mockProducts = [
        {
          id: 1,
          name: 'Test Product 1',
          base_price: 99.99,
          state: ProductState.ACTIVE,
          // findAll enriches every row with aggregated stock; the enricher
          // reduces over stock_levels, so the array must exist.
          stock_levels: [],
        },
        {
          id: 2,
          name: 'Test Product 2',
          base_price: 149.99,
          state: ProductState.ACTIVE,
          stock_levels: [],
        },
      ];

      mockPrismaService.products.findMany.mockResolvedValue(mockProducts);
      mockPrismaService.products.count.mockResolvedValue(2);

      const result = await service.findAll(query);

      // findAll returns a projection, not the Prisma row: it flattens brand and
      // categories, resolves the active promotion, and derives final_price /
      // available_stock. Asserting deep equality against the fixture would pin
      // all ~40 projected keys and break on any column addition, so the contract
      // checked here is identity + the derived fields this suite cares about.
      expect(result.data).toHaveLength(2);
      expect(result.data[0]).toEqual(
        expect.objectContaining({
          id: 1,
          name: 'Test Product 1',
          base_price: 99.99,
          state: ProductState.ACTIVE,
          final_price: 99.99,
          active_promotion: null,
        }),
      );
      expect(result.data[1]).toEqual(
        expect.objectContaining({ id: 2, name: 'Test Product 2' }),
      );
      // B.3 (ADR-08) — con `search` el meta trae `search` aunque el path sea
      // legacy: el query del test trae search:'test' y los flags van off.
      expect(result.meta).toEqual({
        total: 2,
        page: 1,
        limit: 10,
        totalPages: 1,
        search: { rank_mode: 'legacy', layer: 'legacy', degraded: false },
      });
    });

    it('should apply search filter correctly', async () => {
      const searchQuery: ProductQueryDto = {
        search: 'laptop',
        page: 1,
        limit: 10,
      };

      mockPrismaService.products.findMany.mockResolvedValue([]);
      mockPrismaService.products.count.mockResolvedValue(0);

      await service.findAll(searchQuery);

      expect(mockPrismaService.products.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          OR: [
            { name: { contains: 'laptop', mode: 'insensitive' } },
            { description: { contains: 'laptop', mode: 'insensitive' } },
            { sku: { contains: 'laptop', mode: 'insensitive' } },
          ],
        }),
        include: expect.any(Object),
        skip: 0,
        take: 10,
        orderBy: { created_at: 'desc' },
      });
    });

    it('should include variants when requested', async () => {
      const variantsQuery: ProductQueryDto = {
        include_variants: true,
        page: 1,
        limit: 10,
      };

      // Both the Prisma relation and the projected key are `product_variants`;
      // `variants` is not part of the contract on either side.
      const mockProduct = {
        id: 1,
        name: 'Test Product',
        stock_levels: [],
        product_variants: [
          { id: 1, sku: 'VAR-001', price_override: 109.99, stock_levels: [] },
          { id: 2, sku: 'VAR-002', price_override: 119.99, stock_levels: [] },
        ],
      };

      mockPrismaService.products.findMany.mockResolvedValue([mockProduct]);
      mockPrismaService.products.count.mockResolvedValue(1);

      const result = await service.findAll(variantsQuery);

      expect(result.data[0].product_variants).toBeDefined();
      expect(result.data[0].product_variants).toHaveLength(2);
      // has_variants is derived from the mapped array, and only appears when
      // include_variants was requested — that flag is what the admin grid reads.
      expect(result.data[0].has_variants).toBe(true);
    });
  });

  describe('findOne', () => {
    it('should return a product by ID', async () => {
      const storedProduct = {
        id: 1,
        store_id: 1,
        name: 'Test Product',
        base_price: 99.99,
        state: ProductState.ACTIVE,
        // The reader reduces over stock_levels to derive the stock totals, so
        // the relation must exist even when empty.
        stock_levels: [],
        product_variants: [],
        product_images: [],
        product_categories: [],
        _count: { product_variants: 0, product_images: 0, reviews: 0 },
      };

      // findFirst, not findUnique: the read carries `state: { not: archived }`
      // alongside the id, which findUnique cannot express.
      mockPrismaService.products.findFirst.mockResolvedValue(storedProduct);

      const result = await service.findOne(1);

      // Doble cinturón de tenant: el cliente Prisma ya inyecta store_id, y
      // findOne lo vuelve a poner desde el contexto ALS salvo super admin —
      // un super admin sale del scope del cliente, así que la cláusula
      // explícita es la que impide leer productos de otra tienda.
      expect(mockPrismaService.products.findFirst).toHaveBeenCalledWith({
        where: { id: 1, state: { not: ProductState.ARCHIVED }, store_id: 1 },
        include: expect.any(Object),
      });
      // findOne returns an enriched projection: identity plus derived stock.
      expect(result).toEqual(
        expect.objectContaining({
          id: 1,
          name: 'Test Product',
          base_price: 99.99,
          total_stock_available: 0,
          total_stock_reserved: 0,
        }),
      );
    });

    it('should throw VendixHttpException if product not found', async () => {
      mockPrismaService.products.findFirst.mockResolvedValue(null);

      await expect(service.findOne(999)).rejects.toThrow(VendixHttpException);
    });
  });

  describe('update', () => {
    const updateDto: UpdateProductDto = {
      name: 'Updated Product',
      base_price: 149.99,
    };

    it('should update a product successfully', async () => {
      // update() cierra devolviendo findOne(id): la misma fila se lee dos veces
      // (guard de existencia + relectura enriquecida), así que la fixture debe
      // traer las relaciones que el enriquecedor recorre.
      const existingProduct = {
        id: 1,
        store_id: 1,
        name: 'Original Product',
        base_price: 99.99,
        state: ProductState.ACTIVE,
        stock_levels: [],
        product_variants: [],
        product_images: [],
        _count: { product_variants: 0, product_images: 0, reviews: 0 },
      };

      const updatedProduct = {
        ...existingProduct,
        ...updateDto,
      };

      mockPrismaService.products.findFirst.mockResolvedValue(existingProduct);
      mockPrismaService.$transaction.mockImplementation((callback) => {
        return callback(mockPrismaService);
      });
      mockPrismaService.products.update.mockResolvedValue(updatedProduct);

      const result = await service.update(1, updateDto);

      // Lo que vuelve es la proyección de findOne, no la fila de products.update.
      expect(result).toEqual(expect.objectContaining({ id: 1 }));
      expect(mockPrismaService.products.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: expect.objectContaining({
          name: updateDto.name,
          base_price: updateDto.base_price,
        }),
      });
    });

    it('should throw VendixHttpException if product to update not found', async () => {
      mockPrismaService.products.findFirst.mockResolvedValue(null);

      await expect(service.update(999, updateDto)).rejects.toThrow(
        VendixHttpException,
      );
    });

    it('should handle slug changes', async () => {
      const updateWithSlug: UpdateProductDto = {
        name: 'New Product Name',
        slug: 'new-product-slug',
      };

      const existingProduct = {
        id: 1,
        store_id: 1,
        name: 'Original Product',
        slug: 'original-product',
        state: ProductState.ACTIVE,
        stock_levels: [],
        product_variants: [],
        product_images: [],
        _count: { product_variants: 0, product_images: 0, reviews: 0 },
      };

      // 1ª llamada: el producto a actualizar. 2ª: el chequeo de unicidad del
      // slug dentro de la tienda (null = libre). 3ª: la relectura de findOne
      // con la que update() cierra. Todas son findFirst — findUnique no puede
      // expresar el filtro de estado ni el scope de tienda.
      mockPrismaService.products.findFirst
        .mockResolvedValueOnce(existingProduct)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(existingProduct);
      mockPrismaService.$transaction.mockImplementation((callback) => {
        return callback(mockPrismaService);
      });

      await service.update(1, updateWithSlug);

      expect(mockPrismaService.products.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: expect.objectContaining({
          slug: 'new-product-slug',
        }),
      });
    });
  });

  describe('deactivate', () => {
    it('should deactivate a product successfully', async () => {
      const existingProduct = {
        id: 1,
        name: 'Test Product',
        state: ProductState.ACTIVE,
      };

      mockPrismaService.products.findFirst.mockResolvedValue(existingProduct);
      mockPrismaService.products.update.mockResolvedValue({
        ...existingProduct,
        state: ProductState.INACTIVE,
      });

      await service.deactivate(1);

      expect(mockPrismaService.products.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { state: ProductState.INACTIVE, updated_at: expect.any(Date) },
      });
    });

    it('should throw VendixHttpException if product not found', async () => {
      mockPrismaService.products.findFirst.mockResolvedValue(null);

      await expect(service.deactivate(999)).rejects.toThrow(VendixHttpException);
    });
  });

  describe('remove', () => {
    // `remove` is a LOGICAL delete: it archives. A product is referenced by
    // order_items, invoice_items and inventory_transactions, so physically
    // deleting the row would orphan historical documents. Hard deletion lives
    // behind a separate `admin_delete` path with its own permission.
    it('should archive the product instead of deleting the row', async () => {
      const existingProduct = {
        id: 1,
        store_id: 1,
        name: 'Test Product',
        state: ProductState.ACTIVE,
        stock_levels: [],
        product_variants: [],
        _count: { product_variants: 0, product_images: 0, reviews: 0 },
      };

      // remove() delegates existence checking to findOne(), which reads through
      // findFirst and enriches with stock — hence the relations above.
      mockPrismaService.products.findFirst.mockResolvedValue(existingProduct);
      mockPrismaService.$transaction.mockImplementation((callback) => {
        return callback(mockPrismaService);
      });
      mockPrismaService.products.update.mockResolvedValue({
        ...existingProduct,
        state: 'archived',
      });

      await service.remove(1);

      expect(mockPrismaService.products.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { state: 'archived', updated_at: expect.any(Date) },
      });
      expect(mockPrismaService.products.delete).not.toHaveBeenCalled();
    });

    it('should throw VendixHttpException if product to delete not found', async () => {
      mockPrismaService.products.findFirst.mockResolvedValue(null);

      await expect(service.remove(999)).rejects.toThrow(VendixHttpException);
    });
  });

  // ===========================================================================
  // D.4 / D.7 / D.8 — archivar con existencias
  // ===========================================================================
  // El defecto de origen: archivar dejaba las existencias colgando invisibles y
  // el promedio ponderado las seguía contando, así que recomprar un producto
  // «borrado» lo costeaba contra inventario fantasma. La decisión es castigar
  // el inventario al archivar; lo que estos tests protegen es que el castigo
  // sea VISIBLE y CONSENTIDO antes de ocurrir, y trazable después.
  describe('remove — castigo de inventario del archivado (D.4/D.7/D.8)', () => {
    const productWithStock = {
      id: 7,
      store_id: 1,
      name: 'Cerveza 330ml',
      sku: 'CER-330',
      state: 'active',
      cost_price: 1200,
      stock_quantity: 30,
      track_inventory: true,
    };

    const stockRow = (overrides: any = {}) => ({
      product_id: 7,
      location_id: 4,
      product_variant_id: null,
      quantity_on_hand: 30,
      cost_per_unit: 1000,
      inventory_locations: { id: 4, name: 'Bodega tienda', store_id: 1 },
      product_variants: null,
      ...overrides,
    });

    beforeEach(() => {
      mockPrismaService.products.findFirst.mockResolvedValue(productWithStock);
      mockPrismaService.stock_reservations.findFirst.mockResolvedValue(null);
      mockPrismaService.products.update.mockResolvedValue({
        ...productWithStock,
        state: 'archived',
      });
      mockPrismaService.audit_logs.create.mockResolvedValue({ id: 1 });
      mockPrismaService.$transaction.mockImplementation((callback: any) =>
        callback(mockPrismaService),
      );
      mockInventoryAdjustments.createAdjustmentInTransaction.mockResolvedValue({
        adjustment: { id: 55 },
        quantity_change: -30,
        cost_amount: -30000,
      });
    });

    it('sin existencias archiva igual, pero AHORA deja fila de auditoría', async () => {
      mockPrismaService.stock_levels.findMany.mockResolvedValue([]);

      await service.remove(7);

      expect(
        mockInventoryAdjustments.createAdjustmentInTransaction,
      ).not.toHaveBeenCalled();
      expect(mockPrismaService.products.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: { state: 'archived', updated_at: expect.any(Date) },
      });
      expect(mockPrismaService.audit_logs.create).toHaveBeenCalledTimes(1);
    });

    it('con existencias y SIN confirmación rechaza 409 y devuelve el plan completo', async () => {
      mockPrismaService.stock_levels.findMany.mockResolvedValue([stockRow()]);

      let thrown: any;
      await service.remove(7).catch((error) => {
        thrown = error;
      });

      expect(thrown).toBeInstanceOf(VendixHttpException);
      expect(thrown.getStatus()).toBe(409);
      const details = (thrown.getResponse() as any)?.details;
      expect(details.archive_write_off).toEqual(
        expect.objectContaining({
          product_id: 7,
          requires_confirmation: true,
          total_units: 30,
          total_value: 30000,
          zero_cost_units: 0,
        }),
      );
      expect(details.archive_write_off.lines).toEqual([
        expect.objectContaining({
          location_id: 4,
          location_name: 'Bodega tienda',
          quantity_on_hand: 30,
          unit_cost: 1000,
          value: 30000,
          has_known_cost: true,
        }),
      ]);
      // Nada se tocó: el rechazo es ANTES de la transacción.
      expect(mockPrismaService.products.update).not.toHaveBeenCalled();
      expect(
        mockInventoryAdjustments.createAdjustmentInTransaction,
      ).not.toHaveBeenCalled();
    });

    it('con confirmación castiga a cero, archiva DESPUÉS y audita, todo en una transacción', async () => {
      // `cost_price: 0` en el producto es DELIBERADO: la cadena canónica cae
      // `stock_levels.cost_per_unit -> variante -> producto`, así que sin este
      // cero la segunda línea heredaría el costo del producto y el caso del
      // 63,9 % de unidades sin costo no se probaría nunca.
      mockPrismaService.products.findFirst.mockResolvedValue({
        ...productWithStock,
        cost_price: 0,
      });
      mockPrismaService.stock_levels.findMany.mockResolvedValue([
        stockRow(),
        stockRow({
          location_id: 9,
          product_variant_id: 21,
          quantity_on_hand: 5,
          cost_per_unit: 0,
          inventory_locations: { id: 9, name: 'Mostrador', store_id: 1 },
          product_variants: { sku: 'CER-330-L', cost_price: 0 },
        }),
      ]);

      await service.remove(7, { confirm_stock_write_off: true });

      expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(1);
      expect(
        mockInventoryAdjustments.createAdjustmentInTransaction,
      ).toHaveBeenCalledTimes(2);
      expect(
        mockInventoryAdjustments.createAdjustmentInTransaction,
      ).toHaveBeenNthCalledWith(
        1,
        mockPrismaService,
        expect.objectContaining({
          product_id: 7,
          location_id: 4,
          type: 'loss',
          quantity_after: 0,
          reason_code: 'product_archived',
        }),
        expect.anything(),
      );
      // La variante viaja: sin ella el ajuste castigaría la fila equivocada.
      expect(
        mockInventoryAdjustments.createAdjustmentInTransaction,
      ).toHaveBeenNthCalledWith(
        2,
        mockPrismaService,
        expect.objectContaining({
          product_variant_id: 21,
          location_id: 9,
          quantity_after: 0,
        }),
        expect.anything(),
      );

      // DB-16: el estado se escribe DESPUÉS de las bajas.
      const updateOrder =
        mockPrismaService.products.update.mock.invocationCallOrder[0];
      const lastAdjustmentOrder =
        mockInventoryAdjustments.createAdjustmentInTransaction.mock
          .invocationCallOrder[1];
      expect(updateOrder).toBeGreaterThan(lastAdjustmentOrder);

      const auditRow =
        mockPrismaService.audit_logs.create.mock.calls[0][0].data;
      expect(auditRow.action).toBe('PRODUCT_ARCHIVE');
      expect(auditRow.resource).toBe('products');
      expect(auditRow.resource_id).toBe(7);
      expect(auditRow.store_id).toBe(1);
      expect(auditRow.metadata.confirmation).toEqual(
        expect.objectContaining({
          confirmed: true,
          required: true,
          approved_units: 35,
        }),
      );
      // El 63,9 % de las unidades fantasma no tiene costo: la fila lo dice en
      // vez de dejar que el silencio del asiento contable lo esconda.
      expect(auditRow.metadata.write_off.zero_cost_units).toBe(5);

      // El evento contable se emite DESPUÉS del commit, uno por ajuste.
      expect(mockInventoryAdjustments.emitInventoryAdjusted).toHaveBeenCalledTimes(
        2,
      );
    });

    it('las existencias fuera del alcance de la tienda BLOQUEAN aunque haya confirmación', async () => {
      mockPrismaService.stock_levels.findMany.mockResolvedValue([stockRow()]);
      mockGlobalPrisma.stock_levels.findMany.mockResolvedValue([
        {
          product_id: 7,
          location_id: 99,
          quantity_on_hand: 1386,
          inventory_locations: {
            id: 99,
            name: 'Bodega central',
            store_id: null,
          },
        },
      ]);

      await expect(
        service.remove(7, { confirm_stock_write_off: true }),
      ).rejects.toThrow(VendixHttpException);

      expect(mockPrismaService.products.update).not.toHaveBeenCalled();
    });

    it('D.7: las reservas activas rechazan con PROD_HAS_RESERVATIONS_001', async () => {
      mockPrismaService.stock_reservations.findFirst.mockResolvedValue({
        id: 3,
      });

      let thrown: any;
      await service.remove(7).catch((error) => {
        thrown = error;
      });

      expect(thrown).toBeInstanceOf(VendixHttpException);
      expect(thrown.errorCode).toBe(
        ErrorCodes.PROD_HAS_RESERVATIONS_001.code,
      );
      expect(mockPrismaService.products.update).not.toHaveBeenCalled();
    });

    it('D.8: si la auditoría falla, el archivado entero revierte y no se emite evento', async () => {
      mockPrismaService.stock_levels.findMany.mockResolvedValue([stockRow()]);
      mockPrismaService.audit_logs.create.mockRejectedValue(
        new Error('audit_logs down'),
      );

      await expect(
        service.remove(7, { confirm_stock_write_off: true }),
      ).rejects.toThrow('audit_logs down');

      expect(
        mockInventoryAdjustments.emitInventoryAdjusted,
      ).not.toHaveBeenCalled();
    });
  });

  // Variant CRUD moved out of ProductsService: these three methods are pure
  // delegations to ProductVariantService, which owns SKU uniqueness, the
  // attribute matrix and the stock_levels rows. The contract to protect here is
  // therefore the delegation itself (right collaborator, right arguments, value
  // passed through untouched) — asserting `product_variants.create` again would
  // duplicate ProductVariantService's own spec and break on every refactor there.
  describe('VARIANTS OPERATIONS', () => {
    const createVariantDto: CreateProductVariantDto = {
      sku: 'TEST-VAR-001',
      name: 'Test Variant',
      price_override: 109.99,
      stock_quantity: 50,
      attributes: { color: 'red', size: 'L' },
    };

    it('should delegate variant creation and return the variant', async () => {
      const expectedVariant = {
        id: 1,
        product_id: 1,
        ...createVariantDto,
      };

      mockVariantService.createVariant.mockResolvedValue(expectedVariant);

      const result = await service.createVariant(1, createVariantDto);

      expect(result).toEqual(expectedVariant);
      expect(mockVariantService.createVariant).toHaveBeenCalledWith(
        1,
        createVariantDto,
      );
    });

    it('should propagate the collaborator rejection when the product does not exist', async () => {
      // Product existence is validated inside ProductVariantService, so the
      // failure surfaces here as a rejection travelling through the delegation.
      mockVariantService.createVariant.mockRejectedValue(
        new VendixHttpException(ErrorCodes.PROD_FIND_001),
      );

      await expect(
        service.createVariant(999, createVariantDto),
      ).rejects.toThrow(VendixHttpException);
    });

    it('should delegate variant update and return the updated variant', async () => {
      const updateVariantDto: UpdateProductVariantDto = {
        price_override: 119.99,
        stock_quantity: 45,
      };

      const updatedVariant = {
        id: 1,
        sku: 'TEST-VAR-001',
        ...updateVariantDto,
      };

      mockVariantService.updateVariant.mockResolvedValue(updatedVariant);

      const result = await service.updateVariant(1, updateVariantDto);

      expect(result).toEqual(updatedVariant);
      expect(mockVariantService.updateVariant).toHaveBeenCalledWith(
        1,
        updateVariantDto,
      );
    });

    it('should delegate variant removal', async () => {
      mockVariantService.removeVariant.mockResolvedValue({ id: 1 });

      await service.removeVariant(1);

      expect(mockVariantService.removeVariant).toHaveBeenCalledWith(1);
    });
  });

  describe('PRODUCT IMAGES', () => {
    const imageDto: ProductImageDto = {
      image_url: 'https://example.com/image.jpg',
      is_main: true,
      alt_text: 'Product image',
    };

    it('should add an image to product', async () => {
      const expectedImage = {
        id: 1,
        product_id: 1,
        ...imageDto,
      };

      const existingProduct = {
        id: 1,
        name: 'Test Product',
      };

      mockPrismaService.products.findFirst.mockResolvedValue(existingProduct);
      mockPrismaService.$transaction.mockImplementation((callback) => {
        return callback(mockPrismaService);
      });
      mockPrismaService.product_images.create.mockResolvedValue(expectedImage);

      const result = await service.addImage(1, imageDto);

      expect(result).toEqual(expectedImage);
      expect(mockPrismaService.product_images.create).toHaveBeenCalledWith({
        data: {
          product_id: 1,
          image_url: imageDto.image_url,
          is_main: imageDto.is_main,
          alt_text: imageDto.alt_text,
        },
      });
    });

    it('should set image as main if is_main is true', async () => {
      const imageDtoWithMain: ProductImageDto = {
        image_url: 'https://example.com/image.jpg',
        is_main: true,
      };

      const existingProduct = {
        id: 1,
        name: 'Test Product',
      };

      mockPrismaService.products.findFirst.mockResolvedValue(existingProduct);
      mockPrismaService.$transaction.mockImplementation((callback) => {
        return callback(mockPrismaService);
      });
      mockPrismaService.product_images.updateMany.mockResolvedValue({
        count: 1,
      });
      mockPrismaService.product_images.create.mockResolvedValue({
        id: 1,
        ...imageDtoWithMain,
      });

      await service.addImage(1, imageDtoWithMain);

      expect(mockPrismaService.product_images.updateMany).toHaveBeenCalledWith({
        where: { product_id: 1 },
        data: { is_main: false },
      });
    });
  });

  describe('getProductStats', () => {
    it('should return product statistics for store', async () => {
      // CP-PURCHASE-TRANSPARENCY D.3 — el archivado (10 × 20 = 200) SALE de
      // las cuatro cifras agregadas y viaja etiquetado aparte. Antes de D.3
      // este bloque afirmaba `total_value: 500`, `low_stock_products: 3` y
      // `products_without_images: 3`, es decir el arnés daba fe de que el
      // panel sumara existencia fantasma.
      const expectedStats = {
        total_products: 3,
        active_products: 2,
        inactive_products: 1,
        archived_products: 1,
        low_stock_products: 2,
        out_of_stock_products: 1,
        products_without_images: 2,
        total_value: 300,
        categories_count: 2,
        brands_count: 1,
        archived_stock_value: 200,
        archived_stock_units: 10,
      };

      mockPrismaService.products.findMany.mockResolvedValue([
        {
          state: ProductState.ACTIVE,
          stock_quantity: 2,
          base_price: 100,
          product_images: [],
        },
        {
          state: ProductState.ACTIVE,
          stock_quantity: 0,
          base_price: 100,
          product_images: [{ id: 1 }],
        },
        {
          state: ProductState.INACTIVE,
          stock_quantity: 5,
          base_price: 20,
          product_images: [],
        },
        {
          state: ProductState.ARCHIVED,
          stock_quantity: 10,
          base_price: 20,
          product_images: [],
        },
      ]);
      mockPrismaService.categories.count.mockResolvedValue(2);
      mockPrismaService.brands.count.mockResolvedValue(1);

      const result = await service.getProductStats(1);

      expect(result).toEqual(expectedStats);
    });

    it('should use store low stock threshold when product threshold is not set', async () => {
      mockPrismaService.store_settings.findFirst.mockResolvedValue({
        settings: { inventory: { low_stock_threshold: 8 } },
      });
      mockPrismaService.products.findMany.mockResolvedValue([
        {
          state: ProductState.ACTIVE,
          stock_quantity: 8,
          min_stock_level: 0,
          reorder_point: 0,
          base_price: 10,
          product_images: [],
        },
        {
          state: ProductState.ACTIVE,
          stock_quantity: 9,
          min_stock_level: 0,
          reorder_point: 0,
          base_price: 10,
          product_images: [],
        },
      ]);
      mockPrismaService.categories.count.mockResolvedValue(0);
      mockPrismaService.brands.count.mockResolvedValue(0);

      const result = await service.getProductStats(1);

      expect(result.low_stock_products).toBe(1);
    });
  });

  /**
   * CP-PURCHASE-TRANSPARENCY D.3 — las cifras AGREGADAS excluyen archivados.
   *
   * EL DEFECTO QUE CIERRA
   * ---------------------
   * Archivar un producto nunca borró su `stock_quantity`. D.2 sacó esas
   * unidades del motor de COSTEO, pero el panel las seguía LEYENDO como
   * existencia real. Medido en la base local (tienda 10): `total_value`
   * 16.362.306.320 con 5.040.064.000 aportados por 25 productos archivados.
   *
   * LA LÍNEA QUE NO SE CRUZA
   * ------------------------
   * El criterio es de AGREGADO, no de visibilidad. `archived_products` sigue
   * contando, `archived_stock_value` publica lo que se restó, y las lecturas
   * de DETALLE (listado con `state=archived`, vista previa del castigo) siguen
   * devolviendo los datos del archivado. Un archivado existió: esconderlo
   * rompería la trazabilidad tanto como sumarlo rompía el total.
   */
  describe('getProductStats — el archivado sale del agregado (D.3)', () => {
    const producto = (over: Partial<any> = {}) => ({
      state: ProductState.ACTIVE,
      stock_quantity: 0,
      base_price: 0,
      product_images: [{ id: 1 }],
      ...over,
    });

    beforeEach(() => {
      mockPrismaService.categories.count.mockResolvedValue(0);
      mockPrismaService.brands.count.mockResolvedValue(0);
      mockPrismaService.store_settings.findFirst.mockResolvedValue({
        settings: { inventory: { low_stock_threshold: 5 } },
      });
    });

    it('EL DEFECTO: un archivado con existencia ya no infla total_value', async () => {
      mockPrismaService.products.findMany.mockResolvedValue([
        producto({ stock_quantity: 3, base_price: 1000 }),
        producto({
          state: ProductState.ARCHIVED,
          stock_quantity: 20000,
          base_price: 3,
        }),
      ]);

      const result = await service.getProductStats(1);

      // 3 × 1.000. Las 20.000 unidades fantasma a 3,00 ya no entran.
      expect(result.total_value).toBe(3000);
      // Y no desaparecen sin rastro: viajan etiquetadas.
      expect(result.archived_stock_value).toBe(60000);
      expect(result.archived_stock_units).toBe(20000);
    });

    it('un producto activo con existencia da exactamente la misma cifra que antes', async () => {
      mockPrismaService.products.findMany.mockResolvedValue([
        producto({ stock_quantity: 14, base_price: 1620000 }),
      ]);

      const result = await service.getProductStats(1);

      expect(result.total_value).toBe(22680000);
      expect(result.archived_stock_value).toBe(0);
      expect(result.archived_stock_units).toBe(0);
    });

    it('el archivado tampoco cuenta como «sin stock», «bajo mínimo» ni «sin imagen»', async () => {
      mockPrismaService.products.findMany.mockResolvedValue([
        producto({
          state: ProductState.ARCHIVED,
          stock_quantity: 0,
          product_images: [],
        }),
        producto({
          state: ProductState.ARCHIVED,
          stock_quantity: 2,
          base_price: 10,
          product_images: [],
        }),
      ]);

      const result = await service.getProductStats(1);

      expect(result.out_of_stock_products).toBe(0);
      expect(result.low_stock_products).toBe(0);
      expect(result.products_without_images).toBe(0);
      // Pero siguen existiendo, y el panel puede decirlo.
      expect(result.archived_products).toBe(2);
    });

    it('una tienda cuyo valor es TODO archivado cae a cero limpio, sin NaN', async () => {
      // Caso límite real: en producción hay organizaciones donde lo archivado
      // es el 100 % del valor mostrado. Pasan de una cifra a cero exacto — no
      // a NaN, no a null, no a una división por cero.
      mockPrismaService.products.findMany.mockResolvedValue([
        producto({
          state: ProductState.ARCHIVED,
          stock_quantity: 500,
          base_price: 8453,
        }),
      ]);

      const result = await service.getProductStats(1);

      expect(result.total_value).toBe(0);
      expect(Number.isNaN(result.total_value)).toBe(false);
      expect(result.total_products).toBe(0);
      expect(result.archived_stock_value).toBe(4226500);
      expect(result.archived_stock_units).toBe(500);
    });

    it('un stock_quantity nulo no envenena la huella archivada con NaN', async () => {
      mockPrismaService.products.findMany.mockResolvedValue([
        producto({
          state: ProductState.ARCHIVED,
          stock_quantity: null,
          base_price: 900,
        }),
      ]);

      const result = await service.getProductStats(1);

      expect(result.archived_stock_units).toBe(0);
      expect(result.archived_stock_value).toBe(0);
      expect(Number.isNaN(result.archived_stock_value)).toBe(false);
    });

    it('EL DETALLE NO CAMBIA: pedir el listado de archivados sigue devolviéndolos con su stock', async () => {
      // Esta es la prueba que impide «arreglar de más». D.3 sólo toca
      // agregados; la consulta de detalle por estado sigue intacta.
      const archivado = {
        id: 378,
        name: 'Producto archivado',
        state: ProductState.ARCHIVED,
        base_price: 3,
        track_inventory: true,
        product_images: [],
        product_variants: [],
        product_categories: [],
        stock_levels: [
          {
            product_variant_id: null,
            quantity_available: 20000,
            quantity_reserved: 0,
            inventory_locations: { id: 1, name: 'Bodega', type: 'warehouse' },
          },
        ],
      };
      mockPrismaService.products.findMany.mockResolvedValue([archivado]);
      mockPrismaService.products.count.mockResolvedValue(1);

      const result: any = await service.findAll({
        page: 1,
        limit: 10,
        state: ProductState.ARCHIVED,
        include_inactive: true,
      } as any);

      expect(result.data).toHaveLength(1);
      // Sigue llegando con identidad Y con su existencia: 20.000 unidades que
      // el agregado ya no suma pero que el detalle sigue mostrando.
      expect(result.data[0]).toEqual(
        expect.objectContaining({
          id: 378,
          state: ProductState.ARCHIVED,
          stock_quantity: 20000,
          total_stock_available: 20000,
        }),
      );
    });
  });

  describe('ADVANCED SCENARIOS', () => {
    it('should handle product creation with multiple stock locations', async () => {
      const productWithStock: CreateProductDto = {
        name: 'Product with Stock',
        base_price: 199.99,
        stock_by_location: [
          {
            location_id: 1,
            quantity: 50,
            notes: 'Main warehouse',
          },
          {
            location_id: 2,
            quantity: 25,
            notes: 'Secondary warehouse',
          },
        ],
      };

      const expectedProduct = {
        id: 1,
        ...productWithStock,
        state: ProductState.ACTIVE,
        // create() reloads the row inside the same transaction to compute the
        // stock totals and resolve the main image, so the reload must carry
        // both relations.
        stock_levels: [],
        product_variants: [],
        product_images: [],
        _count: { product_variants: 0, product_images: 0, reviews: 0 },
      };

      mockPrismaService.products.create.mockResolvedValue(expectedProduct);
      mockPrismaService.products.findUnique.mockResolvedValue(expectedProduct);
      mockPrismaService.$transaction.mockImplementation((callback) => {
        return callback(mockPrismaService);
      });

      await service.create(productWithStock);

      // El stock inicial NO se escribe con stock_levels.createMany: pasa por
      // StockLevelManager una vez por ubicación, dentro de la misma transacción.
      // La diferencia no es cosmética — createMany crearía saldo sin fila en
      // inventory_transactions, y el libro de movimientos quedaría en desacuerdo
      // con el saldo desde el primer segundo de vida del producto. De ahí que
      // `create_movement: true` sea obligatorio en cada llamada.
      expect(mockPrismaService.stock_levels.createMany).not.toHaveBeenCalled();
      expect(mockStockLevelManager.updateStock).toHaveBeenCalledTimes(2);
      expect(mockStockLevelManager.updateStock).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          product_id: 1,
          location_id: 1,
          quantity_change: 50,
          movement_type: 'initial',
          create_movement: true,
          validate_availability: false,
        }),
        mockPrismaService,
      );
      expect(mockStockLevelManager.updateStock).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          product_id: 1,
          location_id: 2,
          quantity_change: 25,
          movement_type: 'initial',
        }),
        mockPrismaService,
      );
    });

    it('should handle complex filtering with multiple criteria', async () => {
      const complexQuery: ProductQueryDto = {
        search: 'smartphone',
        category_id: 1,
        brand_id: 2,
        state: ProductState.ACTIVE,
        pos_optimized: true,
        include_variants: true,
        include_stock: true,
      };

      mockPrismaService.products.findMany.mockResolvedValue([]);
      mockPrismaService.products.count.mockResolvedValue(0);

      await service.findAll(complexQuery);

      // The filters are siblings in a flat `where`, not entries of an `AND`
      // array: Prisma already ANDs sibling keys, and flattening keeps the query
      // planner able to use the per-column indexes. `category_id` in particular
      // travels through the product_categories join — a product belongs to many
      // categories, so there is no category_id column on products.
      expect(mockPrismaService.products.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          OR: [
            { name: { contains: 'smartphone', mode: 'insensitive' } },
            { description: { contains: 'smartphone', mode: 'insensitive' } },
            { sku: { contains: 'smartphone', mode: 'insensitive' } },
          ],
          state: ProductState.ACTIVE,
          brand_id: 2,
          product_categories: { some: { category_id: 1 } },
        }),
        include: expect.any(Object),
        skip: 0,
        take: 10,
        orderBy: { created_at: 'desc' },
      });
    });
  });

  describe('STATE FILTER PRIORITY (findAll)', () => {
    // Regression: previously, the state filter was set with a ternary
    // (pos_optimized ? ACTIVE : include_inactive ? undefined : { not: ARCHIVED })
    // and then overridden by a spread `...(state && { state })`. The spread
    // did not propagate correctly, so filtering by 'archived' returned 0
    // products. Fix computes `effectiveState` with explicit priority.

    const buildStateQuery = (
      overrides: Partial<ProductQueryDto> = {},
    ): ProductQueryDto =>
      ({
        page: 1,
        limit: 10,
        ...overrides,
      }) as ProductQueryDto;

    const getFindManyStateFilter = (callArgs: any): any => {
      // The service wraps `where` inside an `AND` array when there are other
      // filters; we unwrap it here so tests only assert the `state` clause.
      const where = callArgs?.where ?? {};
      if (Array.isArray(where.AND)) {
        const stateEntry = where.AND.find(
          (clause: any) => clause && 'state' in clause,
        );
        return stateEntry?.state;
      }
      return where.state;
    };

    it('uses the explicit `state` param when the caller asks for archived', async () => {
      mockPrismaService.products.findMany.mockResolvedValue([]);
      mockPrismaService.products.count.mockResolvedValue(0);

      await service.findAll(
        buildStateQuery({ state: ProductState.ARCHIVED, include_inactive: true }),
      );

      const lastCall =
        mockPrismaService.products.findMany.mock.calls[
          mockPrismaService.products.findMany.mock.calls.length - 1
        ][0];
      expect(getFindManyStateFilter(lastCall)).toBe(ProductState.ARCHIVED);
    });

    it('forces ACTIVE when pos_optimized=true and no explicit state', async () => {
      mockPrismaService.products.findMany.mockResolvedValue([]);
      mockPrismaService.products.count.mockResolvedValue(0);

      await service.findAll(buildStateQuery({ pos_optimized: true }));

      const lastCall =
        mockPrismaService.products.findMany.mock.calls[
          mockPrismaService.products.findMany.mock.calls.length - 1
        ][0];
      expect(getFindManyStateFilter(lastCall)).toBe(ProductState.ACTIVE);
    });

    it('omits the state filter when include_inactive=true and no explicit state', async () => {
      mockPrismaService.products.findMany.mockResolvedValue([]);
      mockPrismaService.products.count.mockResolvedValue(0);

      await service.findAll(buildStateQuery({ include_inactive: true }));

      const lastCall =
        mockPrismaService.products.findMany.mock.calls[
          mockPrismaService.products.findMany.mock.calls.length - 1
        ][0];
      // No `state` clause should appear at all.
      expect(getFindManyStateFilter(lastCall)).toBeUndefined();
    });

    it('excludes archived by default when no flags are set', async () => {
      mockPrismaService.products.findMany.mockResolvedValue([]);
      mockPrismaService.products.count.mockResolvedValue(0);

      await service.findAll(buildStateQuery({}));

      const lastCall =
        mockPrismaService.products.findMany.mock.calls[
          mockPrismaService.products.findMany.mock.calls.length - 1
        ][0];
      expect(getFindManyStateFilter(lastCall)).toEqual({
        not: ProductState.ARCHIVED,
      });
    });

    it('explicit `state` wins over pos_optimized (caller priority)', async () => {
      mockPrismaService.products.findMany.mockResolvedValue([]);
      mockPrismaService.products.count.mockResolvedValue(0);

      await service.findAll(
        buildStateQuery({
          state: ProductState.INACTIVE,
          pos_optimized: true,
        }),
      );

      const lastCall =
        mockPrismaService.products.findMany.mock.calls[
          mockPrismaService.products.findMany.mock.calls.length - 1
        ][0];
      // Even though pos_optimized is true, explicit INACTIVE should win.
      expect(getFindManyStateFilter(lastCall)).toBe(ProductState.INACTIVE);
    });
  });

  describe('ACTIVE PROMOTIONS ON LISTING', () => {
    const buildListedProduct = (override: Partial<any> = {}) => ({
      id: override.id ?? 1,
      name: 'Sample Product',
      slug: 'sample-product',
      description: 'desc',
      base_price: 100,
      sale_price: null,
      is_on_sale: false,
      sku: 'SKU-1',
      cost_price: null,
      profit_margin: null,
      min_stock_level: null,
      reorder_point: null,
      state: ProductState.ACTIVE,
      pricing_type: 'unit',
      product_type: 'physical',
      track_inventory: true,
      available_for_ecommerce: true,
      is_featured: false,
      allow_pos_price_override: false,
      requires_batch_tracking: false,
      requires_booking: false,
      booking_mode: null,
      buffer_minutes: 0,
      is_recurring: false,
      service_duration_minutes: null,
      service_modality: null,
      service_pricing_type: null,
      service_instructions: null,
      product_images: [],
      brands: null,
      product_categories: override.product_categories ?? [],
      product_tax_assignments: [],
      product_price_tier_assignments: [],
      product_variants: [],
      stock_levels: [],
      stores: { id: 1, name: 'T', slug: 't' },
      _count: { product_variants: 0, product_images: 0, reviews: 0 },
      ...override,
    });

    it('attaches active_promotion when the engine returns one for the product', async () => {
      const product = buildListedProduct({ id: 10 });
      mockPrismaService.products.findMany.mockResolvedValue([product]);
      mockPrismaService.products.count.mockResolvedValue(1);
      mockPromotionEngineService.findActiveAutoPromotionsForProducts.mockResolvedValueOnce(
        new Map([
          [
            10,
            {
              id: 55,
              name: 'Direct 15%',
              type: 'percentage',
              scope: 'product',
              discount_percentage: 15,
              promotional_price: 85,
              badge_label: '-15% OFF',
              priority: 2,
            },
          ],
        ]),
      );

      const result = await service.findAll({ page: 1, limit: 10 });

      expect(result.data).toHaveLength(1);
      expect((result.data[0] as any).active_promotion).toMatchObject({
        id: 55,
        promotional_price: 85,
        badge_label: '-15% OFF',
      });
    });

    it('forwards product category ids so the engine can resolve scope=category eligibility', async () => {
      const product = buildListedProduct({
        id: 20,
        product_categories: [
          { category_id: 5, categories: { id: 5, name: 'Cat A' } },
        ],
      });
      mockPrismaService.products.findMany.mockResolvedValue([product]);
      mockPrismaService.products.count.mockResolvedValue(1);
      mockPromotionEngineService.findActiveAutoPromotionsForProducts.mockResolvedValueOnce(
        new Map([
          [
            20,
            {
              id: 77,
              name: 'Cat 10%',
              type: 'percentage',
              scope: 'category',
              discount_percentage: 10,
              promotional_price: 90,
              badge_label: '-10% OFF',
              priority: 1,
            },
          ],
        ]),
      );

      const result = await service.findAll({ page: 1, limit: 10 });

      const callArgs =
        mockPromotionEngineService.findActiveAutoPromotionsForProducts.mock
          .calls[0][0];
      expect(callArgs[0].category_ids).toContain(5);
      expect((result.data[0] as any).active_promotion).toMatchObject({
        id: 77,
        scope: 'category',
      });
    });

    it('returns active_promotion=null when the engine does not match the product', async () => {
      const product = buildListedProduct({ id: 30 });
      mockPrismaService.products.findMany.mockResolvedValue([product]);
      mockPrismaService.products.count.mockResolvedValue(1);
      mockPromotionEngineService.findActiveAutoPromotionsForProducts.mockResolvedValueOnce(
        new Map(),
      );

      const result = await service.findAll({ page: 1, limit: 10 });

      expect((result.data[0] as any).active_promotion).toBeNull();
    });
  });

  /**
   * Bulk-edit prerequisites: el sanitizer de insumo puro debe llegar de verdad
   * al `prisma.products.update()`, el retorno ligero debe evitar el `findOne()`
   * completo, y `findIds()` debe materializar ids con tope explícito.
   */
  describe('BULK-EDIT PREREQUISITES', () => {
    const existingProduct = {
      id: 42,
      store_id: 1,
      name: 'Harina de trigo',
      sku: 'ING-042',
      slug: 'harina-de-trigo',
      state: ProductState.ACTIVE,
      base_price: 12000,
      product_type: 'physical',
      track_inventory: true,
      stock_quantity: 0,
      requires_booking: false,
      consultation_template_id: null,
      preconsultation_template_id: null,
      send_preconsultation: false,
      stock_uom_id: null,
      purchase_uom_id: null,
      online_purchase_url: null,
      online_purchase_qr_code: null,
      online_purchase_domain_id: null,
    };

    let findOneSpy: jest.SpyInstance;

    /**
     * Prepara el camino feliz de `update()`: producto existente, tienda con
     * industria que soporta insumos, sin reservas activas y transacción que
     * ejecuta el callback contra el propio mock de Prisma.
     */
    const primeUpdatePath = (
      updatedRow: Record<string, any> = {
        ...existingProduct,
        base_price: 0,
      },
    ) => {
      mockPrismaService.products.findFirst.mockReset();
      mockPrismaService.products.findFirst.mockResolvedValueOnce(
        existingProduct,
      );
      mockPrismaService.stores.findUnique.mockReset();
      mockPrismaService.stores.findUnique.mockResolvedValue({
        industries: ['restaurant'],
      });
      mockPrismaService.stock_reservations.findFirst.mockReset();
      mockPrismaService.product_variants.count.mockReset();
      mockPrismaService.product_variants.count.mockResolvedValue(0);
      mockPrismaService.products.update.mockReset();
      mockPrismaService.products.update.mockResolvedValue(updatedRow);
      mockPrismaService.$transaction.mockImplementation((callback: any) =>
        callback(mockPrismaService),
      );
    };

    beforeEach(() => {
      findOneSpy = jest
        .spyOn(service, 'findOne')
        .mockResolvedValue({ id: existingProduct.id } as any);
    });

    afterEach(() => {
      findOneSpy.mockRestore();
    });

    it('persiste las neutralizaciones del sanitizer de insumo puro', async () => {
      primeUpdatePath();

      await service.update(existingProduct.id, {
        is_ingredient: true,
        is_sellable: false,
      } as UpdateProductDto);

      expect(mockPrismaService.products.update).toHaveBeenCalledWith({
        where: { id: existingProduct.id },
        data: expect.objectContaining({
          is_ingredient: true,
          is_sellable: false,
          base_price: 0,
          sale_price: 0,
          is_on_sale: false,
          allow_pos_price_override: false,
          has_multiple_price_tiers: false,
          available_for_ecommerce: false,
          is_featured: false,
          online_purchase_url: null,
        }),
      });
    });

    it('con { lean: true } devuelve solo { id, name, sku } y no invoca findOne', async () => {
      primeUpdatePath({
        ...existingProduct,
        name: 'Harina de trigo',
        sku: 'ING-042',
        base_price: 0,
      });

      const result = await service.update(
        existingProduct.id,
        { is_featured: false } as UpdateProductDto,
        { lean: true },
      );

      expect(result).toEqual({
        id: existingProduct.id,
        name: 'Harina de trigo',
        sku: 'ING-042',
      });
      expect(findOneSpy).not.toHaveBeenCalled();
    });

    it('sin opciones sigue delegando en findOne (retrocompatibilidad)', async () => {
      primeUpdatePath();

      await service.update(existingProduct.id, {
        is_featured: false,
      } as UpdateProductDto);

      expect(findOneSpy).toHaveBeenCalledWith(existingProduct.id);
    });

    it('findIds marca capped y trunca los ids en MAX_PRODUCT_IDS', async () => {
      const rows = Array.from({ length: MAX_PRODUCT_IDS }, (_, index) => ({
        id: index + 1,
      }));
      mockPrismaService.products.findMany.mockResolvedValue(rows);
      mockPrismaService.products.count.mockResolvedValue(MAX_PRODUCT_IDS + 25);

      const result = await service.findIds({
        state: ProductState.ACTIVE,
      } as ProductQueryDto);

      expect(result.capped).toBe(true);
      expect(result.total).toBe(MAX_PRODUCT_IDS + 25);
      expect(result.ids).toHaveLength(MAX_PRODUCT_IDS);
      expect(mockPrismaService.products.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ state: ProductState.ACTIVE }),
        select: { id: true },
        orderBy: { created_at: 'desc' },
        take: MAX_PRODUCT_IDS,
      });
    });

    it('findIds no marca capped cuando el total cabe en el tope', async () => {
      mockPrismaService.products.findMany.mockResolvedValue([
        { id: 7 },
        { id: 9 },
      ]);
      mockPrismaService.products.count.mockResolvedValue(2);

      const result = await service.findIds({} as ProductQueryDto);

      expect(result).toEqual({ ids: [7, 9], total: 2, capped: false });
    });
  });

  // ===========================================================================
  // B.3 — CP-pos-smart-search Fase A: where tokenizado (B.1/ADR-02) + rank en
  // memoria con fail-open (B.2/ADR-03). Las expectativas de orden se derivan a
  // mano de la tabla de pesos (search-score.util.ts), NO reutilizando el
  // scorer: estos specs son oráculo independiente del wiring B.2.
  // ===========================================================================
  describe('POS SMART SEARCH (B.1/B.2 — CP-pos-smart-search)', () => {
    const FLAGS_OFF = { l1: false, l2: false, trigram: false };
    const FLAGS_L1 = { l1: true, l2: false, trigram: false };
    const FLAGS_L2 = { l1: true, l2: true, trigram: false };

    const primeSearchPath = (flags: typeof FLAGS_OFF, path: string) => {
      mockSearchFlags.resolveSearchFlags.mockResolvedValue(flags);
      mockSearchFlags.resolveSearchPathFor.mockResolvedValue({
        flags,
        trigramCapable: false,
        killSwitch: false,
        path,
      });
    };

    // Fila ligera del scan rank (F-017): id + texto + featured/created_at.
    const lightRow = (over: Record<string, any>) => ({
      description: null,
      sku: null,
      barcode: null,
      is_featured: false,
      created_at: new Date('2024-06-01T00:00:00.000Z'),
      ...over,
    });

    // Fila hidratada: mismo shape que el mapper no-pos recorre (copia del
    // builder de ACTIVE PROMOTIONS + created_at/is_featured para el re-score).
    const fullRow = (over: Record<string, any>) => ({
      id: over.id ?? 1,
      name: 'Sample Product',
      slug: 'sample-product',
      description: null,
      base_price: 100,
      sale_price: null,
      is_on_sale: false,
      sku: null,
      barcode: null,
      cost_price: null,
      profit_margin: null,
      min_stock_level: null,
      reorder_point: null,
      state: ProductState.ACTIVE,
      pricing_type: 'unit',
      product_type: 'physical',
      track_inventory: false,
      available_for_ecommerce: true,
      is_featured: false,
      allow_pos_price_override: false,
      requires_batch_tracking: false,
      requires_booking: false,
      booking_mode: null,
      buffer_minutes: 0,
      is_recurring: false,
      service_duration_minutes: null,
      service_modality: null,
      service_pricing_type: null,
      service_instructions: null,
      created_at: new Date('2024-06-01T00:00:00.000Z'),
      product_images: [],
      brands: null,
      product_categories: [],
      product_tax_assignments: [],
      product_price_tier_assignments: [],
      stock_levels: [],
      stores: { id: 1, name: 'T', slug: 't' },
      _count: { product_variants: 0, product_images: 0, reviews: 0 },
      ...over,
    });

    // Enruta el `findMany` doble del path rank: la light (select, sin include)
    // devuelve `light`; el hydrate (include) devuelve las filas pedidas en
    // ORDEN INVERSO — Prisma no respeta el orden del `in`, el servicio debe
    // restaurarlo (re-sort por pageIds + re-score tier-2).
    const routeScanHydrate = (
      light: any[],
      fullById: Map<number, any>,
      onSelect?: (args: any) => any,
    ) => {
      mockPrismaService.products.findMany.mockImplementation((args: any) => {
        if (args?.select && !args?.include) {
          if (onSelect) return onSelect(args);
          return Promise.resolve(light);
        }
        const ids: number[] | undefined = args?.where?.id?.in;
        const rows = ids
          ? ids.map((id) => fullById.get(id)).filter(Boolean)
          : [...fullById.values()];
        return Promise.resolve([...rows].reverse());
      });
    };

    beforeEach(() => {
      // Cada test smart parte de legacy + miss: mockResolvedValue persiste
      // entre tests (clearAllMocks no lo borra) y un l2 de un test anterior
      // contaminaría al siguiente.
      primeSearchPath(FLAGS_OFF, 'legacy');
      mockCacheManager.get.mockResolvedValue(null);
    });

    it('flags on (l1) + mult-token → AND×OR con tokens normalizados, orden legacy', async () => {
      primeSearchPath(FLAGS_L1, 'l1');
      mockPrismaService.products.findMany.mockResolvedValue([]);
      mockPrismaService.products.count.mockResolvedValue(0);

      const result = await service.findAll({
        search: 'cafe chocolate',
        page: 1,
        limit: 10,
      });

      const where = mockPrismaService.products.findMany.mock.calls[0][0].where;
      // Un AND por token (ADR-02); el OR legacy de frase desaparece.
      expect(where.AND).toHaveLength(2);
      expect(where.OR).toBeUndefined();
      // Tokens normalizados (lower + símbolos→espacio).
      expect(where.AND[0].OR).toContainEqual({
        name: { contains: 'cafe', mode: 'insensitive' },
      });
      expect(where.AND[1].OR).toContainEqual({
        name: { contains: 'chocolate', mode: 'insensitive' },
      });
      // 3 escalares + 2 de variantes por token (unión sobre 5 espacios).
      expect(where.AND[0].OR).toHaveLength(5);
      expect(where.AND[0].OR).toContainEqual({
        product_variants: {
          some: { name: { contains: 'cafe', mode: 'insensitive' } },
        },
      });
      expect(where.AND[0].OR).toContainEqual({
        product_variants: {
          some: { sku: { contains: 'cafe', mode: 'insensitive' } },
        },
      });
      // L1 = recall nuevo, orden legacy by design (el rank es L2).
      expect(mockPrismaService.products.findMany).toHaveBeenCalledTimes(1);
      expect(result.meta.search).toEqual({
        rank_mode: 'legacy',
        layer: 'l1',
        degraded: false,
      });
    });

    it('flags on (l1) + query acentuada → frase legacy (paridad, finding #2)', async () => {
      primeSearchPath(FLAGS_L1, 'l1');
      mockPrismaService.products.findMany.mockResolvedValue([]);
      mockPrismaService.products.count.mockResolvedValue(0);

      const result = await service.findAll({
        search: 'café chocolate',
        page: 1,
        limit: 10,
      });

      // `café`→`cafe` en el tokenizer volvería el AND inmatcheable en
      // `contains` (accent-sensitive): legacy byte-idéntico a prod.
      const where = mockPrismaService.products.findMany.mock.calls[0][0].where;
      expect(where.AND).toBeUndefined();
      expect(where.OR).toEqual([
        { name: { contains: 'café chocolate', mode: 'insensitive' } },
        { description: { contains: 'café chocolate', mode: 'insensitive' } },
        { sku: { contains: 'café chocolate', mode: 'insensitive' } },
      ]);
      expect(result.meta.search).toEqual({
        rank_mode: 'legacy',
        layer: 'l1',
        degraded: false,
      });
    });

    it('flags off + mult-token → OR de frase legacy intacto (fail-closed)', async () => {
      primeSearchPath(FLAGS_OFF, 'legacy');
      mockPrismaService.products.findMany.mockResolvedValue([]);
      mockPrismaService.products.count.mockResolvedValue(0);

      const result = await service.findAll({
        search: 'cafe chocolate',
        page: 1,
        limit: 10,
      });

      const where = mockPrismaService.products.findMany.mock.calls[0][0].where;
      expect(where.AND).toBeUndefined();
      expect(where.OR).toEqual([
        { name: { contains: 'cafe chocolate', mode: 'insensitive' } },
        { description: { contains: 'cafe chocolate', mode: 'insensitive' } },
        { sku: { contains: 'cafe chocolate', mode: 'insensitive' } },
      ]);
      expect(result.meta.search).toEqual({
        rank_mode: 'legacy',
        layer: 'legacy',
        degraded: false,
      });
    });

    it('rank-1: el exacto en nombre gana al parcial featured + skip-count (F-005)', async () => {
      primeSearchPath(FLAGS_L2, 'l2');
      // Pesos: name word 40, description word 15, fullCoverage 15,
      // allInPrimary 25. A: 40+40+15+25=120. B: 15+0=15 (coverage 1, sin
      // bonus). 120 > 15 ⇒ A primero aunque B sea featured.
      const light = [
        lightRow({
          id: 11,
          name: 'Café molido',
          sku: 'CAF-MOL-001',
          created_at: new Date('2024-01-01T00:00:00.000Z'),
        }),
        lightRow({
          id: 22,
          name: 'Azúcar morena',
          description: 'Endulza tu café de la mañana',
          sku: 'AZU-001',
          is_featured: true,
        }),
      ];
      const fullById = new Map([
        [
          11,
          fullRow({
            id: 11,
            name: 'Café molido',
            sku: 'CAF-MOL-001',
            created_at: new Date('2024-01-01T00:00:00.000Z'),
          }),
        ],
        [
          22,
          fullRow({
            id: 22,
            name: 'Azúcar morena',
            description: 'Endulza tu café de la mañana',
            sku: 'AZU-001',
            is_featured: true,
          }),
        ],
      ]);
      routeScanHydrate(light, fullById);

      const result = await service.findAll({
        search: 'cafe molido',
        page: 1,
        limit: 10,
      });

      // El hydrate devolvió [22,11]; el servicio restaura [11,22].
      expect(result.data.map((row: any) => row.id)).toEqual([11, 22]);
      expect(result.meta).toEqual({
        total: 2,
        page: 1,
        limit: 10,
        totalPages: 1,
        search: { rank_mode: 'ranked', layer: 'l2', degraded: false },
      });
      // F-005: con rank el total es el conjunto rankeado — sin `count`.
      expect(mockPrismaService.products.count).not.toHaveBeenCalled();
      // Scan + hydrate: exactamente 2 round-trips.
      expect(mockPrismaService.products.findMany).toHaveBeenCalledTimes(2);
      expect(
        mockPrismaService.products.findMany.mock.calls[1][0].where.id,
      ).toEqual({ in: [11, 22] });
      // F-046: id-list completa cacheada 45s (no solo la página).
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        expect.stringMatching(/^products:smartsearch:1:[0-9a-f]{12}:[0-9a-f]{12}$/),
        { ids: [11, 22], total: 2 },
        45_000,
      );
    });

    it('featured desempat: a igual score/coverage gana featured', async () => {
      primeSearchPath(FLAGS_L2, 'l2');
      // 'cafe' vs name 'Café' (exacto 120) + fullCoverage 15 + allInPrimary
      // 25 = 160 en ambas; coverage 1 en ambas ⇒ decide featured.
      const created = new Date('2024-06-01T00:00:00.000Z');
      const light = [
        lightRow({ id: 44, name: 'Café', created_at: created }),
        lightRow({
          id: 33,
          name: 'Café',
          is_featured: true,
          created_at: created,
        }),
      ];
      const fullById = new Map([
        [44, fullRow({ id: 44, name: 'Café', created_at: created })],
        [
          33,
          fullRow({
            id: 33,
            name: 'Café',
            is_featured: true,
            created_at: created,
          }),
        ],
      ]);
      routeScanHydrate(light, fullById);

      const result = await service.findAll({
        search: 'cafe',
        page: 1,
        limit: 10,
      });

      expect(result.data.map((row: any) => row.id)).toEqual([33, 44]);
      expect(result.meta.search).toEqual({
        rank_mode: 'ranked',
        layer: 'l2',
        degraded: false,
      });
    });

    it('orden determinista: input invertido → mismo orden; id DESC cierra', async () => {
      primeSearchPath(FLAGS_L2, 'l2');
      // Gemelas en todo (160/1/no-featured/mismo created_at): solo queda el
      // id DESC. Sort estable + id ⇒ sin flips entre llamadas.
      const created = new Date('2024-06-01T00:00:00.000Z');
      const e = lightRow({ id: 55, name: 'Café', created_at: created });
      const f = lightRow({ id: 66, name: 'Café', created_at: created });
      const fullById = new Map([
        [55, fullRow({ id: 55, name: 'Café', created_at: created })],
        [66, fullRow({ id: 66, name: 'Café', created_at: created })],
      ]);
      const query = { search: 'cafe', page: 1, limit: 10 };

      routeScanHydrate([e, f], fullById);
      const first = await service.findAll(query);
      routeScanHydrate([f, e], fullById);
      const second = await service.findAll(query);

      expect(first.data.map((row: any) => row.id)).toEqual([66, 55]);
      expect(second.data.map((row: any) => row.id)).toEqual([66, 55]);
    });

    it('cache hit: página 2 no re-escanea ni cuenta (F-046)', async () => {
      primeSearchPath(FLAGS_L2, 'l2');
      mockCacheManager.get.mockResolvedValueOnce({
        ids: [11, 22, 33, 44, 55],
        total: 5,
      });
      const fullById = new Map([
        [33, fullRow({ id: 33, name: 'Café molido', sku: 'C-33' })],
        [
          44,
          fullRow({
            id: 44,
            name: 'Azúcar',
            description: 'para el cafe',
            sku: 'A-44',
          }),
        ],
      ]);
      mockPrismaService.products.findMany.mockImplementation((args: any) => {
        if (args?.select && !args?.include) {
          throw new Error('el hit no debe escanear');
        }
        const ids: number[] = args?.where?.id?.in ?? [];
        return Promise.resolve(ids.map((id) => fullById.get(id)));
      });

      const result = await service.findAll({
        search: 'cafe molido',
        page: 2,
        limit: 2,
      });

      // Slice [33,44] de la id-list; el re-score tier-2 confirma el orden
      // (120 vs 15) en vez de confiarlo a ciegas.
      expect(result.data.map((row: any) => row.id)).toEqual([33, 44]);
      expect(result.meta.total).toBe(5);
      expect(result.meta.search).toEqual({
        rank_mode: 'ranked',
        layer: 'l2',
        degraded: false,
      });
      expect(mockPrismaService.products.count).not.toHaveBeenCalled();
      expect(mockPrismaService.products.findMany).toHaveBeenCalledTimes(1);
    });

    // ---- FAIL-OPEN (B.2/ERR-17): over-cap o throw ⇒ legacy + meta ---------

    it('over scan-cap → orderBy legacy + meta unranked_scan_cap (fail-open)', async () => {
      const envKey = 'POS_SMART_SEARCH_SCAN_CAP';
      const prev = process.env[envKey];
      process.env[envKey] = '3';
      try {
        primeSearchPath(FLAGS_L2, 'l2');
        const light = [1, 2, 3, 4].map((id) =>
          lightRow({ id, name: `Café ${id}` }),
        );
        const fullById = new Map(
          [1, 2, 3, 4].map((id) => [
            id,
            fullRow({ id, name: `Café ${id}` }),
          ]),
        );
        // El scan pide cap+1 para detectar el desborde sin segundo round-trip.
        routeScanHydrate(light, fullById, (args: any) => {
          expect(args.take).toBe(4);
          return Promise.resolve(light);
        });
        mockPrismaService.products.count.mockResolvedValue(4);

        const result = await service.findAll({
          search: 'cafe',
          page: 1,
          limit: 10,
        });

        // La grilla NO se vacía: llegan las 4 filas por el path legacy.
        expect(result.data).toHaveLength(4);
        expect(result.meta.total).toBe(4);
        expect(result.meta.search).toEqual({
          rank_mode: 'unranked_scan_cap',
          layer: 'l2',
          degraded: true,
        });
        // Degradado ⇒ recount legacy + hydrate con skip/take.
        expect(mockPrismaService.products.count).toHaveBeenCalledTimes(1);
        expect(mockPrismaService.products.findMany).toHaveBeenCalledTimes(2);
        const legacyCall =
          mockPrismaService.products.findMany.mock.calls[1][0];
        expect(legacyCall.skip).toBe(0);
        expect(legacyCall.take).toBe(10);
        expect(legacyCall.where.id).toBeUndefined();
        // Sin rank no hay nada que cachear.
        expect(mockCacheManager.set).not.toHaveBeenCalled();
      } finally {
        if (prev === undefined) delete process.env[envKey];
        else process.env[envKey] = prev;
      }
    });

    it('hydrate lanza → re-fetch legacy + meta unranked_error (fail-open)', async () => {
      primeSearchPath(FLAGS_L2, 'l2');
      const light = [
        lightRow({ id: 11, name: 'Café molido', sku: 'CAF-MOL-001' }),
        lightRow({
          id: 22,
          name: 'Azúcar morena',
          description: 'Endulza tu café de la mañana',
          sku: 'AZU-001',
        }),
      ];
      const fullById = new Map([
        [11, fullRow({ id: 11, name: 'Café molido', sku: 'CAF-MOL-001' })],
        [
          22,
          fullRow({
            id: 22,
            name: 'Azúcar morena',
            description: 'Endulza tu café de la mañana',
            sku: 'AZU-001',
          }),
        ],
      ]);
      let hydrateCalls = 0;
      mockPrismaService.products.findMany.mockImplementation((args: any) => {
        if (args?.select && !args?.include) {
          return Promise.resolve(light);
        }
        // Solo el hydrate acotado a la página rankeada falla; el re-fetch
        // legacy (mismo where, sin id.in) sana.
        if (args?.where?.id?.in) {
          hydrateCalls += 1;
          return Promise.reject(new Error('hydrate down'));
        }
        return Promise.resolve([...fullById.values()]);
      });
      mockPrismaService.products.count.mockResolvedValue(2);

      const result = await service.findAll({
        search: 'cafe molido',
        page: 1,
        limit: 10,
      });

      expect(hydrateCalls).toBe(1);
      expect(result.data).toHaveLength(2);
      expect(result.meta.total).toBe(2);
      expect(result.meta.search).toEqual({
        rank_mode: 'unranked_error',
        layer: 'l2',
        degraded: true,
      });
      // Scan + hydrate-roto + re-fetch legacy.
      expect(mockPrismaService.products.findMany).toHaveBeenCalledTimes(3);
      expect(mockPrismaService.products.count).toHaveBeenCalledTimes(1);
    });

    it('flags rechazan → legacy fail-closed (cutover never-throw)', async () => {
      mockSearchFlags.resolveSearchPathFor.mockRejectedValueOnce(
        new Error('flags down'),
      );
      mockPrismaService.products.findMany.mockResolvedValue([]);
      mockPrismaService.products.count.mockResolvedValue(0);

      const result = await service.findAll({
        search: 'cafe chocolate',
        page: 1,
        limit: 10,
      });

      const where = mockPrismaService.products.findMany.mock.calls[0][0].where;
      expect(where.AND).toBeUndefined();
      expect(where.OR).toEqual([
        { name: { contains: 'cafe chocolate', mode: 'insensitive' } },
        { description: { contains: 'cafe chocolate', mode: 'insensitive' } },
        { sku: { contains: 'cafe chocolate', mode: 'insensitive' } },
      ]);
      expect(result.meta.search).toEqual({
        rank_mode: 'legacy',
        layer: 'legacy',
        degraded: false,
      });
      expect(mockPrismaService.products.findMany).toHaveBeenCalledTimes(1);
    });

    // ---- GATE tokens>0 (B.2/F-013): 1-char/stopwords ⇒ legacy -------------

    it("search 1-char 'e' + l2 → legacy, sin rank ni caché", async () => {
      primeSearchPath(FLAGS_L2, 'l2');
      mockPrismaService.products.findMany.mockResolvedValue([]);
      mockPrismaService.products.count.mockResolvedValue(0);

      const result = await service.findAll({
        search: 'e',
        page: 1,
        limit: 10,
      });

      // 0 tokens: el where cae a la frase legacy y el rank ni se intenta.
      const where = mockPrismaService.products.findMany.mock.calls[0][0].where;
      expect(where.AND).toBeUndefined();
      expect(where.OR).toEqual([
        { name: { contains: 'e', mode: 'insensitive' } },
        { description: { contains: 'e', mode: 'insensitive' } },
        { sku: { contains: 'e', mode: 'insensitive' } },
      ]);
      // layer=l2 (cutover) pero rank_mode=legacy (gate): la distinción que
      // impide que meta.search mienta `ranked` sobre conjunto legacy.
      expect(result.meta.search).toEqual({
        rank_mode: 'legacy',
        layer: 'l2',
        degraded: false,
      });
      expect(mockPrismaService.products.findMany).toHaveBeenCalledTimes(1);
      expect(mockCacheManager.get).not.toHaveBeenCalled();
      expect(mockPrismaService.products.count).toHaveBeenCalledTimes(1);
    });

    it("search solo-stopwords 'de la' + l2 → fallback frase legacy", async () => {
      primeSearchPath(FLAGS_L2, 'l2');
      mockPrismaService.products.findMany.mockResolvedValue([]);
      mockPrismaService.products.count.mockResolvedValue(0);

      const result = await service.findAll({
        search: 'de la',
        page: 1,
        limit: 10,
      });

      const where = mockPrismaService.products.findMany.mock.calls[0][0].where;
      expect(where.AND).toBeUndefined();
      expect(where.OR).toEqual([
        { name: { contains: 'de la', mode: 'insensitive' } },
        { description: { contains: 'de la', mode: 'insensitive' } },
        { sku: { contains: 'de la', mode: 'insensitive' } },
      ]);
      expect(result.meta.search).toEqual({
        rank_mode: 'legacy',
        layer: 'l2',
        degraded: false,
      });
      expect(mockPrismaService.products.findMany).toHaveBeenCalledTimes(1);
      expect(mockCacheManager.get).not.toHaveBeenCalled();
    });

    // ---- BARCODE — RAMA INTACTA (FB-02/DB-01) -------------------------------

    it('barcode positivo: fixture producto/variante/tier intacto + scanned_price_tier_id', async () => {
      const row = fullRow({
        id: 5,
        name: 'Caja x12',
        sku: 'CJ-12',
        barcode: '7701234000012',
        product_variants: [
          {
            id: 51,
            name: 'Caja x12',
            sku: 'CJ-12',
            barcode: '7701234000012-V',
            price_override: 12000,
            cost_price: 9000,
            profit_margin: 25,
            is_on_sale: false,
            sale_price: null,
            stock_quantity: 7,
            track_inventory_override: null,
            service_duration_minutes: null,
            service_pricing_type: null,
            buffer_minutes: null,
            preparation_time_minutes: null,
            attributes: null,
            stock_levels: [],
          },
        ],
        product_price_tier_assignments: [
          { price_tier_id: 7, barcode: 'T-770' },
        ],
        _count: { product_variants: 1, product_images: 0, reviews: 0 },
      });
      mockPrismaService.products.findMany.mockResolvedValue([row]);
      mockPrismaService.products.count.mockResolvedValue(1);

      const result = await service.findAll({
        barcode: 'T-770',
        include_variants: true,
        page: 1,
        limit: 10,
      });

      // OR exacto sobre los 3 espacios del namespace (producto/variante/tier).
      const where = mockPrismaService.products.findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual([
        { barcode: { equals: 'T-770' } },
        { product_variants: { some: { barcode: { equals: 'T-770' } } } },
        {
          product_price_tier_assignments: {
            some: { barcode: { equals: 'T-770' } },
          },
        },
      ]);
      expect(where.AND).toBeUndefined();
      // La rama barcode no toca flags ni rank.
      expect(mockSearchFlags.resolveSearchPathFor).not.toHaveBeenCalled();
      expect(mockCacheManager.get).not.toHaveBeenCalled();
      expect(result.meta.search).toBeUndefined();
      // Fixture intacto: la variante mapea con su barcode y el tier escaneado
      // se resuelve (el POS cobra la presentación correcta sin adivinar).
      expect((result.data[0] as any).scanned_price_tier_id).toBe(7);
      expect((result.data[0] as any).has_variants).toBe(true);
      expect((result.data[0] as any).product_variants[0]).toEqual(
        expect.objectContaining({
          id: 51,
          sku: 'CJ-12',
          barcode: '7701234000012-V',
        }),
      );
    });

    it('search⊗barcode: con barcode, search se anula (DB-01)', async () => {
      primeSearchPath(FLAGS_L2, 'l2');
      mockPrismaService.products.findMany.mockResolvedValue([]);
      mockPrismaService.products.count.mockResolvedValue(0);

      const result = await service.findAll({
        search: 'cafe',
        barcode: '7701234',
        page: 1,
        limit: 10,
      });

      const where = mockPrismaService.products.findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual([
        { barcode: { equals: '7701234' } },
        { product_variants: { some: { barcode: { equals: '7701234' } } } },
        {
          product_price_tier_assignments: {
            some: { barcode: { equals: '7701234' } },
          },
        },
      ]);
      expect(where.AND).toBeUndefined();
      expect(JSON.stringify(where)).not.toContain('cafe');
      expect(mockSearchFlags.resolveSearchPathFor).not.toHaveBeenCalled();
      expect(mockPrismaService.products.findMany).toHaveBeenCalledTimes(1);
      // Hay search, pero barcode fuerza legacy en ambos ejes.
      expect(result.meta.search).toEqual({
        rank_mode: 'legacy',
        layer: 'legacy',
        degraded: false,
      });
    });

    // ---- COCINA SIN DINERO (QUI-727/ADR-10) --------------------------------

    it('cocina no recibe dinero en findAll (ni en variantes)', async () => {
      jest
        .spyOn(RequestContextService, 'getRoles')
        .mockReturnValue(['kitchen']);
      const row = fullRow({
        id: 5,
        name: 'Bandeja paisa',
        base_price: 25000,
        cost_price: 12000,
        profit_margin: 52,
        product_variants: [
          {
            id: 51,
            name: 'Bandeja paisa',
            sku: 'BP-01',
            barcode: null,
            price_override: 27000,
            cost_price: 13000,
            profit_margin: 50,
            is_on_sale: false,
            sale_price: 24000,
            stock_quantity: 4,
            track_inventory_override: null,
            service_duration_minutes: null,
            service_pricing_type: null,
            buffer_minutes: null,
            preparation_time_minutes: 20,
            attributes: null,
            stock_levels: [],
          },
        ],
        _count: { product_variants: 1, product_images: 0, reviews: 0 },
      });
      mockPrismaService.products.findMany.mockResolvedValue([row]);
      mockPrismaService.products.count.mockResolvedValue(1);

      const result = await service.findAll({
        page: 1,
        limit: 10,
        include_variants: true,
      });

      const dto = result.data[0] as any;
      for (const money of [
        'cost_price',
        'profit_margin',
        'base_price',
        'sale_price',
        'final_price',
        'active_promotion',
        'sale_config_summary',
      ]) {
        expect(dto).not.toHaveProperty(money);
      }
      // Lo estructural y el stock sí viajan (cocina los consume).
      expect(dto).toEqual(
        expect.objectContaining({
          id: 5,
          name: 'Bandeja paisa',
          state: ProductState.ACTIVE,
          total_stock_available: 0,
        }),
      );
      const variant = dto.product_variants[0];
      for (const money of [
        'cost_price',
        'profit_margin',
        'sale_price',
        'price_override',
        'final_price',
      ]) {
        expect(variant).not.toHaveProperty(money);
      }
      expect(variant).toEqual(
        expect.objectContaining({ id: 51, sku: 'BP-01', stock_quantity: 4 }),
      );
    });

    // ---- findIds PARIDAD DE CONJUNTO (DB-17) ---------------------------------

    it('findIds usa el mismo where smart que findAll (select-all exacto)', async () => {
      primeSearchPath(FLAGS_L1, 'l1');
      mockPrismaService.products.findMany.mockResolvedValue([]);
      mockPrismaService.products.count.mockResolvedValue(0);
      const query = {
        search: 'cafe chocolate',
        state: ProductState.ACTIVE,
      } as ProductQueryDto;

      await service.findAll(query);
      const whereFindAll =
        mockPrismaService.products.findMany.mock.calls[0][0].where;
      expect(whereFindAll.AND).toHaveLength(2);

      mockPrismaService.products.findMany.mockClear();
      mockPrismaService.products.count.mockClear();
      mockSearchFlags.resolveSearchPathFor.mockClear();
      mockSearchFlags.resolveSearchFlags.mockClear();

      const ids = await service.findIds(query);
      const whereFindIds =
        mockPrismaService.products.findMany.mock.calls[0][0].where;

      // Mismo conjunto: "seleccionar todo" opera sobre lo que se ve.
      expect(whereFindIds).toEqual(whereFindAll);
      expect(ids).toEqual({ ids: [], total: 0, capped: false });
      // C.3: findIds SÍ resuelve path (1 vez, cacheado) para decidir raw
      // (trigram, acentos) vs ORM. En l1 cae al ORM con el where idéntico.
      expect(mockSearchFlags.resolveSearchFlags).toHaveBeenCalledTimes(1);
      expect(mockSearchFlags.resolveSearchPathFor).toHaveBeenCalledTimes(1);
    });

    // ---- TENANT NEGATIVO (DB-11) ----------------------------------------------

    it('flags y caché del rank van por la tienda del contexto', async () => {
      jest
        .spyOn(RequestContextService, 'getContext')
        .mockReturnValue({ store_id: 2, organization_id: 1, user_id: 9 } as any);
      jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(2);
      primeSearchPath(FLAGS_L2, 'l2');
      routeScanHydrate(
        [lightRow({ id: 9, name: 'Café' })],
        new Map([[9, fullRow({ id: 9, name: 'Café' })]]),
      );

      await service.findAll({ search: 'cafe', page: 1, limit: 10 });

      expect(mockSearchFlags.resolveSearchPathFor).toHaveBeenCalledWith(2);
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        expect.stringMatching(/^products:smartsearch:2:/),
        expect.anything(),
        expect.anything(),
      );
    });

    it('tienda B≁A: la id-list rankeada de B nunca sirve a A', async () => {
      // Las filas las escopa StorePrismaService (DB-11, cubierto por sus
      // specs); aquí se fija que la CAPA RANK tampoco cruza tiendas: flags y
      // caché van por store_id, y un hit de B es miss para A.
      primeSearchPath(FLAGS_L2, 'l2');
      mockCacheManager.get.mockImplementation((key: string) =>
        Promise.resolve(
          key.includes(':2:') ? { ids: [99], total: 1 } : null,
        ),
      );
      const fullById = new Map([
        [7, fullRow({ id: 7, name: 'Café de A' })],
        [99, fullRow({ id: 99, name: 'Café de B' })],
      ]);
      mockPrismaService.products.findMany.mockImplementation((args: any) => {
        if (args?.select && !args?.include) {
          return Promise.resolve([lightRow({ id: 7, name: 'Café de A' })]);
        }
        const ids: number[] | undefined = args?.where?.id?.in;
        const rows = ids
          ? ids.map((id) => fullById.get(id)).filter(Boolean)
          : [...fullById.values()];
        return Promise.resolve(rows);
      });
      const query = { search: 'cafe', page: 1, limit: 10 };

      // Tienda 1 (contexto default): miss ⇒ re-escanea lo suyo.
      const resA = await service.findAll(query);
      const selectCallsA = mockPrismaService.products.findMany.mock.calls.filter(
        ([args]: any[]) => args?.select && !args?.include,
      );
      expect(selectCallsA).toHaveLength(1);
      expect(resA.data.map((row: any) => row.id)).toEqual([7]);

      // Tienda 2: hit de SU caché (ids de B, jamás los de A).
      jest
        .spyOn(RequestContextService, 'getContext')
        .mockReturnValue({ store_id: 2, organization_id: 1, user_id: 9 } as any);
      jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(2);
      mockPrismaService.products.findMany.mockClear();
      const resB = await service.findAll(query);
      const selectCallsB = mockPrismaService.products.findMany.mock.calls.filter(
        ([args]: any[]) => args?.select && !args?.include,
      );
      expect(selectCallsB).toHaveLength(0);
      expect(resB.data.map((row: any) => row.id)).toEqual([99]);
      expect(
        mockPrismaService.products.findMany.mock.calls[0][0].where.id,
      ).toEqual({ in: [99] });
    });

    // ---- META.SEARCH AUSENTE + ERR-06 (documentación) --------------------------

    it('sin search → meta.search ausente y flags ni se resuelven', async () => {
      mockPrismaService.products.findMany.mockResolvedValue([]);
      mockPrismaService.products.count.mockResolvedValue(0);

      const result = await service.findAll({ page: 1, limit: 10 });

      expect(result.meta.search).toBeUndefined();
      expect(mockSearchFlags.resolveSearchPathFor).not.toHaveBeenCalled();
      expect(mockSearchFlags.resolveSearchFlags).not.toHaveBeenCalled();
      expect(mockCacheManager.get).not.toHaveBeenCalled();
    });

    it('page=-1: el servicio PROPAGA el rechazo de Prisma (ERR-06, no traga)', async () => {
      // ERR-06 documentado, NO cambiado: page/limit<=0 pasa el DTO (sin @Min)
      // y Prisma rechaza skip/take. El servicio deja propagar; el shape
      // `200 success:false` lo produce el catch del controller (ver
      // products.controller.spec.ts ERR-06). Si este test enrojece porque el
      // servicio empieza a retornar en vez de lanzar, es un cambio de
      // contrato que requiere decisión explícita.
      mockPrismaService.products.findMany.mockRejectedValue(
        new Error(
          'Invalid `prisma.products.findMany()` invocation: Argument `skip` must be greater than or equal to 0.',
        ),
      );

      await expect(
        service.findAll({ page: -1, limit: 10 }),
      ).rejects.toThrow(/skip/);
    });
  });

  describe('POS SMART SEARCH TRIGRAM (C.3 — CP-pos-smart-search)', () => {
    const FLAGS_TRI = { l1: true, l2: true, trigram: true };
    const CTX_1 = {
      store_id: 1,
      organization_id: 1,
      user_id: 1,
      request_id: 'req-c3-001',
    } as any;

    const primeTrigram = () => {
      mockSearchFlags.resolveSearchFlags.mockResolvedValue(FLAGS_TRI);
      mockSearchFlags.resolveSearchPathFor.mockResolvedValue({
        flags: FLAGS_TRI,
        trigramCapable: true,
        killSwitch: false,
        path: 'trigram',
      });
      mockCacheManager.get.mockResolvedValue(null);
    };

    // Tx interactiva mockeada: corre el callback con un tx doble y expone
    // orden de llamadas (SET LOCAL primero) + SQL/params enviados.
    const primeTx = (rankRows: any[], countTotal: number) => {
      const calls: { method: string; sql: string }[] = [];
      const tx = {
        $executeRawUnsafe: jest.fn(async (sql: string) => {
          calls.push({ method: 'exec', sql });
          return 0;
        }),
        $queryRawUnsafe: jest.fn(
          async (sql: string, ..._params: unknown[]) => {
            void _params;
            calls.push({ method: 'query', sql });
            if (sql.includes('COUNT(*)')) return [{ total: countTotal }];
            return rankRows;
          },
        ),
      };
      (mockPrismaService as any).withoutScope = jest.fn(() => ({
        $transaction: jest.fn(async (fn: any) => fn(tx)),
      }));
      return { tx, calls };
    };

    const fullRow = (over: Record<string, any>) => ({
      id: over.id ?? 1,
      name: 'Sample Product',
      slug: 'sample-product',
      description: null,
      base_price: 100,
      sale_price: null,
      is_on_sale: false,
      sku: null,
      barcode: null,
      cost_price: null,
      profit_margin: null,
      min_stock_level: null,
      reorder_point: null,
      state: ProductState.ACTIVE,
      pricing_type: 'unit',
      product_type: 'physical',
      track_inventory: false,
      available_for_ecommerce: true,
      is_featured: false,
      allow_pos_price_override: false,
      requires_batch_tracking: false,
      requires_booking: false,
      booking_mode: null,
      buffer_minutes: 0,
      is_recurring: false,
      service_duration_minutes: null,
      service_modality: null,
      service_pricing_type: null,
      service_instructions: null,
      created_at: new Date('2024-06-01T00:00:00.000Z'),
      product_images: [],
      brands: null,
      product_categories: [],
      product_tax_assignments: [],
      product_price_tier_assignments: [],
      stock_levels: [],
      stores: { id: 1, name: 'T', slug: 't' },
      _count: { product_variants: 0, product_images: 0, reviews: 0 },
      ...over,
    });

    beforeEach(() => {
      primeTrigram();
      jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
        store_id: 1,
        organization_id: 1,
        user_id: 1,
      } as any);
    });

    it('trigram: SET LOCAL primero + rank + COUNT twin + meta layer trigram', async () => {
      const { tx, calls } = primeTx(
        [
          { id: 11 },
          { id: 22 },
        ],
        2,
      );
      // Empate de score/coverage/featured a propósito: el re-score tier-2
      // post-hydrate re-ordena por created_at DESC (contrato compareSearchRank)
      // ⇒ 11 (más nuevo) primero. El SQL entrega la página, JS manda el orden.
      const byId = new Map([
        [
          11,
          fullRow({
            id: 11,
            name: 'Café molido',
            created_at: new Date('2024-06-02T00:00:00.000Z'),
          }),
        ],
        [
          22,
          fullRow({
            id: 22,
            name: 'Café en grano',
            created_at: new Date('2024-06-01T00:00:00.000Z'),
          }),
        ],
      ]);
      mockPrismaService.products.findMany.mockImplementation((args: any) =>
        Promise.resolve(
          (args?.where?.id?.in ?? []).map((id: number) => byId.get(id)),
        ),
      );

      const result = await RequestContextService.run(CTX_1, () =>
        service.findAll({ search: 'cafe', page: 1, limit: 10 }),
      );

      // Orden de tx: timeout → rank → count.
      expect(calls.map((c) => c.method)).toEqual([
        'exec',
        'query',
        'query',
      ]);
      expect(calls[0]?.sql).toContain('SET LOCAL statement_timeout');
      expect(calls[1]?.sql).toContain('ORDER BY score DESC');
      expect(calls[2]?.sql).toContain('COUNT(*)');
      // Placeholders, no interpolación: el token no aparece literal.
      expect(calls[1]?.sql).not.toContain('cafe');
      expect(tx.$queryRawUnsafe.mock.calls[0].slice(1)).toContain('%cafe%');
      // Scope $1 = tienda del ALS.
      expect(tx.$queryRawUnsafe.mock.calls[0][1]).toBe(1);
      // Outcome → hydrate por ids + total del twin (F-005, sin count Prisma).
      expect(mockPrismaService.products.count).not.toHaveBeenCalled();
      expect(result.meta.total).toBe(2);
      expect(result.meta.search).toEqual({
        rank_mode: 'ranked',
        layer: 'trigram',
        degraded: false,
      });
      expect(result.data.map((p: any) => p.id)).toEqual([11, 22]);
      // Hydrate trigram: ids + escalares, SIN el AND×OR de texto (el raw ya
      // filtró con acentos; re-aplicarlo vaciaría la página).
      const hydrateCall = mockPrismaService.products.findMany.mock.calls.find(
        (call: any[]) => Array.isArray(call[0]?.where?.id?.in),
      );
      expect(hydrateCall).toBeDefined();
      const hydrateWhere = hydrateCall[0].where;
      expect(hydrateWhere.id).toEqual({ in: [11, 22] });
      expect(hydrateWhere.AND).toBeUndefined();
      expect(hydrateWhere.OR).toBeUndefined();
      expect(hydrateWhere.state).toBeDefined();
    });

    it('F-004 negativo 1: ALS vacío (solo spy estático) → Forbidden, sin SQL', async () => {
      const { tx } = primeTx([], 0);
      // Sin RequestContextService.run: ALS vacío aunque getContext diga 1.
      await expect(
        service.findAll({ search: 'cafe', page: 1, limit: 10 }),
      ).rejects.toThrow(ForbiddenException);
      expect(tx.$queryRawUnsafe).not.toHaveBeenCalled();
      expect(tx.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('F-004 negativo 2: ALS tienda 2 ≠ caller 1 → Forbidden (cero filas)', async () => {
      const { tx } = primeTx([{ id: 99 }], 1);
      await expect(
        RequestContextService.run(
          { ...CTX_1, store_id: 2 },
          () => service.findAll({ search: 'cafe', page: 1, limit: 10 }),
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(tx.$queryRawUnsafe).not.toHaveBeenCalled();
    });

    it('F-085: throw del driver → unranked_error + meta genérica (cero eco)', async () => {
      (mockPrismaService as any).withoutScope = jest.fn(() => ({
        $transaction: jest.fn(async () => {
          throw new Error(
            'function unaccent(text) does not exist HINT: products_search_name_trgm_idx',
          );
        }),
      }));
      mockPrismaService.products.findMany.mockResolvedValue([
        fullRow({ id: 5 }),
      ]);
      mockPrismaService.products.count.mockResolvedValue(1);

      const result = await RequestContextService.run(CTX_1, () =>
        service.findAll({ search: 'cafe', page: 1, limit: 10 }),
      );

      expect(result.meta.search).toEqual({
        rank_mode: 'unranked_error',
        layer: 'trigram',
        degraded: true,
      });
      // El cliente ve filas legacy + meta genérica: ni rastro del driver.
      expect(JSON.stringify(result)).not.toContain('unaccent');
      expect(JSON.stringify(result)).not.toContain('products_search_');
      expect(result.data).toHaveLength(1);
    });

    it('request_id limpio viaja como comment; sucio se omite (no rompe SQL)', async () => {
      const { calls } = primeTx([], 0);
      mockPrismaService.products.findMany.mockResolvedValue([]);
      await RequestContextService.run(CTX_1, () =>
        service.findAll({ search: 'cafe', page: 1, limit: 10 }),
      );
      expect(calls[1]?.sql.startsWith('/* req:req-c3-001 */')).toBe(true);

      const evil = primeTx([], 0);
      await RequestContextService.run(
        { ...CTX_1, request_id: 'a*/ DROP TABLE x; --' },
        () => service.findAll({ search: 'cafe', page: 1, limit: 10 }),
      );
      expect(evil.calls[1]?.sql.startsWith('/*')).toBe(false);
      expect(evil.calls[1]?.sql).toContain('SELECT p.id AS id');
    });

    it('F-030 conductual: search `100%` no deja literal en el SQL', async () => {
      // `100%` normaliza a token `100` (el símbolo muere en el tokenizer);
      // el SQL solo ve $n y el patrón `%100%` viaja en params.
      const { tx, calls } = primeTx([], 0);
      mockPrismaService.products.findMany.mockResolvedValue([]);
      mockPrismaService.products.count.mockResolvedValue(0);
      await RequestContextService.run(CTX_1, () =>
        service.findAll({ search: '100%', page: 1, limit: 10 }),
      );
      expect(calls[1]?.sql).not.toContain('100%');
      const params: unknown[] = tx.$queryRawUnsafe.mock.calls[0].slice(1);
      expect(params).toContain('%100%');
    });

    it('findIds trigram (DB-17): conjunto del raw + capped honesto', async () => {
      primeTx([{ id: 11 }, { id: 22 }], 1200);
      const result = await RequestContextService.run(CTX_1, () =>
        service.findIds({ search: 'cafe' } as any),
      );
      expect(result).toEqual({ ids: [11, 22], total: 1200, capped: true });
      // Cero Prisma ORM: el conjunto lo define el raw (acentos incluidos).
      expect(mockPrismaService.products.findMany).not.toHaveBeenCalled();
      expect(mockPrismaService.products.count).not.toHaveBeenCalled();
    });

    it('findIds: throw operativo del raw → fail-open a legacy', async () => {
      (mockPrismaService as any).withoutScope = jest.fn(() => ({
        $transaction: jest.fn(async () => {
          throw new Error('boom');
        }),
      }));
      mockPrismaService.products.findMany.mockResolvedValue([{ id: 5 }]);
      mockPrismaService.products.count.mockResolvedValue(1);
      const result = await RequestContextService.run(CTX_1, () =>
        service.findIds({ search: 'cafe' } as any),
      );
      expect(result).toEqual({ ids: [5], total: 1, capped: false });
    });

    it('findIds sin tienda en contexto → legacy (cero SQL crudo)', async () => {
      const { tx } = primeTx([{ id: 1 }], 1);
      jest.spyOn(RequestContextService, 'getContext').mockReturnValue(
        undefined as any,
      );
      mockPrismaService.products.findMany.mockResolvedValue([]);
      mockPrismaService.products.count.mockResolvedValue(0);
      const result = await service.findIds({ search: 'cafe' } as any);
      expect(result).toEqual({ ids: [], total: 0, capped: false });
      expect(tx.$queryRawUnsafe).not.toHaveBeenCalled();
    });
  });
});
