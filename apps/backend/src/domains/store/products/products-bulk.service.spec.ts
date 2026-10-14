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
import * as XLSX from 'xlsx';
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
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    audit_logs: {
      create: jest.fn().mockResolvedValue({}),
    },
    product_variants: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    product_price_tier_assignments: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
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
      findMany: jest.fn().mockResolvedValue([]),
    },
    categories: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    tax_categories: {
      findMany: jest.fn(),
    },
    // Catálogo de unidades (QUI-648): loadUomCatalogByCode (:442) sólo
    // necesita findMany({ where: { is_active }, select: { id, code, name,
    // is_stock_eligible } }). Vacío por defecto: ningún test de este spec
    // ejercita códigos de unidad.
    units_of_measure: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };

  const mockProductsService = {
    create: jest.fn(),
    update: jest.fn(),
    createVariant: jest.fn(),
    updateVariant: jest.fn(),
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
            action: 'create',
            message: 'Producto creado exitosamente',
          },
          {
            product: createdProducts[1],
            status: 'success',
            action: 'create',
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
            action: 'create',
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

    it('maps a P2002 on products_store_id_barcode_active_key (driverAdapterError) to a barcode message', async () => {
      const p2002: any = new Error('Unique constraint failed');
      p2002.code = 'P2002';
      p2002.meta = {
        driverAdapterError: {
          cause: {
            kind: 'UniqueConstraintViolation',
            constraint: { index: 'products_store_id_barcode_active_key' },
          },
        },
      };
      mockProductsService.create.mockRejectedValueOnce(p2002);

      const result = await service.uploadProducts(
        {
          products: [{ name: 'Product B', base_price: 10, sku: 'PROD-B' }],
        } as BulkProductUploadDto,
        mockUser,
      );

      expect(result.failed).toBe(1);
      expect(result.results[0].message).toContain('código de barras');
      expect(result.results[0].message).not.toContain('SKU');
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
      // MAX_BATCH_SIZE = 10000. El tope no es cosmético: cada fila abre su propia
      // transacción en ProductsService, así que un lote sin techo agota el pool
      // de conexiones antes de terminar.
      const largeBatch = Array.from({ length: 10001 }, (_, i) => ({
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

      const result = await service.uploadProducts(bulkUploadDto, mockUser);

      expect(result.results[0].status).toBe('success');
      // Las variantes viajan dentro del DTO de create (una sola transacción en
      // ProductsService.create); el bulk ya no las crea una por una después.
      expect(mockProductsService.createVariant).not.toHaveBeenCalled();
      const [createDto] = mockProductsService.create.mock.calls[0];
      expect(createDto.variants).toHaveLength(2);
      expect(createDto.variants[0]).toMatchObject({
        sku: 'VAR-001',
        price_override: 109.99,
      });
      void createdVariants;
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

  // QUI-846: la plantilla guardaba el precio como texto y `parseFloat`
  // descartaba en silencio cualquier celda con símbolo o separador de miles,
  // dejando el producto creado con el default 0 de la DB. Ahora el parser de
  // dinero interpreta el formato local y una celda inválida/vacía se reporta
  // como error de fila en lugar de convertirse en precio 0.
  describe('parseFile — precio de carga masiva (QUI-846)', () => {
    const csv = (rows: string[]) =>
      Buffer.from(['Nombre,SKU,Precio Venta', ...rows].join('\n'));

    it('interpreta un precio con símbolo y separador de miles en celda de texto', () => {
      const [row] = service.parseFile(csv(['Prod,PROD-1,"$ 5.000"']));
      expect((row as any).base_price).toBe(5000);
    });

    it('interpreta "5.000" como cinco mil, no como cinco', () => {
      const [row] = service.parseFile(csv(['Prod,PROD-1,5.000']));
      expect((row as any).base_price).toBe(5000);
    });

    it('interpreta el formato colombiano 5.000,50', () => {
      const [row] = service.parseFile(csv(['Prod,PROD-1,"5.000,50"']));
      expect((row as any).base_price).toBe(5000.5);
    });

    it('deja el precio sin setear y registra el error cuando la celda no es numérica', () => {
      const [row] = service.parseFile(csv(['Prod,PROD-1,N/A']));
      expect((row as any).base_price).toBeUndefined();
      expect((row as any).__cell_errors).toEqual([
        expect.objectContaining({ field: 'base_price', code: 'INVALID_PRICE' }),
      ]);
    });

    it('no registra error cuando la celda de precio está vacía', () => {
      const [row] = service.parseFile(csv(['Prod,PROD-1,']));
      expect((row as any).base_price).toBeUndefined();
      expect((row as any).__cell_errors).toBeUndefined();
    });
  });

  describe('analyzeProducts — volumen (tope 10.000, lecturas agrupadas)', () => {
    const buildCsv = (n: number) =>
      Buffer.from(
        '\uFEFF' +
          [
            'Nombre,SKU,Precio Venta',
            ...Array.from({ length: n }, (_, i) => `P${i},S-${i},${i + 1}`),
          ].join('\n'),
        'utf-8',
      );
    const readCalls = () =>
      [
        mockPrismaService.products.findMany,
        mockPrismaService.products.findFirst,
        mockPrismaService.product_variants.findMany,
        mockPrismaService.brands.findMany,
        mockPrismaService.brands.findFirst,
        mockPrismaService.categories.findMany,
        mockPrismaService.categories.findFirst,
        mockPrismaService.units_of_measure.findMany,
        mockPrismaService.product_price_tier_assignments.findMany,
      ].reduce((acc, fn) => acc + fn.mock.calls.length, 0);

    const run = async (n: number) => {
      jest.clearAllMocks();
      mockPrismaService.products.findMany.mockResolvedValue([]);
      mockPrismaService.product_variants.findMany.mockResolvedValue([]);
      mockPrismaService.brands.findMany.mockResolvedValue([]);
      mockPrismaService.categories.findMany.mockResolvedValue([]);
      mockPrismaService.units_of_measure.findMany.mockResolvedValue([]);
      mockPrismaService.product_price_tier_assignments.findMany.mockResolvedValue(
        [],
      );
      const started = Date.now();
      const result = await service.analyzeProducts(buildCsv(n), 1);
      return { result, calls: readCalls(), ms: Date.now() - started };
    };

    it('el número de lecturas a BD no crece con N (10 vs 1000 vs 10000 filas)', async () => {
      const small = await run(10);
      const mid = await run(1000);
      const big = await run(10000);
      expect(big.result.products).toHaveLength(10000);
      expect(small.calls).toBeGreaterThan(0);
      expect(mid.calls).toBe(small.calls);
      expect(big.calls).toBe(small.calls);
      expect(big.ms).toBeLessThan(30000);
    }, 60000);

    it('rechaza 10.001 filas', async () => {
      await expect(
        service.analyzeProducts(buildCsv(10001), 1),
      ).rejects.toThrow();
    }, 60000);
  });

  describe('analyzeProducts — precio (QUI-846)', () => {
    beforeEach(() => {
      mockPrismaService.products.findMany.mockResolvedValue([]);
    });

    const analyze = (rows: string[]) =>
      service.analyzeProducts(
        Buffer.from(['Nombre,SKU,Precio Venta', ...rows].join('\n')),
        1,
      );

    it('marca la fila como error cuando el precio no es numérico', async () => {
      const result = await analyze(['Prod,PROD-1,N/A']);
      const item = result.products[0];
      expect(item.status).toBe('error');
      expect(
        item.errors.map((e) => (e as { code: string }).code),
      ).toContain('INVALID_PRICE');
      expect(result.ready).toBe(0);
      expect(result.with_errors).toBe(1);
    });

    it('marca la fila como error cuando falta el precio', async () => {
      const result = await analyze(['Prod,PROD-1,']);
      const item = result.products[0];
      expect(item.status).toBe('error');
      expect(
        item.errors.map((e) => (e as { code: string }).code),
      ).toContain('MISSING_PRICE');
    });

    it('acepta y normaliza un precio con separador de miles', async () => {
      const result = await analyze(['Prod,PROD-1,"5.000"']);
      const item = result.products[0];
      expect(item.base_price).toBe(5000);
      expect(item.status).toBe('ready');
    });
  });

  describe('código de barras en carga masiva', () => {
    // BOM UTF-8 como el que escribe Excel: sin él SheetJS lee el CSV como
    // latin-1 y 'Código' llega corrupto.
    const csv = (header: string, rows: string[]) =>
      Buffer.from('\uFEFF' + [header, ...rows].join('\n'), 'utf-8');

    it("mapea el encabezado 'Código de barras' (con tilde)", () => {
      const [row] = service.parseFile(
        csv('Nombre,SKU,Código de barras,Precio Venta', [
          'P,S-1,7702001234567,1000',
        ]),
      );
      expect((row as any).barcode).toBe('7702001234567');
    });

    it("mapea 'codigo de barras', 'barcode', 'ean' y 'gtin'", () => {
      for (const h of ['codigo de barras', 'BARCODE', 'EAN', 'gtin']) {
        const [row] = service.parseFile(
          csv(`Nombre,SKU,${h},Precio Venta`, ['P,S-1,123456,1000']),
        );
        expect((row as any).barcode).toBe('123456');
      }
    });

    it('convierte una celda numérica a texto exacto', () => {
      const ws = XLSX.utils.aoa_to_sheet([
        ['Nombre', 'SKU', 'Código de barras', 'Precio Venta'],
        ['P', 'S-1', 7702001234567, 1000],
      ]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Hoja1');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      const [row] = service.parseFile(buf);
      expect((row as any).barcode).toBe('7702001234567');
    });

    it('conserva el cero inicial de un barcode de texto', () => {
      const [row] = service.parseFile(
        csv('Nombre,SKU,Código de barras,Precio Venta', [
          'P,S-1,0123456789012,1000',
        ]),
      );
      expect((row as any).barcode).toBe('0123456789012');
    });

    it('rechaza la notación científica con error de fila', () => {
      const [row] = service.parseFile(
        csv('Nombre,SKU,Código de barras,Precio Venta', [
          'P,S-1,7.702E+12,1000',
        ]),
      );
      expect((row as any).barcode).toBeUndefined();
      expect((row as any).__cell_errors).toEqual([
        expect.objectContaining({
          field: 'barcode',
          message: expect.stringContaining('formatee la columna como texto'),
        }),
      ]);
    });

    it('rechaza un número no entero seguro (notación científica en xlsx)', () => {
      const ws = XLSX.utils.aoa_to_sheet([
        ['Nombre', 'SKU', 'Código de barras', 'Precio Venta'],
        ['P', 'S-1', 1.2345678901234567e21, 1000],
      ]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Hoja1');
      const [row] = service.parseFile(
        XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }),
      );
      expect((row as any).__cell_errors?.[0]?.field).toBe('barcode');
    });

    it('rechaza un barcode de más de 64 caracteres', () => {
      const [row] = service.parseFile(
        csv('Nombre,SKU,Código de barras,Precio Venta', [
          `P,S-1,${'1'.repeat(65)},1000`,
        ]),
      );
      expect((row as any).barcode).toBeUndefined();
      expect((row as any).__cell_errors?.[0]?.field).toBe('barcode');
    });

    it('celda vacía = sin barcode y sin error', () => {
      const [row] = service.parseFile(
        csv('Nombre,SKU,Código de barras,Precio Venta', ['P,S-1,,1000']),
      );
      expect((row as any).barcode).toBeUndefined();
      expect((row as any).__cell_errors).toBeUndefined();
    });

    describe('analyzeProducts', () => {
      const analyze = (rows: string[]) =>
        service.analyzeProducts(
          csv('Nombre,SKU,Código de barras,Precio Venta', rows),
          1,
        );
      const codes = (item: any) => item.errors.map((e: any) => e.code);

      beforeEach(() => {
        mockPrismaService.products.findMany.mockReset();
        mockPrismaService.products.findMany.mockResolvedValue([]);
        mockPrismaService.product_variants.findMany.mockReset();
        mockPrismaService.product_variants.findMany.mockResolvedValue([]);
        mockPrismaService.product_price_tier_assignments.findMany.mockReset();
        mockPrismaService.product_price_tier_assignments.findMany.mockResolvedValue(
          [],
        );
      });

      it('expone el barcode en el item y lo acepta cuando está libre', async () => {
        const result = await analyze(['P,S-1,0123456789012,1000']);
        const item = result.products[0] as any;
        expect(item.barcode).toBe('0123456789012');
        expect(item.status).toBe('ready');
        expect(item.modified_fields).toContain('barcode');
      });

      it('marca error cuando el barcode se repite en el archivo con otro SKU', async () => {
        const result = await analyze([
          'A,S-1,111,1000',
          'B,S-2,111,1000',
        ]);
        expect(result.products[0].status).toBe('ready');
        expect(codes(result.products[1])).toContain('DUPLICATE_BARCODE_IN_BATCH');
      });

      it('marca error cuando el barcode pertenece a otro SKU de la tienda', async () => {
        mockPrismaService.products.findMany.mockImplementation(
          async (args: any) =>
            args.where?.barcode
              ? [{ id: 50, barcode: '111' }]
              : [{ id: 7, sku: 'S-1', name: 'Uno' }],
        );
        const result = await analyze(['A,S-2,111,1000']);
        expect(codes(result.products[0])).toContain('BARCODE_IN_USE');
        expect(result.with_errors).toBe(1);
      });

      it('marca error cuando el barcode pertenece a una variante o presentación', async () => {
        mockPrismaService.product_variants.findMany.mockResolvedValue([
          { product_id: 60, barcode: '222' },
        ]);
        mockPrismaService.product_price_tier_assignments.findMany.mockResolvedValue(
          [{ product_id: 61, barcode: '333' }],
        );
        const result = await analyze(['A,S-1,222,1000', 'B,S-2,333,1000']);
        expect(codes(result.products[0])).toContain('BARCODE_IN_USE');
        expect(codes(result.products[1])).toContain('BARCODE_IN_USE');
      });

      it('productos y variantes solo cuentan si no están archivados; presentaciones siempre', async () => {
        await analyze(['A,S-1,444,1000']);
        const productWhere = mockPrismaService.products.findMany.mock.calls
          .map((c: any) => c[0].where)
          .find((w: any) => w.barcode);
        expect(productWhere).toEqual({
          store_id: 1,
          barcode: { in: ['444'] },
          state: { not: 'archived' },
        });
        expect(
          mockPrismaService.product_variants.findMany.mock.calls[0][0].where,
        ).toEqual({
          barcode: { in: ['444'] },
          products: { store_id: 1, state: { not: 'archived' } },
        });
        // Presentaciones: sin filtro de estado del producto.
        expect(
          mockPrismaService.product_price_tier_assignments.findMany.mock
            .calls[0][0].where,
        ).toEqual({ barcode: { in: ['444'] }, product: { store_id: 1 } });
      });

      it('presentación de un producto archivado sigue bloqueando y el mensaje lo nombra', async () => {
        mockPrismaService.product_price_tier_assignments.findMany.mockResolvedValue(
          [
            {
              product_id: 61,
              barcode: '333',
              product: { name: 'Caja Vieja', state: 'archived' },
            },
          ],
        );
        const result = await analyze(['A,S-1,333,1000']);
        const err = (result.products[0].errors as any[]).find(
          (e) => e.code === 'BARCODE_IN_USE',
        );
        expect(err.message).toBe(
          'El código de barras ya está en uso por una presentación de venta del producto archivado "Caja Vieja" de esta tienda',
        );
      });

      it('acepta el mismo SKU con su mismo barcode (update)', async () => {
        mockPrismaService.products.findMany.mockImplementation(
          async (args: any) =>
            args.where?.barcode
              ? [{ id: 7, barcode: '111' }]
              : [{ id: 7, sku: 'S-1', name: 'Uno' }],
        );
        const result = await analyze(['A,S-1,111,1000']);
        expect(result.products[0].action).toBe('update');
        expect(codes(result.products[0])).not.toContain('BARCODE_IN_USE');
        expect(result.products[0].status).toBe('ready');
      });

      it('consulta cada tabla una sola vez sobre el set de barcodes', async () => {
        await analyze(['A,S-1,111,1000', 'B,S-2,222,1000', 'C,S-3,333,1000']);
        const barcodeCalls = mockPrismaService.products.findMany.mock.calls.filter(
          ([a]: any[]) => a.where?.barcode,
        );
        expect(barcodeCalls).toHaveLength(1);
        expect(mockPrismaService.product_variants.findMany).toHaveBeenCalledTimes(1);
        expect(
          mockPrismaService.product_price_tier_assignments.findMany,
        ).toHaveBeenCalledTimes(1);
      });

      it('la notación científica llega como error de fila', async () => {
        const result = await analyze(['A,S-1,7.7E+12,1000']);
        expect(codes(result.products[0])).toContain('INVALID_BARCODE');
      });
    });

    describe('mapeo a DTOs', () => {
      it('mapToCreateProductDto propaga el barcode', () => {
        const dto = (service as any).mapToCreateProductDto(
          { name: 'P', sku: 'S-1', base_price: 10, barcode: '0123' },
          1,
        );
        expect(dto.barcode).toBe('0123');
      });

      it('mapToUpdateProductDto lo incluye solo si viene (sparse)', () => {
        expect(
          (service as any).mapToUpdateProductDto({ sku: 'S-1', barcode: '0123' })
            .barcode,
        ).toBe('0123');
        expect(
          'barcode' in (service as any).mapToUpdateProductDto({ sku: 'S-1' }),
        ).toBe(false);
      });
    });

    describe('plantillas', () => {
      const headerRow = (buf: Buffer) => {
        const wb = XLSX.read(buf, { type: 'buffer' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        return XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 })[0];
      };

      it('la plantilla de productos y la de servicios incluyen la columna', async () => {
        expect(headerRow(await service.generateExcelTemplate('products'))).toContain(
          'Código de barras',
        );
        expect(headerRow(await service.generateExcelTemplate('services'))).toContain(
          'Código de barras',
        );
      });

      it('el ejemplo con cero inicial sobrevive como texto', async () => {
        const wb = XLSX.read(await service.generateExcelTemplate('products'), {
          type: 'buffer',
        });
        const rows = XLSX.utils.sheet_to_json<any>(wb.Sheets[wb.SheetNames[0]]);
        expect(
          rows.map((r) => r['Código de barras']).filter(Boolean),
        ).toContain('0123456789012');
      });

      it('el export actual llena el barcode del producto como texto', async () => {
        mockPrismaService.products.count.mockResolvedValue(1);
        mockPrismaService.products.findMany.mockReset();
        mockPrismaService.products.findMany.mockResolvedValueOnce([
          {
            id: 1,
            name: 'P',
            sku: 'S-1',
            barcode: '0123456789012',
            state: 'active',
            product_type: 'physical',
            base_price: 10,
          },
        ]);
        const buf = await service.exportCurrentProductsAsTemplate();
        const wb = XLSX.read(buf, { type: 'buffer' });
        const rows = XLSX.utils.sheet_to_json<any>(wb.Sheets[wb.SheetNames[0]]);
        expect(rows[0]['Código de barras']).toBe('0123456789012');
      });
    });
  });

  describe('uploadProductsFromSession — commit paginado', () => {
    let s3: { downloadImage: jest.Mock; deleteFile: jest.Mock };

    const fileWithRows = (n: number) =>
      Buffer.from(
        [
          'Nombre,SKU,Precio Venta',
          ...Array.from({ length: n }, (_, i) => `P${i + 1},SKU-${i + 1},1000`),
        ].join('\n'),
      );

    beforeEach(() => {
      s3 = (service as any).s3Service;
      s3.downloadImage.mockResolvedValue(fileWithRows(200));
      s3.deleteFile.mockClear();
      mockPrismaService.products.findFirst.mockResolvedValue(null);
      mockProductsService.create.mockReset();
      mockProductsService.create.mockImplementation(async (dto: any) => ({
        id: 1,
        name: dto.name,
        sku: dto.sku,
      }));
    });

    it('dos páginas 100/100 sobre 200 filas: done false/true y S3 borrado solo al final', async () => {
      const p1: any = await service.uploadProductsFromSession('sid', 1, mockUser, {
        offset: 0,
        limit: 100,
      });
      expect(p1).toMatchObject({
        total: 200,
        offset: 0,
        limit: 100,
        done: false,
        successful: 100,
        failed: 0,
        total_processed: 100,
      });
      expect(p1.results).toHaveLength(100);
      expect(s3.deleteFile).not.toHaveBeenCalled();

      const p2: any = await service.uploadProductsFromSession('sid', 1, mockUser, {
        offset: 100,
        limit: 100,
      });
      expect(p2).toMatchObject({ total: 200, offset: 100, done: true, successful: 100 });
      expect(s3.deleteFile).toHaveBeenCalledTimes(1);
      expect(s3.deleteFile).toHaveBeenCalledWith('tmp/bulk-products/1/sid.xlsx');
      expect(mockProductsService.create).toHaveBeenCalledTimes(200);
    });

    it('row_number de la página 2 empieza en 102 y una fila inválida no aborta la página', async () => {
      mockProductsService.create.mockImplementation(async (dto: any) => {
        if (dto.sku === 'SKU-101') throw new BadRequestException('boom');
        return { id: 1, name: dto.name, sku: dto.sku };
      });
      const p2: any = await service.uploadProductsFromSession('sid', 1, mockUser, {
        offset: 100,
        limit: 100,
      });
      expect(p2.failed).toBe(1);
      expect(p2.successful).toBe(99);
      const err = p2.results.find((r: any) => r.status === 'error');
      expect(err.row_number).toBe(102);
      expect(err.sku).toBe('SKU-101');
      expect(p2.done).toBe(true);
    });

    it('una excepción en una página intermedia no borra el S3', async () => {
      mockAccessValidationService.validateStoreAccess.mockRejectedValueOnce(
        new Error('fallo'),
      );
      await expect(
        service.uploadProductsFromSession('sid', 1, mockUser, { offset: 0, limit: 100 }),
      ).rejects.toThrow('fallo');
      expect(s3.deleteFile).not.toHaveBeenCalled();
    });

    it('offset >= total responde 400 y no borra el S3', async () => {
      await expect(
        service.uploadProductsFromSession('sid', 1, mockUser, { offset: 200, limit: 100 }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(s3.deleteFile).not.toHaveBeenCalled();
    });

    it('sin offset/limit conserva el comportamiento legacy: procesa todo y borra el S3', async () => {
      const r: any = await service.uploadProductsFromSession('sid', 1, mockUser);
      expect(r.total_processed).toBe(200);
      expect(r.done).toBeUndefined();
      expect(s3.deleteFile).toHaveBeenCalledTimes(1);
    });

    it('sesión inexistente sigue devolviendo BULK_PROD_SESSION_EXPIRED', async () => {
      s3.downloadImage.mockRejectedValueOnce(new Error('nope'));
      await expect(
        service.uploadProductsFromSession('sid', 1, mockUser, { offset: 0, limit: 100 }),
      ).rejects.toMatchObject({ errorCode: 'BULK_PROD_SESSION_EXPIRED' });
    });

    it('BulkUploadSessionDto valida limit<=100 y offset>=0', async () => {
      const { plainToInstance } = await import('class-transformer');
      const { validate } = await import('class-validator');
      const { BulkUploadSessionDto } = await import('./dto');
      const bad = await validate(
        plainToInstance(BulkUploadSessionDto, { session_id: 'x', limit: 101 }),
      );
      expect(bad.map((e) => e.property)).toContain('limit');
      const neg = await validate(
        plainToInstance(BulkUploadSessionDto, { session_id: 'x', offset: -1 }),
      );
      expect(neg.map((e) => e.property)).toContain('offset');
      const ok = await validate(
        plainToInstance(BulkUploadSessionDto, { session_id: 'x', offset: '100', limit: '100' }),
      );
      expect(ok).toHaveLength(0);
    });
  });
  describe('reactivación de producto archivado por SKU', () => {
    const csv = (rows: string[]) =>
      Buffer.from(
        '\uFEFF' + ['Nombre,SKU,Precio Venta', ...rows].join('\n'),
        'utf-8',
      );
    const codes = (item: any) => item.errors.map((e: any) => e.code);

    describe('analyzeProducts', () => {
      beforeEach(() => {
        mockPrismaService.products.findMany.mockReset();
      });

      it('SKU solo en un archivado => action reactivate con su id', async () => {
        mockPrismaService.products.findMany.mockResolvedValue([
          { id: 9, sku: 'S-1', name: 'Viejo', slug: 'viejo', state: 'archived' },
        ]);
        const result = await service.analyzeProducts(csv(['Viejo,S-1,1000']), 1);
        const item = result.products[0];
        expect(item.action).toBe('reactivate');
        expect(item.existing_product_id).toBe(9);
        expect(item.errors).toHaveLength(0);
        // El pre-fetch ya no excluye archivados.
        expect(
          mockPrismaService.products.findMany.mock.calls[0][0].where,
        ).toEqual({ store_id: 1 });
      });

      it('SKU en un activo => action update', async () => {
        mockPrismaService.products.findMany.mockResolvedValue([
          { id: 7, sku: 'S-1', name: 'Uno', slug: 'uno', state: 'active' },
        ]);
        const result = await service.analyzeProducts(csv(['Uno,S-1,1000']), 1);
        expect(result.products[0].action).toBe('update');
        expect(result.products[0].existing_product_id).toBe(7);
      });

      it('slug de un archivado de otro SKU NO choca (ya no ocupa el slug)', async () => {
        mockPrismaService.products.findMany.mockResolvedValue([
          { id: 9, sku: 'OTRO', name: 'Camisa Roja', slug: 'camisa-roja', state: 'archived' },
        ]);
        const result = await service.analyzeProducts(
          csv(['Camisa Roja,S-NEW,1000']),
          1,
        );
        const item = result.products[0];
        expect(item.action).toBe('create');
        expect(codes(item)).not.toContain('DUPLICATE_SLUG');
        expect(item.errors).toHaveLength(0);
        expect(result.with_errors).toBe(0);
      });

      it('slug que usa un producto NO archivado de otro SKU => DUPLICATE_SLUG sin decir archivado', async () => {
        mockPrismaService.products.findMany.mockResolvedValue([
          { id: 8, sku: 'OTRO', name: 'Camisa Roja', slug: 'camisa-roja', state: 'active' },
        ]);
        const result = await service.analyzeProducts(
          csv(['Camisa Roja,S-NEW,1000']),
          1,
        );
        const item = result.products[0];
        expect(codes(item)).toContain('DUPLICATE_SLUG');
        const msg = (item.errors[0] as any).message as string;
        expect(msg).not.toContain('archivado');
        expect(msg).toContain('Camisa Roja');
        expect(item.status).toBe('error');
      });

      it('activo + archivado con el mismo SKU => update sobre el activo (cualquier orden)', async () => {
        const active = { id: 7, sku: 'S-1', name: 'Uno', slug: 'uno', state: 'active', updated_at: new Date('2026-01-01') };
        const arch = { id: 9, sku: 'S-1', name: 'Viejo', slug: 'viejo', state: 'archived', updated_at: new Date('2026-06-01') };
        for (const rows of [[active, arch], [arch, active]]) {
          mockPrismaService.products.findMany.mockResolvedValue(rows);
          const result = await service.analyzeProducts(csv(['Uno,S-1,1000']), 1);
          expect(result.products[0].action).toBe('update');
          expect(result.products[0].existing_product_id).toBe(7);
        }
      });

      it('varios archivados con el mismo SKU => reactivate del más reciente', async () => {
        mockPrismaService.products.findMany.mockResolvedValue([
          { id: 11, sku: 'S-1', name: 'Reciente', slug: 'a', state: 'archived', updated_at: new Date('2026-06-01') },
          { id: 12, sku: 'S-1', name: 'Antiguo', slug: 'b', state: 'archived', updated_at: new Date('2026-01-01') },
        ]);
        const result = await service.analyzeProducts(csv(['X,S-1,1000']), 1);
        expect(result.products[0].action).toBe('reactivate');
        expect(result.products[0].existing_product_id).toBe(11);
      });
    });

    describe('uploadProducts (commit)', () => {
      // Solo hay un archivado con ese SKU; slug/barcode libres.
      const mockOnlyArchivedBySku = (arch: any) =>
        mockPrismaService.products.findFirst.mockImplementation(
          async (args: any) =>
            args.where.sku && args.where.state === 'archived' ? arch : null,
        );
      const row = (extra: Record<string, any> = {}): any => ({
        name: 'Camisa Roja',
        sku: 'S-1',
        base_price: 50000,
        ...extra,
      });

      it('SKU archivado: no crea, reactiva y aplica el set completo (ausentes en default/null)', async () => {
        mockOnlyArchivedBySku({
          id: 9,
          sku: 'S-1',
          state: 'archived',
          description: 'DESCRIPCION VIEJA',
          is_featured: true,
        });
        mockProductsService.update.mockResolvedValue({ id: 9, state: 'active' });

        const result = await service.uploadProducts(
          { products: [row({ description: 'Nueva' })] },
          mockUser,
        );

        expect(mockProductsService.create).not.toHaveBeenCalled();
        // Primero busca el NO archivado; luego el archivado más reciente.
        const calls = mockPrismaService.products.findFirst.mock.calls;
        expect(calls[0][0].where).toEqual({
          store_id: 1,
          sku: 'S-1',
          state: { not: 'archived' },
        });
        expect(calls[1][0]).toMatchObject({
          where: { store_id: 1, sku: 'S-1', state: 'archived' },
          orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
        });
        expect(mockPrismaService.products.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 9, store_id: 1 },
            data: expect.objectContaining({ state: 'active' }),
          }),
        );
        expect(mockProductsService.update).toHaveBeenCalledTimes(1);
        const [id, dto] = mockProductsService.update.mock.calls[0];
        expect(id).toBe(9);
        expect(dto.name).toBe('Camisa Roja');
        expect(dto.description).toBe('Nueva');
        expect(dto).not.toHaveProperty('store_id');
        // Ausentes en el archivo: default de creación, no el valor viejo.
        expect(dto.is_featured).toBe(false);
        expect(dto.brand_id).toBeNull();
        expect(dto.category_ids).toEqual([]);
        expect(dto.tax_category_ids).toEqual([]);
        expect(dto.state).toBe('active');
        expect(dto.booking_mode).toBe('provider_required');
        expect(dto.price_unit_quantity).toBe(1);
        expect(mockPrismaService.audit_logs.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              action: 'PRODUCT_REACTIVATE',
              resource_id: 9,
            }),
          }),
        );
        expect(result.successful).toBe(1);
        expect(result.results[0]).toMatchObject({
          status: 'success',
          action: 'reactivate',
          message: 'Producto con SKU S-1 reactivado con los datos del archivo',
        });
      });

      it('SKU archivado: si el update falla vuelve a archived y reporta el error', async () => {
        mockOnlyArchivedBySku({ id: 9, sku: 'S-1', state: 'archived' });
        mockProductsService.update.mockRejectedValue(new Error('boom'));

        const result = await service.uploadProducts({ products: [row()] }, mockUser);

        expect(result.failed).toBe(1);
        expect(result.results[0].message).toBe('boom');
        const calls = mockPrismaService.products.updateMany.mock.calls;
        expect(calls[calls.length - 1][0].data.state).toBe('archived');
      });

      it('activo + archivado con el mismo SKU: el commit prefiere el activo', async () => {
        mockPrismaService.products.findFirst.mockImplementation(
          async (args: any) =>
            args.where.state?.not === 'archived'
              ? { id: 7, sku: 'S-1', state: 'active' }
              : { id: 9, sku: 'S-1', state: 'archived' },
        );
        mockProductsService.update.mockResolvedValue({ id: 7 });

        const result = await service.uploadProducts({ products: [row()] }, mockUser);

        expect(mockPrismaService.products.updateMany).not.toHaveBeenCalled();
        expect(mockProductsService.update.mock.calls[0][0]).toBe(7);
        expect(result.results[0]).toMatchObject({ action: 'update' });
      });

      it('reactivación con barcode ocupado por un activo: PROD_BARCODE_DUP_001 y no cambia el estado', async () => {
        mockPrismaService.products.findFirst.mockImplementation(
          async (args: any) => {
            if (args.where.sku)
              return args.where.state === 'archived'
                ? { id: 9, sku: 'S-1', state: 'archived' }
                : null;
            if (args.where.barcode)
              return { id: 5, name: 'Camisa Azul' };
            return null;
          },
        );

        const result = await service.uploadProducts(
          { products: [row({ barcode: '7701234567890' })] },
          mockUser,
        );

        expect(result.failed).toBe(1);
        expect(result.results[0]).toMatchObject({
          status: 'error',
          error_code: 'PROD_BARCODE_DUP_001',
        });
        expect(result.results[0].message).toContain('Camisa Azul');
        expect(mockPrismaService.products.updateMany).not.toHaveBeenCalled();
        expect(mockProductsService.update).not.toHaveBeenCalled();
      });

      it('reactivación con slug ocupado por un activo: PROD_DUP_001 y no cambia el estado', async () => {
        mockPrismaService.products.findFirst.mockImplementation(
          async (args: any) => {
            if (args.where.sku)
              return args.where.state === 'archived'
                ? { id: 9, sku: 'S-1', state: 'archived' }
                : null;
            if (args.where.slug) return { id: 5, name: 'Camisa Roja 2' };
            return null;
          },
        );

        const result = await service.uploadProducts({ products: [row()] }, mockUser);

        expect(result.results[0]).toMatchObject({
          status: 'error',
          error_code: 'PROD_DUP_001',
        });
        expect(result.results[0].message).toContain('Camisa Roja 2');
        expect(mockPrismaService.products.updateMany).not.toHaveBeenCalled();
      });

      it('SKU activo: sigue la ruta update sparse, sin tocar estado ni crear', async () => {
        mockPrismaService.products.findFirst.mockResolvedValue({
          id: 7,
          sku: 'S-1',
          state: 'active',
        });
        mockProductsService.update.mockResolvedValue({ id: 7 });

        const result = await service.uploadProducts({ products: [row()] }, mockUser);

        expect(mockProductsService.create).not.toHaveBeenCalled();
        expect(mockPrismaService.products.updateMany).not.toHaveBeenCalled();
        const [id, dto] = mockProductsService.update.mock.calls[0];
        expect(id).toBe(7);
        // Sparse: lo que el archivo no trae no aparece.
        expect(dto).not.toHaveProperty('is_featured');
        expect(dto).not.toHaveProperty('description');
        expect(result.results[0]).toMatchObject({
          action: 'update',
          message: 'Producto con SKU S-1 actualizado exitosamente',
        });
      });
    });
  });

  describe('variantes en carga masiva (SKU Padre)', () => {
    const HEADER =
      'Nombre,SKU,Precio Venta,SKU Padre,Atributo 1,Valor 1,Atributo 2,Valor 2,Marca,Usa Listas de Precio';
    const file = (rows: string[], header = HEADER) =>
      Buffer.from([header, ...rows].join('\n'));
    const codes = (list: any[]) => list.map((e) => e.code ?? e);

    // padre + 2 variantes (una sin precio, una con otro precio)
    const family = [
      'Camiseta,CAM,45000,,,,,,,',
      ',CAM-N-M,,CAM,Color,Negro,Talla,M,,',
      'Camiseta Blanca L,CAM-B-L,49000,CAM,Color,Blanco,Talla,L,,',
    ];

    beforeEach(() => {
      mockPrismaService.products.findMany.mockReset();
      mockPrismaService.products.findMany.mockResolvedValue([]);
      mockPrismaService.product_variants.findMany.mockReset();
      mockPrismaService.product_variants.findMany.mockResolvedValue([]);
      mockPrismaService.product_price_tier_assignments.findMany.mockReset();
      mockPrismaService.product_price_tier_assignments.findMany.mockResolvedValue(
        [],
      );
    });

    describe('parseFile', () => {
      it('agrupa padre + 2 variantes y conserva la fila de origen', () => {
        const rows = service.parseFile(file(family));
        expect(rows).toHaveLength(1);
        const parent: any = rows[0];
        expect(parent.__row_number).toBe(2);
        expect(parent.variants).toHaveLength(2);
        expect(parent.variants[0]).toMatchObject({
          sku: 'CAM-N-M',
          // Sin Nombre en la fila: `<padre> <valores>`.
          name: 'Camiseta Negro M',
          attributes: { Color: 'Negro', Talla: 'M' },
          __row_number: 3,
        });
        expect(parent.variants[0].price).toBeUndefined();
        expect(parent.variants[1]).toMatchObject({
          name: 'Camiseta Blanca L',
          price: 49000,
          __row_number: 4,
        });
        // Columnas de variante no se filtran al producto.
        expect(parent).not.toHaveProperty('parent_sku');
        expect(parent).not.toHaveProperty('attr_name_1');
      });

      it('agrupa aunque las variantes vengan antes que el padre (sin distinguir mayúsculas)', () => {
        const rows = service.parseFile(
          file([
            ',CAM-N-M,,cam,Color,Negro,,,,',
            'Camiseta,CAM,45000,,,,,,,',
          ]),
        );
        expect(rows).toHaveLength(1);
        expect((rows[0] as any).variants).toHaveLength(1);
        expect((rows[0] as any).variants[0].__row_number).toBe(2);
        expect((rows[0] as any).__row_number).toBe(3);
      });

      it('variante huérfana sale como producto independiente marcado con error de celda', () => {
        const rows: any[] = service.parseFile(
          file(['Camiseta,CAM,45000,,,,,,,', ',X-1,,NO-EXISTE,Color,Rojo,,,,']),
        );
        expect(rows).toHaveLength(2);
        expect(rows[1].__orphan_variant).toBe(true);
        expect(rows[1].__cell_errors).toEqual([
          expect.objectContaining({ code: 'VARIANT_PARENT_NOT_FOUND' }),
        ]);
        expect(rows[0].variants).toBeUndefined();
      });

      it('un padre que a su vez es variante deja huérfana a la fila hija', () => {
        const rows: any[] = service.parseFile(
          file([
            'Camiseta,CAM,45000,,,,,,,',
            ',CAM-N,,CAM,Color,Negro,,,,',
            ',CAM-N-XL,,CAM-N,Talla,XL,,,,',
          ]),
        );
        expect(rows).toHaveLength(2);
        expect(rows[0].variants).toHaveLength(1);
        expect(rows[1].__orphan_variant).toBe(true);
      });

      it('lista las columnas de producto con dato que la fila-variante ignora', () => {
        const [parent]: any[] = service.parseFile(
          file([
            'Camiseta,CAM,45000,,,,,,,',
            ',CAM-N,,CAM,Color,Negro,,,Nike,sí',
          ]),
        );
        expect(parent.variants[0].__ignored_fields).toEqual(
          expect.arrayContaining(['Marca', 'Usa Listas de Precio']),
        );
      });

      it('archivo viejo sin columnas de variante: misma salida (más __row_number)', () => {
        const rows: any[] = service.parseFile(
          Buffer.from('Nombre,SKU,Precio Venta\nP1,S1,1000\nP2,S2,2000'),
        );
        expect(rows).toEqual([
          { name: 'P1', sku: 'S1', base_price: 1000, __row_number: 2 },
          { name: 'P2', sku: 'S2', base_price: 2000, __row_number: 3 },
        ]);
      });
    });

    describe('analyzeProducts', () => {
      const analyze = (rows: string[], header = HEADER) =>
        service.analyzeProducts(file(rows, header), 1);

      it('padre + 2 variantes: total_products cuenta productos, total_variants variantes', async () => {
        const result = await analyze(family);
        expect(result.total_products).toBe(1);
        expect(result.total_variants).toBe(2);
        const item: any = result.products[0];
        expect(item.status).toBe('ready');
        expect(item.variants).toHaveLength(2);
        // Hereda precio = null; con precio propio = ese precio.
        expect(item.variants[0]).toMatchObject({
          row_number: 3,
          sku: 'CAM-N-M',
          price: null,
          action: 'create',
          status: 'ready',
          attributes: { Color: 'Negro', Talla: 'M' },
        });
        expect(item.variants[1].price).toBe(49000);
      });

      it('row_number es la fila real aunque haya variantes de por medio', async () => {
        const result = await analyze([...family, 'Otro,OTR,1000,,,,,,,']);
        expect(result.products.map((p) => p.row_number)).toEqual([2, 5]);
      });

      it('variante huérfana: error VARIANT_PARENT_NOT_FOUND en su item', async () => {
        const result = await analyze([
          'Camiseta,CAM,45000,,,,,,,',
          ',X-1,,NO-EXISTE,Color,Rojo,,,,',
        ]);
        expect(result.total_products).toBe(2);
        expect(codes(result.products[1].errors)).toContain(
          'VARIANT_PARENT_NOT_FOUND',
        );
        expect(result.products[1].status).toBe('error');
      });

      it('variante sin pares atributo/valor => VARIANT_NO_ATTRIBUTES y el padre queda en error', async () => {
        const result = await analyze([
          'Camiseta,CAM,45000,,,,,,,',
          ',CAM-1,,CAM,Color,,,,,',
        ]);
        const item: any = result.products[0];
        expect(codes(item.variants[0].errors)).toContain('VARIANT_NO_ATTRIBUTES');
        expect(item.status).toBe('error');
        expect(result.with_errors).toBe(1);
      });

      it('misma combinación de atributos (normalizada) => VARIANT_DUPLICATE_ATTRIBUTES', async () => {
        const result = await analyze([
          'Camiseta,CAM,45000,,,,,,,',
          ',CAM-1,,CAM,Color,Negro,Talla,M,,',
          ',CAM-2,,CAM,talla,m,COLOR,negro,,',
        ]);
        const item: any = result.products[0];
        expect(item.variants[0].status).toBe('ready');
        expect(codes(item.variants[1].errors)).toEqual([
          'VARIANT_DUPLICATE_ATTRIBUTES',
        ]);
        expect(item.status).toBe('error');
      });

      it('SKU de variante repetido, o igual al de un producto del archivo => VARIANT_DUPLICATE_SKU', async () => {
        const result = await analyze([
          'Camiseta,CAM,45000,,,,,,,',
          ',CAM-1,,CAM,Color,Negro,,,,',
          ',cam-1,,CAM,Color,Rojo,,,,',
          ',CAM,,CAM,Color,Azul,,,,',
        ]);
        const item: any = result.products[0];
        expect(codes(item.variants[1].errors)).toContain('VARIANT_DUPLICATE_SKU');
        expect(codes(item.variants[2].errors)).toContain('VARIANT_DUPLICATE_SKU');
      });

      it('SKU de variante vacío => VARIANT_SKU_REQUIRED', async () => {
        const result = await analyze([
          'Camiseta,CAM,45000,,,,,,,',
          'Camiseta Negra,,,CAM,Color,Negro,,,,',
        ]);
        expect(codes((result.products[0] as any).variants[0].errors)).toContain(
          'VARIANT_SKU_REQUIRED',
        );
      });

      it('SKU de variante que ya usa otro producto o variante de la tienda => VARIANT_SKU_TAKEN', async () => {
        mockPrismaService.products.findMany.mockResolvedValue([
          { id: 50, sku: 'YA-PROD', name: 'Otro', slug: 'otro', state: 'active' },
        ]);
        mockPrismaService.product_variants.findMany.mockResolvedValue([
          { sku: 'YA-VAR', product_id: 51, products: { name: 'Ajeno' } },
        ]);
        const result = await analyze([
          'Camiseta,CAM,45000,,,,,,,',
          ',YA-PROD,,CAM,Color,Negro,,,,',
          ',YA-VAR,,CAM,Color,Rojo,,,,',
        ]);
        const item: any = result.products[0];
        expect(codes(item.variants[0].errors)).toContain('VARIANT_SKU_TAKEN');
        expect(codes(item.variants[1].errors)).toContain('VARIANT_SKU_TAKEN');
        // Una sola consulta batch de variantes por análisis.
        expect(mockPrismaService.product_variants.findMany).toHaveBeenCalledTimes(
          1,
        );
      });

      it("SKU que ya es variante del MISMO producto existente => action 'update'", async () => {
        mockPrismaService.products.findMany.mockResolvedValue([
          { id: 7, sku: 'CAM', name: 'Camiseta', slug: 'camiseta', state: 'active' },
        ]);
        mockPrismaService.product_variants.findMany.mockResolvedValue([
          { sku: 'CAM-1', product_id: 7, products: { name: 'Camiseta' } },
        ]);
        const result = await analyze([
          'Camiseta,CAM,45000,,,,,,,',
          ',CAM-1,,CAM,Color,Negro,,,,',
          ',CAM-2,,CAM,Color,Rojo,,,,',
        ]);
        const item: any = result.products[0];
        expect(item.action).toBe('update');
        expect(item.variants.map((v: any) => v.action)).toEqual([
          'update',
          'create',
        ]);
        expect(item.status).toBe('ready');
      });

      it('padre con Usa Listas de Precio y variantes => VARIANTS_WITH_PRICE_TIERS', async () => {
        const result = await analyze([
          'Camiseta,CAM,45000,,,,,,,sí',
          ',CAM-1,,CAM,Color,Negro,,,,',
        ]);
        expect(codes(result.products[0].errors)).toContain(
          'VARIANTS_WITH_PRICE_TIERS',
        );
        expect(result.products[0].status).toBe('error');
      });

      it('precio de variante inválido => error; columnas de producto ignoradas => warning', async () => {
        const result = await analyze([
          'Camiseta,CAM,45000,,,,,,,',
          ',CAM-1,abc,CAM,Color,Negro,,,,',
          ',CAM-2,,CAM,Color,Rojo,,,Nike,',
        ]);
        const item: any = result.products[0];
        expect(codes(item.variants[0].errors)).toContain('INVALID_PRICE');
        expect(item.variants[1].status).toBe('warning');
        expect(codes(item.variants[1].warnings)).toContain(
          'VARIANT_IGNORED_FIELDS',
        );
      });

      it('una variante con warning deja al padre en warning', async () => {
        const result = await analyze([
          'Camiseta,CAM,45000,,,,,,,',
          ',CAM-2,,CAM,Color,Rojo,,,Nike,',
        ]);
        expect(result.products[0].status).toBe('warning');
        expect(result.with_warnings).toBe(1);
      });

      it('archivo viejo sin columnas: sin variants y total_variants 0', async () => {
        const result = await service.analyzeProducts(
          Buffer.from('Nombre,SKU,Precio Venta\nP1,S1,1000'),
          1,
        );
        expect(result.total_variants).toBe(0);
        expect(result.products[0].variants).toBeUndefined();
        expect(result.products[0].status).toBe('ready');
        expect(result.products[0].row_number).toBe(2);
      });
    });

    describe('commit (uploadProducts)', () => {
      beforeEach(() => {
        mockPrismaService.products.findFirst.mockReset();
        mockPrismaService.products.findFirst.mockResolvedValue(null);
        mockPrismaService.product_variants.findMany.mockReset();
        mockPrismaService.product_variants.findMany.mockResolvedValue([]);
        mockProductsService.create.mockReset();
        mockProductsService.create.mockImplementation(async (dto: any) => ({
          id: 1,
          name: dto.name,
          sku: dto.sku,
        }));
        mockProductsService.update.mockReset();
        mockProductsService.update.mockResolvedValue({ id: 7 });
        mockProductsService.createVariant.mockReset();
        mockProductsService.updateVariant.mockReset();
      });

      it('create recibe las variantes en su DTO: hereda sin precio, sin override si iguala al padre, claves internas fuera', async () => {
        const products = service.parseFile(
          file([
            'Camiseta,CAM,45000,,,,,,,',
            ',CAM-N,,CAM,Color,Negro,,,,',
            ',CAM-B,45000,CAM,Color,Blanco,,,,',
            ',CAM-R,49000,CAM,Color,Rojo,,,,',
          ]),
        );
        const result = await service.uploadProducts({ products }, mockUser);

        expect(result.results[0]).toMatchObject({
          status: 'success',
          action: 'create',
        });
        expect(mockProductsService.createVariant).not.toHaveBeenCalled();
        const [dto] = mockProductsService.create.mock.calls[0];
        expect(dto.variants).toEqual([
          { sku: 'CAM-N', name: 'Camiseta Negro', attributes: { Color: 'Negro' } },
          { sku: 'CAM-B', name: 'Camiseta Blanco', attributes: { Color: 'Blanco' } },
          {
            sku: 'CAM-R',
            name: 'Camiseta Rojo',
            attributes: { Color: 'Rojo' },
            price_override: 49000,
          },
        ]);
        expect(JSON.stringify(dto)).not.toContain('__');
      });

      it('producto sin variantes: el DTO de create no trae la clave variants', async () => {
        const products = service.parseFile(file(['Camiseta,CAM,45000,,,,,,,']));
        await service.uploadProducts({ products }, mockUser);
        expect(mockProductsService.create.mock.calls[0][0]).not.toHaveProperty(
          'variants',
        );
      });

      it('variante huérfana: se salta (skipped) y no crea producto', async () => {
        const products = service.parseFile(
          file([',X-1,,NO-EXISTE,Color,Rojo,,,,']),
        );
        const result = await service.uploadProducts({ products }, mockUser);
        expect(mockProductsService.create).not.toHaveBeenCalled();
        expect(result.skipped).toBe(1);
        expect(result.results[0]).toMatchObject({
          status: 'skipped',
          row_number: 2,
          error_code: 'VARIANT_PARENT_NOT_FOUND',
        });
      });

      it('error de producto usa la fila real del archivo, no la posición agrupada', async () => {
        mockProductsService.create.mockRejectedValueOnce(
          new BadRequestException('boom'),
        );
        const products = service.parseFile(
          file([
            'Camiseta,CAM,45000,,,,,,,',
            ',CAM-N,,CAM,Color,Negro,,,,',
            'Otro,OTR,1000,,,,,,,',
          ]),
        );
        const result = await service.uploadProducts({ products }, mockUser);
        expect(result.results[0]).toMatchObject({ status: 'error', row_number: 2 });
        expect(result.results[1].status).toBe('success');
      });

      it('update de producto activo: upsert por SKU (update las existentes, create las nuevas) sin borrar', async () => {
        mockPrismaService.products.findFirst.mockResolvedValue({
          id: 7,
          sku: 'CAM',
          state: 'active',
        });
        mockPrismaService.products.findMany.mockResolvedValue([
          { id: 7, sku: 'CAM', state: 'active' },
        ]);
        mockPrismaService.product_variants.findMany.mockImplementation(
          async (args: any) =>
            // Dueños de SKU de variante (commit): la variante es del MISMO producto.
            args?.where?.sku?.in
              ? [{ sku: 'cam-n', product_id: 7, products: { name: 'Camiseta' } }]
              : [
                  { id: 70, sku: 'cam-n' },
                  { id: 71, sku: 'CAM-AUSENTE' }, // no viene en el archivo: no se toca
                ],
        );
        const products = service.parseFile(
          file([
            'Camiseta,CAM,45000,,,,,,,',
            ',CAM-N,49000,CAM,Color,Negro,,,,',
            ',CAM-NEW,,CAM,Color,Rojo,,,,',
          ]),
        );
        const result = await service.uploadProducts({ products }, mockUser);

        expect(result.results[0]).toMatchObject({ status: 'success', action: 'update' });
        expect(mockProductsService.create).not.toHaveBeenCalled();
        // El update del producto no lleva `variants` (borraría las ausentes).
        expect(mockProductsService.update.mock.calls[0][1]).not.toHaveProperty(
          'variants',
        );
        expect(mockProductsService.updateVariant).toHaveBeenCalledTimes(1);
        expect(mockProductsService.updateVariant).toHaveBeenCalledWith(70, {
          name: 'Camiseta Negro',
          attributes: { Color: 'Negro' },
          price_override: 49000,
        });
        expect(mockProductsService.createVariant).toHaveBeenCalledTimes(1);
        expect(mockProductsService.createVariant).toHaveBeenCalledWith(7, {
          sku: 'CAM-NEW',
          name: 'Camiseta Rojo',
          attributes: { Color: 'Rojo' },
        });
        expect(mockVariantService.removeVariant).not.toHaveBeenCalled();
      });

      describe('re-validación de variantes en commit', () => {
        const run = async (rows: string[]) => {
          const products = service.parseFile(
            file([...rows, 'Sano,SANO,1000,,,,,,,']),
          );
          return service.uploadProducts({ products }, mockUser);
        };
        const createdSkus = () =>
          mockProductsService.create.mock.calls.map((c) => c[0].sku);

        it('variante sin atributos: fila en error con "Variante fila N:" y create NO llamado; el producto sano sí', async () => {
          const result = await run([
            'Camiseta,CAM,45000,,,,,,,',
            ',CAM-1,,CAM,Color,,,,,',
          ]);
          expect(result.results[0]).toMatchObject({
            status: 'error',
            row_number: 2,
            sku: 'CAM',
          });
          expect(result.results[0].message).toMatch(/^Variante fila 3: /);
          expect(createdSkus()).toEqual(['SANO']);
          expect(result.successful).toBe(1);
          expect(result.failed).toBe(1);
        });

        it('combinación de atributos duplicada: rechaza el producto completo', async () => {
          const result = await run([
            'Camiseta,CAM,45000,,,,,,,',
            ',CAM-1,,CAM,Color,Negro,,,,',
            ',CAM-2,,CAM,color,NEGRO,,,,',
          ]);
          expect(result.results[0].status).toBe('error');
          expect(result.results[0].message).toMatch(/^Variante fila 4: /);
          expect(createdSkus()).toEqual(['SANO']);
        });

        it('precio de variante inválido: rechaza y no crea', async () => {
          const result = await run([
            'Camiseta,CAM,45000,,,,,,,',
            ',CAM-1,abc,CAM,Color,Negro,,,,',
          ]);
          expect(result.results[0].status).toBe('error');
          expect(createdSkus()).toEqual(['SANO']);
        });

        it('SKU de variante repetido en el lote: rechaza al segundo producto', async () => {
          const result = await run([
            'Camiseta,CAM,45000,,,,,,,',
            ',X-1,,CAM,Color,Negro,,,,',
            'Pantalon,PAN,45000,,,,,,,',
            ',x-1,,PAN,Color,Negro,,,,',
          ]);
          expect(result.results.map((r) => r.status)).toEqual([
            'success',
            'error',
            'success',
          ]);
          expect(createdSkus()).toEqual(['CAM', 'SANO']);
        });

        it('multitarifa en el archivo + variantes: rechaza en commit', async () => {
          const result = await run([
            'Camiseta,CAM,45000,,,,,,,sí',
            ',CAM-1,,CAM,Color,Negro,,,,',
          ]);
          expect(result.results[0].status).toBe('error');
          expect(createdSkus()).toEqual(['SANO']);
        });

        it('SKU de variante que ya usa otra variante/producto en BD: rechaza el producto con error de fila; el sano sí', async () => {
          mockPrismaService.product_variants.findMany.mockImplementation(
            async (args: any) =>
              args?.where?.sku?.in
                ? [
                    {
                      sku: 'CAM-1',
                      product_id: 99,
                      products: { name: 'Otro' },
                    },
                  ]
                : [],
          );
          const result = await run([
            'Camiseta,CAM,45000,,,,,,,',
            ',CAM-1,,CAM,Color,Negro,,,,',
          ]);
          expect(result.results[0].status).toBe('error');
          expect(result.results[0].message).toMatch(/^Variante fila 3: .*ya lo usa/);
          expect(createdSkus()).toEqual(['SANO']);
        });

        it('SKU de variante que es SKU de un producto de la tienda: rechaza', async () => {
          mockPrismaService.products.findMany.mockResolvedValue([
            { id: 50, sku: 'CAM-1', state: 'active' },
          ]);
          const result = await run([
            'Camiseta,CAM,45000,,,,,,,',
            ',CAM-1,,CAM,Color,Negro,,,,',
          ]);
          expect(result.results[0].status).toBe('error');
          expect(result.results[0].message).toMatch(/producto de la tienda/);
          expect(createdSkus()).toEqual(['SANO']);
        });

        it('variante del MISMO producto existente con ese SKU: no es colisión (upsert)', async () => {
          mockPrismaService.products.findMany.mockResolvedValue([
            { id: 7, sku: 'CAM', state: 'active' },
          ]);
          mockPrismaService.products.findFirst.mockImplementation(
            async (args: any) =>
              args?.where?.sku === 'CAM'
                ? { id: 7, sku: 'CAM', state: 'active' }
                : null,
          );
          mockPrismaService.product_variants.findMany.mockImplementation(
            async (args: any) =>
              args?.where?.sku?.in
                ? [{ sku: 'CAM-1', product_id: 7, products: { name: 'Camiseta' } }]
                : [{ id: 70, sku: 'CAM-1' }],
          );
          const result = await run([
            'Camiseta,CAM,45000,,,,,,,',
            ',CAM-1,,CAM,Color,Negro,,,,',
          ]);
          expect(result.results[0]).toMatchObject({ status: 'success', action: 'update' });
          expect(mockProductsService.updateVariant).toHaveBeenCalledTimes(1);
        });

        it('update con variantes nuevas y Estado inactivo: error de fila sin llamar update', async () => {
          mockPrismaService.products.findFirst.mockImplementation(
            async (args: any) =>
              args?.where?.sku === 'CAM'
                ? { id: 7, sku: 'CAM', state: 'active' }
                : null,
          );
          const products = service.parseFile(
            file(
              [
                'Camiseta,CAM,45000,,,,,,,,inactivo',
                ',CAM-NEW,,CAM,Color,Negro,,,,,',
              ],
              HEADER + ',Estado',
            ),
          );
          const result = await service.uploadProducts({ products }, mockUser);
          expect(result.results[0].status).toBe('error');
          expect(result.results[0].message).toMatch(/producto inactivo/);
          expect(mockProductsService.update).not.toHaveBeenCalled();
          expect(mockProductsService.createVariant).not.toHaveBeenCalled();
        });

        it('update de variante existente con precio igual al padre: manda price_override null (limpia el override)', async () => {
          mockPrismaService.products.findFirst.mockImplementation(
            async (args: any) =>
              args?.where?.sku === 'CAM'
                ? { id: 7, sku: 'CAM', state: 'active' }
                : null,
          );
          mockPrismaService.products.findMany.mockResolvedValue([
            { id: 7, sku: 'CAM', state: 'active' },
          ]);
          mockPrismaService.product_variants.findMany.mockImplementation(
            async (args: any) =>
              args?.where?.sku?.in
                ? [{ sku: 'CAM-N', product_id: 7, products: { name: 'Camiseta' } }]
                : [{ id: 70, sku: 'CAM-N' }],
          );
          const products = service.parseFile(
            file([
              'Camiseta,CAM,45000,,,,,,,',
              ',CAM-N,45000,CAM,Color,Negro,,,,',
            ]),
          );
          await service.uploadProducts({ products }, mockUser);
          expect(mockProductsService.updateVariant).toHaveBeenCalledWith(
            70,
            expect.objectContaining({ price_override: null }),
          );
        });

        it('producto existente con multitarifa activa en BD: no actualiza ni agrega variantes', async () => {
          mockPrismaService.products.findFirst.mockImplementation(
            async (args: any) =>
              args?.where?.sku === 'CAM'
                ? { id: 7, sku: 'CAM', state: 'active', has_multiple_price_tiers: true }
                : args?.where?.id === 7
                  ? { has_multiple_price_tiers: true }
                  : null,
          );
          const result = await run([
            'Camiseta,CAM,45000,,,,,,,',
            ',CAM-1,,CAM,Color,Negro,,,,',
          ]);
          expect(result.results[0].status).toBe('error');
          expect(mockProductsService.update).not.toHaveBeenCalled();
          expect(mockProductsService.createVariant).not.toHaveBeenCalled();
          expect(createdSkus()).toEqual(['SANO']);
        });
      });

      it('celda de variante inválida (barcode en notación científica) rechaza el producto completo', async () => {
        const products = service.parseFile(
          Buffer.from(
            [
              'Nombre,SKU,Precio Venta,SKU Padre,Atributo 1,Valor 1,Barcode',
              'Camiseta,CAM,45000,,,,',
              ',CAM-N,,CAM,Color,Negro,1.23E+12',
            ].join('\n'),
          ),
        );
        const result = await service.uploadProducts({ products }, mockUser);
        expect(mockProductsService.create).not.toHaveBeenCalled();
        expect(result.results[0].status).toBe('error');
      });
    });

    describe('paginación del commit', () => {
      it('las páginas cortan productos ya agrupados: nunca parten una familia', async () => {
        const rows = [
          'A,A1,1000,,,,,,,',
          ',A1-1,,A1,Color,Negro,,,,',
          ',A1-2,,A1,Color,Rojo,,,,',
          'B,B1,1000,,,,,,,',
          ',B1-1,,B1,Color,Negro,,,,',
          'C,C1,1000,,,,,,,',
        ];
        const s3 = (service as any).s3Service;
        s3.downloadImage.mockResolvedValue(file(rows));
        s3.deleteFile.mockClear();
        mockPrismaService.products.findFirst.mockReset();
        mockPrismaService.products.findFirst.mockResolvedValue(null);
        mockProductsService.create.mockReset();
        mockProductsService.create.mockImplementation(async (dto: any) => ({
          id: 1,
          name: dto.name,
          sku: dto.sku,
        }));

        const p1: any = await service.uploadProductsFromSession('sid', 1, mockUser, {
          offset: 0,
          limit: 2,
        });
        // 3 productos (no 6 filas): total y paginación operan sobre el árbol.
        expect(p1).toMatchObject({ total: 3, done: false, successful: 2 });
        expect(mockProductsService.create.mock.calls[0][0].variants).toHaveLength(2);
        expect(mockProductsService.create.mock.calls[1][0].variants).toHaveLength(1);

        const p2: any = await service.uploadProductsFromSession('sid', 1, mockUser, {
          offset: 2,
          limit: 2,
        });
        expect(p2).toMatchObject({ total: 3, done: true, successful: 1 });
        expect(mockProductsService.create.mock.calls[2][0]).not.toHaveProperty(
          'variants',
        );
      });
    });

    describe('plantilla y exportación', () => {
      const sheet = (buf: Buffer) => {
        const wb = XLSX.read(buf, { type: 'buffer' });
        return XLSX.utils.sheet_to_json<any>(wb.Sheets[wb.SheetNames[0]]);
      };
      const headerRow = (buf: Buffer) => {
        const wb = XLSX.read(buf, { type: 'buffer' });
        return XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[0]], {
          header: 1,
        })[0];
      };

      it('la plantilla de productos termina con las 7 columnas nuevas; la de servicios no las trae', async () => {
        expect(headerRow(await service.generateExcelTemplate('products')).slice(-7)).toEqual([
          'SKU Padre',
          'Atributo 1',
          'Valor 1',
          'Atributo 2',
          'Valor 2',
          'Atributo 3',
          'Valor 3',
        ]);
        expect(headerRow(await service.generateExcelTemplate('services'))).not.toContain(
          'SKU Padre',
        );
      });

      it('el ejemplo de la plantilla incluye la familia Camiseta Básica y se importa como 1 padre + 2 variantes', async () => {
        const buf = await service.generateExcelTemplate('products');
        const rows = service.parseFile(buf) as any[];
        const camiseta = rows.find((r) => r.sku === 'CAM-BAS');
        expect(camiseta.variants).toHaveLength(2);
        expect(camiseta.variants[0].attributes).toEqual({
          Color: 'Negro',
          Talla: 'M',
        });
      });

      it('el export emite una fila por variante justo después de su padre y re-importa igual', async () => {
        mockPrismaService.products.count.mockResolvedValue(1);
        mockPrismaService.products.findMany.mockReset();
        mockPrismaService.products.findMany.mockResolvedValueOnce([
          {
            id: 1,
            name: 'Camiseta',
            sku: 'CAM',
            state: 'active',
            product_type: 'physical',
            base_price: 45000,
            product_variants: [
              {
                id: 10,
                sku: 'CAM-N-M',
                name: 'Camiseta Negro M',
                barcode: '7701',
                price_override: null,
                attributes: { Color: 'Negro', Talla: 'M' },
              },
              {
                id: 11,
                sku: 'CAM-B-L',
                name: 'Camiseta Blanco L',
                barcode: null,
                price_override: 49000,
                attributes: { Color: 'Blanco', Talla: 'L', Material: 'Algodón', Extra: 'x' },
              },
            ],
          },
        ]);
        const buf = await service.exportCurrentProductsAsTemplate();
        const rows = sheet(buf);
        expect(rows).toHaveLength(3);
        expect(rows[0].SKU).toBe('CAM');
        expect(rows[1]).toMatchObject({
          'SKU Padre': 'CAM',
          SKU: 'CAM-N-M',
          Nombre: 'Camiseta Negro M',
          'Atributo 1': 'Color',
          'Valor 1': 'Negro',
          'Atributo 2': 'Talla',
          'Valor 2': 'M',
          'Código de barras': '7701',
        });
        expect(rows[1]['Precio Venta']).toBe('');
        expect(rows[2]).toMatchObject({ SKU: 'CAM-B-L', 'Precio Venta': 49000 });
        // Más de 3 atributos: solo salen los 3 primeros.
        expect(rows[2]['Atributo 3']).toBe('Material');
        expect(rows[2]).not.toHaveProperty('Atributo 4');

        const parsed: any[] = service.parseFile(buf);
        expect(parsed).toHaveLength(1);
        expect(parsed[0].variants).toHaveLength(2);
      });
    });
  });
});
