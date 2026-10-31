import {
  CASH_MOVEMENT_DELIVERY_SCOPE,
  DEFERRED_SALE_CASH_MOVEMENT_KEY,
  DEFERRED_SALE_CASH_MOVEMENT_SOURCE,
  MovementsService,
  ORDER_CANCELLED_MOVEMENT_REFERENCE,
  REFUND_CASH_MOVEMENT_KEY,
  RefundCashMovementPayload,
} from './movements.service';
import { RequestContextService } from '@common/context/request-context.service';

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
    $queryRaw: jest.Mock;
    cash_register_movements: { findFirst: jest.Mock; create: jest.Mock };
    cash_register_sessions: { findFirst: jest.Mock };
    accounting_entry_failures: { findFirst: jest.Mock; update: jest.Mock };
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
    $queryRaw: jest.fn().mockResolvedValue([{ id: 200 }]),
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
    accounting_entry_failures: {
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
    },
  });

  const makeService = (
    db: Db,
    extra: Record<string, any> = {},
    eventEmitter: { emit: jest.Mock } = { emit: jest.fn() },
  ) => {
    const unscoped = { ...db, ...extra };
    const prisma = {
      withoutScope: jest.fn().mockReturnValue(unscoped),
      $transaction: jest.fn((cb: any) => cb(unscoped)),
      stores: { findUnique: jest.fn().mockResolvedValue({ organization_id: 3 }) },
    };
    const service = new MovementsService(prisma as any, eventEmitter as any);
    return { service, unscoped, prisma, eventEmitter };
  };

  describe('shared cash-session close lock', () => {
    const input = {
      store_id: STORE_ID,
      user_id: OPERATOR,
      amount: 1250,
      payment_method: 'cash',
      order_id: 91,
      payment_id: 92,
    };
    const saleInput = {
      store_id: STORE_ID,
      user_id: OPERATOR,
      amount: 18000,
      payment_method: 'cash',
      order_id: 91,
      payment_id: 92,
    };

    it('manual movement locks the open store session before insert and emits after commit', async () => {
      const db = makeDb(
        [{ id: 200, status: 'open', cash_register_id: REGISTER_ID, opened_by: OPERATOR }],
        [],
      );
      const emit = jest.fn();
      const { service, unscoped } = makeService(db, {}, { emit });
      const contextSpy = jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
        store_id: STORE_ID,
        user_id: OPERATOR,
      } as any);

      await service.createManualMovement(200, { type: 'cash_in', amount: 1250 });

      expect(db.$queryRaw).toHaveBeenCalledTimes(1);
      expect(db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        db.cash_register_movements.create.mock.invocationCallOrder[0],
      );
      expect(unscoped.cash_register_movements.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ session_id: 200, store_id: STORE_ID, type: 'cash_in' }),
      });
      expect(emit).toHaveBeenCalledWith('cash_register.movement', expect.any(Object));
      contextSpy.mockRestore();
    });

    it('manual movement aborts if the session is no longer open', async () => {
      const db = makeDb(
        [{ id: 200, status: 'closed', cash_register_id: REGISTER_ID, opened_by: OPERATOR }],
        [],
      );
      db.$queryRaw.mockResolvedValue([]);
      const { service } = makeService(db);
      const contextSpy = jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
        store_id: STORE_ID,
        user_id: OPERATOR,
      } as any);

      await expect(
        service.createManualMovement(200, { type: 'cash_in', amount: 1250 }),
      ).rejects.toThrow('La sesión de caja ya no está abierta');
      expect(db.cash_register_movements.create).not.toHaveBeenCalled();
      contextSpy.mockRestore();
    });

    it('recordRefundMovement opens its own transaction when no tx is supplied', async () => {
      const db = makeDb(
        [{ id: 200, status: 'open', cash_register_id: REGISTER_ID, opened_by: OPERATOR }],
        [],
      );
      const { service, unscoped } = makeService(db);

      await service.recordRefundMovement(200, input);

      expect((service as any).prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(db.$queryRaw).toHaveBeenCalledTimes(1);
      expect(db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        db.cash_register_movements.create.mock.invocationCallOrder[0],
      );
      expect(unscoped.cash_register_movements.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ session_id: 200, store_id: STORE_ID, type: 'refund' }),
      });
    });

    it('recordSaleMovement opens its own transaction and locks before insert', async () => {
      const db = makeDb(
        [{ id: 200, status: 'open', cash_register_id: REGISTER_ID, opened_by: OPERATOR }],
        [],
      );
      const { service, prisma } = makeService(db);

      await service.recordSaleMovement(200, saleInput);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        db.cash_register_movements.create.mock.invocationCallOrder[0],
      );
      expect(db.cash_register_movements.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          session_id: 200,
          store_id: STORE_ID,
          type: 'sale',
          payment_id: 92,
        }),
      });
    });

    it('recordSaleMovement reuses the caller transaction', async () => {
      const db = makeDb(
        [{ id: 200, status: 'open', cash_register_id: REGISTER_ID, opened_by: OPERATOR }],
        [],
      );
      const { service, prisma } = makeService(db);

      await service.recordSaleMovement(200, saleInput, db as any);

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        db.cash_register_movements.create.mock.invocationCallOrder[0],
      );
    });

    it('recordRefundMovement reuses the caller transaction and locks within it', async () => {
      const db = makeDb(
        [{ id: 200, status: 'open', cash_register_id: REGISTER_ID, opened_by: OPERATOR }],
        [],
      );
      const { service } = makeService(db);

      await service.recordRefundMovement(200, input, db as any);

      expect((service as any).prisma.$transaction).not.toHaveBeenCalled();
      expect(db.$queryRaw).toHaveBeenCalledTimes(1);
      expect(db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        db.cash_register_movements.create.mock.invocationCallOrder[0],
      );
    });

    it('recordRefundMovement with caller tx aborts if the session is no longer open', async () => {
      const db = makeDb(
        [{ id: 200, status: 'closed', cash_register_id: REGISTER_ID, opened_by: OPERATOR }],
        [],
      );
      db.$queryRaw.mockResolvedValue([]);
      const { service } = makeService(db);

      await expect(service.recordRefundMovement(200, input, db as any)).rejects.toThrow(
        'La sesión de caja ya no está abierta',
      );
      expect(db.cash_register_movements.create).not.toHaveBeenCalled();
    });
  });

  describe('recordRefundMovement — idempotencia por reference (B15)', () => {
    const input = {
      store_id: STORE_ID,
      user_id: OPERATOR,
      amount: 1250,
      payment_method: 'cash',
      order_id: 91,
      payment_id: 92,
      reference: 'refund:55',
    };
    const open = [
      { id: 200, status: 'open', cash_register_id: REGISTER_ID, opened_by: OPERATOR },
    ];

    it('doble llamada con el mismo reference produce un solo movimiento', async () => {
      const db = makeDb(open, []);
      const stored: any[] = [];
      db.cash_register_movements.findFirst.mockImplementation(async ({ where }: any) =>
        stored.find(
          (m) =>
            m.store_id === where.store_id &&
            m.type === where.type &&
            m.reference === where.reference &&
            m.order_id === where.order_id &&
            m.payment_id === where.payment_id &&
            m.payment_method === where.payment_method,
        ) ?? null,
      );
      db.cash_register_movements.create.mockImplementation(async ({ data }: any) => {
        const row = { id: 900 + stored.length, ...data };
        stored.push(row);
        return row;
      });
      const { service } = makeService(db);

      const first = await service.recordRefundMovement(200, input);
      const second = await service.recordRefundMovement(200, input);

      expect(db.cash_register_movements.create).toHaveBeenCalledTimes(1);
      expect(second.id).toBe(first.id);
    });

    it('P2002 al crear se trata como "ya existe" y devuelve el movimiento previo', async () => {
      const db = makeDb(open, []);
      db.cash_register_movements.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 777 });
      db.cash_register_movements.create.mockRejectedValueOnce(
        Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
      );
      const { service } = makeService(db);

      const result = await service.recordRefundMovement(200, input);

      expect(result).toEqual({ id: 777 });
    });

    it('sin reference no busca duplicados', async () => {
      const db = makeDb(open, []);
      const { service } = makeService(db);

      await service.recordRefundMovement(200, { ...input, reference: undefined });

      expect(db.cash_register_movements.findFirst).not.toHaveBeenCalled();
      expect(db.cash_register_movements.create).toHaveBeenCalledTimes(1);
    });

    it('un error distinto de P2002 se propaga', async () => {
      const db = makeDb(open, []);
      db.cash_register_movements.create.mockRejectedValueOnce(new Error('boom'));
      const { service } = makeService(db);

      await expect(service.recordRefundMovement(200, input)).rejects.toThrow('boom');
    });
  });

  it('exporta la constante de referencia de cancelación de orden', () => {
    expect(ORDER_CANCELLED_MOVEMENT_REFERENCE).toBe('order_cancelled');
  });

  describe('resolveCompensationSessionId', () => {
    const sale = { session_id: 100, payment_id: 55, order_id: 9 };

    it('B03: el actor con sesión propia gana sobre la sesión abierta de la venta de otro cajero', async () => {
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
      ).resolves.toBe(200);
    });

    it('B03: el actor sin sesión NO cae en la venta abierta de otro cajero ni en otra de la misma caja (null → outbox)', async () => {
      const db = makeDb(
        [
          { id: 100, status: 'open', cash_register_id: REGISTER_ID, opened_by: OTHER_USER },
          { id: 300, status: 'open', cash_register_id: REGISTER_ID, opened_by: 12 },
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

    it('B03: si la sesión original es del mismo actor, es la del actor', async () => {
      const db = makeDb(
        [{ id: 100, status: 'open', cash_register_id: REGISTER_ID, opened_by: OPERATOR }],
        [sale],
      );
      const { service } = makeService(db);
      await expect(
        service.resolveCompensationSessionId({
          store_id: STORE_ID, user_id: OPERATOR, order_id: 9,
        }),
      ).resolves.toBe(100);
    });

    it('B02 (excepción S03): sale_session_first usa la sesión del sale aunque sea de otro usuario', async () => {
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
          sale_session_first: true,
        }),
      ).resolves.toBe(100);
    });

    it('B02: sale_session_first sin payment_id resuelve el sale por order_id', async () => {
      const db = makeDb(
        [{ id: 100, status: 'open', cash_register_id: REGISTER_ID, opened_by: OTHER_USER }],
        [sale],
      );
      const { service } = makeService(db);
      await expect(
        service.resolveCompensationSessionId({
          store_id: STORE_ID, user_id: OPERATOR, order_id: 9,
          sale_session_first: true,
        }),
      ).resolves.toBe(100);
    });

    it('b) si la original está cerrada, usa la sesión abierta del operador (con o sin sale_session_first)', async () => {
      const db = makeDb(
        [
          { id: 100, status: 'closed', cash_register_id: REGISTER_ID, opened_by: OTHER_USER },
          { id: 200, status: 'open', cash_register_id: 99, opened_by: OPERATOR },
          { id: 300, status: 'open', cash_register_id: REGISTER_ID, opened_by: 12 },
        ],
        [sale],
      );
      const { service } = makeService(db);
      for (const sale_session_first of [false, true]) {
        await expect(
          service.resolveCompensationSessionId({
            store_id: STORE_ID, user_id: OPERATOR, payment_id: 55, order_id: 9,
            sale_session_first,
          }),
        ).resolves.toBe(200);
      }
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

  describe('recordRefundCashMovementDurable — B03/B18', () => {
    const input = {
      organization_id: 3,
      store_id: STORE_ID,
      user_id: OPERATOR,
      refund_id: 900,
      order_id: 9,
      payment_id: 55,
      amount: 15000,
      channel: 'cash',
    };

    it('B03: asienta en la sesión del actor y deja refunds.cash_session_id', async () => {
      const db = makeDb(
        [
          { id: 100, status: 'open', cash_register_id: REGISTER_ID, opened_by: OTHER_USER },
          { id: 200, status: 'open', cash_register_id: REGISTER_ID, opened_by: OPERATOR },
        ],
        [{ session_id: 100, payment_id: 55, order_id: 9 }],
      );
      const refunds = { updateMany: jest.fn().mockResolvedValue({ count: 1 }) };
      const { service } = makeService(db, { refunds });

      const out = await service.recordRefundCashMovementDurable(input);

      expect(out).toEqual({ status: 'recorded', movement_id: 901 });
      expect(db.cash_register_movements.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ session_id: 200, payment_id: 55 }),
      });
      expect(refunds.updateMany).toHaveBeenCalledWith({
        where: { id: 900, cash_session_id: null },
        data: { cash_session_id: 200 },
      });
    });

    it('B03: actor sin sesión → outbox, nunca la caja de un tercero', async () => {
      const db = makeDb(
        [{ id: 100, status: 'open', cash_register_id: REGISTER_ID, opened_by: OTHER_USER }],
        [{ session_id: 100, payment_id: 55, order_id: 9 }],
      );
      const failures = {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 61 }),
        update: jest.fn(),
      };
      const { service } = makeService(db, { accounting_entry_failures: failures });

      const out = await service.recordRefundCashMovementDurable(input);

      expect(out).toEqual({ status: 'pending', failure_id: 61, reason: 'no_open_cash_session' });
      expect(db.cash_register_movements.create).not.toHaveBeenCalled();
    });

    it('B18: force_outbox encola aunque el actor del sale tenga sesión abierta', async () => {
      const db = makeDb(
        [{ id: 200, status: 'open', cash_register_id: REGISTER_ID, opened_by: OPERATOR }],
        [],
      );
      const failures = {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 62 }),
        update: jest.fn(),
      };
      const { service } = makeService(db, { accounting_entry_failures: failures });

      const out = await service.recordRefundCashMovementDurable({ ...input, force_outbox: true });

      expect(out).toMatchObject({ status: 'pending', failure_id: 62 });
      expect(db.cash_register_movements.create).not.toHaveBeenCalled();
      expect(failures.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          source_id: 900,
          event_payload: expect.objectContaining({ user_id: OPERATOR, payment_id: 55 }),
        }),
      });
    });

    it('B25: dos pagos en efectivo del mismo refund → dos filas de outbox (dedupe por pago)', async () => {
      const db = makeDb([], []);
      const failures = {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValueOnce({ id: 70 }).mockResolvedValueOnce({ id: 71 }),
        update: jest.fn(),
      };
      const { service } = makeService(db, { accounting_entry_failures: failures });

      await service.recordRefundCashMovementDurable({ ...input, payment_id: 55 });
      await service.recordRefundCashMovementDurable({ ...input, payment_id: 56 });

      expect(failures.findFirst).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: expect.objectContaining({
            event_payload: { path: ['payment_id'], equals: 56 },
          }),
        }),
      );
      expect(failures.create).toHaveBeenCalledTimes(2);
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
      delivery_scope: CASH_MOVEMENT_DELIVERY_SCOPE,
    };

    it('B03: la entrega usa la sesión abierta del operador del payload', async () => {
      const db = makeDb(
        [
          { id: 100, status: 'closed', cash_register_id: REGISTER_ID, opened_by: OTHER_USER },
          { id: 300, status: 'open', cash_register_id: REGISTER_ID, opened_by: OPERATOR },
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
          update: jest.fn(),
        },
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
      const prisma = {
        withoutScope: jest.fn().mockReturnValue(db),
        $transaction: jest.fn((cb: any) => cb(db)),
      };
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
      const unscoped = { ...db, stores };
      const prisma = {
        withoutScope: jest.fn().mockReturnValue(unscoped),
        $transaction: jest.fn((cb: any) => cb(unscoped)),
      };
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

    it('B03: sin sesión del operador y con la original abierta de otro: NO cae en la original (outbox)', async () => {
      const db = makeDb(
        [{ id: 100, status: 'open', cash_register_id: REGISTER_ID, opened_by: OTHER_USER }],
        [{ session_id: 100, payment_id: 55, order_id: 9 }],
      );
      const failures = {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 78 }),
        update: jest.fn(),
      };
      const { service } = makeService(db, { stores, accounting_entry_failures: failures });

      const out = await service.recordCompensationCashMovementDurable(input);

      expect(out).toEqual({ status: 'pending', failure_id: 78, reason: 'no_open_cash_session' });
      expect(db.cash_register_movements.create).not.toHaveBeenCalled();
    });

    it('B02: con sale_session_first cae en la sesión del sale y el outbox conserva el flag', async () => {
      const db = makeDb(
        [{ id: 100, status: 'open', cash_register_id: REGISTER_ID, opened_by: OTHER_USER }],
        [{ session_id: 100, payment_id: 55, order_id: 9 }],
      );
      const { service } = makeService(db, { stores });

      await service.recordCompensationCashMovementDurable({
        ...input,
        sale_session_first: true,
      });

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
        select: { id: true, event_payload: true },
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
          delivery_scope: CASH_MOVEMENT_DELIVERY_SCOPE,
        }),
      });
    });

    it('reencolar sobre una fila existente sin marca NO se la agrega; con marca la conserva', async () => {
      const db = makeDb([], []);
      const failures = {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ id: 77, event_payload: { dedupe_key: 'x' } })
          .mockResolvedValueOnce({
            id: 78,
            event_payload: { delivery_scope: CASH_MOVEMENT_DELIVERY_SCOPE },
          }),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      };
      const { service } = makeService(db, { stores, accounting_entry_failures: failures });

      await service.recordCompensationCashMovementDurable(input);
      await service.recordCompensationCashMovementDurable(input);

      expect(
        failures.update.mock.calls[0][0].data.event_payload,
      ).not.toHaveProperty('delivery_scope');
      expect(failures.update.mock.calls[1][0].data.event_payload).toHaveProperty(
        'delivery_scope',
        CASH_MOVEMENT_DELIVERY_SCOPE,
      );
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
        delivery_scope: CASH_MOVEMENT_DELIVERY_SCOPE,
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
          update: jest.fn(),
        },
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

