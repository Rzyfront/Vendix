import { Prisma } from '@prisma/client';
import { OrderFlowService } from '../../../orders/order-flow/order-flow.service';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { createPrismaMock } from 'src/testing/prisma-mock';
import { recordTriggerEvent } from '../workflow-trigger.outbox';

jest.mock('../workflow-trigger.outbox', () => ({
  recordTriggerEvent: jest.fn().mockResolvedValue(true),
}));

const record = recordTriggerEvent as jest.Mock;

describe('Flujos P1.1 producer: order.status_changed (OrderFlowService.updateOrderState)', () => {
  const ORDER_ID = 9001;
  const total = new Prisma.Decimal(4500);

  const build = (previousState: string, history: { id: number } | null) => {
    const prisma = createPrismaMock({
      orders: ['findUnique', 'update'],
      order_items: ['findMany'],
    });
    prisma.order_items.findMany.mockResolvedValue([]);
    prisma.orders.findUnique.mockResolvedValue({
      state: previousState,
      store_id: 100,
      order_number: 'ORD-7',
      stores: { organization_id: 1 },
    });
    prisma.orders.update.mockResolvedValue({
      id: ORDER_ID,
      store_id: 100,
      grand_total: total,
      stores: { id: 100, name: 'Tienda', store_code: 'T1', organization_id: 1 },
      order_items: [],
      payments: [],
    });
    const emitter = { emit: jest.fn() };
    const orderHistory = { record: jest.fn().mockResolvedValue(history) };
    const stockCommit = {
      commitOrderDelivery: jest.fn().mockResolvedValue({ totalCost: 0 }),
    };
    const service = new OrderFlowService(
      prisma as unknown as StorePrismaService,
      emitter as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      stockCommit as never,
      { logCustom: jest.fn().mockResolvedValue(undefined) } as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      orderHistory as never,
    );
    return { prisma, emitter, service };
  };

  beforeEach(() => record.mockClear());

  it('generic state write: event in the same transaction, keyed by the history row', async () => {
    const { prisma, service } = build('processing', { id: 55 });

    await (service as any).updateOrderState(ORDER_ID, 'shipped', {}, {});

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith(prisma, 'order.status_changed', {
      store_id: 100,
      order_id: ORDER_ID,
      order_number: 'ORD-7',
      from_state: 'processing',
      to_state: 'shipped',
      grand_total: total,
      transition_id: 55,
    });
  });

  it('inventory-moving state (finished): event in the stock transaction', async () => {
    const { prisma, service } = build('delivered', { id: 56 });

    await (service as any).updateOrderState(ORDER_ID, 'finished', {}, {});

    expect(record).toHaveBeenCalledWith(
      prisma,
      'order.status_changed',
      expect.objectContaining({
        order_id: ORDER_ID,
        from_state: 'delivered',
        to_state: 'finished',
        transition_id: 56,
      }),
    );
  });

  it('does not announce the order change after the commit when the outbox write fails', async () => {
    const { service, emitter } = build('processing', { id: 57 });
    record.mockRejectedValueOnce(new Error('outbox down'));

    await expect(
      (service as any).updateOrderState(ORDER_ID, 'shipped', {}, {}),
    ).rejects.toThrow('outbox down');
    expect(emitter.emit).not.toHaveBeenCalledWith(
      'order.status_changed',
      expect.anything(),
    );
  });

  it('records nothing when the write changes no state (no history row)', async () => {
    const { service } = build('shipped', null);

    await (service as any).updateOrderState(ORDER_ID, 'shipped', {}, {});

    expect(record).not.toHaveBeenCalled();
  });
});
