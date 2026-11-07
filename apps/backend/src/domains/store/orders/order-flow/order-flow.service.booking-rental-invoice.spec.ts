import { OrderFlowService } from './order-flow.service';

/**
 * Rental order of a booking paid through its payment request (S1/S15, D6):
 * once fully paid it goes to the POS emitter whatever its channel, and the
 * auto-emit flag follows the sale lane (counter `invoicing.pos`, online
 * `invoicing.ecommerce`). The presential lane keeps ignoring online orders.
 */
describe('OrderFlowService — invoicePaidBookingRentalOrder', () => {
  const paid = (amount: number) => ({ state: 'succeeded', amount });

  const build = (opts: {
    channel?: string;
    payments?: Array<{ state: string; amount: number }>;
    invoice?: { id: number; status: string } | null;
    settings?: Record<string, unknown>;
  }) => {
    const prisma: any = {
      orders: {
        findFirst: jest.fn(async () => ({
          id: 7001,
          store_id: 105,
          order_number: 'ORD-7001',
          channel: opts.channel ?? 'ecommerce',
          delivery_type: 'direct_delivery',
          grand_total: 200000,
          active_financial_split_id: null,
          payments: opts.payments ?? [paid(200000)],
        })),
      },
      invoices: { findFirst: jest.fn(async () => opts.invoice ?? null) },
    };
    const service = new OrderFlowService(
      prisma, {} as any, {} as any, {} as any, {} as any,
      {} as any, {} as any, {} as any, {} as any,
    );
    (service as any).settingsService = { getSettings: jest.fn(async () => opts.settings ?? {}) };
    const dispatch = jest
      .spyOn(service as any, 'dispatchSaleCompletedEvent')
      .mockImplementation(async () => undefined);
    return { service, dispatch };
  };

  it('online rental order fully paid: dispatched with the online auto-emit flag', async () => {
    const h = build({ settings: { invoicing: { ecommerce: { auto_emit: true }, pos: { auto_emit: false } } } });
    await h.service.invoicePaidBookingRentalOrder(7001);
    expect(h.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7001, store_id: 105 }),
      true,
      'booking_rental.paid',
    );
  });

  it('online rental order without an online flag: dispatched with the online default (off)', async () => {
    const h = build({ settings: { invoicing: { pos: { auto_emit: true } } } });
    await h.service.invoicePaidBookingRentalOrder(7001);
    expect(h.dispatch).toHaveBeenCalledWith(expect.objectContaining({ id: 7001 }), false, 'booking_rental.paid');
  });

  it('counter rental order (channel pos) follows the POS flag', async () => {
    const h = build({ channel: 'pos', settings: { invoicing: { pos: { auto_emit: true }, ecommerce: { auto_emit: false } } } });
    await h.service.invoicePaidBookingRentalOrder(7001);
    expect(h.dispatch).toHaveBeenCalledWith(expect.objectContaining({ id: 7001 }), true, 'booking_rental.paid');
  });

  it('a partially paid rental order is not invoiced yet', async () => {
    const h = build({ payments: [paid(80000)] });
    await h.service.invoicePaidBookingRentalOrder(7001);
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it('an already issued invoice is not issued again', async () => {
    const h = build({ invoice: { id: 3, status: 'accepted' } });
    await h.service.invoicePaidBookingRentalOrder(7001);
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it('the presential lane still ignores an online order', async () => {
    const h = build({ settings: { invoicing: { ecommerce: { auto_emit: true }, pos: { auto_emit: true } } } });
    await h.service.invoicePaidReservationFeeOrder(7001);
    expect(h.dispatch).not.toHaveBeenCalled();
  });
});
