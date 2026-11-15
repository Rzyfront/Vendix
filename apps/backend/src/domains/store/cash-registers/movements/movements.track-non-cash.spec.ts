import { MovementsService } from './movements.service';

/**
 * QUI-893 — `pos.cash_register.track_non_cash_payments` ("Registrar Pagos No
 * Efectivo"). Off: card / transfer rows are not written in the session, which
 * only reflects cash. Cash is always recorded; absent flag = default `true`.
 */
describe('MovementsService — track_non_cash_payments', () => {
  const STORE_ID = 10;
  const USER_ID = 7;

  const makeDb = (track: boolean | undefined) => ({
    store_settings: {
      findUnique: jest.fn().mockResolvedValue({
        settings: {
          pos: {
            cash_register: {
              enabled: true,
              ...(track === undefined ? {} : { track_non_cash_payments: track }),
            },
          },
        },
      }),
    },
    cash_register_sessions: {
      findFirst: jest.fn().mockResolvedValue({ id: 200 }),
    },
    $queryRaw: jest.fn().mockResolvedValue([{ id: 200 }]),
    orders: {
      findFirst: jest.fn().mockResolvedValue({ id: 91, state: 'finished' }),
    },
    accounting_entry_failures: {
      findFirst: jest.fn().mockResolvedValue({
        id: 5,
        event_payload: { session_id: 200, ready_state: 'finished', payment_ids: [1, 2] },
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    cash_register_movements: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(async ({ data }: any) => ({ id: 900, ...data })),
    },
  });

  const service = new MovementsService({} as any, { emit: jest.fn() } as any);

  const sale = (payment_method: string) => ({
    store_id: STORE_ID,
    user_id: USER_ID,
    amount: 20000,
    payment_method,
    order_id: 91,
    payment_id: 92,
  });

  describe('recordSaleMovement', () => {
    it('off: a card sale writes no row', async () => {
      const db = makeDb(false);
      const res = await service.recordSaleMovement(200, sale('card'), db as any);
      expect(res).toBeNull();
      expect(db.cash_register_movements.create).not.toHaveBeenCalled();
    });

    it('off: a cash sale is still recorded', async () => {
      const db = makeDb(false);
      await service.recordSaleMovement(200, sale('cash'), db as any);
      expect(db.cash_register_movements.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ type: 'sale', payment_method: 'cash' }),
      });
    });

    it.each([[true], [undefined]])(
      'flag %p: a transfer sale is recorded (previous behavior)',
      async (track) => {
        const db = makeDb(track);
        await service.recordSaleMovement(200, sale('bank_transfer'), db as any);
        expect(db.cash_register_movements.create).toHaveBeenCalledWith({
          data: expect.objectContaining({ type: 'sale', payment_method: 'bank_transfer' }),
        });
      },
    );
  });

  describe('recordModuleCashMovement (include_non_cash)', () => {
    const base = {
      store_id: STORE_ID,
      user_id: USER_ID,
      direction: 'in' as const,
      amount: 50000,
      source_type: 'wallet_topup',
      source_id: 33,
      include_non_cash: true,
    };

    it('off: a transfer top-up writes no row', async () => {
      const db = makeDb(false);
      const res = await service.recordModuleCashMovement(db as any, {
        ...base,
        payment_method: 'bank_transfer',
      });
      expect(res).toBeNull();
      expect(db.cash_register_movements.create).not.toHaveBeenCalled();
    });

    it('off: cash is still recorded as cash_in', async () => {
      const db = makeDb(false);
      await service.recordModuleCashMovement(db as any, { ...base, payment_method: 'cash' });
      expect(db.cash_register_movements.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ type: 'cash_in', payment_method: 'cash' }),
      });
    });

    it('on: a transfer top-up keeps its informative sale row', async () => {
      const db = makeDb(true);
      await service.recordModuleCashMovement(db as any, {
        ...base,
        payment_method: 'bank_transfer',
      });
      expect(db.cash_register_movements.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ type: 'sale', payment_method: 'bank_transfer' }),
      });
    });
  });

  describe('completeDeferredSaleCashMovement', () => {
    const input = {
      store_id: STORE_ID,
      user_id: USER_ID,
      session_id: 200,
      order_id: 91,
      failure_id: 5,
      ready_state: 'finished',
      movements: [
        { amount: 10000, payment_method: 'cash', payment_id: 1 },
        { amount: 20000, payment_method: 'card', payment_id: 2 },
      ],
    };

    it('off: only the cash leg is written and the signal is resolved', async () => {
      const db = makeDb(false);
      await service.completeDeferredSaleCashMovement(db as any, input as any);
      expect(db.cash_register_movements.create).toHaveBeenCalledTimes(1);
      expect(db.cash_register_movements.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ payment_method: 'cash', payment_id: 1 }),
      });
      expect(db.accounting_entry_failures.update).toHaveBeenCalled();
    });

    it('on: both legs are written', async () => {
      const db = makeDb(true);
      await service.completeDeferredSaleCashMovement(db as any, input as any);
      expect(db.cash_register_movements.create).toHaveBeenCalledTimes(2);
    });
  });
});
