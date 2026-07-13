import { Test, TestingModule } from '@nestjs/testing';
import { PromotionEngineService } from './promotion-engine.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';

/**
 * Helper to build a promotion row matching the shape PromotionEngineService
 * expects (Prisma row + relations).
 */
function buildPromotion(overrides: Partial<Record<string, unknown>> = {}) {
  const start = new Date('2026-01-01T00:00:00Z');
  const end = new Date('2026-12-31T23:59:59Z');
  return {
    id: 1,
    store_id: 1,
    name: 'Test Promotion',
    description: null,
    code: null,
    type: 'percentage',
    value: 10,
    scope: 'order',
    min_purchase_amount: null,
    max_discount_amount: null,
    usage_limit: null,
    usage_count: 0,
    per_customer_limit: null,
    start_date: start,
    end_date: end,
    state: 'active',
    is_auto_apply: true,
    priority: 0,
    promotion_products: [],
    promotion_categories: [],
    ...overrides,
  };
}

describe('PromotionEngineService - quoteDiscounts', () => {
  let service: PromotionEngineService;
  let prisma: {
    promotions: { findMany: jest.Mock; findFirst: jest.Mock; update: jest.Mock };
    order_promotions: { count: jest.Mock; create: jest.Mock };
  };

  const REFERENCE_NOW = new Date('2026-06-01T12:00:00Z');

  beforeEach(async () => {
    prisma = {
      promotions: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      order_promotions: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PromotionEngineService,
        {
          provide: StorePrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    service = module.get<PromotionEngineService>(PromotionEngineService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('returns zeroed quote when no items are passed', async () => {
    const result = await service.quoteDiscounts({ items: [], now: REFERENCE_NOW });

    expect(result.subtotal).toBe(0);
    expect(result.total_discount).toBe(0);
    expect(result.promotional_subtotal).toBe(0);
    expect(result.applied_promotions).toEqual([]);
    expect(result.items).toEqual([]);
    expect(result.order_promotions_snapshot).toEqual([]);
    expect(prisma.promotions.findMany).not.toHaveBeenCalled();
  });

  it('returns subtotal with empty discounts when no promotions exist', async () => {
    prisma.promotions.findMany.mockResolvedValue([]);

    const result = await service.quoteDiscounts({
      items: [
        { line_id: 'l1', product_id: 10, unit_price: 100, quantity: 2 },
      ],
      now: REFERENCE_NOW,
    });

    expect(result.subtotal).toBe(200);
    expect(result.total_discount).toBe(0);
    expect(result.promotional_subtotal).toBe(200);
    expect(result.items[0].final_unit_price).toBe(100);
    expect(result.items[0].final_line_total).toBe(200);
    expect(result.items[0].promotion_ids).toEqual([]);
  });

  describe('product-scoped promotions', () => {
    it('applies discount only to matching products', async () => {
      prisma.promotions.findMany.mockResolvedValue([
        buildPromotion({
          id: 11,
          name: 'Producto A 10% OFF',
          type: 'percentage',
          value: 10,
          scope: 'product',
          promotion_products: [{ product_id: 10 }],
        }),
      ]);

      const result = await service.quoteDiscounts({
        items: [
          { line_id: 'l1', product_id: 10, unit_price: 100, quantity: 2 }, // 200
          { line_id: 'l2', product_id: 20, unit_price: 50, quantity: 1 }, // 50
        ],
        now: REFERENCE_NOW,
      });

      expect(result.subtotal).toBe(250);
      // 10% of 200 = 20 (only product 10 is in scope)
      expect(result.total_discount).toBe(20);
      expect(result.promotional_subtotal).toBe(230);

      const item10 = result.items.find((i) => i.product_id === 10)!;
      const item20 = result.items.find((i) => i.product_id === 20)!;
      expect(item10.promotion_discount).toBe(20);
      expect(item10.promotion_ids).toEqual([11]);
      expect(item20.promotion_discount).toBe(0);
      expect(item20.promotion_ids).toEqual([]);
      expect(result.applied_promotions[0].applicable_item_ids).toEqual(['l1']);
      expect(result.order_promotions_snapshot).toEqual([
        { promotion_id: 11, discount_amount: 20 },
      ]);
    });
  });

  describe('category-scoped promotions', () => {
    it('matches via single category_id or category_ids array', async () => {
      prisma.promotions.findMany.mockResolvedValue([
        buildPromotion({
          id: 21,
          name: 'Categoria 5 - 10%',
          type: 'percentage',
          value: 10,
          scope: 'category',
          promotion_categories: [{ category_id: 5 }],
        }),
      ]);

      const result = await service.quoteDiscounts({
        items: [
          { line_id: 'a', product_id: 1, category_id: 5, unit_price: 200, quantity: 1 },
          { line_id: 'b', product_id: 2, category_ids: [9, 5], unit_price: 100, quantity: 1 },
          { line_id: 'c', product_id: 3, category_id: 99, unit_price: 50, quantity: 1 },
        ],
        now: REFERENCE_NOW,
      });

      // Applicable total: 200 + 100 = 300, 10% = 30.
      expect(result.total_discount).toBe(30);
      const itemA = result.items.find((i) => i.product_id === 1)!;
      const itemB = result.items.find((i) => i.product_id === 2)!;
      const itemC = result.items.find((i) => i.product_id === 3)!;
      // Proration: 200/300*30 = 20; 100/300*30 = 10
      expect(itemA.promotion_discount).toBe(20);
      expect(itemB.promotion_discount).toBe(10);
      expect(itemC.promotion_discount).toBe(0);
    });
  });

  describe('order-scoped promotions', () => {
    it('applies to the whole cart', async () => {
      prisma.promotions.findMany.mockResolvedValue([
        buildPromotion({
          id: 31,
          name: 'Compra general 10%',
          type: 'percentage',
          value: 10,
          scope: 'order',
        }),
      ]);

      const result = await service.quoteDiscounts({
        items: [
          { line_id: 'x', product_id: 1, unit_price: 100, quantity: 1 },
          { line_id: 'y', product_id: 2, unit_price: 200, quantity: 1 },
        ],
        now: REFERENCE_NOW,
      });

      expect(result.subtotal).toBe(300);
      expect(result.total_discount).toBe(30);
      expect(result.promotional_subtotal).toBe(270);
      expect(result.items.every((i) => i.promotion_ids.includes(31))).toBe(true);
    });
  });

  describe('max discount cap', () => {
    it('caps percentage discount at max_discount_amount', async () => {
      prisma.promotions.findMany.mockResolvedValue([
        buildPromotion({
          id: 41,
          type: 'percentage',
          value: 50, // 50% -> would be 500
          scope: 'order',
          max_discount_amount: 100,
        }),
      ]);

      const result = await service.quoteDiscounts({
        items: [{ line_id: 'a', product_id: 1, unit_price: 1000, quantity: 1 }],
        now: REFERENCE_NOW,
      });

      expect(result.total_discount).toBe(100);
      expect(result.applied_promotions[0].discount_amount).toBe(100);
    });

    it('caps fixed_amount discount at applicable total', async () => {
      prisma.promotions.findMany.mockResolvedValue([
        buildPromotion({
          id: 42,
          type: 'fixed_amount',
          value: 500,
          scope: 'order',
        }),
      ]);

      const result = await service.quoteDiscounts({
        items: [{ line_id: 'a', product_id: 1, unit_price: 100, quantity: 1 }],
        now: REFERENCE_NOW,
      });

      // Discount cannot exceed applicable_total (100).
      expect(result.total_discount).toBe(100);
      expect(result.promotional_subtotal).toBe(0);
    });
  });

  describe('min purchase guard', () => {
    it('does not apply when subtotal is below min_purchase_amount', async () => {
      prisma.promotions.findMany.mockResolvedValue([
        buildPromotion({
          id: 51,
          type: 'percentage',
          value: 10,
          scope: 'order',
          min_purchase_amount: 500,
        }),
      ]);

      const result = await service.quoteDiscounts({
        items: [{ line_id: 'a', product_id: 1, unit_price: 100, quantity: 1 }],
        now: REFERENCE_NOW,
      });

      expect(result.total_discount).toBe(0);
      expect(result.applied_promotions).toEqual([]);
      expect(result.promotional_subtotal).toBe(100);
    });

    it('applies when subtotal meets min_purchase_amount exactly', async () => {
      prisma.promotions.findMany.mockResolvedValue([
        buildPromotion({
          id: 52,
          type: 'percentage',
          value: 10,
          scope: 'order',
          min_purchase_amount: 200,
        }),
      ]);

      const result = await service.quoteDiscounts({
        items: [{ line_id: 'a', product_id: 1, unit_price: 200, quantity: 1 }],
        now: REFERENCE_NOW,
      });

      expect(result.total_discount).toBe(20);
    });
  });

  describe('ineligibility', () => {
    it('ignores promotion when scope does not match any cart item', async () => {
      prisma.promotions.findMany.mockResolvedValue([
        buildPromotion({
          id: 61,
          scope: 'product',
          type: 'percentage',
          value: 25,
          promotion_products: [{ product_id: 999 }],
        }),
      ]);

      const result = await service.quoteDiscounts({
        items: [{ line_id: 'a', product_id: 1, unit_price: 100, quantity: 1 }],
        now: REFERENCE_NOW,
      });

      expect(result.applied_promotions).toEqual([]);
      expect(result.total_discount).toBe(0);
    });

    it('ignores expired promotions via query-time filter (no candidates)', async () => {
      // Simulate Prisma honouring the date predicate: expired promo returns no rows.
      prisma.promotions.findMany.mockResolvedValue([]);

      const result = await service.quoteDiscounts({
        items: [{ line_id: 'a', product_id: 1, unit_price: 100, quantity: 1 }],
        now: REFERENCE_NOW,
      });

      // Verify the query enforced state + date range predicates.
      const args = prisma.promotions.findMany.mock.calls[0][0];
      expect(args.where.state.in).toEqual(['active', 'scheduled']);
      expect(args.where.start_date.lte).toBe(REFERENCE_NOW);
      expect(args.where.OR).toEqual([
        { end_date: null },
        { end_date: { gte: REFERENCE_NOW } },
      ]);
      expect(result.applied_promotions).toEqual([]);
    });

    it('skips promotion when usage_limit is reached', async () => {
      prisma.promotions.findMany.mockResolvedValue([
        buildPromotion({
          id: 62,
          usage_limit: 5,
          usage_count: 5,
        }),
      ]);

      const result = await service.quoteDiscounts({
        items: [{ line_id: 'a', product_id: 1, unit_price: 100, quantity: 1 }],
        now: REFERENCE_NOW,
      });

      expect(result.applied_promotions).toEqual([]);
    });

    it('skips promotion when per_customer_limit is reached', async () => {
      prisma.promotions.findMany.mockResolvedValue([
        buildPromotion({
          id: 63,
          per_customer_limit: 1,
        }),
      ]);
      prisma.order_promotions.count.mockResolvedValue(1);

      const result = await service.quoteDiscounts({
        items: [{ line_id: 'a', product_id: 1, unit_price: 100, quantity: 1 }],
        customer_id: 77,
        now: REFERENCE_NOW,
      });

      expect(prisma.order_promotions.count).toHaveBeenCalledWith({
        where: { promotion_id: 63, customer_id: 77 },
      });
      expect(result.applied_promotions).toEqual([]);
    });
  });

  describe('stacking', () => {
    it('combines multiple auto-apply promotions by priority desc', async () => {
      prisma.promotions.findMany.mockResolvedValue([
        buildPromotion({
          id: 71,
          name: 'Order 5% OFF',
          type: 'percentage',
          value: 5,
          scope: 'order',
          priority: 10,
        }),
        buildPromotion({
          id: 72,
          name: 'Producto 10 - $20 OFF',
          type: 'fixed_amount',
          value: 20,
          scope: 'product',
          priority: 5,
          promotion_products: [{ product_id: 10 }],
        }),
      ]);

      const result = await service.quoteDiscounts({
        items: [
          { line_id: 'l1', product_id: 10, unit_price: 100, quantity: 1 },
          { line_id: 'l2', product_id: 20, unit_price: 100, quantity: 1 },
        ],
        now: REFERENCE_NOW,
      });

      // subtotal = 200
      // First (priority 10): order scope, 5% of 200 = 10
      // Second (priority 5): product scope, fixed 20 on product 10
      expect(result.subtotal).toBe(200);
      expect(result.total_discount).toBe(30);
      expect(result.promotional_subtotal).toBe(170);
      expect(result.applied_promotions.map((p) => p.promotion_id)).toEqual([71, 72]);

      const item10 = result.items.find((i) => i.product_id === 10)!;
      // Item 10 got order share (5% of 100 = 5) + product (20) = 25
      expect(item10.promotion_discount).toBe(25);
      expect(item10.promotion_ids).toEqual([71, 72]);
    });
  });

  describe('manual promotions', () => {
    it('only applies a manual (non-auto) promotion when its id is in manual_promotion_ids', async () => {
      const manualPromotion = buildPromotion({
        id: 81,
        name: 'Manual 15% OFF',
        type: 'percentage',
        value: 15,
        scope: 'order',
        is_auto_apply: false,
      });
      prisma.promotions.findMany.mockResolvedValue([manualPromotion]);

      const withId = await service.quoteDiscounts({
        items: [{ line_id: 'a', product_id: 1, unit_price: 200, quantity: 1 }],
        manual_promotion_ids: [81],
        now: REFERENCE_NOW,
      });
      expect(withId.total_discount).toBe(30);
      expect(withId.applied_promotions[0].promotion_id).toBe(81);

      // Now simulate the same engine call WITHOUT the manual id. Prisma would
      // not return the promo (because the where clause filters by auto OR id).
      prisma.promotions.findMany.mockResolvedValue([]);
      const withoutId = await service.quoteDiscounts({
        items: [{ line_id: 'a', product_id: 1, unit_price: 200, quantity: 1 }],
        now: REFERENCE_NOW,
      });
      expect(withoutId.total_discount).toBe(0);
      expect(withoutId.applied_promotions).toEqual([]);

      // Verify the second call filters by `is_auto_apply: true` only.
      const args = prisma.promotions.findMany.mock.calls[1][0];
      expect(args.where.is_auto_apply).toBe(true);
      expect(args.where.AND).toBeUndefined();
    });

    it('builds a where clause combining auto + manual ids when both are requested', async () => {
      prisma.promotions.findMany.mockResolvedValue([]);

      await service.quoteDiscounts({
        items: [{ line_id: 'a', product_id: 1, unit_price: 100, quantity: 1 }],
        manual_promotion_ids: [81, 82],
        now: REFERENCE_NOW,
      });

      const args = prisma.promotions.findMany.mock.calls[0][0];
      expect(args.where.is_auto_apply).toBeUndefined();
      expect(args.where.AND).toEqual([
        { OR: [{ is_auto_apply: true }, { id: { in: [81, 82] } }] },
      ]);
    });
  });

  describe('order_promotions snapshot', () => {
    it('returns a snapshot ready to persist 1:1 to order_promotions', async () => {
      prisma.promotions.findMany.mockResolvedValue([
        buildPromotion({
          id: 91,
          type: 'percentage',
          value: 10,
          scope: 'order',
        }),
      ]);

      const result = await service.quoteDiscounts({
        items: [{ line_id: 'a', product_id: 1, unit_price: 100, quantity: 1 }],
        now: REFERENCE_NOW,
      });

      expect(result.order_promotions_snapshot).toEqual([
        { promotion_id: 91, discount_amount: 10 },
      ]);
    });
  });

  describe('quantity_tiered - aggregated by scope', () => {
    // Tier factory: mirrors PromotionQuantityTierRecord. `max_quantity` is
    // number|null (null = open-ended top band).
    function buildTier(overrides: Partial<Record<string, unknown>> = {}) {
      return {
        id: 1,
        promotion_id: 100,
        min_quantity: 2,
        max_quantity: null as number | null,
        value: 10,
        type: 'percentage',
        sort_order: 0,
        ...overrides,
      };
    }

    // Case 1 — THE reproduced bug: an order-scope tier whose min_quantity is 2
    // must fire when the cart carries two DISTINCT single-unit lines, because
    // scopedQty aggregates quantity across the scope (2), not per line (1+1).
    // With the old per-line engine each line saw qty=1 < 2 and got nothing.
    it('order scope: 2 distinct lines qty1 each aggregate to scopedQty=2 and apply the tier', async () => {
      prisma.promotions.findMany.mockResolvedValue([
        buildPromotion({
          id: 101,
          name: 'Escala orden 15% desde 2 und',
          scope: 'order',
          rule_type: 'quantity_tiered',
          promotion_quantity_tiers: [
            buildTier({ id: 1, promotion_id: 101, min_quantity: 2, max_quantity: null, value: 15, type: 'percentage' }),
          ],
        }),
      ]);

      const result = await service.quoteDiscounts({
        items: [
          { line_id: 'l1', product_id: 1, unit_price: 75000, quantity: 1 },
          { line_id: 'l2', product_id: 2, unit_price: 43500, quantity: 1 },
        ],
        now: REFERENCE_NOW,
      });

      // applicableTotal = 118500; 15% = 17775 spread over both lines.
      expect(result.total_discount).toBe(17775);
      const l1 = result.items.find((i) => i.line_id === 'l1')!;
      const l2 = result.items.find((i) => i.line_id === 'l2')!;
      expect(l1.promotion_discount).toBe(11250); // 75000 * 15%
      expect(l2.promotion_discount).toBe(6525); // 43500 * 15%
      expect(l1.promotion_ids).toEqual([101]);
      expect(l2.promotion_ids).toEqual([101]);
      expect(result.applied_promotions[0].promotion_id).toBe(101);
      expect(result.applied_promotions[0].applicable_item_ids).toEqual(['l1', 'l2']);
      expect(result.order_promotions_snapshot).toEqual([
        { promotion_id: 101, discount_amount: 17775 },
      ]);
    });

    // Case 2 — category scope aggregates quantity across category lines.
    it('category scope: 2 products of the same category qty1 each trigger the tier by sum', async () => {
      prisma.promotions.findMany.mockResolvedValue([
        buildPromotion({
          id: 102,
          name: 'Categoria 5 escala 10% desde 2 und',
          scope: 'category',
          rule_type: 'quantity_tiered',
          promotion_categories: [{ category_id: 5 }],
          promotion_quantity_tiers: [
            buildTier({ id: 1, promotion_id: 102, min_quantity: 2, max_quantity: null, value: 10, type: 'percentage' }),
          ],
        }),
      ]);

      const result = await service.quoteDiscounts({
        items: [
          { line_id: 'a', product_id: 1, category_id: 5, unit_price: 100, quantity: 1 },
          { line_id: 'b', product_id: 2, category_id: 5, unit_price: 200, quantity: 1 },
        ],
        now: REFERENCE_NOW,
      });

      // scopedQty = 2 -> 10% tier. applicableTotal = 300 -> 30.
      expect(result.total_discount).toBe(30);
      const a = result.items.find((i) => i.line_id === 'a')!;
      const b = result.items.find((i) => i.line_id === 'b')!;
      expect(a.promotion_discount).toBe(10); // 100 * 10%
      expect(b.promotion_discount).toBe(20); // 200 * 10%
      expect(result.applied_promotions[0].promotion_id).toBe(102);
    });

    // Case 3 — product scope with base + variant sharing the same product_id.
    // Two lines with product_id=10 (base + a variant) aggregate to scopedQty=2.
    it('product scope: base + variant lines (same product_id) qty1 each aggregate to trigger the tier', async () => {
      prisma.promotions.findMany.mockResolvedValue([
        buildPromotion({
          id: 103,
          name: 'Producto 10 escala 10% desde 2 und',
          scope: 'product',
          rule_type: 'quantity_tiered',
          promotion_products: [{ product_id: 10 }],
          promotion_quantity_tiers: [
            buildTier({ id: 1, promotion_id: 103, min_quantity: 2, max_quantity: null, value: 10, type: 'percentage' }),
          ],
        }),
      ]);

      const result = await service.quoteDiscounts({
        items: [
          { line_id: 'base', product_id: 10, unit_price: 100, quantity: 1 },
          { line_id: 'variant', product_id: 10, variant_id: 55, unit_price: 150, quantity: 1 },
        ],
        now: REFERENCE_NOW,
      });

      // scopedQty = 2 -> 10% tier on each line. 10 + 15 = 25.
      expect(result.total_discount).toBe(25);
      const base = result.items.find((i) => i.line_id === 'base')!;
      const variant = result.items.find((i) => i.line_id === 'variant')!;
      expect(base.promotion_discount).toBe(10); // 100 * 10%
      expect(variant.promotion_discount).toBe(15); // 150 * 10%
      expect(base.promotion_ids).toEqual([103]);
      expect(variant.promotion_ids).toEqual([103]);
    });

    // Case 4 — aggregated quantity below the lowest tier min => no tier matched.
    it('does not apply when aggregated scopedQty is below the tier minimum', async () => {
      prisma.promotions.findMany.mockResolvedValue([
        buildPromotion({
          id: 104,
          scope: 'order',
          rule_type: 'quantity_tiered',
          promotion_quantity_tiers: [
            buildTier({ id: 1, promotion_id: 104, min_quantity: 2, max_quantity: null, value: 20, type: 'percentage' }),
          ],
        }),
      ]);

      const result = await service.quoteDiscounts({
        items: [{ line_id: 'a', product_id: 1, unit_price: 100, quantity: 1 }],
        now: REFERENCE_NOW,
      });

      expect(result.total_discount).toBe(0);
      expect(result.applied_promotions).toEqual([]);
      expect(result.items[0].promotion_discount).toBe(0);
    });

    // Case 5 — fixed_amount tier: a FLAT amount applied ONCE across the scope.
    // Business rule (confirmed): a fixed_amount tier behaves exactly like a
    // non-tiered fixed discount — a single flat amount, NOT tier.value × units.
    // Canonical example: cart 3×$12.000 (=$36.000), tier "2-4 und = $5.000"
    // order scope → flat $5.000 off once (total $31.000), NOT $15.000/$21.000
    // that the old per-unit (5000×3) math produced.
    it('fixed_amount tier: FLAT discount applied once (not per unit), capped at applicable total', async () => {
      prisma.promotions.findMany.mockResolvedValue([
        buildPromotion({
          id: 105,
          scope: 'order',
          rule_type: 'quantity_tiered',
          promotion_quantity_tiers: [
            buildTier({ id: 1, promotion_id: 105, min_quantity: 2, max_quantity: 4, value: 5000, type: 'fixed_amount' }),
          ],
        }),
      ]);

      const result = await service.quoteDiscounts({
        items: [
          { line_id: 'a', product_id: 1, unit_price: 12000, quantity: 3 },
        ],
        now: REFERENCE_NOW,
      });

      // scopedQty = 3 matches the 2-4 band -> flat $5.000 once.
      expect(result.subtotal).toBe(36000);
      expect(result.total_discount).toBe(5000);
      expect(result.promotional_subtotal).toBe(31000);
      const a = result.items.find((i) => i.line_id === 'a')!;
      expect(a.promotion_discount).toBe(5000);
      expect(result.applied_promotions[0].discount_amount).toBe(5000);
    });

    // Case 5b — regression guard: the flat amount stays a SINGLE discount even
    // when the scope spans multiple lines. It is split proportionally across
    // lines, never applied per line and never multiplied by unit count.
    it('fixed_amount tier: flat amount is a single discount split across multiple lines (not per line)', async () => {
      prisma.promotions.findMany.mockResolvedValue([
        buildPromotion({
          id: 115,
          scope: 'order',
          rule_type: 'quantity_tiered',
          promotion_quantity_tiers: [
            buildTier({ id: 1, promotion_id: 115, min_quantity: 2, max_quantity: null, value: 1000, type: 'fixed_amount' }),
          ],
        }),
      ]);

      const result = await service.quoteDiscounts({
        items: [
          { line_id: 'a', product_id: 1, unit_price: 5000, quantity: 1 },
          { line_id: 'b', product_id: 2, unit_price: 5000, quantity: 1 },
        ],
        now: REFERENCE_NOW,
      });

      // Flat $1.000 once across the whole order (5000/5000 split -> 500/500),
      // NOT $1.000 per line and NOT per unit.
      expect(result.total_discount).toBe(1000);
      const a = result.items.find((i) => i.line_id === 'a')!;
      const b = result.items.find((i) => i.line_id === 'b')!;
      expect(a.promotion_discount).toBe(500);
      expect(b.promotion_discount).toBe(500);
    });

    // Case 6 — the global max_discount_amount cap still applies on top of the
    // summed tiered line discounts.
    it('caps the tiered discount at max_discount_amount', async () => {
      prisma.promotions.findMany.mockResolvedValue([
        buildPromotion({
          id: 106,
          scope: 'order',
          rule_type: 'quantity_tiered',
          max_discount_amount: 100,
          promotion_quantity_tiers: [
            buildTier({ id: 1, promotion_id: 106, min_quantity: 2, max_quantity: null, value: 50, type: 'percentage' }),
          ],
        }),
      ]);

      const result = await service.quoteDiscounts({
        items: [
          { line_id: 'a', product_id: 1, unit_price: 1000, quantity: 1 },
          { line_id: 'b', product_id: 2, unit_price: 1000, quantity: 1 },
        ],
        now: REFERENCE_NOW,
      });

      // 50% of 2000 = 1000 raw, capped to 100.
      expect(result.total_discount).toBe(100);
      expect(result.applied_promotions[0].discount_amount).toBe(100);
    });

    // Case 7 — proration invariant: the sum of per-item promotion_discount must
    // equal both applied_promotions[0].discount_amount and total_discount with
    // zero rounding drift, even when a cap forces a fractional scale.
    it('prorates with no rounding drift: sum of item discounts == applied discount == total', async () => {
      prisma.promotions.findMany.mockResolvedValue([
        buildPromotion({
          id: 107,
          scope: 'order',
          rule_type: 'quantity_tiered',
          max_discount_amount: 100, // forces scale = 100/150 = 0.6667 across 3 lines
          promotion_quantity_tiers: [
            buildTier({ id: 1, promotion_id: 107, min_quantity: 2, max_quantity: null, value: 50, type: 'percentage' }),
          ],
        }),
      ]);

      const result = await service.quoteDiscounts({
        items: [
          { line_id: 'a', product_id: 1, unit_price: 100, quantity: 1 },
          { line_id: 'b', product_id: 2, unit_price: 100, quantity: 1 },
          { line_id: 'c', product_id: 3, unit_price: 100, quantity: 1 },
        ],
        now: REFERENCE_NOW,
      });

      const sumItems = result.items.reduce((s, i) => s + i.promotion_discount, 0);
      expect(result.total_discount).toBe(100);
      expect(result.applied_promotions[0].discount_amount).toBe(100);
      expect(Math.round(sumItems * 100) / 100).toBe(100);
      expect(Math.round(sumItems * 100) / 100).toBe(result.applied_promotions[0].discount_amount);
    });

    // Case 8 — max_quantity bounds a band: scopedQty picks the correct tier.
    it('selects the tier whose band contains scopedQty (max_quantity bounds the band)', async () => {
      const tiers = [
        buildTier({ id: 1, promotion_id: 108, min_quantity: 2, max_quantity: 4, value: 10, type: 'percentage', sort_order: 0 }),
        buildTier({ id: 2, promotion_id: 108, min_quantity: 5, max_quantity: null, value: 20, type: 'percentage', sort_order: 1 }),
      ];

      // scopedQty = 3 -> first band (10%).
      prisma.promotions.findMany.mockResolvedValue([
        buildPromotion({
          id: 108,
          scope: 'order',
          rule_type: 'quantity_tiered',
          promotion_quantity_tiers: tiers,
        }),
      ]);
      const low = await service.quoteDiscounts({
        items: [{ line_id: 'a', product_id: 1, unit_price: 100, quantity: 3 }],
        now: REFERENCE_NOW,
      });
      // lineTotal = 300, 10% = 30.
      expect(low.total_discount).toBe(30);

      // scopedQty = 6 -> second band (20%).
      prisma.promotions.findMany.mockResolvedValue([
        buildPromotion({
          id: 108,
          scope: 'order',
          rule_type: 'quantity_tiered',
          promotion_quantity_tiers: tiers,
        }),
      ]);
      const high = await service.quoteDiscounts({
        items: [{ line_id: 'a', product_id: 1, unit_price: 100, quantity: 6 }],
        now: REFERENCE_NOW,
      });
      // lineTotal = 600, 20% = 120.
      expect(high.total_discount).toBe(120);
    });
  });

  describe('quantity_tiered badge label (findActiveAutoPromotionsForProducts)', () => {
    function buildTier(overrides: Partial<Record<string, unknown>> = {}) {
      return {
        id: 1,
        promotion_id: 200,
        min_quantity: 2,
        max_quantity: null as number | null,
        value: 10,
        type: 'percentage',
        sort_order: 0,
        ...overrides,
      };
    }

    it('percentage tier badge advertises the min quantity and the -X% benefit', async () => {
      prisma.promotions.findMany.mockResolvedValue([
        buildPromotion({
          id: 201,
          scope: 'product',
          rule_type: 'quantity_tiered',
          type: 'percentage',
          promotion_products: [{ product_id: 10 }],
          promotion_quantity_tiers: [
            buildTier({ id: 1, promotion_id: 201, min_quantity: 3, max_quantity: null, value: 15, type: 'percentage' }),
          ],
        }),
      ]);

      const map = await service.findActiveAutoPromotionsForProducts(
        [{ product_id: 10, unit_price: 20000, category_ids: [] }],
        REFERENCE_NOW,
      );

      const entry = map.get(10)!;
      expect(entry).toBeDefined();
      expect(entry.badge_label).toBe('Desde 3 und: -15%');
    });

    it('fixed_amount tier badge advertises the flat -$Y benefit formatted es-CO', async () => {
      prisma.promotions.findMany.mockResolvedValue([
        buildPromotion({
          id: 202,
          scope: 'product',
          rule_type: 'quantity_tiered',
          type: 'fixed_amount',
          promotion_products: [{ product_id: 10 }],
          promotion_quantity_tiers: [
            buildTier({ id: 1, promotion_id: 202, min_quantity: 2, max_quantity: null, value: 5000, type: 'fixed_amount' }),
          ],
        }),
      ]);

      const map = await service.findActiveAutoPromotionsForProducts(
        [{ product_id: 10, unit_price: 20000, category_ids: [] }],
        REFERENCE_NOW,
      );

      const entry = map.get(10)!;
      expect(entry).toBeDefined();
      // Flat 5000 -> "-$5.000" (es-CO thousands separator), coherent with the
      // discount_amount the same method exposes for this tier.
      expect(entry.discount_amount).toBe(5000);
      expect(entry.badge_label).toBe('Desde 2 und: -$5.000');
    });
  });
});
