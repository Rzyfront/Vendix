import { Test, TestingModule } from '@nestjs/testing';
import { S3Service } from '@common/services/s3.service';
import { ProductsBulkService } from './products-bulk.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { ProductsService } from './products.service';
import { ProductVariantService } from './services/product-variant.service';
import { AccessValidationService } from '@common/services/access-validation.service';
import { StockLevelManager } from '../inventory/shared/services/stock-level-manager.service';
import { LocationsService } from '../inventory/locations/locations.service';
import { RequestContextService } from '@common/context/request-context.service';
import { BulkProductUploadDto, BulkProductItemDto, ProductState } from './dto';
import {
  ConflictException,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';

// Mock para slugify
jest.mock('slugify', () => ({
  default: jest
    .fn()
    .mockImplementation((text) => text.toLowerCase().replace(/\s+/g, '-')),
}));

describe('ProductsBulkService', () => {
  let service: ProductsBulkService;
  let prismaService: StorePrismaService;
  let productsService: ProductsService;
  let variantService: ProductVariantService;
  let accessValidationService: AccessValidationService;
  let stockLevelManager: StockLevelManager;
  let locationsService: LocationsService;

  const mockPrismaService = {
    $transaction: jest.fn(),
    products: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    product_categories: {
      createMany: jest.fn(),
    },
    product_tax_assignments: {
      createMany: jest.fn(),
    },
    product_images: {
      createMany: jest.fn(),
    },
    stock_levels: {
      createMany: jest.fn(),
    },
    brands: {
      findFirst: jest.fn(),
    },
    categories: {
      findFirst: jest.fn(),
    },
    tax_categories: {
      findMany: jest.fn(),
    },
    units_of_measure: {
      // loadUomCatalogByCode (service.ts:442) reads the UoM catalog at the
      // start of every uploadProducts call. The mock must expose it; this
      // was a pre-existing gap hidden by the 16-min jest timeout in CI and
      // surfaced by the isolatedModules fix on the jest transform.
      findMany: jest.fn().mockResolvedValue([]),
    },
  };

  const mockProductsService = {
    create: jest.fn(),
    createVariant: jest.fn(),
  };

  const mockVariantService = {
    createVariant: jest.fn(),
    updateVariant: jest.fn(),
    removeVariant: jest.fn(),
  };

  const mockAccessValidationService = {
    validateStoreAccess: jest.fn(),
  };

  const mockStockLevelManager = {
    updateStock: jest.fn(),
    initializeStockLevelsForProduct: jest.fn(),
  };

  const mockLocationsService = {
    getDefaultLocation: jest.fn(),
  };

  const mockUser = {
    id: 1,
    email: 'test@example.com',
    organization_id: 1,
    store_id: 1,
    roles: ['admin'],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsBulkService,
        {
          provide: StorePrismaService,
          useValue: mockPrismaService,
        },
        // Image handling is S3Service's own contract (it has its own tests); these
        // stubs echo predictable values so a response assertion can read them.
        {
          provide: S3Service,
          useValue: {
            uploadImage: jest.fn().mockResolvedValue('https://s3/img.png'),
            uploadFile: jest.fn().mockResolvedValue('https://s3/file.xlsx'),
            downloadImage: jest.fn().mockResolvedValue(Buffer.from('')),
            deleteFile: jest.fn().mockResolvedValue(undefined),
            getPresignedUrl: jest.fn((url) => url),
            signUrl: jest.fn((url) => url),
          },
        },
        {
          provide: ProductsService,
          useValue: mockProductsService,
        },
        {
          provide: ProductVariantService,
          useValue: mockVariantService,
        },
        {
          provide: AccessValidationService,
          useValue: mockAccessValidationService,
        },
        {
          provide: StockLevelManager,
          useValue: mockStockLevelManager,
        },
        {
          provide: LocationsService,
          useValue: mockLocationsService,
        },
      ],
    }).compile();

    service = module.get<ProductsBulkService>(ProductsBulkService);
    prismaService = module.get<StorePrismaService>(StorePrismaService);
    productsService = module.get<ProductsService>(ProductsService);
    variantService = module.get<ProductVariantService>(ProductVariantService);
    accessValidationService = module.get<AccessValidationService>(
      AccessValidationService,
    );
    stockLevelManager = module.get<StockLevelManager>(StockLevelManager);
    locationsService = module.get<LocationsService>(LocationsService);

    // Reset all mocks
    jest.clearAllMocks();

    // Setup default context - mock the static method directly
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      organization_id: 1,
      store_id: 1,
      user_id: 1,
      is_super_admin: false,
      is_owner: true,
    });
  });

  describe('uploadProducts', () => {
    it('should process bulk upload successfully with all products', async () => {
      const bulkUploadDto: BulkProductUploadDto = {
        products: [
          {
            name: 'Product 1',
            base_price: 99.99,
            description: 'Test product 1',
            sku: 'PROD-001',
            stock_quantity: 10,
            category_ids: [1, 2],
          },
          {
            name: 'Product 2',
            base_price: 149.99,
            description: 'Test product 2',
            sku: 'PROD-002',
            stock_quantity: 5,
            brand_id: 1,
          },
        ],
      };

      const createdProducts = [
        {
          id: 1,
          name: 'Product 1',
          slug: 'product-1',
          base_price: 99.99,
          state: ProductState.ACTIVE,
          stores: { id: 1, name: 'Test Store' },
        },
        {
          id: 2,
          name: 'Product 2',
          slug: 'product-2',
          base_price: 149.99,
          state: ProductState.ACTIVE,
          stores: { id: 1, name: 'Test Store' },
        },
      ];

      // Mock successful product creation
      mockProductsService.create
        .mockResolvedValueOnce(createdProducts[0])
        .mockResolvedValueOnce(createdProducts[1]);

      // Mock brand validation
      mockPrismaService.brands.findFirst.mockResolvedValue({
        id: 1,
        name: 'Test Brand',
        state: 'active',
      });

      // Mock category validation
      mockPrismaService.categories.findFirst
        .mockResolvedValueOnce({ id: 1, name: 'Category 1', state: 'active' })
        .mockResolvedValueOnce({ id: 2, name: 'Category 2', state: 'active' });

      const result = await service.uploadProducts(bulkUploadDto, mockUser);

      expect(result).toEqual({
        success: true,
        total_processed: 2,
        successful: 2,
        // `skipped` cuenta las filas que el importador decidió no tocar (p. ej.
        // un SKU sin cambios); es parte del contrato del resultado, no opcional.
        skipped: 0,
        failed: 0,
        results: [
          {
            product: createdProducts[0],
            status: 'success',
            message: 'Producto creado exitosamente',
          },
          {
            product: createdProducts[1],
            status: 'success',
            message: 'Producto creado exitosamente',
          },
        ],
      });

      expect(mockProductsService.create).toHaveBeenCalledTimes(2);
      expect(
        mockAccessValidationService.validateStoreAccess,
      ).toHaveBeenCalledWith(1, mockUser);
    });

    it('should handle partial failures in bulk upload', async () => {
      const bulkUploadDto: BulkProductUploadDto = {
        products: [
          {
            name: 'Product 1',
            base_price: 99.99,
            sku: 'PROD-001',
          },
          {
            name: 'Product 2',
            base_price: 149.99,
            sku: 'PROD-001', // Duplicate SKU
          },
        ],
      };

      const createdProduct = {
        id: 1,
        name: 'Product 1',
        slug: 'product-1',
        base_price: 99.99,
        state: ProductState.ACTIVE,
        stores: { id: 1, name: 'Test Store' },
      };

      // First product succeeds, second fails due to duplicate SKU
      mockProductsService.create
        .mockResolvedValueOnce(createdProduct)
        .mockRejectedValueOnce(new ConflictException('El SKU ya está en uso'));

      const result = await service.uploadProducts(bulkUploadDto, mockUser);

      // La entrada de error ya no lleva el nombre de la clase de excepción:
      // lleva la coordenada del archivo (row_number, sku, product_name) para
      // que el usuario sepa QUÉ fila corregir en su Excel, más un error_code
      // legible por máquina cuando la excepción es tipada.
      expect(result).toEqual({
        success: false,
        total_processed: 2,
        successful: 1,
        skipped: 0,
        failed: 1,
        results: [
          {
            product: createdProduct,
            status: 'success',
            message: 'Producto creado exitosamente',
          },
          {
            product: null,
            status: 'error',
            message: 'El SKU ya está en uso',
            error_code: undefined,
            product_name: 'Product 2',
            row_number: 3,
            sku: 'PROD-001',
          },
        ],
      });
    });

    // DECISIÓN DE PRODUCTO A CONFIRMAR: una marca inexistente NO invalida la
    // fila. `validateProductData` la descarta (brand_id = undefined), deja un
    // logger.warn y sube el producto sin marca. La tolerancia tiene sentido en
    // una importación de 900 filas — una celda mala no debe tumbar el lote —
    // pero hoy el descarte NO viaja en el resultado, así que el usuario no se
    // entera de que perdió la marca. Si se quiere avisar, el lugar es un
    // `warnings[]` por fila, igual que CATALOG_ONLY_IGNORED_FIELDS en analyze.
    it('drops an unknown brand and still uploads the product', async () => {
      const bulkUploadDto: BulkProductUploadDto = {
        products: [
          {
            name: 'Product 1',
            base_price: 99.99,
            sku: 'PROD-001',
            brand_id: 999, // Non-existent brand
          },
        ],
      };

      mockPrismaService.brands.findFirst.mockResolvedValue(null);
      mockProductsService.create.mockResolvedValue({
        id: 1,
        name: 'Product 1',
        sku: 'PROD-001',
      });

      const result = await service.uploadProducts(bulkUploadDto, mockUser);

      expect(result.results[0].status).toBe('success');
      expect(result.failed).toBe(0);
      expect(mockProductsService.create).toHaveBeenCalledWith(
        expect.objectContaining({ brand_id: undefined }),
      );
    });

    it('forwards category ids untouched — existence is ProductsService\'s check', async () => {
      // El nivel bulk no valida existencia de categorías: reenvía los ids y
      // `ProductsService.create` decide (y es quien tiene el mensaje de error).
      // Duplicar la validación aquí produciría dos fuentes de verdad divergentes.
      const bulkUploadDto: BulkProductUploadDto = {
        products: [
          {
            name: 'Product 1',
            base_price: 99.99,
            sku: 'PROD-001',
            category_ids: [999],
          },
        ],
      };

      mockPrismaService.categories.findFirst.mockResolvedValue(null);
      mockProductsService.create.mockResolvedValue({ id: 1, sku: 'PROD-001' });

      await service.uploadProducts(bulkUploadDto, mockUser);

      expect(mockProductsService.create).toHaveBeenCalledWith(
        expect.objectContaining({ category_ids: [999] }),
      );
    });

    it('should handle empty products array', async () => {
      const bulkUploadDto: BulkProductUploadDto = {
        products: [],
      };

      const result = await service.uploadProducts(bulkUploadDto, mockUser);

      expect(result).toEqual({
        success: true,
        total_processed: 0,
        successful: 0,
        skipped: 0,
        failed: 0,
        results: [],
      });
    });

    it('should respect maximum batch size limit', async () => {
      // MAX_BATCH_SIZE = 1000. El tope no es cosmético: cada fila abre su propia
      // transacción en ProductsService, así que un lote sin techo agota el pool
      // de conexiones antes de terminar.
      const largeBatch = Array.from({ length: 1001 }, (_, i) => ({
        name: `Product ${i + 1}`,
        base_price: 99.99,
        sku: `PROD-${i + 1}`,
      }));

      const bulkUploadDto: BulkProductUploadDto = {
        products: largeBatch,
      };

      await expect(
        service.uploadProducts(bulkUploadDto, mockUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('should generate slugs automatically when not provided', async () => {
      const bulkUploadDto: BulkProductUploadDto = {
        products: [
          {
            name: 'Test Product Name',
            base_price: 99.99,
            sku: 'PROD-001',
          },
        ],
      };

      const createdProduct = {
        id: 1,
        name: 'Test Product Name',
        slug: 'test-product-name',
        base_price: 99.99,
        state: ProductState.ACTIVE,
      };

      mockProductsService.create.mockResolvedValue(createdProduct);

      const result = await service.uploadProducts(bulkUploadDto, mockUser);

      expect(result.results[0].product.slug).toBe('test-product-name');
    });

    it('should handle products with variants in bulk upload', async () => {
      const bulkUploadDto: BulkProductUploadDto = {
        products: [
          {
            name: 'Product with Variants',
            base_price: 99.99,
            sku: 'PROD-VAR-001',
            variants: [
              {
                sku: 'VAR-001',
                name: 'Variant 1',
                price_override: 109.99,
                stock_quantity: 10,
              },
              {
                sku: 'VAR-002',
                name: 'Variant 2',
                price_override: 119.99,
                stock_quantity: 5,
              },
            ],
          },
        ],
      };

      const createdProduct = {
        id: 1,
        name: 'Product with Variants',
        slug: 'product-with-variants',
        base_price: 99.99,
        state: ProductState.ACTIVE,
      };

      const createdVariants = [
        { id: 1, sku: 'VAR-001', product_id: 1 },
        { id: 2, sku: 'VAR-002', product_id: 1 },
      ];

      mockProductsService.create.mockResolvedValue(createdProduct);
      mockProductsService.createVariant
        .mockResolvedValueOnce(createdVariants[0])
        .mockResolvedValueOnce(createdVariants[1]);

      const result = await service.uploadProducts(bulkUploadDto, mockUser);

      expect(result.results[0].status).toBe('success');
      expect(mockProductsService.createVariant).toHaveBeenCalledTimes(2);
    });

    it('should handle stock by location in bulk upload', async () => {
      const bulkUploadDto: BulkProductUploadDto = {
        products: [
          {
            name: 'Product with Location Stock',
            base_price: 99.99,
            sku: 'PROD-LOC-001',
            stock_by_location: [
              {
                location_id: 1,
                quantity: 20,
                notes: 'Main warehouse',
              },
              {
                location_id: 2,
                quantity: 10,
                notes: 'Secondary warehouse',
              },
            ],
          },
        ],
      };

      const createdProduct = {
        id: 1,
        name: 'Product with Location Stock',
        slug: 'product-with-location-stock',
        base_price: 99.99,
        state: ProductState.ACTIVE,
      };

      mockProductsService.create.mockResolvedValue(createdProduct);
      mockLocationsService.getDefaultLocation.mockResolvedValue({
        id: 1,
        name: 'Default Location',
      });

      const result = await service.uploadProducts(bulkUploadDto, mockUser);

      // El import de productos es CATALOG-ONLY por diseño: `stock_quantity` y
      // `stock_by_location` están en CATALOG_ONLY_IGNORED_FIELDS y se retiran
      // de la fila antes de armar el DTO. Razón: saldo sin fila en
      // inventory_transactions (sin ubicación, sin capa de costo, sin usuario)
      // es inauditable. El inventario entra por ajustes/compras, que sí llevan
      // el libro. El servicio además reporta qué columnas ignoró en lugar de
      // descartarlas en silencio.
      expect(result.results[0].status).toBe('success');
      expect(mockStockLevelManager.updateStock).not.toHaveBeenCalled();
      expect(mockProductsService.create).toHaveBeenCalledWith(
        expect.not.objectContaining({ stock_by_location: expect.anything() }),
      );
    });
  });

  describe('validateBulkProducts', () => {
    it('should validate all products successfully', async () => {
      const products: BulkProductItemDto[] = [
        {
          name: 'Valid Product 1',
          base_price: 99.99,
          sku: 'PROD-001',
        },
        {
          name: 'Valid Product 2',
          base_price: 149.99,
          sku: 'PROD-002',
        },
      ];

      // Mock no existing SKUs
      mockPrismaService.products.findFirst.mockResolvedValue(null);

      const result = await service.validateBulkProducts(products, mockUser);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.validProducts).toHaveLength(2);
    });

    it('should detect duplicate SKUs in validation', async () => {
      const products: BulkProductItemDto[] = [
        {
          name: 'Product 1',
          base_price: 99.99,
          sku: 'PROD-001',
        },
        {
          name: 'Product 2',
          base_price: 149.99,
          sku: 'PROD-001', // Duplicate SKU
        },
      ];

      const result = await service.validateBulkProducts(products, mockUser);

      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      // Un solo error agregado que nombra TODOS los SKUs repetidos, no un
      // error por fila: el usuario corrige el archivo de una pasada.
      expect(result.errors[0]).toContain('SKUs duplicados en el archivo');
      expect(result.errors[0]).toContain('PROD-001');
    });

    it('accepts a SKU that already exists — the upload upserts', async () => {
      // El import pasó de "crear" a "crear o actualizar": `uploadProducts` busca
      // por SKU y hace update si lo encuentra. Por eso un SKU existente ya no es
      // un error de pre-validación; rechazarlo impediría el caso de uso central
      // (reimportar la lista de precios del proveedor).
      const products: BulkProductItemDto[] = [
        {
          name: 'Product 1',
          base_price: 99.99,
          sku: 'EXISTING-SKU',
        },
      ];

      mockPrismaService.products.findFirst.mockResolvedValue({
        id: 1,
        name: 'Existing Product',
        sku: 'EXISTING-SKU',
      });

      const result = await service.validateBulkProducts(products, mockUser);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.validProducts).toHaveLength(1);
    });

    it('should validate required fields', async () => {
      const products: BulkProductItemDto[] = [
        {
          name: '', // Empty name
          base_price: 99.99,
          sku: 'PROD-001',
        },
      ];

      const result = await service.validateBulkProducts(products, mockUser);

      expect(result.isValid).toBe(false);
      // Un único mensaje por fila que nombra los tres obligatorios juntos, con
      // el número de fila del archivo por delante.
      expect(result.errors[0]).toContain('Fila 1');
      expect(result.errors[0]).toContain(
        'Faltan datos obligatorios (Nombre, SKU o Precio)',
      );
    });

    it('lets a negative price through pre-validation (the upload rejects it)', async () => {
      // `validateBulkProducts` es una pre-lectura estructural: solo exige que
      // Nombre, SKU y Precio estén presentes. El signo lo valida
      // `validateProductData` durante `uploadProducts`, que es donde el rechazo
      // puede reportarse contra la fila concreta del archivo.
      const products: BulkProductItemDto[] = [
        {
          name: 'Product 1',
          base_price: -10,
          sku: 'PROD-001',
        },
      ];

      const result = await service.validateBulkProducts(products, mockUser);

      expect(result.isValid).toBe(true);
      expect(result.validProducts).toHaveLength(1);
    });

    it('uploadProducts rejects the negative price with its row coordinate', async () => {
      const result = await service.uploadProducts(
        {
          products: [{ name: 'Product 1', base_price: -10, sku: 'PROD-001' }],
        } as BulkProductUploadDto,
        mockUser,
      );

      expect(result.failed).toBe(1);
      expect(result.results[0].status).toBe('error');
      expect(result.results[0].message).toContain(
        'Precio base debe ser positivo',
      );
      expect(result.results[0].row_number).toBe(2);
    });
  });

  // DEUDA A DECIDIR: `getBulkUploadTemplate` quedó como stub deprecado — el
  // propio servicio lo marca "Deprecated in favor of Excel download" y devuelve
  // headers vacíos. Su ruta HTTP ya no existe (ver products-bulk.controller.spec),
  // así que hoy no tiene ningún consumidor. O se borra el método, o se
  // reexpone; mientras tanto el test fija el stub para que nadie lo confunda
  // con la plantilla real, que es `generateExcelTemplate`.
  describe('getBulkUploadTemplate (deprecated stub)', () => {
    it('returns an empty shell pointing at the Excel download', async () => {
      const result = await service.getBulkUploadTemplate();

      expect(result.headers).toEqual([]);
      expect(result.sample_data).toEqual([]);
      expect(result.instructions).toContain('Excel');
    });
  });

  describe('exportCurrentProductsAsTemplate', () => {
    it('should scope the query by store_id', async () => {
      // Hace falta al menos una fila: con 0 filas recolectadas el método lanza
      // en vez de devolver el buffer, y la aserción de scope nunca se evalúa.
      mockPrismaService.products.count.mockResolvedValueOnce(1);
      mockPrismaService.products.findMany.mockResolvedValueOnce([
        { id: 1, name: 'P1', sku: 'SKU-1', base_price: 10 },
      ]);
      await service.exportCurrentProductsAsTemplate();

      expect(mockPrismaService.products.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            store_id: expect.anything(),
          }),
        }),
      );
    });

    it('should throw NotFoundException with a clear message when no products exist', async () => {
      mockPrismaService.products.count.mockResolvedValueOnce(0);

      await expect(service.exportCurrentProductsAsTemplate()).rejects.toThrow(
        NotFoundException,
      );
      // El mensaje es accionable a propósito: dice qué falta y qué hacer, en
      // lugar de un 404 seco que el usuario lee como "se rompió".
      mockPrismaService.products.count.mockResolvedValueOnce(0);
      await expect(service.exportCurrentProductsAsTemplate()).rejects.toThrow(
        /No hay productos en su tienda/,
      );
    });

    it('should not call findMany when no products exist', async () => {
      mockPrismaService.products.count.mockResolvedValueOnce(0);
      mockPrismaService.products.findMany.mockClear();

      try {
        await service.exportCurrentProductsAsTemplate();
      } catch {
        // expected
      }

      expect(mockPrismaService.products.findMany).not.toHaveBeenCalled();
    });

    // Regla de negocio: los productos archivados NUNCA deben salir en la
    // descarga del template (mismo criterio que la UI usa para ocultarlos
    // en el listado de productos). Verificamos que tanto el count() previo
    // como el findMany() del chunk paginado filtren por `state: { not:
    // ProductState.ARCHIVED }`. Si esto se rompe, el usuario descarga 120+
    // productos "viejos" que aparecen como si estuvieran activos.
    it('should exclude archived products from both count() and findMany()', async () => {
      // Simular que hay productos no-archivados (count > 0) para que sí se
      // llegue a llamar findMany. Devolver [] corta el loop inmediatamente.
      mockPrismaService.products.count.mockResolvedValueOnce(5);
      mockPrismaService.products.findMany.mockResolvedValueOnce([]);

      try {
        await service.exportCurrentProductsAsTemplate();
      } catch {
        // Puede lanzar NotFoundException porque rows queda vacío; no nos
        // importa acá — lo que validamos son las llamadas a Prisma.
      }

      const expectedArchiveFilter = {
        state: { not: ProductState.ARCHIVED },
      };

      expect(mockPrismaService.products.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining(expectedArchiveFilter),
        }),
      );
      expect(mockPrismaService.products.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining(expectedArchiveFilter),
        }),
      );
    });

    // Regression: previously when count() failed (e.g. schema drift in prod),
    // the service silently set productCount=0 and threw NotFoundException
    // with 'No hay productos en su tienda' — misleading the user into
    // thinking they had no products. The fix differentiates the two cases.
    it('should throw InternalServerErrorException (not NotFoundException) when count() fails', async () => {
      mockPrismaService.products.count.mockReset();
      mockPrismaService.products.count.mockRejectedValueOnce(
        new Error('relation "products" does not exist'),
      );

      await expect(service.exportCurrentProductsAsTemplate()).rejects.toThrow(
        InternalServerErrorException,
      );
      await expect(service.exportCurrentProductsAsTemplate()).rejects.not.toThrow(
        NotFoundException,
      );
    });

    it('should retry findMany with minimal query when the rich include fails (schema drift fallback)', async () => {
      // First chunk: rich include fails -> fallback to minimal
      mockPrismaService.products.findMany
        .mockRejectedValueOnce(new Error('relation "stock_levels" does not exist'))
        .mockResolvedValueOnce([
          {
            id: 1,
            name: 'Drifted product',
            sku: 'DRF-1',
            product_type: 'physical',
            state: 'active',
            track_inventory: true,
            base_price: 10,
            description: '',
            product_tax_assignments: [],
            pricing_type: 'unit',
            available_for_ecommerce: false,
            is_featured: false,
            allow_pos_price_override: false,
            has_multiple_price_tiers: false,
            is_on_sale: false,
            sale_price: 0,
            cost_price: 0,
          },
        ]);

      const buffer = await service.exportCurrentProductsAsTemplate();
      expect(buffer).toBeInstanceOf(Buffer);

      // Should have called findMany twice: once rich (failed), once minimal (succeeded)
      expect(mockPrismaService.products.findMany).toHaveBeenCalledTimes(2);

      // Second call must NOT include the rich include (fallback path).
      const fallbackCall =
        mockPrismaService.products.findMany.mock.calls[1][0];
      expect(fallbackCall.include).toBeUndefined();
    });
  });
});
