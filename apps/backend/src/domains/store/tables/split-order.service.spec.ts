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

    // Plan KDS fire-flows: SplitOrderService now takes a KitchenFireService
// for the auto-fire path inside runSplit. The existing tests in this
// file do not exercise the auto-fire path; we pass a minimal stub so
// the constructor compiles without dragging in the full module.
service = new SplitOrderService(prismaMock as any, {
  prepareFireContext: jest.fn(),
  fireOrderItemsInTx: jest.fn(),
  emitKitchenFiredAfterCommit: jest.fn(),
} as any);
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

    // F-222 — la tolerancia declarada arriba ("1 cent tolerance") es la que
    // manda: el umbral no se movió, sólo dejó de medirse con `Math.abs` sobre
    // floats. El par 2425.00 / 2424.99 es UN centavo real y el `> 0.01` viejo
    // lo RECHAZABA (0.01000000000021 > 0.01) mientras que 13603.13 / 13603.12
    // —el mismo centavo— lo aceptaba: la cuenta se partía o no según cuánto
    // costaba la mesa.
    it('F-222: 1¢ real (2425.00 vs total 2424.99) se TOLERA — el float lo rechazaba', async () => {
      expect(Math.abs(2425.0 - 2424.99) > 0.01).toBe(true); // el defecto viejo
      prismaMock.orders.findFirst.mockResolvedValueOnce(
        buildSourceOrder({ grand_total: new Prisma.Decimal(2424.99) }),
      );
      prismaMock.orders.create
        .mockResolvedValueOnce({ id: 10001 })
        .mockResolvedValueOnce({ id: 10002 });
      prismaMock.order_items.create.mockResolvedValue({});
      prismaMock.orders.update.mockResolvedValue({});

      const result = await service.splitByAmount(9001, {
        mode: 'custom',
        n_splits: 2,
        amounts: [1212.5, 1212.5], // suma 2425.00 — 1 centavo sobre el total
      } as any);

      expect(result.sub_orders).toHaveLength(2);
    });

    it('F-222: 2¢ reales (13603.14 vs total 13603.12) SÍ rechaza — el float los dejaba pasar', async () => {
      // El `> 0.02` no aplica acá, pero el par sirve igual: el float de la
      // resta (0.0199999999986) muestra por qué la comparación no puede vivir
      // en dobles. `n_splits` válido a propósito: con `1` el servicio lanza
      // antes por "partes >= 2" y el test pasaría sin tocar la suma.
      expect(Math.abs(13603.14 - 13603.12) > 0.01).toBe(true);
      prismaMock.orders.findFirst.mockResolvedValueOnce(
        buildSourceOrder({ grand_total: new Prisma.Decimal(13603.12) }),
      );
      await expect(
        service.splitByAmount(9001, {
          mode: 'custom',
          n_splits: 2,
          amounts: [6801.57, 6801.57], // suma 13603.14 — 2 centavos sobre
        } as any),
      ).rejects.toMatchObject({ errorCode: 'SPLIT_ORDER_ITEMS_MISSING' });
    });
  });
});
