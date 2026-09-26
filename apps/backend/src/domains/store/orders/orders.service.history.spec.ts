import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrdersService } from './orders.service';
import { mockRequestContext } from 'src/testing/prisma-mock';

/**
 * Plan order-truth-and-invoice-tz — `OrdersService.update` (PATCH
 * /store/orders/:id) registra `customer_changed` cuando el titular
 * (`customer_id`) cambia. Construcción positional espejo de
 * `orders.service.titular.spec.ts`; `orderHistoryService` es el 16º
 * parámetro (`@Optional()`).
 */
afterEach(() => {
  jest.restoreAllMocks();
});

describe('OrdersService.update — customer_changed', () => {
  const ORDER_ID = 924;
  const STORE_ID = 1;

  const draftOrder = {
    id: ORDER_ID,
    store_id: STORE_ID,
    order_number: 'D-1',
    state: 'draft',
    customer_id: 12,
    customer_alias: null,
    active_financial_split_id: null,
    subtotal_amount: '1000.00',
    tax_amount: '0.00',
    discount_amount: '0.00',
    tip_amount: '0.00',
    order_items: [],
    payments: [],
    users: { id: 12, first_name: 'Miguel', last_name: 'P' },
  };

  const build = () => {
    const prisma: any = {
      orders: {
        findFirst: jest.fn().mockResolvedValue({ ...draftOrder }),
        update: jest.fn().mockResolvedValue({ ...draftOrder, customer_id: 217 }),
      },
      store_users: { findFirst: jest.fn().mockResolvedValue({ id: 7 }) },
      invoices: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const orderHistoryService = { record: jest.fn().mockResolvedValue(null) };
    const service = new OrdersService(
      prisma,
      { signUrl: jest.fn(async (u: string) => u) } as any,
      { emit: jest.fn() } as unknown as EventEmitter2,
      {} as any,
      { validateOrThrow: jest.fn() } as any,
      {} as any, {} as any, {} as any,
      { forceOrderState: jest.fn() } as any,
      {} as any, {} as any, {} as any, {} as any, {} as any,
      { update: jest.fn() } as any,
      orderHistoryService as any,
    );
    return { prisma, orderHistoryService, service };
  };

  it('cambio de customer_id registra customer_changed con from/to exactos después del write', async () => {
    mockRequestContext({ store_id: STORE_ID, organization_id: 5, user_id: 3 });
    const { prisma, orderHistoryService, service } = build();

    await service.update(ORDER_ID, { customer_id: 217 } as any);

    expect(orderHistoryService.record).toHaveBeenCalledTimes(1);
    expect(orderHistoryService.record).toHaveBeenCalledWith(prisma, {
      orderId: ORDER_ID,
      storeId: STORE_ID,
      organizationId: 5,
      type: 'customer_changed',
      payload: { from_customer_id: 12, to_customer_id: 217 },
    });
    expect(prisma.orders.update.mock.invocationCallOrder[0]).toBeLessThan(
      orderHistoryService.record.mock.invocationCallOrder[0],
    );
  });

  it('customer_id: null explícito (quitar titular) registra to_customer_id null', async () => {
    mockRequestContext({ store_id: STORE_ID, organization_id: 5, user_id: 3 });
    const { orderHistoryService, service } = build();

    await service.update(ORDER_ID, { customer_id: null } as any);

    expect(orderHistoryService.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'customer_changed',
        payload: { from_customer_id: 12, to_customer_id: null },
      }),
    );
  });

  it('mismo customer_id, solo alias, o sin titular en el DTO: no registra', async () => {
    mockRequestContext({ store_id: STORE_ID, organization_id: 5, user_id: 3 });
    const { orderHistoryService, service } = build();

    await service.update(ORDER_ID, { customer_id: 12 } as any);
    await service.update(ORDER_ID, { customer_alias: 'Mesa 5' } as any);
    await service.update(ORDER_ID, { internal_notes: 'nota' } as any);

    expect(orderHistoryService.record).not.toHaveBeenCalled();
  });

  it('si el write de la orden falla, no registra evento', async () => {
    mockRequestContext({ store_id: STORE_ID, organization_id: 5, user_id: 3 });
    const { prisma, orderHistoryService, service } = build();
    prisma.orders.update.mockRejectedValue(new Error('db down'));

    await expect(service.update(ORDER_ID, { customer_id: 217 } as any)).rejects.toThrow('db down');
    expect(orderHistoryService.record).not.toHaveBeenCalled();
  });
});
