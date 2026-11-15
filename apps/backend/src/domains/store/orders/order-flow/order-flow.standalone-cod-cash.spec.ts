import { OrderFlowService } from './order-flow.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { createPrismaMock } from 'src/testing/prisma-mock';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';

/**
 * QUI-893 B3 — a contra entrega remisión invoiced with a balance and that did
 * NOT travel on a route planilla: whoever invoices needs an open drawer, and
 * the collection is a cash `sale` in that drawer. The route flow is unchanged
 * (its cash enters at planilla close).
 */
describe('OrderFlowService — standalone COD invoice collects into the invoicer drawer (QUI-893 B3)', () => {
  const ORDER_ID = 7501;
  const STORE_ID = 42;
  const NOTE_ID = 91;
  const USER_ID = 9;
  const PAYMENT_ID = 6701;
  const SESSION_ID = 423;

  const build = (opts: {
    order?: Record<string, unknown>;
    routeStop?: { id: number } | null;
    onDeliveryPayment?: { id: number } | null;
    cashRegisterEnabled?: boolean;
    session?: { id: number } | null;
  } = {}) => {
    const prismaMock = createPrismaMock({
      dispatch_notes: ['findFirst'],
      dispatch_route_stops: ['findFirst'],
      payments: ['findFirst', 'create'],
      orders: ['findFirst', 'updateMany'],
      store_settings: ['findUnique'],
      cash_register_sessions: ['findFirst'],
    });
    const order = {
      id: ORDER_ID,
      currency: 'COP',
      total_paid: 0,
      remaining_balance: 30000,
      payment_form: '1',
      customer_id: 12,
      order_number: 'ORD-1',
      stores: { organization_id: 3 },
      ...opts.order,
    };
    prismaMock.dispatch_notes.findFirst.mockResolvedValue({ order_id: ORDER_ID });
    prismaMock.dispatch_route_stops.findFirst.mockResolvedValue(opts.routeStop ?? null);
    // 1st payments.findFirst = idempotency key, 2nd = ON_DELIVERY promise lookup.
    prismaMock.payments.findFirst.mockImplementation(async (args: any) =>
      args?.where?.gateway_reference ? null : (opts.onDeliveryPayment ?? null),
    );
    prismaMock.orders.findFirst.mockResolvedValue(order);
    prismaMock.payments.create.mockResolvedValue({ id: PAYMENT_ID });
    prismaMock.orders.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.store_settings.findUnique.mockResolvedValue({
      settings: { pos: { cash_register: { enabled: opts.cashRegisterEnabled ?? true } } },
    });
    prismaMock.cash_register_sessions.findFirst.mockResolvedValue(
      opts.session === undefined ? { id: SESSION_ID } : opts.session,
    );
    const sessionsService = { assertSessionForSales: jest.fn().mockResolvedValue(undefined) };
    const movementsService = { recordSaleMovement: jest.fn().mockResolvedValue({ id: 1 }) };
    const service = new OrderFlowService(
      prismaMock as unknown as StorePrismaService,
      { emit: jest.fn() } as any,
      {} as any,
      sessionsService as any,
      movementsService as any,
      {} as any, {} as any, {} as any, {} as any,
      undefined, undefined, undefined, undefined, undefined, undefined,
      { record: jest.fn().mockResolvedValue(null) } as any,
    );
    return { prismaMock, sessionsService, movementsService, service };
  };

  describe('assertStandaloneCodInvoiceCashSession (gate at invoice time)', () => {
    const gate = (service: OrderFlowService) =>
      service.assertStandaloneCodInvoiceCashSession({
        storeId: STORE_ID,
        dispatchNoteId: NOTE_ID,
        userId: USER_ID,
      });

    it('COD balance off-route: demands the invoicer open drawer and says it collects', async () => {
      const { service, sessionsService } = build();
      await expect(gate(service)).resolves.toBe(true);
      expect(sessionsService.assertSessionForSales).toHaveBeenCalledWith(USER_ID);
    });

    it('without an open drawer the invoice is blocked with CASH_SESSION_REQUIRED_001', async () => {
      const { service, sessionsService } = build();
      sessionsService.assertSessionForSales.mockRejectedValue(
        new VendixHttpException(ErrorCodes.CASH_SESSION_REQUIRED_001),
      );
      await expect(gate(service)).rejects.toMatchObject({
        errorCode: 'CASH_SESSION_REQUIRED_001',
      });
    });

    it('remisión on a route planilla: route flow unchanged, no gate', async () => {
      const { service, sessionsService, prismaMock } = build({ routeStop: { id: 5 } });
      await expect(gate(service)).resolves.toBe(false);
      expect(sessionsService.assertSessionForSales).not.toHaveBeenCalled();
      expect(prismaMock.dispatch_route_stops.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { dispatch_note_id: NOTE_ID, status: { not: 'released' } },
        }),
      );
    });

    it('pure credit sale: stays in cartera, no gate', async () => {
      const { service, sessionsService } = build({ order: { payment_form: '2' } });
      await expect(gate(service)).resolves.toBe(false);
      expect(sessionsService.assertSessionForSales).not.toHaveBeenCalled();
    });

    it('contra entrega invoiced on credit (ON_DELIVERY promise) is collected: gate applies', async () => {
      const { service, sessionsService } = build({
        order: { payment_form: '2' },
        onDeliveryPayment: { id: 3 },
      });
      await expect(gate(service)).resolves.toBe(true);
      expect(sessionsService.assertSessionForSales).toHaveBeenCalledWith(USER_ID);
    });

    it('no balance left: nothing to collect, no gate', async () => {
      const { service, sessionsService } = build({ order: { remaining_balance: 0 } });
      await expect(gate(service)).resolves.toBe(false);
      expect(sessionsService.assertSessionForSales).not.toHaveBeenCalled();
    });
  });

  describe('applyDispatchCodPayment with the invoicer (cashUserId)', () => {
    const input = (extra: Record<string, unknown> = {}) => ({
      storeId: STORE_ID,
      dispatchNoteId: NOTE_ID,
      amount: 30000,
      correlationKey: `dispatch_note:${NOTE_ID}`,
      ...extra,
    });

    it('records a cash sale in the invoicer session, linked to the order and payment', async () => {
      const { service, prismaMock, movementsService } = build();
      await service.applyDispatchCodPayment(input({ cashUserId: USER_ID }));
      expect(prismaMock.cash_register_sessions.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { store_id: STORE_ID, status: 'open', opened_by: USER_ID },
        }),
      );
      expect(movementsService.recordSaleMovement).toHaveBeenCalledWith(
        SESSION_ID,
        {
          store_id: STORE_ID,
          user_id: USER_ID,
          amount: 30000,
          payment_method: 'cash',
          order_id: ORDER_ID,
          payment_id: PAYMENT_ID,
        },
        prismaMock,
      );
    });

    it('drawer closed since the invoice: the collection rolls back with CASH_SESSION_REQUIRED_001', async () => {
      const { service, movementsService } = build({ session: null });
      await expect(
        service.applyDispatchCodPayment(input({ cashUserId: USER_ID })),
      ).rejects.toMatchObject({ errorCode: 'CASH_SESSION_REQUIRED_001' });
      expect(movementsService.recordSaleMovement).not.toHaveBeenCalled();
    });

    it('cash register off: payment as before, no movement', async () => {
      const { service, prismaMock, movementsService } = build({ cashRegisterEnabled: false });
      await service.applyDispatchCodPayment(input({ cashUserId: USER_ID }));
      expect(prismaMock.payments.create).toHaveBeenCalled();
      expect(movementsService.recordSaleMovement).not.toHaveBeenCalled();
    });

    it('route collection (stopId) never books into a drawer here: planilla close does', async () => {
      const { service, movementsService, prismaMock } = build();
      await service.applyDispatchCodPayment(
        input({ stopId: 5, correlationKey: 'dispatch_route_stop:5' }),
      );
      expect(prismaMock.payments.create).toHaveBeenCalled();
      expect(movementsService.recordSaleMovement).not.toHaveBeenCalled();
    });
  });
});
