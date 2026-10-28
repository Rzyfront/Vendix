import { OrderFlowService } from './order-flow.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { mockRequestContext } from 'src/testing/prisma-mock';
import { POS_SALE_COMPLETED_EVENT } from '../../invoicing/pos/pos-sale-completed.event';

/**
 * cod-auto-invoicing S2 — a delivery order (contra entrega / domicilio, POS or
 * tienda en línea) is invoiced automatically only when it is DELIVERED and
 * fully PAID, and only if the store explicitly turned automatic invoicing on.
 */
describe('OrderFlowService — emisión al entregar y cobrar (S2)', () => {
  const ORDER_ID = 50;
  const STORE_ID = 4;
  const ORG_ID = 77;

  let service: OrderFlowService;
  let prismaMock: any;
  let eventEmitter: { emit: jest.Mock };
  let settingsService: { getSettings: jest.Mock };
  let row: any;
  let latestInvoice: any;

  const emitted = () =>
    eventEmitter.emit.mock.calls.filter(([name]) => name === POS_SALE_COMPLETED_EVENT);

  beforeEach(() => {
    mockRequestContext({ store_id: STORE_ID, organization_id: ORG_ID, user_id: 9 });
    row = {
      id: ORDER_ID,
      store_id: STORE_ID,
      order_number: 'ORD-50',
      channel: 'ecommerce',
      delivery_type: 'home_delivery',
      state: 'delivered',
      payment_form: null,
      grand_total: 100000,
      active_financial_split_id: null,
      payments: [
        {
          state: 'succeeded',
          amount: 100000,
          created_at: new Date('2026-10-28T15:00:00Z'),
          gateway_response: { payment_type: 'direct' },
        },
      ],
    };
    latestInvoice = {
      id: 7,
      status: 'draft',
      created_at: new Date('2026-10-27T10:00:00Z'),
    };
    prismaMock = {
      orders: { findFirst: jest.fn().mockImplementation(() => Promise.resolve(row)) },
      invoices: { findFirst: jest.fn().mockImplementation(() => Promise.resolve(latestInvoice)) },
      stores: { findFirst: jest.fn().mockResolvedValue({ organization_id: ORG_ID }) },
    };
    eventEmitter = { emit: jest.fn() };
    settingsService = {
      getSettings: jest.fn().mockResolvedValue({
        invoicing: { pos: { auto_emit: true }, ecommerce: { auto_emit: true } },
      }),
    };
    service = new OrderFlowService(
      prismaMock as unknown as StorePrismaService,
      eventEmitter as any,
      settingsService as any,
      { assertSessionForSales: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { logCustom: jest.fn().mockResolvedValue(undefined) } as any,
    );
  });

  const run = () => (service as any).emitDeliveredOrderInvoiceIfReady(ORDER_ID, 'test');

  it('delivered + paid + online auto-emit on → emits the invoice (existing checkout draft is reused)', async () => {
    await run();

    expect(emitted()).toHaveLength(1);
    expect(emitted()[0][1]).toEqual(
      expect.objectContaining({
        order_id: ORDER_ID,
        store_id: STORE_ID,
        organization_id: ORG_ID,
        auto_emit: true,
      }),
    );
  });

  it('paid but not delivered yet → does not emit', async () => {
    row.state = 'shipped';
    await run();
    expect(emitted()).toHaveLength(0);
  });

  it('delivered but not paid → does not emit (the payment registration will)', async () => {
    row.payments = [{ state: 'pending', amount: 100000, created_at: new Date(), gateway_response: {} }];
    await run();
    expect(emitted()).toHaveLength(0);
  });

  it('flag never set (default off) → does not emit; only manual «Facturar»', async () => {
    settingsService.getSettings.mockResolvedValue({});
    await run();
    expect(emitted()).toHaveLength(0);
  });

  it('POS domicilio reads the POS flag, not the online one', async () => {
    row.channel = 'pos';
    settingsService.getSettings.mockResolvedValue({
      invoicing: { pos: { auto_emit: false }, ecommerce: { auto_emit: true } },
    });
    await run();
    expect(emitted()).toHaveLength(0);

    settingsService.getSettings.mockResolvedValue({
      invoicing: { pos: { auto_emit: true }, ecommerce: { auto_emit: false } },
    });
    await run();
    expect(emitted()).toHaveLength(1);
  });

  it('already accepted invoice → does not emit again', async () => {
    latestInvoice = { id: 7, status: 'accepted', created_at: new Date() };
    await run();
    expect(emitted()).toHaveLength(0);
  });

  it('credit order (payment_form 2) → not this lane', async () => {
    row.payment_form = '2';
    await run();
    expect(emitted()).toHaveLength(0);
  });

  it('route collection without a prior invoice → does not emit (revenue already booked by the route, would double count)', async () => {
    latestInvoice = null;
    row.payments = [
      {
        state: 'succeeded',
        amount: 100000,
        created_at: new Date('2026-10-28T15:00:00Z'),
        gateway_response: { payment_type: 'dispatch_route' },
      },
    ];
    await run();
    expect(emitted()).toHaveLength(0);
  });

  it('route collection with a draft created BEFORE it → emits (the route booked against 1305)', async () => {
    row.payments = [
      {
        state: 'succeeded',
        amount: 100000,
        created_at: new Date('2026-10-28T15:00:00Z'),
        gateway_response: { payment_type: 'dispatch_route' },
      },
    ];
    await run();
    expect(emitted()).toHaveLength(1);
  });

  it('counter pickup sale (not a delivery order) → not this lane', async () => {
    row.channel = 'pos';
    row.delivery_type = 'direct_delivery';
    await run();
    expect(emitted()).toHaveLength(0);
  });

  it('deliverOrder triggers the check after marking delivered', async () => {
    const spy = jest
      .spyOn(service as any, 'emitDeliveredOrderInvoiceIfReady')
      .mockResolvedValue(undefined);
    jest.spyOn(service as any, 'getOrder').mockResolvedValue({ id: ORDER_ID, state: 'shipped', stores: {} });
    jest.spyOn(service as any, 'assertKitchenReadyForWholeOrder').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'updateOrderState').mockResolvedValue({ id: ORDER_ID, state: 'delivered' });

    await service.deliverOrder(ORDER_ID, {} as any);

    expect(spy).toHaveBeenCalledWith(ORDER_ID, 'deliver_order');
  });

  it('POS home delivery paid while shipped → waits for delivery (emitPosSaleCompletedIfFullyPaid defers)', async () => {
    row.channel = 'pos';
    row.state = 'shipped';
    await (service as any).emitPosSaleCompletedIfFullyPaid(ORDER_ID, 'pay_order.shipped');
    expect(emitted()).toHaveLength(0);
  });
});