describe('MovementsService — señal durable de venta diferida F-006', () => {
  const input = {
    failure_id: 44,
    session_id: 20,
    store_id: 10,
    order_id: 91,
    user_id: 7,
    payment_ids: [301],
    ready_state: 'finished' as const,
    compensation_state: 'created',
  };

  const makeTx = (overrides: Record<string, any> = {}) => ({
    $queryRaw: jest.fn().mockResolvedValue([{ id: 20 }]),
    cash_register_movements: {
      create: jest.fn().mockResolvedValue({ id: 88 }),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    accounting_entry_failures: {
      create: jest.fn().mockResolvedValue({ id: input.failure_id }),
      findFirst: jest.fn().mockResolvedValue({
        id: input.failure_id,
        event_payload: {
          session_id: input.session_id,
          payment_ids: input.payment_ids,
          ready_state: input.ready_state,
          compensation_state: input.compensation_state,
        },
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    orders: { findFirst: jest.fn().mockResolvedValue({ id: 91, state: 'finished' }) },
    payments: { findMany: jest.fn().mockResolvedValue([{ id: 301, state: 'cancelled' }]) },
    ...overrides,
  });

  const makeService = () => new MovementsService({ withoutScope: jest.fn() } as any, { emit: jest.fn() } as any);

  it('crea la señal después del lock y antes de confirmar la transacción de pago', async () => {
    const tx = makeTx();
    const service = makeService();
    const id = await service.createDeferredSaleCashMovementSignal(tx as any, {
      session_id: input.session_id,
      store_id: input.store_id,
      order_id: input.order_id,
      user_id: input.user_id,
      organization_id: 3,
      ready_state: input.ready_state,
      compensation_state: input.compensation_state,
    });

    expect(id).toBe(input.failure_id);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.accounting_entry_failures.create.mock.invocationCallOrder[0],
    );
    expect(tx.accounting_entry_failures.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        handler_key: DEFERRED_SALE_CASH_MOVEMENT_KEY,
        source_type: DEFERRED_SALE_CASH_MOVEMENT_SOURCE,
        source_id: input.order_id,
        event_payload: expect.objectContaining({
          session_id: input.session_id,
          order_id: input.order_id,
          payment_ids: [],
        }),
      }),
    });
  });

  it('escribe movimientos y resuelve la señal en la misma transacción tras finish', async () => {
    const tx = makeTx();
    await makeService().completeDeferredSaleCashMovement(tx as any, {
      ...input,
      movements: [{ payment_id: 301, amount: 1250, payment_method: 'cash' }],
    });

    expect(tx.cash_register_movements.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        session_id: input.session_id,
        order_id: input.order_id,
        payment_id: 301,
        type: 'sale',
      }),
    });
    expect(tx.accounting_entry_failures.update).toHaveBeenCalledWith({
      where: { id: input.failure_id },
      data: expect.objectContaining({ resolved_at: expect.any(Date) }),
    });
  });

  it('no duplica el movimiento si una señal repetida ya se entregó en esa sesión', async () => {
    const tx = makeTx({
      cash_register_movements: {
        create: jest.fn(),
        findFirst: jest.fn().mockResolvedValue({ id: 88, session_id: input.session_id }),
      },
    });
    await makeService().completeDeferredSaleCashMovement(tx as any, {
      ...input,
      movements: [{ payment_id: 301, amount: 1250, payment_method: 'cash' }],
    });

    expect(tx.cash_register_movements.create).not.toHaveBeenCalled();
    expect(tx.accounting_entry_failures.update).toHaveBeenCalledWith({
      where: { id: input.failure_id },
      data: expect.objectContaining({ resolved_at: expect.any(Date) }),
    });
  });

  it('resuelve sin movimiento solo con pagos compensados y orden restaurada', async () => {
    const tx = makeTx({
      orders: { findFirst: jest.fn().mockResolvedValue({ id: 91, state: 'created' }) },
      payments: { findMany: jest.fn().mockResolvedValue([{ id: 301, state: 'pending' }]) },
    });
    const resolved = await makeService().cancelDeferredSaleCashMovementSignal(tx as any, {
      ...input,
      restored_state: 'created',
    });

    expect(resolved).toBe(true);
    expect(tx.cash_register_movements.create).not.toHaveBeenCalled();
    expect(tx.accounting_entry_failures.update).toHaveBeenCalledWith({
      where: { id: input.failure_id },
      data: expect.objectContaining({
        resolved_at: expect.any(Date),
        error_message: expect.stringContaining('CANCELLED'),
      }),
    });
  });

  it('deja la señal abierta si pago u orden aún no están compensados/restaurados', async () => {
    const tx = makeTx({
      orders: { findFirst: jest.fn().mockResolvedValue({ id: 91, state: 'processing' }) },
    });
    const resolved = await makeService().cancelDeferredSaleCashMovementSignal(tx as any, {
      ...input,
      restored_state: 'created',
    });

    expect(resolved).toBe(false);
    expect(tx.accounting_entry_failures.update).not.toHaveBeenCalled();
  });

  it('recupera una señal tras reinicio cuando pago y orden ya están listos', async () => {
    const payload = {
      version: 1,
      session_id: input.session_id,
      store_id: input.store_id,
      order_id: input.order_id,
      user_id: input.user_id,
      payment_ids: input.payment_ids,
      ready_state: input.ready_state,
      compensation_state: input.compensation_state,
    };
    const signal = {
      id: input.failure_id,
      resolved_at: null,
      event_payload: payload,
    };
    const tx = makeTx({
      orders: { findFirst: jest.fn().mockResolvedValue({ id: 91, state: 'finished' }) },
      payments: {
        findMany: jest.fn().mockResolvedValue([{
          id: 301,
          amount: 1250,
          state: 'succeeded',
          store_payment_method: { system_payment_method: { type: 'cash' } },
        }]),
      },
      accounting_entry_failures: {
        findFirst: jest.fn().mockResolvedValue(signal),
        update: jest.fn().mockResolvedValue({}),
      },
    });
    const db = { accounting_entry_failures: { findFirst: jest.fn().mockResolvedValue(signal) } };
    const prisma = {
      withoutScope: jest.fn().mockReturnValue(db),
      $transaction: jest.fn((callback: any) => callback(tx)),
    };
    const service = new MovementsService(prisma as any, { emit: jest.fn() } as any);

    await service.deliverDeferredSaleCashMovement(input.failure_id);

    expect(tx.cash_register_movements.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        session_id: input.session_id,
        order_id: input.order_id,
        payment_id: 301,
        amount: 1250,
        type: 'sale',
      }),
    });
    expect(tx.accounting_entry_failures.update).toHaveBeenCalledWith({
      where: { id: input.failure_id },
      data: expect.objectContaining({ resolved_at: expect.any(Date) }),
    });
  });
});
