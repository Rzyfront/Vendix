import { OrderFlowService } from './order-flow.service';

describe('OrderFlowService — cancelOrderItemInTx / recalc (QUI-650)', () => {
  const ORDER_ID = 100;
  const ITEM_ID = 200;

  const build = () => {
    const kds = {
      cancelTicketItemInTx: jest.fn().mockResolvedValue('cancelled'),
      emitTicketCancelledEvent: jest.fn(),
      emitTicketUpdatedEvent: jest.fn(),
    };
    const stock = {
      releaseReservationQuantity: jest.fn().mockResolvedValue(0),
      getDefaultLocationForProduct: jest.fn(),
      updateStock: jest.fn(),
    };
    const service = new OrderFlowService(
      {} as any, {} as any, {} as any, {} as any, {} as any,
      stock as any, {} as any, {} as any, {} as any,
      kds as any,
      undefined, undefined, undefined, undefined, undefined,
      { record: jest.fn() } as any,
    );
    const item = {
      id: ITEM_ID, product_id: 1, product_variant_id: null, quantity: 1,
      stock_units_consumed: null, product_name: 'X', inventory_consumed_at_fire: false,
      products: { product_type: 'physical' }, cancelled_at: null, delivered_at: null,
      kitchen_ticket_items: [],
    };
    const tx: any = {
      order_items: {
        findFirst: jest.fn().mockResolvedValue(item),
        update: jest.fn().mockResolvedValue({}),
      },
      kitchen_ticket_items: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const order = { id: ORDER_ID, store_id: 4, state: 'processing', payments: [], stores: { organization_id: 1 } };
    const recalc = jest
      .spyOn(service as any, 'recalcOrderTotalsAfterItemCancelInTx')
      .mockResolvedValue(undefined);
    return { service, tx, order, recalc };
  };

  it('skipTotalsRecalc=true no recalcula; sin el flag sí', async () => {
    const a = build();
    await a.service.cancelOrderItemInTx(a.tx, {
      order: a.order, orderItemId: ITEM_ID, reason: 'cliente cambió', skipTotalsRecalc: true,
    });
    expect(a.recalc).not.toHaveBeenCalled();
    expect(a.tx.order_items.update).toHaveBeenCalled();

    const b = build();
    const effects = await b.service.cancelOrderItemInTx(b.tx, {
      order: b.order, orderItemId: ITEM_ID, reason: 'cliente cambió',
    });
    expect(b.recalc).toHaveBeenCalledTimes(1);
    expect(effects.alreadyCancelled).toBe(false);
    expect(effects.resolvedType).toBe('before_fire');
  });

  it('línea entregada -> VendixHttpException ITEM_ALREADY_DELIVERED', async () => {
    const a = build();
    a.tx.order_items.findFirst.mockResolvedValue({
      ...(await a.tx.order_items.findFirst()), delivered_at: new Date(),
    });
    await expect(
      a.service.cancelOrderItemInTx(a.tx, { order: a.order, orderItemId: ITEM_ID, reason: 'motivo ok' }),
    ).rejects.toMatchObject({ errorCode: 'ITEM_ALREADY_DELIVERED' });
  });

  it('recalcOrderTotalsFromActiveLinesInTx: discountOverride se persiste y la propina % se re-deriva', async () => {
    const { service } = build();
    const update = jest.fn().mockResolvedValue({});
    const tx: any = {
      order_items: {
        findMany: jest.fn().mockResolvedValue([
          { total_price: 100, order_item_taxes: [{ tax_amount: 19 }] },
        ]),
      },
      orders: { update },
    };
    jest.spyOn(service as any, 'syncPendingCodAmountInTx').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'rederivePercentageTip').mockReturnValue(10);
    await service.recalcOrderTotalsFromActiveLinesInTx(
      tx,
      { discount_amount: 5, shipping_cost: 0, tip_amount: 3, payments: [] },
      ORDER_ID,
      { discountOverride: 20 },
    );
    const data = update.mock.calls[0][0].data;
    expect(Number(data.discount_amount)).toBe(20);
    expect(Number(data.tip_amount)).toBe(10);
    expect(Number(data.grand_total)).toBe(100 + 19 + 10 - 20);

    update.mockClear();
    await service.recalcOrderTotalsFromActiveLinesInTx(
      tx, { discount_amount: 5, shipping_cost: 0, payments: [] }, ORDER_ID,
    );
    const d2 = update.mock.calls[0][0].data;
    expect(d2.discount_amount).toBeUndefined();
    expect(Number(d2.grand_total)).toBe(100 + 19 + 10 - 5);
  });
});
