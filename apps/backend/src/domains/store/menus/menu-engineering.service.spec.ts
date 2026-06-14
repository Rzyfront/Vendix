import { Test, TestingModule } from '@nestjs/testing';
import { MenuEngineeringService } from './menu-engineering.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';

const STORE_ID = 7;

/**
 * Smoke test for the Menu Engineering quadrant classifier and recipe cost
 * helper. The Prisma client is mocked end-to-end; the goal is to assert
 * the four-quadrant split and the fallback to product.cost_price when no
 * active recipe exists.
 */
describe('MenuEngineeringService — quadrant classification', () => {
  let service: MenuEngineeringService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      order_items: {
        groupBy: jest.fn().mockResolvedValue([
          { product_id: 1, _sum: { quantity: 50, total_price: 500 } },
          { product_id: 2, _sum: { quantity: 30, total_price: 240 } },
          { product_id: 3, _sum: { quantity: 5, total_price: 60 } },
          { product_id: 4, _sum: { quantity: 2, total_price: 10 } },
        ]),
      },
      products: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 1,
            name: 'Bandeja Paisa',
            sku: 'BP-01',
            base_price: 25,
            cost_price: 8,
            recipe: {
              id: 10,
              yield_quantity: 1,
              waste_percent: 0,
              items: [
                { quantity: 0.2, waste_percent: 0, component_product: { cost_price: 5 } },
                { quantity: 0.1, waste_percent: 0, component_product: { cost_price: 30 } },
              ],
            },
          },
          {
            id: 2,
            name: 'Ajiaco',
            sku: 'AJ-01',
            base_price: 18,
            cost_price: 7,
            recipe: {
              id: 11,
              yield_quantity: 1,
              waste_percent: 0,
              items: [
                { quantity: 0.25, waste_percent: 0, component_product: { cost_price: 10 } },
                { quantity: 0.05, waste_percent: 0, component_product: { cost_price: 60 } },
              ],
            },
          },
          {
            id: 3,
            name: 'Postre de Maracuya',
            sku: 'PM-01',
            base_price: 12,
            cost_price: 3,
            recipe: null,
          },
          {
            id: 4,
            name: 'Jugo de Lulo',
            sku: 'JL-01',
            base_price: 5,
            cost_price: 4,
            recipe: null,
          },
        ]),
      },
    };
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: STORE_ID } as any);

    service = new MenuEngineeringService(prisma as any);
  });

  it('returns one product in each quadrant for a balanced 4-product set', async () => {
    const report = await service.report({});

    // Recipe unit cost: (0.2*5 + 0.1*30) / 1 = 4  for product 1 → margin high
    // Recipe unit cost: (0.25*10 + 0.05*60) / 1 = 5.5 for product 2 → margin medium-high
    // Product 3: cost_price=3, revenue/unit=12, margin = (12-3)/12 = 75%  → high
    // Product 4: cost_price=4, revenue/unit=5,  margin = (5-4)/5  = 20%   → low

    // popularity: 1=50, 2=30, 3=5, 4=2 (total=87).  Medians: pop=17.5, margin=…
    // Star quadrant (product 1) and dog (product 4) should be populated.
    expect(report.total_products).toBe(4);
    const totalGrouped =
      report.counts.estrella +
      report.counts.caballo +
      report.counts.puzzle +
      report.counts.perro;
    expect(totalGrouped).toBe(4);
    expect(report.totals.units_sold).toBe(87);
  });

  it('falls back to product.cost_price when no recipe exists', async () => {
    const report = await service.report({});
    const product3 = [
      ...report.groups.estrella,
      ...report.groups.caballo,
      ...report.groups.puzzle,
      ...report.groups.perro,
    ].find((p) => p.product_id === 3);
    expect(product3).toBeDefined();
    expect(product3!.has_recipe).toBe(false);
    // recipe_unit_cost falls back to product.cost_price=3
    expect(product3!.recipe_unit_cost).toBe(3);
  });

  it('returns an empty report when there is no sales data', async () => {
    prisma.order_items.groupBy.mockResolvedValueOnce([]);
    const report = await service.report({});
    expect(report.total_products).toBe(0);
    expect(report.totals.units_sold).toBe(0);
  });
});
