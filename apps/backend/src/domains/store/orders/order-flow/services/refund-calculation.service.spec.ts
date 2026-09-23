import { Prisma } from '@prisma/client';
import { StorePrismaService } from 'src/prisma/services/store-prisma.service';
import { buildOrder, buildOrderItem } from 'src/testing/money-fixtures';
import {
  RefundCalculationService,
  RefundItemRequest,
} from './refund-calculation.service';

describe('RefundCalculationService — per-line quantity integrity', () => {
  const prisma = { orders: { findFirst: jest.fn() } };
  const service = new RefundCalculationService(
    prisma as unknown as StorePrismaService,
  );

  function sourceOrder() {
    return buildOrder({
      state: 'finished',
      subtotal_amount: new Prisma.Decimal(1010),
      grand_total: new Prisma.Decimal(1010),
      tax_amount: new Prisma.Decimal(0),
      total_paid: new Prisma.Decimal(1010),
      remaining_balance: new Prisma.Decimal(0),
      refunds: [],
      order_items: [
        buildOrderItem({
          id: 1,
          product_name: 'A',
          quantity: 1,
          unit_price: new Prisma.Decimal(10),
          total_price: new Prisma.Decimal(10),
          tax_rate: new Prisma.Decimal(0),
          tax_amount_item: new Prisma.Decimal(0),
        }),
        buildOrderItem({
          id: 2,
          product_name: 'B',
          quantity: 1,
          unit_price: new Prisma.Decimal(1000),
          total_price: new Prisma.Decimal(1000),
          tax_rate: new Prisma.Decimal(0),
          tax_amount_item: new Prisma.Decimal(0),
        }),
      ],
    });
  }

  function item(id: number, quantity = 1): RefundItemRequest {
    return { order_item_id: id, quantity, inventory_action: 'no_return' };
  }

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.orders.findFirst.mockResolvedValue(sourceOrder());
  });

  it('calculates a partial refund without marking the other product refunded', async () => {
    const result = await service.calculate({
      order_id: 9001,
      items: [item(1)],
      include_shipping: false,
    });
    expect(result).toMatchObject({
      total_refund: 10,
      subtotal_refund: 10,
      tax_refund: 0,
      is_full_refund: false,
      max_refundable: 1010,
      already_refunded: 0,
    });
  });

  it('recognizes full coverage of both lines regardless of request order', async () => {
    const result = await service.calculate({
      order_id: 9001,
      items: [item(2), item(1)],
      include_shipping: false,
    });
    expect(result.total_refund).toBe(1010);
    expect(result.is_full_refund).toBe(true);
  });

  it('combines completed refunds and the current request on the same line identities', async () => {
    prisma.orders.findFirst.mockResolvedValue({
      ...sourceOrder(),
      refunds: [{ amount: new Prisma.Decimal(10), refund_items: [item(1)] }],
    });
    const result = await service.calculate({
      order_id: 9001,
      items: [item(2)],
      include_shipping: false,
    });
    expect(result).toMatchObject({
      total_refund: 1000,
      already_refunded: 10,
      max_refundable: 1000,
      is_full_refund: true,
    });
    expect(prisma.orders.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          refunds: {
            where: { state: 'completed' },
            include: { refund_items: true },
          },
        }),
      }),
    );
  });

  it.each([
    ['identical rows', item(1)],
    [
      'different return action and location',
      {
        ...item(1),
        inventory_action: 'restock' as const,
        location_id: 99,
      },
    ],
  ])(
    'rejects duplicate order_item_id with %s even though the amount fits',
    async (_label, duplicate) => {
      await expect(
        service.calculate({
          order_id: 9001,
          items: [item(1), duplicate],
          include_shipping: false,
        }),
      ).rejects.toMatchObject({ errorCode: 'REF_VALIDATE_001', status: 400 });
    },
  );

  it('does not let excess historical units of A cover a missing unit of B', async () => {
    const order = sourceOrder();
    prisma.orders.findFirst.mockResolvedValue({
      ...order,
      subtotal_amount: new Prisma.Decimal(2010),
      grand_total: new Prisma.Decimal(2010),
      total_paid: new Prisma.Decimal(2010),
      order_items: [
        order.order_items[0],
        {
          ...order.order_items[1],
          quantity: 2,
          total_price: new Prisma.Decimal(2000),
        },
      ],
      // Historical rows may contain precisely the duplicate accepted before this fix.
      refunds: [
        { amount: new Prisma.Decimal(20), refund_items: [item(1), item(1)] },
      ],
    });
    const result = await service.calculate({
      order_id: 9001,
      items: [item(2)],
      include_shipping: false,
    });
    expect(result.total_refund).toBe(1000);
    expect(result.is_full_refund).toBe(false);
  });

  it('does not count refund history belonging to another line as full coverage', async () => {
    prisma.orders.findFirst.mockResolvedValue({
      ...sourceOrder(),
      refunds: [{ amount: new Prisma.Decimal(10), refund_items: [item(999)] }],
    });
    const result = await service.calculate({
      order_id: 9001,
      items: [item(1)],
      include_shipping: false,
    });
    expect(result.is_full_refund).toBe(false);
  });

  it('rejects quantities beyond the remaining quantity of that line', async () => {
    prisma.orders.findFirst.mockResolvedValue({
      ...sourceOrder(),
      refunds: [{ amount: new Prisma.Decimal(10), refund_items: [item(1)] }],
    });
    await expect(
      service.calculate({
        order_id: 9001,
        items: [item(1)],
        include_shipping: false,
      }),
    ).rejects.toThrow('Max refundable: 0');
  });

  it('rejects a line belonging to another order', async () => {
    await expect(
      service.calculate({
        order_id: 9001,
        items: [item(999)],
        include_shipping: false,
      }),
    ).rejects.toThrow('does not belong to order #9001');
  });

  it('preserves the current empty-items contract rather than adding an unrelated restriction', async () => {
    const result = await service.calculate({
      order_id: 9001,
      items: [],
      include_shipping: false,
    });
    expect(result).toMatchObject({
      items: [],
      total_refund: 0,
      is_full_refund: false,
    });
  });
});

describe('RefundCalculationService — cash cancellation ceiling', () => {
  const prisma = { orders: { findFirst: jest.fn() } };
  const service = new RefundCalculationService(prisma as unknown as StorePrismaService);
  const tx = prisma as any;
  const totals = {
    grand_total: new Prisma.Decimal('59.50'),
    tax_amount: new Prisma.Decimal('9.50'),
    shipping_cost: new Prisma.Decimal(0),
    shipping_tax_amount: new Prisma.Decimal(0),
    shipping_tax_type: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.orders.findFirst.mockResolvedValue(buildOrder({ ...totals, refunds: [] }));
  });

  it('allocates paid cash without exceeding grand_total', async () => {
    const result = await service.calculateCancellationCashRefund(
      9001, new Prisma.Decimal('59.50'), tx, totals,
    );
    expect(result.amount.equals('59.50')).toBe(true);
    expect(result.subtotal.equals('50.00')).toBe(true);
    expect(result.tax.equals('9.50')).toBe(true);
  });

  it('rejects a second payout when prior completed refunds consume the ceiling', async () => {
    prisma.orders.findFirst.mockResolvedValue(buildOrder({
      ...totals, refunds: [{ amount: new Prisma.Decimal('20.00'), refund_items: [], shipping_refund: 0 }],
    }));
    await expect(service.calculateCancellationCashRefund(
      9001, new Prisma.Decimal('59.50'), tx, totals,
    )).rejects.toThrow(/exceeds the remaining refundable/);
  });
});
