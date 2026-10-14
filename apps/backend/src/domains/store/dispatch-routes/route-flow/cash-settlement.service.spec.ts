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
          notes: 'Recaudo planilla #3 parada #5',
        }),
      },
    };
    const prisma = {
      stores: { findUnique: jest.fn() },
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

  it('locks the active session before inserting and emits accounting events after commit', async () => {
    const { service, tx, eventEmitter, emitted, input } = createHarness([
      { id: SESSION_ID },
    ]);

    await service.emitPaymentReceived(input);

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.cash_register_movements.create.mock.invocationCallOrder[0],
    );
    expect(tx.cash_register_movements.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        session_id: SESSION_ID,
        store_id: STORE_ID,
        user_id: USER_ID,
        type: 'sale',
      }),
    });
    expect(emitted).toEqual([
      { event: 'cash_register.movement', inTransaction: false },
      { event: 'payment.received', inTransaction: false },
    ]);
    expect(eventEmitter.emit).toHaveBeenCalledTimes(2);
  });

  it('does not create a cash movement if the session closes before its lock', async () => {
    const { service, tx, emitted, input } = createHarness([]);

    await service.emitPaymentReceived(input);

    expect(tx.cash_register_movements.create).not.toHaveBeenCalled();
    expect(emitted).toEqual([
      { event: 'payment.received', inTransaction: false },
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
