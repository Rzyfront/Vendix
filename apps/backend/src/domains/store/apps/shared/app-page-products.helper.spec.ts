import { StorefrontPriceService } from '../../../ecommerce/shared/services/storefront-price.service';
import { PriceResolverService } from '../../products/services/price-resolver.service';
import {
  extractBlockProductIds,
  hasAutoProductsBlock,
  resolvePreviewProductCards,
  type PreviewProductRow,
} from './app-page-products.helper';

describe('app-page-products.helper', () => {
  const storefrontPrice = new StorefrontPriceService(new PriceResolverService());
  const s3 = {
    signUrl: jest.fn(async (key?: string) => (key ? `signed:${key}` : undefined)),
  } as any;

  beforeEach(() => {
    s3.signUrl.mockClear();
  });

  describe('extractBlockProductIds', () => {
    it('filtra solo bloques products habilitados en modo manual, preservando orden, sin duplicados y con tope de 50', () => {
      const sixtyIds = Array.from({ length: 60 }, (_, i) => 100 + i);
      const ids = extractBlockProductIds({
        page: {
          schema_version: 1,
          blocks: [
            // Deshabilitado -> debe ignorarse
            {
              id: 'hidden',
              type: 'products',
              enabled: false,
              props: { selection: 'manual', product_ids: [1, 2] },
            },
            // Modo automático con ids residuales -> debe ignorarse
            {
              id: 'auto_block',
              type: 'products',
              enabled: true,
              props: { selection: 'auto', product_ids: [3, 4] },
            },
            // Sin selection (implícito auto) -> debe ignorarse
            {
              id: 'default_auto',
              type: 'products',
              enabled: true,
              props: { product_ids: [5] },
            },
            // Manual activo -> se toma en orden y con tope de 50
            {
              id: 'manual_1',
              type: 'products',
              enabled: true,
              props: { selection: 'manual', product_ids: [30, 10, 30, 20, ...sixtyIds] },
            },
          ],
        },
      });

      expect(ids).toHaveLength(50);
      expect(ids.slice(0, 4)).toEqual([30, 10, 20, 100]);
      expect(ids).not.toContain(1);
      expect(ids).not.toContain(3);
      expect(ids).not.toContain(5);
    });
  });

  describe('hasAutoProductsBlock', () => {
    it('detecta bloques products habilitados en modo auto y descarta ocultos o manuales', () => {
      expect(
        hasAutoProductsBlock({
          page: {
            blocks: [
              { id: 'p1', type: 'products', enabled: false, props: { selection: 'auto' } },
              { id: 'p2', type: 'products', enabled: true, props: { selection: 'manual', product_ids: [1] } },
            ],
          },
        }),
      ).toBe(false);

      expect(
        hasAutoProductsBlock({
          page: {
            blocks: [{ id: 'p3', type: 'products', enabled: true, props: { selection: 'auto' } }],
          },
        }),
      ).toBe(true);

      expect(
        hasAutoProductsBlock({
          page: {
            blocks: [{ id: 'p4', type: 'products', enabled: true, props: {} }],
          },
        }),
      ).toBe(true);
    });
  });

  describe('resolvePreviewProductCards (paridad con el catálogo público)', () => {
    it('resuelve precios con impuestos igual que StorefrontPriceService y oculta variantes cuando hay presentación por defecto', async () => {
      const rowWithDefaultTier: PreviewProductRow = {
        id: 1,
        slug: 'bulto-cafe',
        name: 'Café por bulto',
        base_price: '10000.00',
        sale_price: null,
        is_on_sale: false,
        track_inventory: true,
        product_images: [{ image_url: 'img/cafe.jpg' }],
        product_categories: [{ category_id: 9 }],
        product_tax_assignments: [
          {
            is_inclusive: false,
            tax_categories: {
              is_inclusive: false,
              tax_rates: [{ rate: '0.19', is_inclusive: false }],
            },
          },
        ],
        product_variants: [
          { id: 101, name: '250 g', sku: 'C-250', price_override: '12000.00', is_on_sale: false },
        ],
      };

      const prisma = {
        product_price_tier_assignments: {
          findMany: jest.fn().mockResolvedValue([
            {
              product_id: 1,
              price_tier_id: 7,
              price_tier: {
                id: 7,
                name: 'Caja x10',
                discount_percentage: 0,
                adjustment_type: 'fixed_price',
                adjustment_value: null,
                amount_scope: 'package',
                is_package_unit: true,
                units_per_package: 10,
              },
            },
          ]),
        },
        product_price_tier_overrides: {
          findMany: jest.fn().mockResolvedValue([
            {
              product_id: 1,
              price_tier_id: 7,
              variant_id: null,
              override_price: '80000.00',
              override_units_per_package: 10,
            },
          ]),
        },
      };

      const { cardsById, defaultSaleUnits } = await resolvePreviewProductCards(
        [rowWithDefaultTier],
        { prisma, s3, storefrontPrice, promotionEngine: null },
      );

      const card = cardsById.get(1)!;
      const expectedPublic = storefrontPrice.resolveCatalogFinalPrice(
        rowWithDefaultTier as any,
        null,
        defaultSaleUnits.get(1) ?? null,
      );
      // 80.000 + 19% IVA = 95.200
      expect(expectedPublic).toBe(95200);
      expect(card.final_price).toBe(expectedPublic);
      // Con presentación por defecto, en público no se exponen variantes: en vista previa tampoco.
      expect(card.variants).toEqual([]);
    });

    it('aplica promoción plana activa sobre el precio final y deja intacto el precio unitario en promociones por cantidad', async () => {
      const flatRow: PreviewProductRow = {
        id: 10,
        slug: 'crema',
        name: 'Crema',
        base_price: '50000.00',
        is_on_sale: false,
        product_categories: [{ category_id: 4 }],
        product_tax_assignments: [],
        product_variants: [],
      };
      const tieredRow: PreviewProductRow = {
        id: 20,
        slug: 'jabon',
        name: 'Jabón',
        base_price: '20000.00',
        is_on_sale: false,
        product_categories: [],
        product_tax_assignments: [],
        product_variants: [],
      };

      const promotionEngine = {
        findActiveAutoPromotionsForProducts: jest.fn().mockResolvedValue(
          new Map([
            [
              10,
              {
                id: 1,
                name: 'Promo 20%',
                type: 'percentage',
                scope: 'product',
                discount_percentage: 20,
                promotional_price: 40000,
                badge_label: '-20% OFF',
                priority: 1,
              },
            ],
            [
              20,
              {
                id: 2,
                name: 'Lleva 3',
                type: 'percentage',
                scope: 'product',
                discount_percentage: 10,
                promotional_price: 20000,
                badge_label: 'Desde 3 und: -10%',
                priority: 1,
                is_quantity_tiered: true,
              },
            ],
          ]),
        ),
      };

      const { cardsById } = await resolvePreviewProductCards([flatRow, tieredRow], {
        prisma: {},
        s3,
        storefrontPrice,
        promotionEngine: promotionEngine as any,
      });

      expect(cardsById.get(10)).toMatchObject({
        final_price: 40000,
        regular_final_price: 50000,
        is_on_sale: true,
      });
      expect(cardsById.get(20)).toMatchObject({
        final_price: 20000,
        regular_final_price: 20000,
        is_on_sale: false,
      });
    });
  });
});
