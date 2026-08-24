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
    // Default to legacy cart_total so existing test cases that aggregate
    // quantity across lines keep working. Tests that want per-product
    // grouping pass `quantity_grouping: 'per_product'` via overrides.
    quantity_grouping: 'cart_total',
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

describe('PromotionEngineService - quoteDiscounts', () => {
  let service: PromotionEngineService;
  let prisma: {
    promotions: { findMany: jest.Mock; findFirst: jest.Mock; update: jest.Mock };
    order_promotions: {
      count: jest.Mock;
      create: jest.Mock;
      // CP-ECOM-PROMO-UX-001 convergence-R5-N+1: limit checks are batched
      // via `groupBy`, so the spec exposes the mock surface the engine
      // actually queries against.
      groupBy: jest.Mock;
    };
    products: { findMany: jest.Mock };
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
        // Default to "no usage yet" so tests that don't care about
        // per_customer_limit behave the same as before. Tests that DO care
        // override the mock per-case with a concrete `{ promotion_id,
        // _count: { _all } }` row.
        groupBy: jest.fn().mockResolvedValue([]),
      },
      // QUI-648: el motor lee la escala de venta del producto para contar
      // presentaciones en vez de unidades mínimas. Por defecto ningún producto
      // declara escala, así que el resto de las specs cuentan como siempre.
      products: {
        findMany: jest.fn().mockResolvedValue([]),
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
      // CP-ECOM-PROMO-UX-001 convergence-R5-N+1: the engine now batches
      // per-customer usage counts via `groupBy` instead of issuing a
      // per-promo `count`. Mock the new surface and assert against it.
      prisma.order_promotions.groupBy.mockResolvedValue([
        { promotion_id: 63, _count: { _all: 1 } },
      ] as any);

      const result = await service.quoteDiscounts({
        items: [{ line_id: 'a', product_id: 1, unit_price: 100, quantity: 1 }],
        customer_id: 77,
        now: REFERENCE_NOW,
      });

      expect(prisma.order_promotions.groupBy).toHaveBeenCalledWith({
        by: ['promotion_id'],
        where: { promotion_id: { in: [63] }, customer_id: 77 },
        _count: { _all: true },
      });
      expect(result.applied_promotions).toEqual([]);
    });
  });

  describe('winner-takes-all', () => {
    // Promotions do NOT stack. When several auto-apply promos are eligible,
    // exactly ONE is applied: the lowest priority NUMBER wins (1 = highest
    // importance, like a priority queue).
    it('applies only the promotion with the lowest priority number', async () => {
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

      // subtotal = 200. Promo 72 (priority 5) beats promo 71 (priority 10),
      // so ONLY the $20 fixed discount on product 10 applies — the order-wide
      // 5% is evaluated and discarded, not added on top.
      expect(result.subtotal).toBe(200);
      expect(result.total_discount).toBe(20);
      expect(result.promotional_subtotal).toBe(180);
      expect(result.applied_promotions.map((p) => p.promotion_id)).toEqual([72]);

      const item10 = result.items.find((i) => i.product_id === 10)!;
      expect(item10.promotion_discount).toBe(20);
      expect(item10.promotion_ids).toEqual([72]);

      const item20 = result.items.find((i) => i.product_id === 20)!;
      expect(item20.promotion_discount).toBe(0);
      expect(item20.promotion_ids).toEqual([]);
    });

    // Tie-break contract. `promotions.priority` defaults to 0, so equal
    // priorities are the COMMON case, not an edge case. On a tie the oldest
    // promo (lowest id) wins, and every read path must agree on that —
    // quoteDiscounts, getEligiblePromotions and the product-card badge.
    it('breaks a priority tie by lowest promotion id (oldest wins)', async () => {
      prisma.promotions.findMany.mockResolvedValue([
        buildPromotion({
          id: 82,
          name: 'Nueva 30% OFF',
          type: 'percentage',
          value: 30,
          scope: 'order',
          priority: 0,
        }),
        buildPromotion({
          id: 81,
          name: 'Vieja 10% OFF',
          type: 'percentage',
          value: 10,
          scope: 'order',
          priority: 0,
        }),
      ]);

      const result = await service.quoteDiscounts({
        items: [{ line_id: 'l1', product_id: 1, unit_price: 100, quantity: 1 }],
        now: REFERENCE_NOW,
      });

      // Same priority → id 81 wins even though 82 offers a bigger discount
      // and was listed first. The rule is deterministic, not "best for the
      // customer", so the POS snapshot and /check-eligibility never diverge.
      expect(result.applied_promotions.map((p) => p.promotion_id)).toEqual([81]);
      expect(result.total_discount).toBe(10);
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
      // cart_total grouping: the discount spans multiple distinct SKUs as a
      // single cart-wide deal, so the "which product triggered it" concept
      // doesn't apply. The frontend uses the empty array as the signal to
      // skip the "en: X, Y" line under the promotion name — otherwise it
      // would mislead the customer into thinking the promo was tied to
      // specific SKUs when in reality it was triggered by the sum.
      expect(result.applied_promotions[0].target_product_ids).toEqual([]);
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

    // Case 2b — per_product grouping with order scope. With 2 distinct single-unit
    // lines, each product has qty=1, below min_quantity=2. NO discount must apply.
    // This is the EXACT scenario from the issue (3 different SKUs, 1 unit each).
    it('per_product: 2 distinct SKUs qty1 each do NOT trigger the tier (issue repro)', async () => {
      prisma.promotions.findMany.mockResolvedValue([
        buildPromotion({
          id: 201,
          name: 'Super promo per_product 5% desde 2 und',
          scope: 'order',
          rule_type: 'quantity_tiered',
          quantity_grouping: 'per_product',
          promotion_products: [
            { product_id: 1 },
            { product_id: 2 },
            { product_id: 3 },
          ],
          promotion_quantity_tiers: [
            buildTier({ id: 1, promotion_id: 201, min_quantity: 2, max_quantity: null, value: 5, type: 'percentage' }),
          ],
        }),
      ]);

      const result = await service.quoteDiscounts({
        items: [
          { line_id: 'l1', product_id: 1, unit_price: 49499, quantity: 1 },
          { line_id: 'l2', product_id: 2, unit_price: 43500, quantity: 1 },
          { line_id: 'l3', product_id: 3, unit_price: 69000, quantity: 1 },
        ],
        now: REFERENCE_NOW,
      });

      // Each product has qty=1 < min_quantity=2 → no tier matches any product
      // → no discount applied to any line.
      expect(result.total_discount).toBe(0);
      for (const line of result.items) {
        expect(line.promotion_discount).toBe(0);
        expect(line.promotion_ids).toEqual([]);
      }
      expect(result.applied_promotions).toEqual([]);
      // Banner (tier_progress) must still surface so the customer knows what
      // to do — and name the closest product. With all 3 products at qty=1
      // tied, the engine picks the first one encountered (lowest index).
      expect(result.tier_progress).toHaveLength(1);
      expect(result.tier_progress[0].promotion_id).toBe(201);
      expect(result.tier_progress[0].remaining_quantity).toBe(1);
      expect(result.tier_progress[0].target_product_id).toBe(1);
    });

    // Case 2c — per_product grouping: 1 product reaches min_quantity on its own.
    // Product A has qty=2 (qualifies); products B and C have qty=1 each (don't).
    // The discount applies to product A only.
    it('per_product: 1 product with qty=2 triggers the tier, others do not', async () => {
      prisma.promotions.findMany.mockResolvedValue([
        buildPromotion({
          id: 202,
          name: 'Per-product 10% desde 2 und',
          scope: 'order',
          rule_type: 'quantity_tiered',
          quantity_grouping: 'per_product',
          promotion_products: [{ product_id: 1 }, { product_id: 2 }, { product_id: 3 }],
          promotion_quantity_tiers: [
            buildTier({ id: 1, promotion_id: 202, min_quantity: 2, max_quantity: null, value: 10, type: 'percentage' }),
          ],
        }),
      ]);

      const result = await service.quoteDiscounts({
        items: [
          { line_id: 'l1', product_id: 1, unit_price: 100, quantity: 2 },  // qualifies
          { line_id: 'l2', product_id: 2, unit_price: 100, quantity: 1 },  // no
          { line_id: 'l3', product_id: 3, unit_price: 100, quantity: 1 },  // no
        ],
        now: REFERENCE_NOW,
      });

      // Product 1 (qty=2) qualifies → 10% of 200 = 20. Others 0.
      expect(result.total_discount).toBe(20);
      const l1 = result.items.find((i) => i.line_id === 'l1')!;
      const l2 = result.items.find((i) => i.line_id === 'l2')!;
      const l3 = result.items.find((i) => i.line_id === 'l3')!;
      expect(l1.promotion_discount).toBe(20);
      expect(l1.promotion_ids).toEqual([202]);
      expect(l2.promotion_discount).toBe(0);
      expect(l2.promotion_ids).toEqual([]);
      expect(l3.promotion_discount).toBe(0);
      expect(l3.promotion_ids).toEqual([]);
      expect(result.applied_promotions).toHaveLength(1);
      expect(result.applied_promotions[0].promotion_id).toBe(202);
      expect(result.applied_promotions[0].applicable_item_ids).toEqual(['l1']);
      // Applied promotion must report ONLY the product(s) that actually
      // unlocked the deal. Products 2 and 3 had qty=1 and must NOT appear
      // here even though they share scope (otherwise the UI would falsely
      // tell the customer "Super promo applied to B and C too").
      expect(result.applied_promotions[0].target_product_ids).toEqual([1]);
      // Banner: now that product 1 already qualified, the next nudge points
      // to whichever product is closest to qualifying next. Product 2 and
      // product 3 are tied at qty=1 → engine picks the first one (lowest
      // index) for stable, deterministic output.
      expect(result.tier_progress).toHaveLength(1);
      expect(result.tier_progress[0].target_product_id).toBe(2);
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

  describe('tier_progress (next tier nudge)', () => {
    function buildTier(overrides: Partial<Record<string, unknown>> = {}) {
      return {
        id: 1,
        promotion_id: 100,
        min_quantity: 3,
        max_quantity: null as number | null,
        value: 15,
        type: 'percentage',
        sort_order: 0,
        ...overrides,
      };
    }

    // scopedQty=2 sits below the lowest tier (min 3): NO discount applies
    // (total_discount must stay 0 exactly as before this feature), and the
    // nudge advertises the reachable min-3 tier with remaining_quantity=1.
    it('surfaces the next reachable tier without altering the discount math', async () => {
      prisma.promotions.findMany.mockResolvedValue([
        buildPromotion({
          id: 301,
          name: 'Escala orden desde 3 und',
          scope: 'order',
          rule_type: 'quantity_tiered',
          promotion_quantity_tiers: [
            buildTier({ id: 1, promotion_id: 301, min_quantity: 3, max_quantity: 5, value: 15, type: 'percentage', sort_order: 0 }),
            buildTier({ id: 2, promotion_id: 301, min_quantity: 6, max_quantity: null, value: 25, type: 'percentage', sort_order: 1 }),
          ],
        }),
      ]);

      const result = await service.quoteDiscounts({
        items: [
          { line_id: 'l1', product_id: 1, unit_price: 10000, quantity: 1 },
          { line_id: 'l2', product_id: 2, unit_price: 20000, quantity: 1 },
        ],
        now: REFERENCE_NOW,
      });

      // No regression: scopedQty=2 < 3 => no tier fires => zero discount, same
      // totals as if tier_progress had never been added.
      expect(result.total_discount).toBe(0);
      expect(result.promotional_subtotal).toBe(30000);
      expect(result.applied_promotions).toEqual([]);

      // Nudge points at the FIRST reachable tier (min_quantity 3).
      expect(result.tier_progress).toHaveLength(1);
      expect(result.tier_progress[0].promotion_id).toBe(301);
      expect(result.tier_progress[0].name).toBe('Escala orden desde 3 und');
      expect(result.tier_progress[0].remaining_quantity).toBe(1); // 3 - 2
      expect(result.tier_progress[0].benefit_type).toBe('percentage');
      expect(result.tier_progress[0].benefit_value).toBe(15);
    });

    // Promos do NOT stack, so a nudge for a promo that would lose the
    // winner-takes-all comparison is a lie: the customer adds product and the
    // discount never changes. Only promos that could actually take over are
    // advertised.
    it('suppresses the nudge of a promo that would lose to the applied one', async () => {
      prisma.promotions.findMany.mockResolvedValue([
        buildPromotion({
          id: 401,
          name: 'Orden 10% (gana)',
          type: 'percentage',
          value: 10,
          scope: 'order',
          priority: 1,
        }),
        buildPromotion({
          id: 402,
          name: 'Escala desde 3 und (pierde)',
          scope: 'order',
          rule_type: 'quantity_tiered',
          priority: 5,
          promotion_quantity_tiers: [
            buildTier({ id: 1, promotion_id: 402, min_quantity: 3, max_quantity: null, value: 25, type: 'percentage', sort_order: 0 }),
          ],
        }),
      ]);

      const result = await service.quoteDiscounts({
        items: [
          { line_id: 'l1', product_id: 1, unit_price: 10000, quantity: 1 },
          { line_id: 'l2', product_id: 2, unit_price: 20000, quantity: 1 },
        ],
        now: REFERENCE_NOW,
      });

      // 401 (priority 1) applies. 402 (priority 5) has a tier one unit away,
      // but even reaching it would not beat 401, so no nudge is emitted.
      expect(result.applied_promotions.map((p) => p.promotion_id)).toEqual([401]);
      expect(result.total_discount).toBe(3000);
      expect(result.tier_progress).toEqual([]);
    });

    it('keeps the nudge of a promo that would beat the applied one', async () => {
      prisma.promotions.findMany.mockResolvedValue([
        buildPromotion({
          id: 403,
          name: 'Escala desde 3 und (ganaria)',
          scope: 'order',
          rule_type: 'quantity_tiered',
          priority: 0,
          promotion_quantity_tiers: [
            buildTier({ id: 1, promotion_id: 403, min_quantity: 3, max_quantity: null, value: 25, type: 'percentage', sort_order: 0 }),
          ],
        }),
        buildPromotion({
          id: 404,
          name: 'Orden 10% (aplica ahora)',
          type: 'percentage',
          value: 10,
          scope: 'order',
          priority: 5,
        }),
      ]);

      const result = await service.quoteDiscounts({
        items: [
          { line_id: 'l1', product_id: 1, unit_price: 10000, quantity: 1 },
          { line_id: 'l2', product_id: 2, unit_price: 20000, quantity: 1 },
        ],
        now: REFERENCE_NOW,
      });

      // 404 applies today (403's tier is not reached yet), but 403 has a lower
      // priority number, so reaching its tier WOULD take over — the nudge is
      // actionable and must survive.
      expect(result.applied_promotions.map((p) => p.promotion_id)).toEqual([404]);
      expect(result.tier_progress).toHaveLength(1);
      expect(result.tier_progress[0].promotion_id).toBe(403);
      expect(result.tier_progress[0].remaining_quantity).toBe(1);
    });

    it('emits no nudge when there are no in-scope items yet (scopedQty=0)', async () => {
      prisma.promotions.findMany.mockResolvedValue([
        buildPromotion({
          id: 302,
          name: 'Escala producto 999',
          scope: 'product',
          rule_type: 'quantity_tiered',
          promotion_products: [{ product_id: 999 }],
          promotion_quantity_tiers: [
            buildTier({ id: 1, promotion_id: 302, min_quantity: 3, value: 15, type: 'percentage' }),
          ],
        }),
      ]);

      const result = await service.quoteDiscounts({
        items: [{ line_id: 'a', product_id: 1, unit_price: 10000, quantity: 1 }],
        now: REFERENCE_NOW,
      });

      expect(result.tier_progress).toEqual([]);
    });

    it('emits no nudge once the top tier is already reached', async () => {
      prisma.promotions.findMany.mockResolvedValue([
        buildPromotion({
          id: 303,
          scope: 'order',
          rule_type: 'quantity_tiered',
          promotion_quantity_tiers: [
            buildTier({ id: 1, promotion_id: 303, min_quantity: 3, max_quantity: null, value: 15, type: 'percentage' }),
          ],
        }),
      ]);

      const result = await service.quoteDiscounts({
        items: [{ line_id: 'a', product_id: 1, unit_price: 10000, quantity: 5 }],
        now: REFERENCE_NOW,
      });

      // scopedQty=5 >= 3 (and no higher tier) => tier already unlocked, no nudge.
      expect(result.tier_progress).toEqual([]);
      expect(result.total_discount).toBe(7500); // 15% of 50000, discount still fires
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

  // QUI-648 — "lleva 3" cuenta unidades de VENTA, no de stock. Un cable medido
  // en milímetros llega con `quantity = 3000` para 3 metros: sin normalizar, la
  // promoción se dispararía con 3 milímetros de cable (un recorte de $0,015) y
  // no se dispararía nunca a partir de 3 metros porque 3000 ya pasó de largo
  // cualquier tramo pensado en unidades.
  describe('escala de venta (price_unit_quantity)', () => {
    /** Copia local del constructor de tramos (el original vive anidado). */
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

    /** Cable a $5.000 el metro con stock en mm: 1 metro = 1.000 mm. */
    function cableEnMilimetros() {
      prisma.products.findMany.mockResolvedValue([
        { id: 10, price_unit_quantity: 1000 },
      ]);
      prisma.promotions.findMany.mockResolvedValue([
        buildPromotion({
          id: 301,
          name: 'Lleva 3 metros, 10%',
          scope: 'order',
          rule_type: 'quantity_tiered',
          quantity_grouping: 'per_product',
          promotion_products: [{ product_id: 10 }],
          promotion_quantity_tiers: [
            buildTier({
              id: 1,
              promotion_id: 301,
              min_quantity: 3,
              max_quantity: null,
              value: 10,
              type: 'percentage',
            }),
          ],
        }),
      ]);
    }

    it('no se dispara con 3 milímetros de cable', async () => {
      cableEnMilimetros();

      const result = await service.quoteDiscounts({
        // 3 mm: tres milésimas de metro, no tres metros.
        items: [{ line_id: 'l1', product_id: 10, unit_price: 5000, quantity: 3 }],
        now: REFERENCE_NOW,
      });

      expect(result.total_discount).toBe(0);
      expect(result.applied_promotions).toEqual([]);
    });

    it('sí se dispara con 3 metros de cable', async () => {
      cableEnMilimetros();

      const result = await service.quoteDiscounts({
        // 3.000 mm = 3 metros: la escala del producto lo vuelve 3.
        items: [
          { line_id: 'l1', product_id: 10, unit_price: 5, quantity: 3000 },
        ],
        now: REFERENCE_NOW,
      });

      expect(result.total_discount).toBeGreaterThan(0);
      expect(result.applied_promotions).toHaveLength(1);
      expect(result.applied_promotions[0].promotion_id).toBe(301);
    });

    it('una línea vendida por presentación ya cuenta presentaciones', async () => {
      cableEnMilimetros();

      const result = await service.quoteDiscounts({
        // 3 rollos: `stock_units_consumed` dice que el descuento de inventario
        // es 60.000 mm, pero la promoción cuenta 3 y no 60.000.
        items: [
          {
            line_id: 'l1',
            product_id: 10,
            unit_price: 95000,
            quantity: 3,
            stock_units_consumed: 60000,
          } as any,
        ],
        now: REFERENCE_NOW,
      });

      expect(result.applied_promotions).toHaveLength(1);
      expect(result.applied_promotions[0].promotion_id).toBe(301);
    });

    // ---------------------------------------------------------------
    // DINERO. Contar bien el tramo no basta: `unit_price` es el precio de UNA
    // unidad de PRECIO (el metro), así que multiplicarlo por la cantidad cruda
    // en unidades de stock infla el subtotal por N. Con N = 1.000 una venta de
    // $12.500 se leía como $12.500.000 y un 10% se volvía $1.250.000, que
    // dejaba la orden en cero.
    // ---------------------------------------------------------------

    /** Cable a $5.000 el metro con un 10% plano de orden. */
    function cableConDiezPorCiento(scale: number | null = 1000) {
      prisma.products.findMany.mockResolvedValue([
        { id: 10, price_unit_quantity: scale },
      ]);
      prisma.promotions.findMany.mockResolvedValue([
        buildPromotion({
          id: 310,
          name: 'Orden 10% OFF',
          type: 'percentage',
          value: 10,
          scope: 'order',
        }),
      ]);
    }

    it('el subtotal de 2.500 mm de cable a $5.000/m son $12.500, no $12.500.000', async () => {
      cableConDiezPorCiento();

      const result = await service.quoteDiscounts({
        items: [
          { line_id: 'l1', product_id: 10, unit_price: 5000, quantity: 2500 },
        ],
        now: REFERENCE_NOW,
      });

      // 2.500 mm = 2,5 metros × $5.000 = $12.500.
      expect(result.subtotal).toBe(12500);
      // 10% de $12.500. El defecto producía $1.250.000.
      expect(result.total_discount).toBe(1250);
      expect(result.promotional_subtotal).toBe(11250);
      expect(result.applied_promotions[0].discount_amount).toBe(1250);
    });

    it('el precio unitario descontado sigue siendo por METRO ($4.500), no por milímetro', async () => {
      cableConDiezPorCiento();

      const result = await service.quoteDiscounts({
        items: [
          { line_id: 'l1', product_id: 10, unit_price: 5000, quantity: 2500 },
        ],
        now: REFERENCE_NOW,
      });

      const l1 = result.items[0]!;
      // Lo que la escala cambia es el MULTIPLICADOR, nunca la magnitud del
      // precio unitario: un 10% sobre $5.000/m da $4.500/m. Dividir por la
      // cantidad cruda daría $4,5 y el POS cobraría una milésima parte.
      expect(l1.original_unit_price).toBe(5000);
      expect(l1.final_unit_price).toBe(4500);
      expect(l1.final_line_total).toBe(11250);
      expect(l1.promotion_discount).toBe(1250);
      // `quantity` se reporta CRUDO: es la cantidad que la orden persiste.
      expect(l1.quantity).toBe(2500);
    });

    it('el dinero NO se redondea al piso aunque el tramo sí lo haga', async () => {
      // 3.500 mm = 3,5 metros. El TRAMO cuenta 3 (lleva 3 metros, se cumple),
      // pero el DINERO cobra 3,5 metros: $17.500. Aplicar el mismo Math.floor
      // del contador de tramos regalaría medio metro en cada línea.
      cableEnMilimetros();

      const result = await service.quoteDiscounts({
        items: [
          { line_id: 'l1', product_id: 10, unit_price: 5000, quantity: 3500 },
        ],
        now: REFERENCE_NOW,
      });

      expect(result.subtotal).toBe(17500);
      expect(result.applied_promotions).toHaveLength(1);
      expect(result.total_discount).toBe(1750); // 10% de $17.500
      const l1 = result.items[0]!;
      expect(l1.final_unit_price).toBe(4500); // 15.750 / 3,5
      expect(l1.final_line_total).toBe(15750);
    });

    it('una línea vendida por presentación no se divide otra vez', async () => {
      cableConDiezPorCiento();

      const result = await service.quoteDiscounts({
        items: [
          {
            line_id: 'l1',
            product_id: 10,
            // 3 rollos a $95.000 el rollo. `unit_price` YA es el precio del
            // paquete y `quantity` YA cuenta paquetes: dividir por la escala
            // cobraría $285 en vez de $285.000.
            unit_price: 95000,
            quantity: 3,
            stock_units_consumed: 60000,
          } as any,
        ],
        now: REFERENCE_NOW,
      });

      expect(result.subtotal).toBe(285000);
      expect(result.total_discount).toBe(28500);
      const l1 = result.items[0]!;
      expect(l1.final_unit_price).toBe(85500);
      expect(l1.final_line_total).toBe(256500);
    });

    // --- No regresión: con escala 1 (todo el catálogo actual) la aritmética
    // tiene que quedar bit a bit igual a la histórica `unit_price × quantity`.

    it('no regresión — escala 1: el porcentaje plano cobra unit_price × quantity', async () => {
      cableConDiezPorCiento(1);

      const result = await service.quoteDiscounts({
        items: [
          { line_id: 'l1', product_id: 10, unit_price: 5000, quantity: 3 },
        ],
        now: REFERENCE_NOW,
      });

      expect(result.subtotal).toBe(15000);
      expect(result.total_discount).toBe(1500);
      expect(result.promotional_subtotal).toBe(13500);
      const l1 = result.items[0]!;
      expect(l1.final_unit_price).toBe(4500);
      expect(l1.final_line_total).toBe(13500);
    });

    it('no regresión — escala 1: el tramo fixed_amount sigue siendo un monto plano', async () => {
      prisma.products.findMany.mockResolvedValue([
        { id: 10, price_unit_quantity: 1 },
      ]);
      prisma.promotions.findMany.mockResolvedValue([
        buildPromotion({
          id: 311,
          scope: 'order',
          rule_type: 'quantity_tiered',
          promotion_quantity_tiers: [
            buildTier({
              id: 1,
              promotion_id: 311,
              min_quantity: 2,
              max_quantity: 4,
              value: 5000,
              type: 'fixed_amount',
            }),
          ],
        }),
      ]);

      const result = await service.quoteDiscounts({
        items: [
          { line_id: 'a', product_id: 10, unit_price: 12000, quantity: 3 },
        ],
        now: REFERENCE_NOW,
      });

      // Mismos números que el caso 5 de `quantity_tiered` (que corre sin
      // ningún producto con escala): la escala 1 no mueve nada.
      expect(result.subtotal).toBe(36000);
      expect(result.total_discount).toBe(5000);
      expect(result.promotional_subtotal).toBe(31000);
    });

    it('un producto sin escala cuenta como siempre', async () => {
      prisma.products.findMany.mockResolvedValue([
        { id: 10, price_unit_quantity: 1 },
      ]);
      prisma.promotions.findMany.mockResolvedValue([
        buildPromotion({
          id: 302,
          scope: 'order',
          rule_type: 'quantity_tiered',
          quantity_grouping: 'per_product',
          promotion_products: [{ product_id: 10 }],
          promotion_quantity_tiers: [
            buildTier({
              id: 1,
              promotion_id: 302,
              min_quantity: 3,
              max_quantity: null,
              value: 10,
              type: 'percentage',
            }),
          ],
        }),
      ]);

      const result = await service.quoteDiscounts({
        items: [{ line_id: 'l1', product_id: 10, unit_price: 100, quantity: 3 }],
        now: REFERENCE_NOW,
      });

      expect(result.applied_promotions).toHaveLength(1);
    });

    // --- El empujón (`tier_progress`) mide con la misma vara que el tramo.
    // Si contara unidades de stock, al cable al que le falta UN metro le
    // diría "agrega 997 más" y el cliente leería un absurdo.

    it('el empujón cuenta lo que falta en unidades de venta, no de stock', async () => {
      cableEnMilimetros(); // tramo desde 3 metros, 10%

      const result = await service.quoteDiscounts({
        // 2.000 mm = 2 metros: falta 1 metro para el tramo de 3.
        items: [
          { line_id: 'l1', product_id: 10, unit_price: 5000, quantity: 2000 },
        ],
        now: REFERENCE_NOW,
      });

      expect(result.applied_promotions).toEqual([]);
      expect(result.tier_progress).toHaveLength(1);
      expect(result.tier_progress[0].promotion_id).toBe(301);
      expect(result.tier_progress[0].remaining_quantity).toBe(1);
      expect(result.tier_progress[0].target_product_id).toBe(10);
    });

    it('no regresión — escala 1: el empujón sigue contando unidades crudas', async () => {
      prisma.products.findMany.mockResolvedValue([
        { id: 10, price_unit_quantity: 1 },
      ]);
      prisma.promotions.findMany.mockResolvedValue([
        buildPromotion({
          id: 303,
          name: 'Lleva 3, 10%',
          scope: 'order',
          rule_type: 'quantity_tiered',
          quantity_grouping: 'per_product',
          promotion_products: [{ product_id: 10 }],
          promotion_quantity_tiers: [
            buildTier({
              id: 1,
              promotion_id: 303,
              min_quantity: 3,
              max_quantity: null,
              value: 10,
              type: 'percentage',
            }),
          ],
        }),
      ]);

      const result = await service.quoteDiscounts({
        items: [
          { line_id: 'l1', product_id: 10, unit_price: 5000, quantity: 2 },
        ],
        now: REFERENCE_NOW,
      });

      expect(result.tier_progress).toHaveLength(1);
      expect(result.tier_progress[0].remaining_quantity).toBe(1);
    });
  });

  // CP-ECOM-PROMO-UX-001 m8: spec for the cart-view helper that the frontend
  // calls to render the "Lleva N, llevas X" badge. The contract is:
  //   - one entry per (promotion, target_product_id) where the promo has
  //     `promotion_products` rows;
  //   - `cart_total` promos (no `promotion_products`) produce NO entries;
  //   - `current_tier_index` is computed against the OVERRIDDEN quantity when
  //     the caller passes `perProductQuantity` (so the cart view can show
  //     "what would happen if I added 5").
  describe('getTierLaddersForQuote', () => {
    // Local helper: this `describe` is a sibling of the other tier tests, so
    // the `buildTier` defined in `quantity_tiered - aggregated by scope` is
    // not in scope. Mirrors its shape.
    function buildTier(overrides: Partial<Record<string, unknown>> = {}) {
      return {
        id: 1,
        promotion_id: 400,
        min_quantity: 2,
        max_quantity: null as number | null,
        value: 10,
        type: 'percentage',
        sort_order: 0,
        ...overrides,
      };
    }

    it('per_product + multiple products: emits one entry per (promo, product_id) with current_tier_index', async () => {
      prisma.promotions.findMany.mockResolvedValue([
        buildPromotion({
          id: 401,
          name: 'Lleva 3: -15%',
          scope: 'product',
          rule_type: 'quantity_tiered',
          type: 'percentage',
          quantity_grouping: 'per_product',
          promotion_products: [{ product_id: 10 }, { product_id: 11 }],
          promotion_quantity_tiers: [
            buildTier({
              id: 1,
              promotion_id: 401,
              min_quantity: 2,
              max_quantity: 2,
              value: 5,
              type: 'percentage',
            }),
            buildTier({
              id: 2,
              promotion_id: 401,
              min_quantity: 3,
              max_quantity: null,
              value: 15,
              type: 'percentage',
            }),
          ],
        }),
      ]);

      const result = await service.getTierLaddersForQuote(
        [401],
        [
          { product_id: 10, quantity: 3 },
          { product_id: 11, quantity: 1 },
        ],
      );

      expect(result).toHaveLength(2);
      const product10 = result.find((r) => r.target_product_id === 10);
      const product11 = result.find((r) => r.target_product_id === 11);
      expect(product10).toBeDefined();
      expect(product11).toBeDefined();
      // Product 10 has qty=3 → top tier (index 1).
      expect(product10!.current_tier_index).toBe(1);
      // Product 11 has qty=1 → below the first threshold (index null).
      expect(product11!.current_tier_index).toBeNull();
      // Both entries share the same tier ladder.
      expect(product10!.tiers).toHaveLength(2);
      expect(product11!.tiers).toHaveLength(2);
      expect(product10!.promotion_id).toBe(401);
    });

    it('cart_total promos (no promotion_products) produce no entries', async () => {
      prisma.promotions.findMany.mockResolvedValue([
        buildPromotion({
          id: 402,
          name: 'Cart total -10%',
          scope: 'order',
          rule_type: 'quantity_tiered',
          type: 'percentage',
          quantity_grouping: 'cart_total',
          promotion_products: [],
          promotion_quantity_tiers: [
            buildTier({
              id: 1,
              promotion_id: 402,
              min_quantity: 3,
              max_quantity: null,
              value: 10,
              type: 'percentage',
            }),
          ],
        }),
      ]);

      const result = await service.getTierLaddersForQuote(
        [402],
        [
          { product_id: 10, quantity: 5 },
          { product_id: 11, quantity: 5 },
        ],
      );

      // cart_total promos have no `target_product_id` to surface a ladder
      // against — the badge helper returns nothing for them.
      expect(result).toEqual([]);
    });

    it('perProductQuantity override: current_tier_index uses the custom quantity, not the cart qty', async () => {
      prisma.promotions.findMany.mockResolvedValue([
        buildPromotion({
          id: 403,
          name: 'Lleva 5: -15%',
          scope: 'product',
          rule_type: 'quantity_tiered',
          type: 'percentage',
          quantity_grouping: 'per_product',
          promotion_products: [{ product_id: 10 }],
          promotion_quantity_tiers: [
            buildTier({
              id: 1,
              promotion_id: 403,
              min_quantity: 2,
              max_quantity: 2,
              value: 5,
              type: 'percentage',
            }),
            buildTier({
              id: 2,
              promotion_id: 403,
              min_quantity: 5,
              max_quantity: null,
              value: 15,
              type: 'percentage',
            }),
          ],
        }),
      ]);

      // Cart has only 1 unit of product 10, but the caller wants to preview
      // "what if I add 5". The override must drive `current_tier_index`.
      const override = new Map<number, number>([[10, 5]]);

      const result = await service.getTierLaddersForQuote(
        [403],
        [{ product_id: 10, quantity: 1 }],
        override,
      );

      expect(result).toHaveLength(1);
      // With qty=5 → top tier (index 1).
      expect(result[0].current_tier_index).toBe(1);
      expect(result[0].target_product_id).toBe(10);
      expect(result[0].promotion_id).toBe(403);
    });
  });

  describe('strategy: stacking_groups and multi-tier rules', () => {
    it('applies multiple promotions concurrently on disjoint products in stacking_groups mode', async () => {
      prisma.promotions.findMany.mockResolvedValue([
        buildPromotion({
          id: 501,
          name: '10% en Camisas',
          scope: 'product',
          type: 'percentage',
          value: 10,
          priority: 1,
          promotion_products: [{ product_id: 1 }],
        }),
        buildPromotion({
          id: 502,
          name: '20% en Pantalones',
          scope: 'product',
          type: 'percentage',
          value: 20,
          priority: 2,
          promotion_products: [{ product_id: 2 }],
        }),
      ]);

      const result = await service.quoteDiscounts({
        items: [
          { line_id: 'l1', product_id: 1, unit_price: 100, quantity: 1 },
          { line_id: 'l2', product_id: 2, unit_price: 200, quantity: 1 },
        ],
        strategy: 'stacking_groups',
        now: REFERENCE_NOW,
      });

      expect(result.strategy_applied).toBe('stacking_groups');
      expect(result.applied_promotions).toHaveLength(2);
      expect(result.total_discount).toBe(50); // $10 (10% of 100) + $40 (20% of 200)
      expect(result.promotional_subtotal).toBe(250);
      expect(result.items[0].promotion_discount).toBe(10);
      expect(result.items[1].promotion_discount).toBe(40);
    });

    it('resolves collision on the same line by giving priority to higher priority promo in stacking_groups', async () => {
      prisma.promotions.findMany.mockResolvedValue([
        buildPromotion({
          id: 501,
          name: '10% en Categoria',
          scope: 'category',
          type: 'percentage',
          value: 10,
          priority: 1,
          promotion_categories: [{ category_id: 10 }],
        }),
        buildPromotion({
          id: 502,
          name: '20% en Producto',
          scope: 'product',
          type: 'percentage',
          value: 20,
          priority: 2,
          promotion_products: [{ product_id: 1 }],
        }),
      ]);

      const result = await service.quoteDiscounts({
        items: [
          {
            line_id: 'l1',
            product_id: 1,
            category_id: 10,
            unit_price: 100,
            quantity: 1,
          },
        ],
        strategy: 'stacking_groups',
        now: REFERENCE_NOW,
      });

      // Priority 1 wins for line l1
      expect(result.applied_promotions).toHaveLength(1);
      expect(result.applied_promotions[0].promotion_id).toBe(501);
      expect(result.total_discount).toBe(10);
      expect(result.items[0].final_unit_price).toBe(90);
    });

    it('stacks order-level promotion on residual subtotal after item promotions', async () => {
      prisma.promotions.findMany.mockResolvedValue([
        buildPromotion({
          id: 501,
          name: '20% en Producto 1',
          scope: 'product',
          type: 'percentage',
          value: 20,
          priority: 1,
          promotion_products: [{ product_id: 1 }],
        }),
        buildPromotion({
          id: 502,
          name: '10% en Todo el Carrito',
          scope: 'order',
          type: 'percentage',
          value: 10,
          priority: 2,
        }),
      ]);

      const result = await service.quoteDiscounts({
        items: [
          { line_id: 'l1', product_id: 1, unit_price: 100, quantity: 1 },
          { line_id: 'l2', product_id: 2, unit_price: 100, quantity: 1 },
        ],
        strategy: 'stacking_groups',
        now: REFERENCE_NOW,
      });

      // Subtotal = 200
      // Item promo = 20% on line 1 = $20
      // Residual subtotal = 180
      // Order promo = 10% on residual 180 = $18
      // Total discount = $38
      expect(result.applied_promotions).toHaveLength(2);
      expect(result.total_discount).toBe(38);
      expect(result.promotional_subtotal).toBe(162);
    });

    it('enforces max_combined_discount_percentage cap when configured in store settings', async () => {
      (prisma as any).store_settings = {
        findFirst: jest.fn().mockResolvedValue({
          settings: {
            promotions: {
              evaluation_strategy: 'stacking_groups',
              max_combined_discount_percentage: 30, // Cap at 30% max
            },
          },
        }),
      };

      prisma.promotions.findMany.mockResolvedValue([
        buildPromotion({
          id: 501,
          name: '50% en Producto 1',
          scope: 'product',
          type: 'percentage',
          value: 50,
          priority: 1,
          promotion_products: [{ product_id: 1 }],
        }),
      ]);

      const result = await service.quoteDiscounts({
        items: [{ line_id: 'l1', product_id: 1, unit_price: 100, quantity: 1 }],
        now: REFERENCE_NOW,
      });

      // 50% requested, but store max_combined_discount_percentage is 30%
      expect(result.total_discount).toBe(30);
      expect(result.promotional_subtotal).toBe(70);
    });

    it('excludes lines with applied_price_tier_id when exclude_tier_priced_lines is true', async () => {
      (prisma as any).store_settings = {
        findFirst: jest.fn().mockResolvedValue({
          settings: {
            promotions: {
              evaluation_strategy: 'stacking_groups',
              exclude_tier_priced_lines: true,
            },
          },
        }),
      };

      prisma.promotions.findMany.mockResolvedValue([
        buildPromotion({
          id: 501,
          name: '15% en Producto 1',
          scope: 'product',
          type: 'percentage',
          value: 15,
          priority: 1,
          promotion_products: [{ product_id: 1 }],
        }),
      ]);

      const result = await service.quoteDiscounts({
        items: [
          {
            line_id: 'l1',
            product_id: 1,
            unit_price: 100,
            quantity: 1,
            applied_price_tier_id: 99, // Customer tier applied
          },
        ],
        now: REFERENCE_NOW,
      });

      // Line is excluded because it has a price tier applied
      expect(result.applied_promotions).toHaveLength(0);
      expect(result.total_discount).toBe(0);
      expect(result.promotional_subtotal).toBe(100);
    });

    it('triggers quantity tier when presentation item consumes enough base stock units', async () => {
      prisma.promotions.findMany.mockResolvedValue([
        buildPromotion({
          id: 110,
          rule_type: 'quantity_tiered',
          scope: 'product',
          promotion_products: [{ id: 1, promotion_id: 110, product_id: 1 }],
          promotion_quantity_tiers: [
            buildTier({ min_quantity: 10, max_quantity: 199, value: 10, discount_type: 'percentage' }),
            buildTier({ min_quantity: 200, max_quantity: 999, value: 20, discount_type: 'percentage' }),
            buildTier({ min_quantity: 1000, max_quantity: null, value: 30, discount_type: 'percentage' }),
          ],
        }),
      ]);

      // Customer buys 1 box of nails (200 units in the box, stock_units_consumed = 200)
      const result1Box = await service.quoteDiscounts({
        items: [
          {
            line_id: 'box1',
            product_id: 1,
            unit_price: 200000, // Box price
            quantity: 1,
            applied_price_tier_id: 5,
            stock_units_consumed: 200, // 200 nails
          },
        ],
        now: REFERENCE_NOW,
      });

      // Unlocks the >= 200 tier (20% discount on the box)
      expect(result1Box.applied_promotions).toHaveLength(1);
      expect(result1Box.applied_promotions[0].value).toBe(20);
      expect(result1Box.total_discount).toBe(40000); // 20% of 200,000 = 40,000
      expect(result1Box.promotional_subtotal).toBe(160000);

      // Customer buys 5 boxes of nails (5 * 200 = 1000 base units, stock_units_consumed = 1000)
      const result5Boxes = await service.quoteDiscounts({
        items: [
          {
            line_id: 'box5',
            product_id: 1,
            unit_price: 200000,
            quantity: 5,
            applied_price_tier_id: 5,
            stock_units_consumed: 1000, // 1000 nails
          },
        ],
        now: REFERENCE_NOW,
      });

      // Unlocks the >= 1000 tier (30% discount on the 5 boxes)
      expect(result5Boxes.applied_promotions).toHaveLength(1);
      expect(result5Boxes.applied_promotions[0].value).toBe(30);
      expect(result5Boxes.total_discount).toBe(300000); // 30% of 1,000,000 = 300,000
      expect(result5Boxes.promotional_subtotal).toBe(700000);
    });
  });
});

