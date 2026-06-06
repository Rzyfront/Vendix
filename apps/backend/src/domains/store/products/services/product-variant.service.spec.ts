import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ProductVariantService } from './product-variant.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { S3Service } from '../../../../common/services/s3.service';
import { LocationsService } from '../../inventory/locations/locations.service';
import { StockLevelManager } from '../../inventory/shared/services/stock-level-manager.service';
import { RequestContextService } from '../../../../common/context/request-context.service';

describe('ProductVariantService', () => {
  let service: ProductVariantService;
  let prismaService: StorePrismaService;

  const mockPrismaService = {
    product_variants: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    stock_reservations: {
      findFirst: jest.fn(),
    },
    stock_levels: {
      aggregate: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockS3Service = {
    deleteFile: jest.fn().mockResolvedValue(undefined),
  };

  const mockLocationsService = {
    getDefaultLocation: jest.fn(),
  };

  const mockStockLevelManager = {
    updateStock: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductVariantService,
        {
          provide: StorePrismaService,
          useValue: mockPrismaService,
        },
        { provide: S3Service, useValue: mockS3Service },
        { provide: LocationsService, useValue: mockLocationsService },
        { provide: StockLevelManager, useValue: mockStockLevelManager },
        {
          provide: RequestContextService,
          useValue: { getContext: () => ({ user_id: 1 }) },
        },
      ],
    }).compile();

    service = module.get<ProductVariantService>(ProductVariantService);
    prismaService = module.get<StorePrismaService>(StorePrismaService);

    // Default: no active stock reservations
    mockPrismaService.stock_reservations.findFirst.mockResolvedValue(null);
    // Default: no stock change requested
    mockPrismaService.stock_levels.aggregate.mockResolvedValue({
      _sum: { quantity_available: 0 },
    });

    // $transaction executes the callback with a transaction client `p`.
    // We forward the same mocked prisma methods onto the transaction client
    // so calls inside the callback (update, findUnique, etc.) are observable.
    mockPrismaService.$transaction.mockImplementation(async (callback: any) => {
      return callback(mockPrismaService);
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ─────────────────────────────────────────────────────────────────
  // Regression: PR #294 — variant image_id contract
  //
  // updateVariant() debe IGNORAR `image_id` y `variant_image_url` del
  // DTO. La gestión de la imagen de variante la hace exclusivamente
  // el orquestador ProductsService.update(). Si alguien futuro rompe
  // este contrato, los siguientes tests deben fallar.
  // ─────────────────────────────────────────────────────────────────
  describe('updateVariant — image_id contract (regression PR #294)', () => {
    const existingVariant = {
      id: 1,
      product_id: 10,
      sku: 'VAR-OLD-SKU',
      name: 'Variant',
      price_override: 50,
      cost_price: 20,
      profit_margin: 150,
      is_on_sale: false,
      sale_price: null,
      image_id: 456, // imagen previa
      track_inventory_override: null,
      products: {
        id: 10,
        store_id: 1,
        product_type: 'physical',
        base_price: 100,
      },
    };

    it('debe descartar image_id del DTO y NO sobrescribir la imagen existente', async () => {
      mockPrismaService.product_variants.findUnique.mockResolvedValue(
        existingVariant,
      );
      mockPrismaService.product_variants.update.mockResolvedValue({
        ...existingVariant,
        sku: 'VAR-NEW-SKU',
      });

      await service.updateVariant(1, {
        sku: 'VAR-NEW-SKU',
        image_id: 999, // <-- intento malicioso de reasignar la imagen
      } as any);

      // Capturar lo que update() recibió en su `data`
      const updateCall = mockPrismaService.product_variants.update.mock.calls[0];
      const updateData = updateCall[0].data;

      // 1. La imagen previa (456) NO fue pisada a 999
      expect(updateData).not.toHaveProperty('image_id');
      // 2. El SKU sí se actualizó (sanity check de que la destructura es selectiva)
      expect(updateData.sku).toBe('VAR-NEW-SKU');
    });

    it('debe descartar variant_image_url del DTO (no causa efecto colateral)', async () => {
      mockPrismaService.product_variants.findUnique.mockResolvedValue(
        existingVariant,
      );
      mockPrismaService.product_variants.update.mockResolvedValue(
        existingVariant,
      );

      await service.updateVariant(1, {
        sku: 'VAR-NEW-SKU',
        variant_image_url: 'data:image/png;base64,AAAA', // intento de subir imagen
      } as any);

      const updateData =
        mockPrismaService.product_variants.update.mock.calls[0][0].data;

      // variant_image_url es procesado por el orquestador, NO aquí
      expect(updateData).not.toHaveProperty('variant_image_url');
    });

    it('debe descartar image_id=null explícito (no nulifica accidentalmente)', async () => {
      mockPrismaService.product_variants.findUnique.mockResolvedValue(
        existingVariant,
      );
      mockPrismaService.product_variants.update.mockResolvedValue(
        existingVariant,
      );

      await service.updateVariant(1, {
        sku: 'VAR-NEW-SKU',
        image_id: null, // peligro: si pasa, podría nulificar la imagen existente
      } as any);

      const updateData =
        mockPrismaService.product_variants.update.mock.calls[0][0].data;

      // La clave es que NO se llame al `update` con image_id: null,
      // porque ese era el comportamiento que rompía la FK del bug original.
      expect(updateData).not.toHaveProperty('image_id');
    });
  });

  describe('findUniqueVariantBySlug', () => {
    it('should find a variant by store ID and slug successfully', async () => {
      const expectedVariant = {
        id: 1,
        sku: 'VAR-001',
        price_override: 109.99,
        stock_quantity: 50,
        attributes: { color: 'red', size: 'L' },
        products: {
          id: 1,
          name: 'Test Product',
          slug: 'test-product',
          state: 'active',
          stores: {
            id: 1,
            name: 'Test Store',
          },
          brands: {
            id: 1,
            name: 'Test Brand',
          },
          product_images: [
            {
              id: 1,
              image_url: 'https://example.com/image.jpg',
              is_main: true,
            },
          ],
          product_categories: [
            {
              id: 1,
              categories: {
                id: 1,
                name: 'Test Category',
              },
            },
          ],
        },
        product_images: [
          {
            id: 1,
            image_url: 'https://example.com/variant-image.jpg',
            is_main: false,
          },
        ],
      };

      mockPrismaService.product_variants.findFirst.mockResolvedValue(
        expectedVariant,
      );

      const result = await service.findUniqueVariantBySlug(1, 'test-product');

      expect(result).toEqual(expectedVariant);
      expect(mockPrismaService.product_variants.findFirst).toHaveBeenCalledWith(
        {
          where: {
            products: {
              store_id: 1,
              slug: 'test-product',
              state: 'active',
            },
          },
          include: {
            products: {
              include: {
                stores: true,
                brands: true,
                product_images: true,
                product_categories: {
                  include: {
                    categories: true,
                  },
                },
              },
            },
            product_images: true,
          },
        },
      );
    });

    it('should throw NotFoundException if variant not found', async () => {
      mockPrismaService.product_variants.findFirst.mockResolvedValue(null);

      await expect(
        service.findUniqueVariantBySlug(1, 'nonexistent-slug'),
      ).rejects.toThrow(NotFoundException);

      await expect(
        service.findUniqueVariantBySlug(1, 'nonexistent-slug'),
      ).rejects.toThrow('Variante de producto no encontrada');
    });

    it('should only find variants from active products', async () => {
      const expectedVariant = {
        id: 1,
        sku: 'VAR-001',
        products: {
          id: 1,
          name: 'Test Product',
          slug: 'test-product',
          state: 'active',
        },
      };

      mockPrismaService.product_variants.findFirst.mockResolvedValue(
        expectedVariant,
      );

      await service.findUniqueVariantBySlug(1, 'test-product');

      expect(mockPrismaService.product_variants.findFirst).toHaveBeenCalledWith(
        {
          where: {
            products: {
              store_id: 1,
              slug: 'test-product',
              state: 'active', // Should only include active products
            },
          },
          include: expect.any(Object),
        },
      );
    });

    it('should handle variants with complex attributes', async () => {
      const variantWithComplexAttributes = {
        id: 1,
        sku: 'COMPLEX-VAR',
        price_override: 199.99,
        stock_quantity: 25,
        attributes: {
          color: 'blue',
          size: 'XL',
          material: 'cotton',
          weight: 250,
          dimensions: { length: 30, width: 20, height: 5 },
        },
        products: {
          id: 1,
          name: 'Complex Product',
          slug: 'complex-product',
          state: 'active',
          stores: { id: 1, name: 'Test Store' },
          brands: { id: 1, name: 'Test Brand' },
          product_images: [],
          product_categories: [],
        },
        product_images: [],
      };

      mockPrismaService.product_variants.findFirst.mockResolvedValue(
        variantWithComplexAttributes,
      );

      const result = await service.findUniqueVariantBySlug(
        1,
        'complex-product',
      );

      expect(result.attributes).toEqual(
        variantWithComplexAttributes.attributes,
      );
      expect(result.attributes.dimensions).toEqual({
        length: 30,
        width: 20,
        height: 5,
      });
    });

    it('should include all related product data', async () => {
      const variantWithFullRelations = {
        id: 1,
        sku: 'FULL-VAR',
        products: {
          id: 1,
          name: 'Full Product',
          slug: 'full-product',
          state: 'active',
          stores: {
            id: 1,
            name: 'Main Store',
            domain: 'main.example.com',
          },
          brands: {
            id: 1,
            name: 'Premium Brand',
            description: 'High quality brand',
          },
          product_images: [
            {
              id: 1,
              image_url: 'https://example.com/main-image.jpg',
              is_main: true,
              alt_text: 'Main product image',
            },
            {
              id: 2,
              image_url: 'https://example.com/gallery-image.jpg',
              is_main: false,
              alt_text: 'Gallery image',
            },
          ],
          product_categories: [
            {
              id: 1,
              categories: {
                id: 1,
                name: 'Electronics',
                description: 'Electronic devices',
              },
            },
            {
              id: 2,
              categories: {
                id: 2,
                name: 'Smartphones',
                description: 'Mobile phones',
              },
            },
          ],
        },
        product_images: [
          {
            id: 3,
            image_url: 'https://example.com/variant-specific.jpg',
            is_main: false,
            alt_text: 'Variant specific image',
          },
        ],
      };

      mockPrismaService.product_variants.findFirst.mockResolvedValue(
        variantWithFullRelations,
      );

      const result = await service.findUniqueVariantBySlug(1, 'full-product');

      expect(result.products.stores).toBeDefined();
      expect(result.products.brands).toBeDefined();
      expect(result.products.product_images).toHaveLength(2);
      expect(result.products.product_categories).toHaveLength(2);
      expect(result.product_images).toHaveLength(1);
    });

    describe('Error Handling', () => {
      it('should handle database errors gracefully', async () => {
        const databaseError = new Error('Database connection failed');
        mockPrismaService.product_variants.findFirst.mockRejectedValue(
          databaseError,
        );

        await expect(
          service.findUniqueVariantBySlug(1, 'test-product'),
        ).rejects.toThrow(databaseError);
      });

      it('should handle invalid store IDs', async () => {
        mockPrismaService.product_variants.findFirst.mockResolvedValue(null);

        await expect(
          service.findUniqueVariantBySlug(-1, 'test-product'),
        ).rejects.toThrow(NotFoundException);
      });

      it('should handle empty slug strings', async () => {
        mockPrismaService.product_variants.findFirst.mockResolvedValue(null);

        await expect(service.findUniqueVariantBySlug(1, '')).rejects.toThrow(
          NotFoundException,
        );
      });
    });

    describe('Integration Scenarios', () => {
      it('should work with multi-tenant architecture', async () => {
        // Scenario: Multiple stores with products having same slug
        const variantFromStore1 = {
          id: 1,
          sku: 'STORE1-VAR',
          products: {
            id: 1,
            name: 'Product A',
            slug: 'product-a',
            state: 'active',
            stores: { id: 1, name: 'Store 1' },
            brands: { id: 1, name: 'Brand A' },
            product_images: [],
            product_categories: [],
          },
          product_images: [],
        };

        const variantFromStore2 = {
          id: 2,
          sku: 'STORE2-VAR',
          products: {
            id: 2,
            name: 'Product A', // Same name, different product
            slug: 'product-a', // Same slug
            state: 'active',
            stores: { id: 2, name: 'Store 2' },
            brands: { id: 2, name: 'Brand B' },
            product_images: [],
            product_categories: [],
          },
          product_images: [],
        };

        // Should return variant from store 1 when querying store 1
        mockPrismaService.product_variants.findFirst.mockResolvedValueOnce(
          variantFromStore1,
        );
        const result1 = await service.findUniqueVariantBySlug(1, 'product-a');
        expect(result1.products.stores.id).toBe(1);

        // Should return variant from store 2 when querying store 2
        mockPrismaService.product_variants.findFirst.mockResolvedValueOnce(
          variantFromStore2,
        );
        const result2 = await service.findUniqueVariantBySlug(2, 'product-a');
        expect(result2.products.stores.id).toBe(2);

        // Both queries should include the store_id filter
        expect(
          mockPrismaService.product_variants.findFirst,
        ).toHaveBeenNthCalledWith(1, {
          where: {
            products: {
              store_id: 1,
              slug: 'product-a',
              state: 'active',
            },
          },
          include: expect.any(Object),
        });

        expect(
          mockPrismaService.product_variants.findFirst,
        ).toHaveBeenNthCalledWith(2, {
          where: {
            products: {
              store_id: 2,
              slug: 'product-a',
              state: 'active',
            },
          },
          include: expect.any(Object),
        });
      });
    });
  });
});
