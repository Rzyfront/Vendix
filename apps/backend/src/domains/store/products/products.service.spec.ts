import { Test, TestingModule } from '@nestjs/testing';
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
      expect(result.meta).toEqual({
        total: 2,
        page: 1,
        limit: 10,
        totalPages: 1,
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
      const expectedStats = {
        total_products: 3,
        active_products: 2,
        inactive_products: 1,
        archived_products: 1,
        low_stock_products: 3,
        out_of_stock_products: 1,
        products_without_images: 3,
        total_value: 500,
        categories_count: 2,
        brands_count: 1,
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
});
