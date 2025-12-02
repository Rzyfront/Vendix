import { Test, TestingModule } from '@nestjs/testing';
import { ProductVariantService } from './product-variant.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { NotFoundException } from '@nestjs/common';

describe('ProductVariantService', () => {
  let service: ProductVariantService;
  let prismaService: PrismaService;

  const mockPrismaService = {
    product_variants: {
      findFirst: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductVariantService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<ProductVariantService>(ProductVariantService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
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
