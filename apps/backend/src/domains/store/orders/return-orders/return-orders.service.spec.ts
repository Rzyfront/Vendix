import { return_order_status_enum } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { ReturnOrdersService } from './return-orders.service';

/**
 * QUI-893 B1 — a customer return (money and goods back to a customer) only
 * exists as "Reembolsar" from the order detail (`RefundFlowService`). The
 * `return-orders` path keeps supplier returns (stock only) and never books a
 * refund that did not move money.
 */
describe('ReturnOrdersService — customer returns go through the order refund', () => {
  const build = (opts: {
    type?: 'sales_return' | 'purchase_return';
    relatedOrderType?: string | null;
    partnerType?: string | null;
    returnItems?: Array<{ id: number; product_id: number; quantity: number }>;
  } = {}) => {
    const draft = {
      id: 99,
      organization_id: 3,
      type: opts.type ?? 'purchase_return',
      status: return_order_status_enum.draft,
      related_order_id: 500,
      related_order_type:
        opts.relatedOrderType === undefined ? 'purchase_order' : opts.relatedOrderType,
      partner_type: opts.partnerType === undefined ? 'supplier' : opts.partnerType,
      reason_id: null,
      return_order_items: (opts.returnItems ?? [{ id: 10, product_id: 7, quantity: 2 }]).map(
        (item) => ({ product_variant_id: null, condition: 'good', ...item }),
      ),
    };
    const tx = {
      return_orders: {
        findUnique: jest.fn().mockResolvedValue(draft),
        update: jest.fn().mockResolvedValue({ ...draft, status: 'processed' }),
        create: jest.fn().mockResolvedValue({ id: 1 }),
      },
      order_items: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const prisma = {
      $transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
      return_orders: {
        findUnique: jest.fn().mockResolvedValue(draft),
        update: jest.fn().mockResolvedValue(draft),
      },
      orders: { findUnique: jest.fn() },
      order_items: { findMany: jest.fn() },
    };
    const stockLevelManager = {
      updateStock: jest.fn().mockResolvedValue(undefined),
      getDefaultLocationForProduct: jest.fn().mockResolvedValue(1),
    };
    const service = new ReturnOrdersService(
      prisma as never,
      stockLevelManager as never,
    );
    const moved = () =>
      stockLevelManager.updateStock.mock.calls.map(([args]) => args.quantity_change);
    return { service, prisma, tx, stockLevelManager, moved };
  };

  const expectUseRefund = async (promise: Promise<unknown>) => {
    await expect(promise).rejects.toMatchObject({
      errorCode: 'RETURN_ORDER_SALES_USE_REFUND_001',
    });
    await promise.catch((error) => expect(error.getStatus()).toBe(409));
  };

  beforeEach(() => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ organization_id: 3, store_id: 1, user_id: 5 } as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it('rejects creating a sales_return and writes nothing', async () => {
    const { service, tx } = build();
    await expectUseRefund(
      service.create({
        type: 'sales_return',
        related_order_id: 500,
        items: [{ product_id: 7, quantity: 1 }],
      }),
    );
    expect(tx.return_orders.create).not.toHaveBeenCalled();
  });

  it('rejects creating a supplier-typed return that points at a customer sale', async () => {
    const { service, tx } = build();
    await expectUseRefund(
      service.create({
        type: 'purchase_return',
        related_order_id: 500,
        related_order_type: 'sales_order',
        items: [{ product_id: 7, quantity: 1 }],
      }),
    );
    await expectUseRefund(
      service.create({
        type: 'purchase_return',
        partner_type: 'customer',
        items: [{ product_id: 7, quantity: 1 }],
      }),
    );
    expect(tx.return_orders.create).not.toHaveBeenCalled();
  });

  it('rejects processing a legacy sales_return draft: no stock, no accounting', async () => {
    const { service, tx, moved } = build({
      type: 'sales_return',
      relatedOrderType: 'sales_order',
      partnerType: 'customer',
    });
    await expectUseRefund(service.process(99, [{ id: 10, action: 'restock' }]));
    expect(moved()).toEqual([]);
    expect(tx.return_orders.update).not.toHaveBeenCalled();
  });

  it('rejects turning a draft into a customer return through update', async () => {
    const { service, prisma } = build();
    await expectUseRefund(service.update(99, { type: 'sales_return' }));
    await expectUseRefund(service.update(99, { related_order_type: 'sales_order' }));
    expect(prisma.return_orders.update).not.toHaveBeenCalled();
  });

  it('still lets a legacy sales_return draft be cancelled (cleanup)', async () => {
    const { service, prisma } = build({ type: 'sales_return', relatedOrderType: 'sales_order' });
    await service.cancel(99);
    expect(prisma.return_orders.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: return_order_status_enum.cancelled }),
      }),
    );
  });

  it('a supplier return still moves its logical quantity and books no customer refund', async () => {
    const { service, tx, prisma, moved, stockLevelManager } = build({
      returnItems: [{ id: 10, product_id: 7, quantity: 2 }],
    });
    await service.process(99, [{ id: 10, action: 'restock' }]);
    expect(moved()).toEqual([2]);
    // Explicit budget for the processing transaction (the 5 s default expired).
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function), { timeout: 20_000, maxWait: 5_000 },
    );
    // Without an explicit warehouse the default one is resolved on the
    // return's tx connection, never on a second pool connection.
    expect(stockLevelManager.getDefaultLocationForProduct).toHaveBeenCalledWith(7, undefined, tx);
    expect(stockLevelManager.updateStock).toHaveBeenCalledWith(
      expect.objectContaining({ location_id: 1 }),
      tx,
    );
    expect(tx.order_items.findMany).not.toHaveBeenCalled();
    expect(tx.return_orders.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: return_order_status_enum.processed }),
      }),
    );
    // The old path priced the return from the sale and booked `refund.completed`
    // with no money leaving; nothing reads the order to price it any more.
    expect(prisma.orders.findUnique).not.toHaveBeenCalled();
    expect(prisma.order_items.findMany).not.toHaveBeenCalled();
  });
});
