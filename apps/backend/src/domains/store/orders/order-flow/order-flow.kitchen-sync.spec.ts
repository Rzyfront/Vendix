import { OrderFlowService } from './order-flow.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { ErrorCodes } from 'src/common/errors';

/**
 * Sincronía cancelado/entregado orden↔cocina (regla del dueño, store Pollo
 * Arabe): entregado y cancelado SIEMPRE iguales entre la orden y el KDS.
 * Cubre R1 (seam desde cocina), R2 (cancelación deja la fila KDS cancelled
 * aunque estuviera delivered) y R4 (no finalizar con platos vivos en cocina).
 */
describe('OrderFlowService — sincronía cancelado/entregado orden↔cocina', () => {
  const ORDER_ID = 9001;
  const ITEM_ID = 9002;
  const TICKET_ID = 9003;
  const STORE_ID = 4;

  const buildService = (opts: {
    order?: Record<string, unknown>;
    item?: Record<string, unknown>;
    latestKti?: { id: number; status: string; kitchen_ticket_id: number } | null;
    ticketRows?: Array<{ status: string }>;
    settledPayment?: boolean;
    activeLines?: Array<Record<string, unknown>>;
  } = {}) => {
    const latestKti =
      opts.latestKti === undefined
        ? { id: 900, status: 'delivered', kitchen_ticket_id: TICKET_ID }
        : opts.latestKti;
    const txMock: any = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: ORDER_ID, state: 'processing' }]),
      kitchen_tickets: {
        findFirst: jest.fn().mockResolvedValue({ status: 'delivered' }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      kitchen_ticket_items: {
        findFirst: jest.fn().mockResolvedValue(latestKti),
        findMany: jest.fn().mockResolvedValue(opts.ticketRows ?? [{ status: 'cancelled' }]),
        update: jest.fn().mockResolvedValue({}),
      },
      inventory_transactions: { findMany: jest.fn().mockResolvedValue([]) },
      audit_logs: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 1 }),
      },
      inventory_cost_layers: { create: jest.fn().mockResolvedValue({ id: 1 }) },
      payments: {
        findFirst: jest
          .fn()
          .mockResolvedValue(opts.settledPayment ? { id: 55 } : null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      order_items: {
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue(
          opts.activeLines ?? [{ id: ITEM_ID }],
        ),
      },
      orders: {
        findFirst: jest.fn().mockResolvedValue({ active_financial_split_id: null }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const prismaMock: any = {
      order_items: {
        findFirst: jest.fn().mockResolvedValue({
          id: ITEM_ID,
          product_id: 1,
          product_variant_id: null,
          quantity: 1,
          stock_units_consumed: null,
          inventory_committed: false,
          inventory_consumed_at_fire: false,
          product_name: 'Pollo',
          products: { product_type: 'physical' },
          cancelled_at: null,
          delivered_at: null,
          kitchen_ticket_items: [
            {
              id: 900,
              status: 'ready',
              kitchen_ticket_id: TICKET_ID,
              kitchen_ticket: { id: TICKET_ID, status: 'ready' },
            },
          ],
          ...(opts.item ?? {}),
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      orders: { findUnique: jest.fn().mockResolvedValue({ state: 'processing' }) },
      payments: { findFirst: jest.fn().mockResolvedValue(opts.settledPayment ? { id: 55 } : null) },
      $transaction: jest.fn((cb: any) => cb(txMock)),
    };
    const kitchenFireService = {
      cancelTicketItemInTx: jest.fn().mockResolvedValue('cancelled'),
      emitTicketCancelledEvent: jest.fn().mockResolvedValue(undefined),
      emitTicketUpdatedEvent: jest.fn().mockResolvedValue(undefined),
    };
    const history = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new OrderFlowService(
      prismaMock as unknown as StorePrismaService,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {
        getDefaultLocationForProduct: jest.fn().mockResolvedValue(1),
        updateStock: jest.fn().mockResolvedValue({}),
        releaseReservationQuantity: jest.fn().mockResolvedValue(0),
      } as any,
      {} as any,
      {} as any,
      { logCustom: jest.fn().mockResolvedValue(undefined) } as any,
      kitchenFireService as any,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      history as any,
    );
    jest.spyOn(service as any, 'getOrder').mockResolvedValue({
      id: ORDER_ID,
      store_id: STORE_ID,
      state: 'processing',
      payments: [],
      stores: { organization_id: 1 },
      ...(opts.order ?? {}),
    });
    return { service, prismaMock, txMock, kitchenFireService, history };
  };

  describe('R2 — cancelLatestKitchenItemInTx', () => {
    it('fila delivered cuyo ticket queda todo cancelado → fila y ticket cancelled', async () => {
      const { service, txMock } = buildService({ ticketRows: [{ status: 'cancelled' }] });

      const res = await (service as any).cancelLatestKitchenItemInTx(txMock, ORDER_ID, ITEM_ID);

      expect(res).toEqual({ ticketId: TICKET_ID, result: 'cancelled' });
      expect(txMock.kitchen_ticket_items.update).toHaveBeenCalledWith({
        where: { id: 900 },
        data: expect.objectContaining({ status: 'cancelled' }),
      });
      expect(txMock.kitchen_tickets.update).toHaveBeenCalledWith({
        where: { id: TICKET_ID },
        data: expect.objectContaining({ status: 'cancelled' }),
      });
    });

    it('con hermano aún pendiente → solo la fila cambia, ticket intacto (updated)', async () => {
      const { service, txMock } = buildService({
        ticketRows: [{ status: 'cancelled' }, { status: 'pending' }],
      });

      const res = await (service as any).cancelLatestKitchenItemInTx(txMock, ORDER_ID, ITEM_ID);

      expect(res).toEqual({ ticketId: TICKET_ID, result: 'updated' });
      expect(txMock.kitchen_tickets.update).not.toHaveBeenCalled();
    });

    it('con hermanos todos terminales (uno delivered) → ticket queda delivered', async () => {
      const { service, txMock } = buildService({
        ticketRows: [{ status: 'cancelled' }, { status: 'delivered' }],
      });

      const res = await (service as any).cancelLatestKitchenItemInTx(txMock, ORDER_ID, ITEM_ID);

      expect(res?.result).toBe('updated');
      expect(txMock.kitchen_tickets.update).toHaveBeenCalledWith({
        where: { id: TICKET_ID },
        data: expect.objectContaining({ status: 'delivered' }),
      });
    });

    it('fila ya cancelled o sin filas → no escribe (idempotente)', async () => {
      const cancelled = buildService({
        latestKti: { id: 900, status: 'cancelled', kitchen_ticket_id: TICKET_ID },
      });
      expect(
        await (cancelled.service as any).cancelLatestKitchenItemInTx(cancelled.txMock, ORDER_ID, ITEM_ID),
      ).toBeNull();
      expect(cancelled.txMock.kitchen_ticket_items.update).not.toHaveBeenCalled();

      const none = buildService({ latestKti: null });
      expect(
        await (none.service as any).cancelLatestKitchenItemInTx(none.txMock, ORDER_ID, ITEM_ID),
      ).toBeNull();
    });
  });

  describe('R2 — cancelOrderItem / cancelDeliveredOrderItem', () => {
    it('cancelOrderItem con fila KDS delivered (línea aún sin delivered_at) → fila cancelled in-tx + SSE ticket', async () => {
      const { service, txMock, kitchenFireService } = buildService({
        item: {
          kitchen_ticket_items: [
            {
              id: 900,
              status: 'delivered',
              kitchen_ticket_id: TICKET_ID,
              kitchen_ticket: { id: TICKET_ID, status: 'delivered' },
            },
          ],
        },
      });
      // Los recálculos leen order_items.findMany con `total_price`.
      txMock.order_items.findMany.mockResolvedValue([{ total_price: 1000, order_item_taxes: [] }]);

      await service.cancelOrderItem(ORDER_ID, ITEM_ID, 'cliente se arrepintió');

      expect(txMock.kitchen_ticket_items.update).toHaveBeenCalledWith({
        where: { id: 900 },
        data: expect.objectContaining({ status: 'cancelled' }),
      });
      expect(kitchenFireService.emitTicketCancelledEvent).toHaveBeenCalledWith(TICKET_ID);
    });

    it('cancelDeliveredOrderItem: la línea entregada (fila KDS delivered) deja cocina cancelled y emite SSE', async () => {
      const { service, txMock, kitchenFireService } = buildService({
        item: {
          delivered_at: new Date('2026-09-20T12:00:00Z'),
          kitchen_ticket_items: [{ kitchen_ticket_id: TICKET_ID }],
        },
      });
      txMock.order_items.findMany.mockResolvedValue([{ total_price: 1000, order_item_taxes: [] }]);

      await service.cancelDeliveredOrderItem(ORDER_ID, ITEM_ID, 'devolución', 'restock');

      expect(txMock.kitchen_ticket_items.update).toHaveBeenCalledWith({
        where: { id: 900 },
        data: expect.objectContaining({ status: 'cancelled' }),
      });
      expect(kitchenFireService.emitTicketCancelledEvent).toHaveBeenCalledWith(TICKET_ID);
    });
  });

  describe('R4 — no finalizar con platos vivos en cocina', () => {
    it('findLineAwaitingKitchenDelivery devuelve la línea con fila ready/pending y null si todo delivered/cancelled', async () => {
      const blocked = buildService();
      blocked.prismaMock.order_items.findMany.mockResolvedValue([
        { product_name: 'Bandeja', kitchen_ticket_items: [{ status: 'ready' }] },
        { product_name: 'Jugo', kitchen_ticket_items: [{ status: 'delivered' }] },
      ]);
      expect(await (blocked.service as any).findLineAwaitingKitchenDelivery(ORDER_ID)).toBe('Bandeja');

      const clear = buildService();
      clear.prismaMock.order_items.findMany.mockResolvedValue([
        { product_name: 'Bandeja', kitchen_ticket_items: [{ status: 'delivered' }] },
        { product_name: 'Jugo', kitchen_ticket_items: [{ status: 'cancelled' }] },
      ]);
      expect(await (clear.service as any).findLineAwaitingKitchenDelivery(ORDER_ID)).toBeNull();
    });

    it('updateOrderState(finished) con plato sin entregar lanza ORDER_HAS_PENDING_KITCHEN_ITEMS y no escribe el estado', async () => {
      const { service, prismaMock } = buildService();
      prismaMock.order_items.findMany.mockResolvedValue([
        { product_name: 'Bandeja', kitchen_ticket_items: [{ status: 'pending' }] },
      ]);
      prismaMock.orders.update = jest.fn();

      await expect(
        (service as any).updateOrderState(ORDER_ID, 'finished', {}),
      ).rejects.toMatchObject({ errorCode: ErrorCodes.ORDER_HAS_PENDING_KITCHEN_ITEMS.code });
      expect(prismaMock.orders.update).not.toHaveBeenCalled();
    });
  });

  describe('R1 — seam cancelItemsFromKitchenInTx / isOrderPaidForKitchenCancel', () => {
    const params = (over: Record<string, unknown> = {}) => ({
      orderId: ORDER_ID,
      orderItemIds: [ITEM_ID],
      disposition: 'reuse' as const,
      reason: 'cocina canceló el plato',
      ticketId: TICKET_ID,
      wasPending: false,
      ...over,
    });

    it('marca la línea after_fire_reused, registra item_cancelled source kitchen y recalcula totales sin tocar inventario ni tickets', async () => {
      const { service, txMock, history, kitchenFireService } = buildService();
      txMock.order_items.findMany
        .mockResolvedValueOnce([{ id: ITEM_ID }])
        .mockResolvedValue([{ total_price: 500, order_item_taxes: [] }]);

      await service.cancelItemsFromKitchenInTx(txMock, params());

      expect(txMock.order_items.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [ITEM_ID] }, order_id: ORDER_ID },
        data: expect.objectContaining({ cancellation_type: 'after_fire_reused' }),
      });
      expect(history.record).toHaveBeenCalledWith(
        txMock,
        expect.objectContaining({
          type: 'item_cancelled',
          orderItemId: ITEM_ID,
          payload: expect.objectContaining({ source: 'kitchen' }),
        }),
      );
      expect(txMock.orders.update).toHaveBeenCalled();
      expect(txMock.kitchen_ticket_items.update).not.toHaveBeenCalled();
      expect(kitchenFireService.cancelTicketItemInTx).not.toHaveBeenCalled();
    });

    it('waste → after_fire_waste', async () => {
      const { service, txMock } = buildService();
      txMock.order_items.findMany
        .mockResolvedValueOnce([{ id: ITEM_ID }])
        .mockResolvedValue([]);

      await service.cancelItemsFromKitchenInTx(txMock, params({ disposition: 'waste' }));

      expect(txMock.order_items.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ cancellation_type: 'after_fire_waste' }),
        }),
      );
    });

    it('orden con pago registrado → error de "ya cobrada" y no muta', async () => {
      const { service, txMock } = buildService({ settledPayment: true });

      await expect(service.cancelItemsFromKitchenInTx(txMock, params())).rejects.toMatchObject({
        errorCode: ErrorCodes.TABLE_SESSION_ITEM_NOT_REMOVABLE.code,
      });
      expect(txMock.order_items.updateMany).not.toHaveBeenCalled();
    });

    it('isOrderPaidForKitchenCancel refleja el predicado de pagos liquidados', async () => {
      const paid = buildService({ settledPayment: true });
      expect(await paid.service.isOrderPaidForKitchenCancel(ORDER_ID)).toBe(true);
      const unpaid = buildService();
      expect(await unpaid.service.isOrderPaidForKitchenCancel(ORDER_ID, unpaid.txMock)).toBe(false);
    });
  });
});
