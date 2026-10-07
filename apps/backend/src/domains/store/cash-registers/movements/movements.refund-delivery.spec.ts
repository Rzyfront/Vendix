import {
  CASH_MOVEMENT_DELIVERY_SCOPE,
  LEGACY_MANUAL_REVIEW_PREFIX,
  MovementsService,
  REFUND_CASH_MOVEMENT_KEY,
  RefundCashMovementPayload,
} from './movements.service';

/**
 * Release-853 (paso 6) — cobertura de `deliverRefundCashMovement`.
 *
 * La regla de negocio bajo prueba (movements.service.ts ~L372-390): un
 * reembolso en efectivo solo puede entregarse contra la sesión de caja
 * ABIERTA DEL MISMO USUARIO que lo generó (`opened_by: payload.user_id`).
 * Si esa sesión no existe — aunque otro usuario sí tenga caja abierta en la
 * misma tienda — la entrega debe fallar sin reasignar el movimiento a otra
 * caja, y la fila del outbox debe seguir pendiente (`resolved_at` intacto,
 * `attempt_count` incrementado) para que el sweeper la reintente.
 */
describe('MovementsService.deliverRefundCashMovement', () => {
  const FAILURE_ID = 555;
  const REFUND_ID = 900;
  const ORDER_ID = 42;
  const STORE_ID = 10;
  const ORG_ID = 3;
  const OWNER_USER_ID = 7;
  const SESSION_ID = 200;
  const MOVEMENT_ID = 321;
  const AMOUNT = 15000;

  const payload: RefundCashMovementPayload = {
    version: 1,
    refund_id: REFUND_ID,
    order_id: ORDER_ID,
    store_id: STORE_ID,
    organization_id: ORG_ID,
    user_id: OWNER_USER_ID,
    payment_id: 88,
    amount: AMOUNT,
    channel: 'cash',
    delivery_scope: CASH_MOVEMENT_DELIVERY_SCOPE,
  };

  const outboxRow = {
    id: FAILURE_ID,
    handler_key: REFUND_CASH_MOVEMENT_KEY,
    source_id: REFUND_ID,
    organization_id: ORG_ID,
    store_id: STORE_ID,
    resolved_at: null as Date | null,
    event_payload: payload as unknown,
  };

  const createService = () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: FAILURE_ID }]),
      accounting_entry_failures: {
        findFirst: jest.fn().mockResolvedValue({ ...outboxRow }),
        update: jest.fn().mockResolvedValue({}),
      },
      cash_register_movements: {
        findFirst: jest.fn().mockResolvedValue(null), // no delivered yet
        create: jest.fn().mockResolvedValue({ id: MOVEMENT_ID }),
      },
      cash_register_sessions: {
        findFirst: jest.fn(),
      },
    };
    const unscoped = {
      $transaction: jest.fn((cb: any) => cb(tx)),
      accounting_entry_failures: {
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const prisma = {
      withoutScope: jest.fn().mockReturnValue(unscoped),
    };
    const service = new MovementsService(
      prisma as any,
      { emit: jest.fn() } as any,
    );
    return { service, tx, unscoped };
  };

  it('sesión abierta de OTRO usuario: no entrega, la fila sigue pendiente y attempt_count sube', async () => {
    const { service, tx, unscoped } = createService();
    // La consulta ya filtra por opened_by: OWNER_USER_ID; que otro usuario
    // tenga caja abierta en la misma tienda no puede colar una fila —
    // el mock representa el resultado real de esa cláusula: ninguna.
    tx.cash_register_sessions.findFirst.mockResolvedValue(null);

    await expect(
      service.deliverRefundCashMovement(FAILURE_ID),
    ).rejects.toThrow(
      `NO_OPEN_SESSION: no open cash session owned by user #${OWNER_USER_ID} in store #${STORE_ID} for refund #${REFUND_ID}`,
    );

    expect(tx.cash_register_sessions.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { store_id: STORE_ID, status: 'open', opened_by: OWNER_USER_ID },
      }),
    );
    // Nunca crea el movimiento ni lo marca resuelto dentro de la tx.
    expect(tx.cash_register_movements.create).not.toHaveBeenCalled();
    expect(tx.accounting_entry_failures.update).not.toHaveBeenCalled();

    // El catch exterior registra el intento SIN resolved_at: la fila sigue
    // pendiente para el próximo barrido del sweeper.
    expect(unscoped.accounting_entry_failures.update).toHaveBeenCalledTimes(1);
    const call = unscoped.accounting_entry_failures.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: FAILURE_ID });
    expect(call.data.attempt_count).toEqual({ increment: 1 });
    expect(call.data.resolved_at).toBeUndefined();
    expect(call.data.error_message).toContain('NO_OPEN_SESSION');
  });

  it('sesión abierta del MISMO usuario: entrega el movimiento y resuelve la fila', async () => {
    const { service, tx, unscoped } = createService();
    tx.cash_register_sessions.findFirst.mockResolvedValue({ id: SESSION_ID });

    await expect(
      service.deliverRefundCashMovement(FAILURE_ID),
    ).resolves.toBeUndefined();

    expect(tx.cash_register_movements.create).toHaveBeenCalledWith({
      data: {
        session_id: SESSION_ID,
        store_id: STORE_ID,
        user_id: OWNER_USER_ID,
        type: 'refund',
        amount: AMOUNT,
        payment_method: 'cash',
        order_id: ORDER_ID,
        payment_id: payload.payment_id,
        reference: `refund:${REFUND_ID}`,
      },
    });

    expect(tx.accounting_entry_failures.update).toHaveBeenCalledWith({
      where: { id: FAILURE_ID },
      data: {
        resolved_at: expect.any(Date),
        error_message: expect.stringContaining(
          `DELIVERED: movement #${MOVEMENT_ID} recorded in session #${SESSION_ID}`,
        ),
      },
    });

    // El camino feliz nunca pasa por el catch exterior (no incrementa
    // attempt_count ni deja la fila pendiente).
    expect(unscoped.accounting_entry_failures.update).not.toHaveBeenCalled();
  });
  describe('filas legacy (sin delivery_scope)', () => {
    const legacyPayload = { ...payload } as Partial<RefundCashMovementPayload>;
    delete legacyPayload.delivery_scope;

    it('con sesión abierta disponible NO crea movimiento: marca LEGACY_MANUAL_REVIEW, sin resolver', async () => {
      const { service, tx, unscoped } = createService();
      tx.accounting_entry_failures.findFirst.mockResolvedValue({
        ...outboxRow,
        error_message: 'PENDING_DELIVERY: x',
        event_payload: legacyPayload,
      });
      tx.cash_register_sessions.findFirst.mockResolvedValue({ id: SESSION_ID });

      await expect(
        service.deliverRefundCashMovement(FAILURE_ID),
      ).resolves.toBeUndefined();

      expect(tx.cash_register_movements.create).not.toHaveBeenCalled();
      expect(tx.accounting_entry_failures.update).toHaveBeenCalledTimes(1);
      const data = tx.accounting_entry_failures.update.mock.calls[0][0].data;
      expect(data.error_message).toMatch(
        new RegExp(`^${LEGACY_MANUAL_REVIEW_PREFIX}`),
      );
      expect(data.attempt_count).toEqual({ increment: 1 });
      expect(data.resolved_at).toBeUndefined();
      expect(unscoped.accounting_entry_failures.update).not.toHaveBeenCalled();
    });

    it('si ya está marcada no vuelve a tocar nada', async () => {
      const { service, tx, unscoped } = createService();
      tx.accounting_entry_failures.findFirst.mockResolvedValue({
        ...outboxRow,
        error_message: `${LEGACY_MANUAL_REVIEW_PREFIX}: ya marcada`,
        event_payload: legacyPayload,
      });

      await service.deliverRefundCashMovement(FAILURE_ID);

      expect(tx.cash_register_movements.create).not.toHaveBeenCalled();
      expect(tx.accounting_entry_failures.update).not.toHaveBeenCalled();
      expect(unscoped.accounting_entry_failures.update).not.toHaveBeenCalled();
    });
  });

  describe('sweepStrandedRefundCashMovements', () => {
    it('excluye de la búsqueda las filas LEGACY_MANUAL_REVIEW', async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const prisma = {
        withoutScope: jest
          .fn()
          .mockReturnValue({ accounting_entry_failures: { findMany } }),
      };
      const service = new MovementsService(
        prisma as any,
        { emit: jest.fn() } as any,
      );

      await service.sweepStrandedRefundCashMovements();

      expect(findMany.mock.calls[0][0].where).toMatchObject({
        handler_key: REFUND_CASH_MOVEMENT_KEY,
        resolved_at: null,
        NOT: {
          error_message: { startsWith: LEGACY_MANUAL_REVIEW_PREFIX },
        },
      });
    });
  });

  describe('encolado guarda la marca', () => {
    it('recordRefundCashMovementDurable sin sesión crea la fila con delivery_scope; en dedupe sin marca no la agrega', async () => {
      const failures = {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: 9, event_payload: { version: 1 } }),
        create: jest.fn().mockResolvedValue({ id: 9 }),
        update: jest.fn().mockResolvedValue({}),
      };
      const unscoped = {
        accounting_entry_failures: failures,
        cash_register_sessions: { findFirst: jest.fn().mockResolvedValue(null) },
        cash_register_movements: { findFirst: jest.fn().mockResolvedValue(null) },
      };
      const prisma = { withoutScope: jest.fn().mockReturnValue(unscoped) };
      const service = new MovementsService(
        prisma as any,
        { emit: jest.fn() } as any,
      );
      jest
        .spyOn(service as any, 'resolveCompensationSessionId')
        .mockResolvedValue(null);
      const input = {
        organization_id: ORG_ID,
        store_id: STORE_ID,
        user_id: OWNER_USER_ID,
        refund_id: REFUND_ID,
        order_id: ORDER_ID,
        payment_id: 88,
        amount: AMOUNT,
        channel: 'cash',
      };

      await service.recordRefundCashMovementDurable(input);
      expect(failures.create.mock.calls[0][0].data.event_payload).toMatchObject({
        delivery_scope: CASH_MOVEMENT_DELIVERY_SCOPE,
      });

      await service.recordRefundCashMovementDurable(input);
      expect(
        failures.update.mock.calls[0][0].data.event_payload,
      ).not.toHaveProperty('delivery_scope');
    });
  });
});
