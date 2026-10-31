import { CashSettlementService } from './cash-settlement.service';

describe('CashSettlementService.emitPaymentReceived — close-session lock', () => {
  const STORE_ID = 12;
  const USER_ID = 7;
  const SESSION_ID = 44;

  const createHarness = (lockedSession: Array<{ id: number }>) => {
    let inTransaction = false;
    const tx = {
      stores: { findUnique: jest.fn().mockResolvedValue({ organization_id: 3 }) },
      cash_register_sessions: {
        findFirst: jest.fn().mockResolvedValue({ id: SESSION_ID }),
      },
      $queryRaw: jest.fn().mockResolvedValue(lockedSession),
      cash_register_movements: {
        create: jest.fn().mockResolvedValue({
          id: 91,
          reference: 'dispatch_route:3:stop:5',
          notes: 'Recaudo ruta #3 parada #5',
        }),
      },
    };
    const prisma = {
      stores: { findUnique: jest.fn() },
      // Default: the stop's order is COD (payment_form '1').
      dispatch_notes: {
        findFirst: jest.fn().mockResolvedValue({ order: { payment_form: '1' } }),
      },
      cash_register_sessions: {
        findFirst: jest.fn().mockResolvedValue({ id: SESSION_ID }),
      },
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => {
        inTransaction = true;
        try {
          return await callback(tx);
        } finally {
          inTransaction = false;
        }
      }),
    };
    const emitted: Array<{ event: string; inTransaction: boolean }> = [];
    const eventEmitter = {
      emit: jest.fn((event: string) => emitted.push({ event, inTransaction })),
    };
    const sessions = { assertSessionForSales: jest.fn() };
    const service = new CashSettlementService(
      prisma as any,
      eventEmitter as any,
      sessions as any,
    );
    const input = {
      store_id: STORE_ID,
      organization_id: 3,
      route_id: 3,
      stop_id: 5,
      dispatch_note_id: 6,
      customer_id: 8,
      sales_order_id: null,
      amount: 18000,
      payment_method: 'cash',
      user_id: USER_ID,
    };
    return { service, tx, prisma, eventEmitter, emitted, input, sessions };
  };

  it('D8: emitPaymentReceived never records a cash movement; it only emits payment.received', async () => {
    const { service, tx, eventEmitter, emitted, input } = createHarness([
      { id: SESSION_ID },
    ]);

    await service.emitPaymentReceived(input);

    expect(tx.cash_register_movements.create).not.toHaveBeenCalled();
    expect(emitted).toEqual([
      { event: 'payment.received', inTransaction: false },
    ]);
    expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
  });

  it('credit order (payment_form 2): payment.received is flagged credit_order_collection so accounting does not book a second entry', async () => {
    const { service, prisma, eventEmitter, input } = createHarness([{ id: SESSION_ID }]);
    prisma.dispatch_notes.findFirst.mockResolvedValue({ order: { payment_form: '2' } });

    await service.emitPaymentReceived(input);

    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'payment.received',
      expect.objectContaining({ source_type: 'dispatch_route', credit_order_collection: true }),
    );
  });

  it('COD: payment.received payload carries no credit_order_collection flag (unchanged)', async () => {
    const { service, eventEmitter, input } = createHarness([{ id: SESSION_ID }]);

    await service.emitPaymentReceived(input);

    const payload = (eventEmitter.emit.mock.calls[0] as unknown[])[1];
    expect(payload).not.toHaveProperty('credit_order_collection');
  });

  it('COD order: resolved order id goes in accounting_order_id (order_id stays null) and W is normalised with subtotal = C + W', async () => {
    const { service, prisma, eventEmitter, input } = createHarness([{ id: SESSION_ID }]);
    prisma.dispatch_notes.findFirst.mockResolvedValue({ order: { id: 321, payment_form: '1' } });

    await service.emitPaymentReceived({
      ...input,
      withholding_breakdown: { retefuente: 15, reteiva: 5 },
    } as any);

    const payload = (eventEmitter.emit.mock.calls[0] as unknown[])[1] as any;
    expect(payload.order_id).toBeNull();
    expect(payload.accounting_order_id).toBe(321);
    expect(payload.subtotal_amount).toBe(18020);
    expect(payload.withholding_breakdown).toEqual([
      expect.objectContaining({
        code: 'retefuente', amount: 15, withholding_type: 'retefuente',
        account_role: 'withholding.suffered.retefuente_receivable', role: 'suffered',
      }),
      expect.objectContaining({ code: 'reteiva', amount: 5, withholding_type: 'reteiva' }),
    ]);
  });

  it('fails closed when the close lock is lost while recording COD in the stop transaction', async () => {
    const { service, tx, input } = createHarness([]);
    await expect(service.recordCashMovement(tx, input)).rejects.toMatchObject({
      errorCode: 'CASH_SESSION_REQUIRED_001',
    });
    expect(tx.cash_register_movements.create).not.toHaveBeenCalled();
  });
});

