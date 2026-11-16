import { OrderFlowService } from './order-flow.service';
import { RequestContextService } from '@common/context/request-context.service';

/**
 * Reactivar una orden cancelada re-reserva su stock y la devuelve a su
 * estado previo. La reserva y la escritura del estado deben ser UNA sola
 * transacción: antes, `updateOrderState` abría otra transacción en otra
 * conexión del pool mientras la de afuera seguía abierta (no atómica y, bajo
 * carga, la de afuera vencía esperando). El evento `order.status_changed`
 * sale solo después del commit.
 */
describe('OrderFlowService.reactivateOrder — una sola transacción', () => {
  const ORDER_ID = 300;

  const build = (opts: { available?: number } = {}) => {
    const events: string[] = [];
    let committed = false;
    const cancelledOrder = {
      id: ORDER_ID,
      store_id: 4,
      state: 'cancelled',
      internal_notes: JSON.stringify({ _flow_metadata: { previous_state: 'processing' } }),
      order_items: [
        {
          id: 1,
          product_id: 50,
          product_variant_id: null,
          quantity: 2,
          products: { id: 50, name: 'Pollo', track_inventory: true, product_type: 'physical' },
        },
      ],
    };
    const tx: any = {
      orders: {
        findFirst: jest.fn().mockResolvedValue(cancelledOrder),
        findUnique: jest.fn().mockResolvedValue({
          ...cancelledOrder,
          order_number: 'ORD-300',
          stores: { organization_id: 1 },
          payments: [],
        }),
        update: jest.fn(async () => {
          events.push('state_write');
          return { id: ORDER_ID, store_id: 4, state: 'processing', grand_total: 0 };
        }),
      },
      stock_levels: {
        findFirst: jest.fn().mockResolvedValue({ quantity_available: opts.available ?? 10 }),
      },
      workflow_definitions: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const prisma: any = {
      $transaction: jest.fn(async (cb: any) => {
        const result = await cb(tx);
        committed = true;
        events.push('commit');
        return result;
      }),
      orders: { findUnique: jest.fn() },
    };
    const emitter = {
      emit: jest.fn((name: string) => {
        events.push(`${name}${committed ? '' : ' (before commit)'}`);
      }),
    };
    const stock = {
      getDefaultLocationForProduct: jest.fn().mockResolvedValue(7),
      reserveStock: jest.fn(async () => {
        events.push('reserve');
      }),
    };
    const service = new OrderFlowService(
      prisma, emitter as any, {} as any, {} as any, {} as any,
      stock as any, {} as any, {} as any, {} as any,
    );
    jest.spyOn(RequestContextService, 'getUserId').mockReturnValue(9 as never);
    return { service, prisma, tx, emitter, stock, events };
  };

  afterEach(() => jest.restoreAllMocks());

  it('re-reserva y escribe el estado en la MISMA tx, con presupuesto explícito', async () => {
    const { service, prisma, tx, stock } = build();

    const result = await service.reactivateOrder(ORDER_ID, { reason: 'cliente volvió' } as any);

    expect(result).toMatchObject({ id: ORDER_ID, state: 'processing' });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function), { timeout: 20_000, maxWait: 5_000 },
    );
    expect(stock.reserveStock).toHaveBeenCalledWith(
      50, undefined, 7, 2, 'order', ORDER_ID, 9, false, tx,
    );
    expect(tx.orders.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ORDER_ID },
        data: expect.objectContaining({ state: 'processing' }),
      }),
    );
    // Las lecturas del estado previo tampoco salen de la tx.
    expect(prisma.orders.findUnique).not.toHaveBeenCalled();
  });

  it('order.status_changed se emite después del commit, nunca dentro de la tx', async () => {
    const { service, events } = build();

    await service.reactivateOrder(ORDER_ID, { reason: 'cliente volvió' } as any);

    expect(events).toEqual(['reserve', 'state_write', 'commit', 'order.status_changed']);
  });

  it('sin stock suficiente rechaza con ORD_VALIDATE_001 y no escribe el estado (sin cambios)', async () => {
    const { service, tx, emitter, stock } = build({ available: 1 });

    await expect(
      service.reactivateOrder(ORDER_ID, { reason: 'cliente volvió' } as any),
    ).rejects.toMatchObject({ errorCode: 'ORD_VALIDATE_001' });

    expect(stock.reserveStock).not.toHaveBeenCalled();
    expect(tx.orders.update).not.toHaveBeenCalled();
    expect(emitter.emit).not.toHaveBeenCalled();
  });
});
