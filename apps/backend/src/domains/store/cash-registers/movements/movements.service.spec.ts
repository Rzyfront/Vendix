import {
  MovementsService,
  ORDER_CANCELLED_MOVEMENT_REFERENCE,
  REFUND_CASH_MOVEMENT_KEY,
  RefundCashMovementPayload,
} from './movements.service';

/**
 * T2 — compensación de caja robusta: cascada de `resolveCompensationSessionId`,
 * entrega de la cola a sesión de otro usuario del mismo registro y movimiento
 * idempotente para reembolsos no efectivo.
 */
describe('MovementsService — compensación de caja', () => {
  const STORE_ID = 10;
  const OPERATOR = 7;
  const OTHER_USER = 8;
  const REGISTER_ID = 5;

  type Db = {
    cash_register_movements: { findFirst: jest.Mock; create: jest.Mock };
    cash_register_sessions: { findFirst: jest.Mock };
  };

  /** Fake de sesiones: devuelve la primera que cumple el `where`. */
  const makeDb = (
    sessions: Array<{
      id: number;
      status: string;
      cash_register_id: number;
      opened_by: number;
    }>,
    sales: Array<{ session_id: number; payment_id: number | null; order_id: number }>,
  ): Db => ({
    cash_register_movements: {
      findFirst: jest.fn(async ({ where }: any) => {
        if (where.type === 'sale') {
          return (
            sales.find(
              (m) =>
                (where.payment_id === undefined ||
                  m.payment_id === where.payment_id) &&
                (where.order_id === undefined || m.order_id === where.order_id),
            ) ?? null
          );
        }
        return null;
      }),
      create: jest.fn(async () => ({ id: 901 })),
    },
    cash_register_sessions: {
      findFirst: jest.fn(async ({ where }: any) => {
        const hit = sessions.find(
          (s) =>
            (where.id === undefined || s.id === where.id) &&
            (where.status === undefined || s.status === where.status) &&
            (where.opened_by === undefined || s.opened_by === where.opened_by) &&
            (where.cash_register_id === undefined ||
              s.cash_register_id === where.cash_register_id),
        );
        return hit ?? null;
      }),
    },
  });

  const makeService = (db: Db, extra: Record<string, any> = {}) => {
    const unscoped = { ...db, ...extra };
    const prisma = { withoutScope: jest.fn().mockReturnValue(unscoped) };
    const service = new MovementsService(prisma as any, { emit: jest.fn() } as any);
    return { service, unscoped };
  };

  it('exporta la constante de referencia de cancelación de orden', () => {
    expect(ORDER_CANCELLED_MOVEMENT_REFERENCE).toBe('order_cancelled');
  });

  describe('resolveCompensationSessionId', () => {
    const sale = { session_id: 100, payment_id: 55, order_id: 9 };

    it('a) devuelve la sesión de la venta original si sigue abierta', async () => {
      const db = makeDb(
        [
          { id: 100, status: 'open', cash_register_id: REGISTER_ID, opened_by: OTHER_USER },
          { id: 200, status: 'open', cash_register_id: REGISTER_ID, opened_by: OPERATOR },
        ],
        [sale],
      );
      const { service } = makeService(db);
      await expect(
        service.resolveCompensationSessionId({
          store_id: STORE_ID, user_id: OPERATOR, payment_id: 55, order_id: 9,
        }),
      ).resolves.toBe(100);
    });

    it('sin payment_id resuelve la venta original por order_id', async () => {
      const db = makeDb(
        [{ id: 100, status: 'open', cash_register_id: REGISTER_ID, opened_by: OTHER_USER }],
        [sale],
      );
      const { service } = makeService(db);
      await expect(
        service.resolveCompensationSessionId({
          store_id: STORE_ID, user_id: OPERATOR, order_id: 9,
        }),
      ).resolves.toBe(100);
    });

    it('b) si la original está cerrada, usa la sesión abierta del operador', async () => {
      const db = makeDb(
        [
          { id: 100, status: 'closed', cash_register_id: REGISTER_ID, opened_by: OTHER_USER },
          { id: 200, status: 'open', cash_register_id: 99, opened_by: OPERATOR },
          { id: 300, status: 'open', cash_register_id: REGISTER_ID, opened_by: 12 },
        ],
        [sale],
      );
      const { service } = makeService(db);
      await expect(
        service.resolveCompensationSessionId({
          store_id: STORE_ID, user_id: OPERATOR, payment_id: 55, order_id: 9,
        }),
      ).resolves.toBe(200);
    });

    it('c) sin sesión del operador, usa otra abierta del mismo cash_register_id', async () => {
      const db = makeDb(
        [
          { id: 100, status: 'closed', cash_register_id: REGISTER_ID, opened_by: OTHER_USER },
          { id: 400, status: 'open', cash_register_id: 99, opened_by: 12 },
          { id: 300, status: 'open', cash_register_id: REGISTER_ID, opened_by: 12 },
        ],
        [sale],
      );
      const { service } = makeService(db);
      await expect(
        service.resolveCompensationSessionId({
          store_id: STORE_ID, user_id: OPERATOR, payment_id: 55, order_id: 9,
        }),
      ).resolves.toBe(300);
    });

    it('d) sin ninguna candidata devuelve null (el llamador encola)', async () => {
      const db = makeDb(
        [
          { id: 100, status: 'closed', cash_register_id: REGISTER_ID, opened_by: OTHER_USER },
          { id: 400, status: 'open', cash_register_id: 99, opened_by: 12 },
        ],
        [sale],
      );
      const { service } = makeService(db);
      await expect(
        service.resolveCompensationSessionId({
          store_id: STORE_ID, user_id: OPERATOR, payment_id: 55, order_id: 9,
        }),
      ).resolves.toBeNull();
    });

    it('sin venta original ni sesión del operador: null (no inventa registro)', async () => {
      const db = makeDb(
        [{ id: 400, status: 'open', cash_register_id: 99, opened_by: 12 }],
        [],
      );
      const { service } = makeService(db);
      await expect(
        service.resolveCompensationSessionId({
          store_id: STORE_ID, user_id: OPERATOR, payment_id: 1, order_id: 2,
        }),
      ).resolves.toBeNull();
    });

    it('usa el tx recibido en vez del cliente sin scope', async () => {
      const dbTx = makeDb(
        [{ id: 100, status: 'open', cash_register_id: REGISTER_ID, opened_by: OPERATOR }],
        [],
      );
      const { service, unscoped } = makeService(
        makeDb([], []),
      );
      await expect(
        service.resolveCompensationSessionId(
          { store_id: STORE_ID, user_id: OPERATOR },
          dbTx as any,
        ),
      ).resolves.toBe(100);
      expect(unscoped.cash_register_sessions.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('deliverRefundCashMovement — cola pendiente', () => {
    const FAILURE_ID = 555;
    const payload: RefundCashMovementPayload = {
      version: 1,
      refund_id: 900,
      order_id: 9,
      store_id: STORE_ID,
      organization_id: 3,
      user_id: OPERATOR,
      payment_id: 55,
      amount: 15000,
      channel: 'cash',
    };

    it('entrega a una sesión abierta del mismo registro aunque sea de OTRO usuario', async () => {
      const db = makeDb(
        [
          { id: 100, status: 'closed', cash_register_id: REGISTER_ID, opened_by: OTHER_USER },
          { id: 300, status: 'open', cash_register_id: REGISTER_ID, opened_by: 12 },
        ],
        [{ session_id: 100, payment_id: 55, order_id: 9 }],
      );
      const tx = {
        ...db,
        $queryRaw: jest.fn().mockResolvedValue([{ id: FAILURE_ID }]),
        accounting_entry_failures: {
          findFirst: jest.fn().mockResolvedValue({
            id: FAILURE_ID,
            handler_key: REFUND_CASH_MOVEMENT_KEY,
            source_id: payload.refund_id,
            organization_id: payload.organization_id,
            store_id: STORE_ID,
            resolved_at: null,
            event_payload: payload,
          }),
          update: jest.fn().mockResolvedValue({}),
        },
      };
      const { service } = makeService(db, {
        $transaction: jest.fn((cb: any) => cb(tx)),
        accounting_entry_failures: { update: jest.fn() },
      });

      await expect(
        service.deliverRefundCashMovement(FAILURE_ID),
      ).resolves.toBeUndefined();

      expect(tx.cash_register_movements.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          session_id: 300,
          type: 'refund',
          payment_method: 'cash',
          reference: 'refund:900',
        }),
      });
      expect(tx.accounting_entry_failures.update).toHaveBeenCalledWith({
        where: { id: FAILURE_ID },
        data: expect.objectContaining({ resolved_at: expect.any(Date) }),
      });
    });
  });

  describe('recordNonCashRefundMovement', () => {
    const input = {
      store_id: STORE_ID,
      user_id: OPERATOR,
      refund_id: 77,
      order_id: 9,
      payment_id: 55,
      amount: 5000,
      payment_method: 'bank_transfer',
    };
    const openSessions = [
      { id: 200, status: 'open', cash_register_id: REGISTER_ID, opened_by: OPERATOR },
    ];

    it('registra un refund con el método real, payment_id y reference refund:<id>, sin emitir evento contable', async () => {
      const db = makeDb(openSessions, []);
      const emit = jest.fn();
      const prisma = { withoutScope: jest.fn().mockReturnValue(db) };
      const service = new MovementsService(prisma as any, { emit } as any);

      const out = await service.recordNonCashRefundMovement(input);

      expect(out).toEqual({ status: 'recorded', movement_id: 901 });
      expect(db.cash_register_movements.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          session_id: 200,
          type: 'refund',
          payment_method: 'bank_transfer',
          payment_id: 55,
          order_id: 9,
          reference: 'refund:77',
        }),
      });
      expect(emit).not.toHaveBeenCalled();
    });

    it('es idempotente: si ya existe el movimiento no crea otro', async () => {
      const db = makeDb(openSessions, []);
      db.cash_register_movements.findFirst.mockImplementation(async ({ where }: any) =>
        where.type === 'refund' ? { id: 444 } : null,
      );
      const { service } = makeService(db);

      const out = await service.recordNonCashRefundMovement(input);

      expect(out).toEqual({ status: 'exists', movement_id: 444 });
      expect(db.cash_register_movements.create).not.toHaveBeenCalled();
    });

    it('sin sesión destino devuelve skipped y no encola ni crea nada', async () => {
      const db = makeDb([], []);
      const failures = { create: jest.fn(), findFirst: jest.fn() };
      const { service } = makeService(db, { accounting_entry_failures: failures });

      const out = await service.recordNonCashRefundMovement(input);

      expect(out).toEqual({ status: 'skipped', reason: 'no_open_cash_session' });
      expect(db.cash_register_movements.create).not.toHaveBeenCalled();
      expect(failures.create).not.toHaveBeenCalled();
    });
  });
  describe('recordCompensationCashMovementDurable', () => {
    const input = {
      store_id: STORE_ID,
      user_id: OPERATOR,
      order_id: 9,
      payment_id: 55,
      amount: 5000,
      reference: 'order_cancelled',
      dedupe_key: 'order_cancelled:9:55',
    };
    const stores = { findUnique: jest.fn().mockResolvedValue({ organization_id: 3 }) };

    it('con sesión: escribe refund/cash con reference y payment_id, sin emitir evento contable', async () => {
      const db = makeDb(
        [{ id: 200, status: 'open', cash_register_id: REGISTER_ID, opened_by: OPERATOR }],
        [],
      );
      const emit = jest.fn();
      const prisma = { withoutScope: jest.fn().mockReturnValue({ ...db, stores }) };
      const service = new MovementsService(prisma as any, { emit } as any);

      const out = await service.recordCompensationCashMovementDurable(input);

      expect(out).toEqual({ status: 'recorded', movement_id: 901 });
      expect(db.cash_register_movements.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          session_id: 200,
          type: 'refund',
          payment_method: 'cash',
          payment_id: 55,
          order_id: 9,
          reference: 'order_cancelled',
        }),
      });
      expect(emit).not.toHaveBeenCalled();
    });

    it('sin sesión del operador pero con la sesión original abierta: cae en la original', async () => {
      const db = makeDb(
        [{ id: 100, status: 'open', cash_register_id: REGISTER_ID, opened_by: OTHER_USER }],
        [{ session_id: 100, payment_id: 55, order_id: 9 }],
      );
      const { service } = makeService(db, { stores });

      await service.recordCompensationCashMovementDurable(input);

      expect(db.cash_register_movements.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ session_id: 100 }),
      });
    });

    it('es idempotente por (reference, payment_id, order_id)', async () => {
      const db = makeDb([], []);
      db.cash_register_movements.findFirst.mockImplementation(async ({ where }: any) =>
        where.type === 'refund' ? { id: 444 } : null,
      );
      const { service } = makeService(db, { stores });

      const out = await service.recordCompensationCashMovementDurable(input);

      expect(out).toEqual({ status: 'exists', movement_id: 444 });
      expect(db.cash_register_movements.create).not.toHaveBeenCalled();
    });

    it('sin ninguna sesión: encola en el outbox con dedupe_key y payload completo', async () => {
      const db = makeDb([], []);
      const failures = {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 77 }),
        update: jest.fn(),
      };
      const { service } = makeService(db, { stores, accounting_entry_failures: failures });

      const out = await service.recordCompensationCashMovementDurable(input);

      expect(out).toEqual({ status: 'pending', failure_id: 77, reason: 'no_open_cash_session' });
      expect(db.cash_register_movements.create).not.toHaveBeenCalled();
      expect(failures.findFirst).toHaveBeenCalledWith({
        where: expect.objectContaining({
          handler_key: REFUND_CASH_MOVEMENT_KEY,
          resolved_at: null,
          event_payload: { path: ['dedupe_key'], equals: 'order_cancelled:9:55' },
        }),
        select: { id: true },
      });
      expect(failures.create.mock.calls[0][0].data).toMatchObject({
        organization_id: 3,
        handler_key: REFUND_CASH_MOVEMENT_KEY,
        source_id: 55,
        event_payload: expect.objectContaining({
          reference: 'order_cancelled',
          dedupe_key: 'order_cancelled:9:55',
          payment_id: 55,
          payment_method: 'cash',
        }),
      });
    });

    it('reencolar el mismo dedupe_key reutiliza la fila abierta (sin duplicar)', async () => {
      const db = makeDb([], []);
      const failures = {
        findFirst: jest.fn().mockResolvedValue({ id: 77 }),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      };
      const { service } = makeService(db, { stores, accounting_entry_failures: failures });

      const out = await service.recordCompensationCashMovementDurable(input);

      expect(out).toMatchObject({ status: 'pending', failure_id: 77 });
      expect(failures.create).not.toHaveBeenCalled();
      expect(failures.update).toHaveBeenCalled();
    });

    it('la entrega del outbox escribe el movimiento con la reference y notas del payload (y sigue entregando los payloads viejos)', async () => {
      const payload: RefundCashMovementPayload = {
        version: 1,
        refund_id: 0,
        order_id: 9,
        store_id: STORE_ID,
        organization_id: 3,
        user_id: OPERATOR,
        payment_id: 55,
        amount: 5000,
        channel: 'cash',
        payment_method: 'cash',
        reference: 'order_cancelled',
        dedupe_key: 'order_cancelled:9:55',
        notes: 'nota',
      };
      const db = makeDb(
        [{ id: 300, status: 'open', cash_register_id: REGISTER_ID, opened_by: OPERATOR }],
        [],
      );
      const tx = {
        ...db,
        $queryRaw: jest.fn().mockResolvedValue([{ id: 5 }]),
        accounting_entry_failures: {
          findFirst: jest.fn().mockResolvedValue({
            id: 5,
            handler_key: REFUND_CASH_MOVEMENT_KEY,
            source_id: 55,
            organization_id: 3,
            store_id: STORE_ID,
            resolved_at: null,
            event_payload: payload,
          }),
          update: jest.fn().mockResolvedValue({}),
        },
      };
      const { service } = makeService(db, {
        $transaction: jest.fn((cb: any) => cb(tx)),
        accounting_entry_failures: { update: jest.fn() },
      });

      await service.deliverRefundCashMovement(5);

      expect(tx.cash_register_movements.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          session_id: 300,
          type: 'refund',
          reference: 'order_cancelled',
          payment_id: 55,
          notes: 'nota',
        }),
      });
    });
  });
});