describe('CashSettlementService — cierre de planilla contra caja', () => {
  const build = () => {
    const tx = {
      cash_register_movements: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockImplementation(async ({ data }: any) => ({ id: 1, ...data })),
      },
    };
    const eventEmitter = { emit: jest.fn() };
    const sessions = { assertSessionForSales: jest.fn() };
    const service = new CashSettlementService(
      {} as any,
      eventEmitter as any,
      sessions as any,
    );
    return { service, tx, eventEmitter, sessions };
  };
  const stop = (id: number, o: any = {}) => ({
    id,
    result: 'delivered',
    is_prepaid: false,
    payment_method: 'cash',
    collected_amount: 100,
    anticipo_amount: 0,
    ...o,
  });
  const base = {
    store_id: 12,
    route_id: 3,
    route_number: 'PLN1',
    session_id: 44,
    responsible_user_id: 33,
  };

  it('crea un movimiento sale por método real, solo con collected_amount (sin anticipo) y con origen dispatch_route', async () => {
    const { service, tx, eventEmitter } = build();
    const res = await service.recordRouteCloseMovements(tx, {
      ...base,
      stops: [
        stop(1),
        stop(2, { collected_amount: 50 }),
        stop(3, { payment_method: 'transfer', collected_amount: 70, anticipo_amount: 5 }),
        // Anticipo con tarjeta y nada cobrado en ruta: no entra al cajón.
        stop(7, { payment_method: 'card', collected_amount: 0, anticipo_amount: 200 }),
        stop(4, { is_prepaid: true }),
        stop(5, { result: 'rejected' }),
        stop(6, { collected_amount: 0 }),
      ],
    });
    expect(res).toHaveLength(2);
    expect(tx.cash_register_movements.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        session_id: 44,
        store_id: 12,
        user_id: 33,
        type: 'sale',
        amount: 150,
        payment_method: 'cash',
        reference: 'dispatch_route:3:close:cash',
        notes: 'Recaudo ruta PLN1 (2 paradas)',
        source_type: 'dispatch_route',
        source_id: 3,
      }),
    });
    expect(tx.cash_register_movements.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amount: 70,
        payment_method: 'transfer',
        reference: 'dispatch_route:3:close:transfer',
        source_type: 'dispatch_route_transfer',
        source_id: 3,
      }),
    });
    expect(tx.cash_register_movements.create).toHaveBeenCalledTimes(2);
    // No `cash_register.movement` (el listener trataria un `sale` como retiro).
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });

  it('B20: cobro sin método no se asume efectivo: PAY_METHOD_MISCONFIGURED y no crea nada', async () => {
    const { service, tx } = build();
    await expect(
      service.recordRouteCloseMovements(tx, {
        ...base,
        stops: [stop(1), stop(2, { payment_method: null, collected_amount: 50 })],
      }),
    ).rejects.toMatchObject({ errorCode: 'PAY_METHOD_MISCONFIGURED' });
    expect(tx.cash_register_movements.create).not.toHaveBeenCalled();
  });

  it('B08: un método de pasarela (wompi) no mueve el cajón', async () => {
    const { service, tx } = build();
    const res = await service.recordRouteCloseMovements(tx, {
      ...base,
      stops: [stop(1, { payment_method: 'wompi', collected_amount: 80 })],
    });
    expect(res).toEqual([]);
    expect(tx.cash_register_movements.create).not.toHaveBeenCalled();
  });

  it('excluye paradas con movimiento legado por parada', async () => {
    const { service, tx } = build();
    tx.cash_register_movements.findMany.mockResolvedValue([
      { reference: 'dispatch_route:3:stop:1' },
    ]);
    await service.recordRouteCloseMovements(tx, {
      ...base,
      stops: [stop(1), stop(2, { collected_amount: 40 })],
    });
    expect(tx.cash_register_movements.create).toHaveBeenCalledTimes(1);
    expect(tx.cash_register_movements.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ amount: 40 }),
    });
  });

  it('es idempotente: no recrea un movimiento con la misma reference', async () => {
    const { service, tx } = build();
    tx.cash_register_movements.findFirst.mockResolvedValue({ id: 9 });
    const res = await service.recordRouteCloseMovements(tx, {
      ...base,
      stops: [stop(1)],
    });
    expect(res).toEqual([]);
    expect(tx.cash_register_movements.create).not.toHaveBeenCalled();
  });

  it('isCashRegisterRequired refleja pos.cash_register.enabled via assertSessionForSales', async () => {
    const { service, sessions } = build();
    expect(await service.isCashRegisterRequired()).toBe(false);
    const { VendixHttpException, ErrorCodes } = require('@common/errors');
    sessions.assertSessionForSales.mockRejectedValue(
      new VendixHttpException(ErrorCodes.CASH_SESSION_REQUIRED_001),
    );
    expect(await service.isCashRegisterRequired()).toBe(true);
    sessions.assertSessionForSales.mockRejectedValue(new Error('boom'));
    await expect(service.isCashRegisterRequired()).rejects.toThrow('boom');
  });
});
