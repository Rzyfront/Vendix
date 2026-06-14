import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { SplitOrderService } from './split-order.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from 'src/common/errors';

describe('SplitOrderService — splitByItems + splitByAmount (Fase E smoke)', () => {
  let service: SplitOrderService;
  let prismaMock: any;
  let context: any;

  const STORE_ID = 100;

  // 4-item order, $200 total (50+50+50+50). Used by both test groups.
  const buildSourceOrder = (overrides: any = {}) => ({
    id: 9001,
    store_id: STORE_ID,
    customer_id: 42,
    currency: 'COP',
    channel: 'pos',
    delivery_type: 'direct_delivery',
    order_number: 'T-1',
    state: 'draft',
    grand_total: new Prisma.Decimal(200),
    subtotal_amount: new Prisma.Decimal(200),
    tax_amount: new Prisma.Decimal(0),
    discount_amount: new Prisma.Decimal(0),
    order_items: [
      {
        id: 1,
        product_id: 100,
        product_variant_id: null,
        product_name: 'Plato A',
        description: null,
        variant_sku: null,
        variant_attributes: null,
        variant_image_url: null,
        quantity: 1,
        unit_price: new Prisma.Decimal(50),
        total_price: new Prisma.Decimal(50),
        tax_rate: null,
        tax_amount_item: null,
        cost_price: null,
        catalog_unit_price: null,
        catalog_final_price: null,
        final_unit_price: null,
        is_price_overridden: false,
        price_override_reason: null,
        price_overridden_by_user_id: null,
        weight: null,
        weight_unit: null,
        item_type: 'prepared',
        applied_price_tier_id: null,
        applied_price_tier_name_snapshot: null,
        stock_units_consumed: null,
        inventory_consumed_at_fire: true,
      },
      {
        id: 2,
        product_id: 101,
        product_name: 'Plato B',
        quantity: 1,
        unit_price: new Prisma.Decimal(50),
        total_price: new Prisma.Decimal(50),
        tax_amount_item: null,
        item_type: 'prepared',
        inventory_consumed_at_fire: true,
        applied_price_tier_id: null,
        applied_price_tier_name_snapshot: null,
        stock_units_consumed: null,
        cost_price: null,
        catalog_unit_price: null,
        catalog_final_price: null,
        final_unit_price: null,
        is_price_overridden: false,
        price_override_reason: null,
        price_overridden_by_user_id: null,
        weight: null,
        weight_unit: null,
        variant_sku: null,
        variant_attributes: null,
        variant_image_url: null,
        product_variant_id: null,
        description: null,
        tax_rate: null,
      },
      {
        id: 3,
        product_id: 102,
        product_name: 'Plato C',
        quantity: 1,
        unit_price: new Prisma.Decimal(50),
        total_price: new Prisma.Decimal(50),
        tax_amount_item: null,
        item_type: 'prepared',
        inventory_consumed_at_fire: true,
        applied_price_tier_id: null,
        applied_price_tier_name_snapshot: null,
        stock_units_consumed: null,
        cost_price: null,
        catalog_unit_price: null,
        catalog_final_price: null,
        final_unit_price: null,
        is_price_overridden: false,
        price_override_reason: null,
        price_overridden_by_user_id: null,
        weight: null,
        weight_unit: null,
        variant_sku: null,
        variant_attributes: null,
        variant_image_url: null,
        product_variant_id: null,
        description: null,
        tax_rate: null,
      },
      {
        id: 4,
        product_id: 103,
        product_name: 'Plato D',
        quantity: 1,
        unit_price: new Prisma.Decimal(50),
        total_price: new Prisma.Decimal(50),
        tax_amount_item: null,
        item_type: 'prepared',
        inventory_consumed_at_fire: true,
        applied_price_tier_id: null,
        applied_price_tier_name_snapshot: null,
        stock_units_consumed: null,
        cost_price: null,
        catalog_unit_price: null,
        catalog_final_price: null,
        final_unit_price: null,
        is_price_overridden: false,
        price_override_reason: null,
        price_overridden_by_user_id: null,
        weight: null,
        weight_unit: null,
        variant_sku: null,
        variant_attributes: null,
        variant_image_url: null,
        product_variant_id: null,
        description: null,
        tax_rate: null,
      },
    ],
    ...overrides,
  });

  beforeEach(() => {
    context = {
      store_id: STORE_ID,
      organization_id: 1,
      user_id: 1,
      is_super_admin: false,
    };

    prismaMock = {
      orders: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      order_items: {
        create: jest.fn(),
      },
      $transaction: jest.fn(async (cb: any) => cb(prismaMock)),
    };

    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue(context);

    service = new SplitOrderService(prismaMock as any);
  });

  afterEach(() => jest.clearAllMocks());

  describe('splitByItems', () => {
    it('rejects overlap / partial coverage with VendixHttpException', async () => {
      prismaMock.orders.findFirst.mockResolvedValueOnce(buildSourceOrder());
      await expect(
        service.splitByItems(9001, {
          item_groups: [
            { order_item_ids: [1, 2] },
            { order_item_ids: [2, 3] }, // overlap
          ],
        } as any),
      ).rejects.toBeInstanceOf(VendixHttpException);
    });

    it('creates 2 sub-orders, each with its share of items + propagates the fire flag', async () => {
      prismaMock.orders.findFirst.mockResolvedValueOnce(buildSourceOrder());
      prismaMock.orders.create
        .mockResolvedValueOnce({ id: 10001 })
        .mockResolvedValueOnce({ id: 10002 });
      prismaMock.order_items.create.mockResolvedValue({});
      prismaMock.orders.update.mockResolvedValue({});

      const result = await service.splitByItems(9001, {
        item_groups: [
          { order_item_ids: [1, 2] },
          { order_item_ids: [3, 4] },
        ],
      } as any);

      expect(result.sub_orders).toHaveLength(2);
      // Each sub-order receives 2 order_items.
      expect(prismaMock.order_items.create).toHaveBeenCalledTimes(4);
      // The fire flag is propagated to every sub-order_item (CRITICAL).
      const allCalls = prismaMock.order_items.create.mock.calls;
      for (const call of allCalls) {
        expect(call[0].data.inventory_consumed_at_fire).toBe(true);
      }
      // Source order is marked cancelled (superseded by sub-orders).
      expect(prismaMock.orders.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 9001 },
          data: expect.objectContaining({ state: 'cancelled' }),
        }),
      );
    });
  });

  describe('splitByAmount — equal mode', () => {
    it('splits the grand_total into N equal parts; sums match exactly', async () => {
      prismaMock.orders.findFirst.mockResolvedValueOnce(buildSourceOrder());
      prismaMock.orders.create
        .mockResolvedValueOnce({ id: 10001 })
        .mockResolvedValueOnce({ id: 10002 });
      prismaMock.order_items.create.mockResolvedValue({});
      prismaMock.orders.update.mockResolvedValue({});

      const result = await service.splitByAmount(9001, {
        mode: 'equal',
        n_splits: 2,
      } as any);

      expect(result.sub_orders).toHaveLength(2);
      // 200/2 = 100 each.
      expect(Number(result.sub_orders[0].grand_total)).toBe(100);
      expect(Number(result.sub_orders[1].grand_total)).toBe(100);
    });

    it('validates custom amounts sum == grand_total', async () => {
      prismaMock.orders.findFirst.mockResolvedValueOnce(buildSourceOrder());
      await expect(
        service.splitByAmount(9001, {
          mode: 'custom',
          n_splits: 2,
          amounts: [100, 50], // sums to 150, not 200
        } as any),
      ).rejects.toBeInstanceOf(VendixHttpException);
    });
  });
});
