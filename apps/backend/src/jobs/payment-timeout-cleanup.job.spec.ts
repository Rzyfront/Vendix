import { PaymentTimeoutCleanupJob } from './payment-timeout-cleanup.job';

describe('PaymentTimeoutCleanupJob', () => {
  function buildJob() {
    const tx = {
      stock_reservations: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
      stock_levels: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
      orders: {
        update: jest.fn().mockResolvedValue({}),
      },
      payments: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    const prisma = {
      $transaction: jest.fn((callback: any) => callback(tx)),
      orders: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      stock_reservations: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    } as any;

    const eventEmitter = { emit: jest.fn() } as any;

    // Plan order-truth-and-invoice-tz (Step 6) — writer único de order_events.
    const orderHistory = { record: jest.fn().mockResolvedValue(null) } as any;

    const job = new PaymentTimeoutCleanupJob(prisma, eventEmitter, orderHistory);
    return { job, prisma, tx, eventEmitter, orderHistory };
  }

  describe('cancelStaleOrder', () => {
    it('registra state_changed con source job dentro de la misma tx que cancela la orden', async () => {
      const { job, tx, orderHistory } = buildJob();

      const order = {
        id: 42,
        order_number: 'ORD-42',
        store_id: 7,
        stores: { organization_id: 3 },
      };

      await (job as any).cancelStaleOrder(order);

      expect(tx.orders.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 42 },
          data: expect.objectContaining({ state: 'cancelled' }),
        }),
      );
      expect(orderHistory.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          orderId: 42,
          storeId: 7,
          organizationId: 3,
          type: 'state_changed',
          fromState: 'pending_payment',
          toState: 'cancelled',
          source: 'job',
        }),
      );
    });

    it('sigue cancelando la orden aunque la tienda no tenga organization_id resuelto', async () => {
      const { job, tx, orderHistory } = buildJob();

      const order = {
        id: 43,
        order_number: 'ORD-43',
        store_id: 7,
        stores: null,
      };

      await (job as any).cancelStaleOrder(order);

      expect(orderHistory.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          orderId: 43,
          storeId: 7,
          organizationId: undefined,
          type: 'state_changed',
          source: 'job',
        }),
      );
    });
  });
});
