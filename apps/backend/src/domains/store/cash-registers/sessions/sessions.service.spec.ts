import { SessionsService, humanCashReference } from './sessions.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { MovementsService } from '../movements/movements.service';
import { AIEngineService } from '../../../../ai-engine/ai-engine.service';
import { SettingsService } from '../../settings/settings.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors';
import { createHash } from 'node:crypto';

/**
 * QUI-572 — regresión del cierre de caja contra un esperado rancio.
 *
 * El bug original: el modal de cierre fotografiaba el "efectivo esperado" una
 * sola vez al abrirse y nunca lo refrescaba. Si entraba una venta mientras el
 * operario contaba, el arqueo se hacía contra la cifra vieja mientras el backend
 * calculaba `difference` contra datos frescos — y registraba un faltante que no
 * existía, en silencio.
 *
 * El candado es `expected_closing_amount_seen`: el cliente declara qué cifra
 * tenía en pantalla y el backend rechaza el cierre si ya no coincide. El campo
 * es OPCIONAL a propósito (`apps/mobile` no lo manda), así que el caso "ausente"
 * se prueba explícitamente: si se rompe, rompemos el móvil.
 *
 * Quitar el candado de `closeSession` debe romper exactamente el primer caso.
 */

const STORE_ID = 10;
const ORGANIZATION_ID = 6;
const USER_ID = 15;
const SESSION_ID = 77;

/** Escenario del reporte: apertura de $100.000 y un `cash_in` de $27.000. */
const OPENING_AMOUNT = 100000;
const CASH_IN_AMOUNT = 27000;
const EXPECTED_FRESH = OPENING_AMOUNT + CASH_IN_AMOUNT; // 127.000

const OPEN_SESSION = {
  id: SESSION_ID,
  store_id: STORE_ID,
  status: 'open',
  opening_amount: OPENING_AMOUNT,
  pending_orders_tracking_enabled: true,
};

const REPRO_MOVEMENTS = [
  { type: 'opening_balance', amount: OPENING_AMOUNT, payment_method: 'cash' },
  { type: 'cash_in', amount: CASH_IN_AMOUNT, payment_method: 'cash' },
];

describe('SessionsService — cierre de caja y resumen autoritativo (QUI-572)', () => {
  let service: SessionsService;
  let prismaMock: any;
  let event_emitter: { emit: jest.Mock };

  /**
   * `cash_register_sessions.findFirst` se llama dos veces en `closeSession`:
   * la primera para validar la sesión abierta y la segunda DENTRO de la
   * transacción para devolver la sesión ya cerrada. Este helper encadena ambas.
   */
  const stubCloseFlow = (
    closed: Record<string, unknown>,
    open: Record<string, unknown> = OPEN_SESSION,
  ) => {
    prismaMock.cash_register_sessions.findFirst
      .mockResolvedValueOnce(open)
      .mockResolvedValueOnce({ ...open, status: 'closed', ...closed });
  };

  beforeEach(() => {
    jest.clearAllMocks();

    prismaMock = {
      cash_register_sessions: {
        findFirst: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: SESSION_ID, store_id: STORE_ID, opened_by: USER_ID }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      cash_registers: { findFirst: jest.fn() },
      cash_register_movements: {
        findMany: jest.fn().mockResolvedValue(REPRO_MOVEMENTS),
        create: jest.fn().mockResolvedValue({}),
      },
      stores: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ organization_id: ORGANIZATION_ID }),
      },
      orders: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      accounting_entry_failures: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ id: SESSION_ID }]),
      $transaction: jest.fn((cb: any) => cb(prismaMock)),
    };

    event_emitter = { emit: jest.fn() };

    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      store_id: STORE_ID,
      organization_id: ORGANIZATION_ID,
      user_id: USER_ID,
      is_super_admin: false,
    } as any);

    const settingsServiceMock = {
      getStoreCurrency: jest.fn().mockResolvedValue('COP'),
      getSettings: jest.fn().mockResolvedValue({
        pos: { cash_register: { enabled: false } },
      }),
    };

    service = new SessionsService(
      prismaMock as unknown as StorePrismaService,
      {} as unknown as MovementsService,
      event_emitter as any,
      {} as unknown as AIEngineService,
      settingsServiceMock as unknown as SettingsService,
    );
  });

  it('habilita atribución de pendientes en sesiones recién abiertas', async () => {
    prismaMock.cash_registers.findFirst.mockResolvedValue({ id: 3, is_active: true });
    prismaMock.cash_register_sessions.findFirst.mockResolvedValue(null);
    prismaMock.cash_register_sessions.create.mockResolvedValue({
      id: SESSION_ID,
      store_id: STORE_ID,
      opened_by: USER_ID,
    });

    await service.openSession({ cash_register_id: 3, opening_amount: 0 } as any);

    expect(prismaMock.cash_register_sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ pending_orders_tracking_enabled: true }),
      }),
    );
  });

  describe('getPendingOrders — QUI-920', () => {
    const updated_at = new Date('2026-10-06T14:30:00.000Z');

    beforeEach(() => {
      prismaMock.cash_register_sessions.findFirst.mockResolvedValue({
        id: SESSION_ID,
        store_id: STORE_ID,
        pending_orders_tracking_enabled: true,
      });
      prismaMock.orders = {
        count: jest.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(1).mockResolvedValueOnce(1),
        aggregate: jest.fn().mockResolvedValue({
          _sum: { remaining_balance: '125.50' },
        }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 101,
            order_number: 'POS-101',
            state: 'processing',
            remaining_balance: '125.50',
            updated_at,
          },
        ]),
      };
    });

    it('pagina por atribución de la sesión y separa motivos sin afectar efectivo', async () => {
      const result = await service.getPendingOrders(SESSION_ID, {
        page: 2,
        limit: 1,
      } as any);

      expect(prismaMock.cash_register_sessions.findFirst).toHaveBeenCalledWith({
        where: { id: SESSION_ID, store_id: STORE_ID },
        select: {
          id: true,
          store_id: true,
          pending_orders_tracking_enabled: true,
        },
      });
      expect(prismaMock.orders.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            store_id: STORE_ID,
            origin_cash_session_id: SESSION_ID,
            OR: [
              {
                state: {
                  notIn: ['finished', 'delivered', 'cancelled', 'refunded'],
                },
              },
              { remaining_balance: { gt: 0 } },
              {
                grand_total: { gt: 0 },
                OR: [{ payment_form: { not: '2' } }, { payment_form: null }],
                payments: {
                  none: {
                    state: {
                      in: ['succeeded', 'captured', 'partially_refunded', 'refunded'],
                    },
                  },
                },
              },
            ],
          },
          skip: 1,
          take: 1,
        }),
      );
      expect(prismaMock.orders.aggregate).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        tracking_enabled: true,
        count: 2,
        operational_count: 1,
        balance_count: 1,
        balance_total: 125.5,
        page: 2,
        limit: 1,
        data: [
          {
            id: 101,
            state: 'processing',
            remaining_balance: 125.5,
            reasons: ['operational', 'balance'],
            version: updated_at.toISOString(),
          },
        ],
      });
      expect(result.data[0].fingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(prismaMock.orders.findMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: expect.objectContaining({
            store_id: STORE_ID,
            origin_cash_session_id: SESSION_ID,
          }),
          select: {
            id: true,
            state: true,
            remaining_balance: true,
            updated_at: true,
            grand_total: true,
            payment_form: true,
            payments: { select: { state: true, amount: true } },
            order_items: { select: { delivered_at: true, cancelled_at: true } },
          },
          orderBy: { id: 'asc' },
        }),
      );
      expect(prismaMock.cash_register_movements.findMany).not.toHaveBeenCalled();
    });

    it('detecta pago faltante en una orden POS aunque remaining_balance sea cero', async () => {
      const posOrder = {
        id: 204,
        order_number: 'POS-2026-0046',
        state: 'processing',
        remaining_balance: '0.00',
        grand_total: '48000.00',
        payment_form: '1',
        payments: [],
        order_items: [{ delivered_at: updated_at, cancelled_at: null }],
        updated_at,
      };
      prismaMock.orders.count
        .mockReset()
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(1);
      prismaMock.orders.findMany
        .mockReset()
        .mockResolvedValueOnce([posOrder])
        .mockResolvedValueOnce([posOrder]);

      const result = await service.getPendingOrders(SESSION_ID);

      expect(result).toMatchObject({
        balance_count: 1,
        balance_total: 48000,
        data: [
          {
            order_number: 'POS-2026-0046',
            remaining_balance: 0,
            payment_required: true,
            payment_amount_due: 48000,
            all_items_delivered: true,
            reasons: ['operational', 'balance'],
          },
        ],
      });
    });

    it('cambia la huella global al cambiar una fila fuera de la página', async () => {
      const outside_page = {
        id: 102,
        state: 'delivered',
        remaining_balance: '20.00',
        updated_at,
      };
      prismaMock.orders.count.mockResolvedValue(2);
      prismaMock.orders.aggregate.mockResolvedValue({
        _sum: { remaining_balance: '20.00' },
      });
      prismaMock.orders.findMany
        .mockResolvedValueOnce([
          {
            id: 101,
            order_number: 'POS-101',
            state: 'processing',
            remaining_balance: '0.00',
            updated_at,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: 101,
            state: 'processing',
            remaining_balance: '0.00',
            updated_at,
          },
          outside_page,
        ])
        .mockResolvedValueOnce([
          {
            id: 101,
            order_number: 'POS-101',
            state: 'processing',
            remaining_balance: '0.00',
            updated_at,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: 101,
            state: 'processing',
            remaining_balance: '0.00',
            updated_at,
          },
          { ...outside_page, remaining_balance: '21.00' },
        ]);

      const first = await service.getPendingOrders(SESSION_ID, {
        page: 1,
        limit: 1,
      } as any);
      const second = await service.getPendingOrders(SESSION_ID, {
        page: 1,
        limit: 1,
      } as any);

      expect(first.data).toEqual(second.data);
      expect(first.fingerprint).not.toBe(second.fingerprint);
    });

    it('no consulta órdenes cuando la sesión pertenece a otra tienda', async () => {
      prismaMock.cash_register_sessions.findFirst.mockResolvedValue(null);

      await expect(service.getPendingOrders(SESSION_ID)).rejects.toThrow(
        'Sesión de caja no encontrada',
      );
      expect(prismaMock.orders.findMany).not.toHaveBeenCalled();
    });

    it('expone estado legacy sin atribuir órdenes huérfanas', async () => {
      prismaMock.cash_register_sessions.findFirst.mockResolvedValue({
        id: SESSION_ID,
        store_id: STORE_ID,
        pending_orders_tracking_enabled: false,
      });
      prismaMock.orders.count.mockResolvedValue(0);
      prismaMock.orders.aggregate.mockResolvedValue({ _sum: { remaining_balance: null } });
      prismaMock.orders.findMany.mockResolvedValue([]);

      const result = await service.getPendingOrders(SESSION_ID);

      expect(result.tracking_enabled).toBe(false);
      expect(result.legacy_unattributed).toMatchObject({ status: 'untracked' });
      expect(prismaMock.orders.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            store_id: STORE_ID,
            origin_cash_session_id: SESSION_ID,
          }),
        }),
      );
    });
  });

  describe('closeSession — candado de esperado rancio', () => {
    const pending_order = {
      id: 101,
      order_number: 'POS-101',
      state: 'processing',
      remaining_balance: '25.50',
      updated_at: new Date('2026-10-07T13:00:00.000Z'),
    };
    const pendingFingerprint = (order = pending_order) =>
      createHash('sha256')
        .update(
          `${order.id}:${order.state}:${Number(order.remaining_balance).toFixed(2)}:${order.updated_at.toISOString()}\n`,
        )
        .digest('hex');

    it('rechaza el cierre si hay un movimiento de venta diferido aún sin resolver', async () => {
      stubCloseFlow({});
      prismaMock.accounting_entry_failures.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 404, source_id: 101 }]);

      await expect(service.closeSession(SESSION_ID, {
        actual_closing_amount: EXPECTED_FRESH,
      } as any)).rejects.toMatchObject({ errorCode: 'CASH_SESSION_PENDING_005' });

      expect(prismaMock.accounting_entry_failures.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            handler_key: 'deferred_sale_cash_movement_v1',
            source_type: 'order.deferred_cash_movement',
            resolved_at: null,
            event_payload: { path: ['session_id'], equals: SESSION_ID },
          }),
        }),
      );
      expect(prismaMock.cash_register_sessions.updateMany).not.toHaveBeenCalled();
    });

    it('toma el lock antes de leer movimientos y pendientes, y rechaza si falta decisión', async () => {
      stubCloseFlow({});
      prismaMock.orders.findMany.mockResolvedValue([pending_order]);

      await expect(
        service.closeSession(SESSION_ID, {
          actual_closing_amount: OPENING_AMOUNT,
          expected_closing_amount_seen: EXPECTED_FRESH,
        } as any),
      ).rejects.toMatchObject({ errorCode: 'CASH_SESSION_PENDING_001' });

      expect(prismaMock.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        prismaMock.$queryRaw.mock.invocationCallOrder[1],
      );
      expect(prismaMock.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(
        prismaMock.cash_register_movements.findMany.mock.invocationCallOrder[0],
      );
      expect(prismaMock.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(
        prismaMock.orders.findMany.mock.invocationCallOrder[0],
      );
      expect(prismaMock.cash_register_movements.create).not.toHaveBeenCalled();
      expect(prismaMock.cash_register_sessions.updateMany).not.toHaveBeenCalled();
    });

    it('no acepta resolved si las órdenes siguen pendientes', async () => {
      stubCloseFlow({});
      prismaMock.orders.findMany.mockResolvedValue([pending_order]);

      await expect(
        service.closeSession(SESSION_ID, {
          actual_closing_amount: OPENING_AMOUNT,
          pending_decision: 'resolved',
          pending_fingerprint: pendingFingerprint(),
        } as any),
      ).rejects.toMatchObject({ errorCode: 'CASH_SESSION_PENDING_002' });
      expect(prismaMock.cash_register_movements.create).not.toHaveBeenCalled();
    });

    it('aborta con fingerprint rancio sin escribir el movimiento de cierre', async () => {
      stubCloseFlow({});
      prismaMock.orders.findMany.mockResolvedValue([pending_order]);

      await expect(
        service.closeSession(SESSION_ID, {
          actual_closing_amount: OPENING_AMOUNT,
          pending_decision: 'override',
          pending_fingerprint: '0'.repeat(64),
          override_reason: 'Revisado por supervisor',
        } as any),
      ).rejects.toMatchObject({ errorCode: 'CASH_SESSION_PENDING_002' });

      expect(prismaMock.cash_register_sessions.updateMany).not.toHaveBeenCalled();
      expect(prismaMock.cash_register_movements.create).not.toHaveBeenCalled();
    });

    it('bloquea el cierre si queda un reembolso outbox de una orden de esta sesión', async () => {
      stubCloseFlow({});
      prismaMock.orders.findMany.mockResolvedValue([]);
      prismaMock.accounting_entry_failures.findMany.mockResolvedValue([
        {
          id: 909,
          event_payload: {
            order_id: 101,
            delivery_scope: 'register_v2',
          },
        },
      ]);

      await expect(
        service.closeSession(SESSION_ID, {
          actual_closing_amount: EXPECTED_FRESH,
          expected_closing_amount_seen: EXPECTED_FRESH,
          pending_decision: 'resolved',
          pending_fingerprint: createHash('sha256').digest('hex'),
        } as any),
      ).rejects.toMatchObject({ errorCode: 'CASH_SESSION_PENDING_005' });

      expect(prismaMock.accounting_entry_failures.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            handler_key: 'refund_cash_movement_v1',
            source_type: 'refund.cash_movement',
            event_payload: {
              path: ['delivery_scope'],
              equals: 'register_v2',
            },
          }),
        }),
      );
      expect(prismaMock.cash_register_movements.create).not.toHaveBeenCalled();
      expect(prismaMock.cash_register_sessions.updateMany).not.toHaveBeenCalled();
    });

    it('requiere motivo y congela la auditoría al permitir override', async () => {
      prismaMock.cash_register_sessions.findFirst.mockResolvedValueOnce(OPEN_SESSION);
      prismaMock.orders.findMany.mockResolvedValue([pending_order]);
      await expect(
        service.closeSession(SESSION_ID, {
          actual_closing_amount: OPENING_AMOUNT,
          pending_decision: 'override',
          pending_fingerprint: pendingFingerprint(),
          override_reason: '   ',
        } as any),
      ).rejects.toMatchObject({ errorCode: 'CASH_SESSION_PENDING_003' });
      expect(prismaMock.cash_register_movements.create).not.toHaveBeenCalled();

      stubCloseFlow({});
      const closed = await service.closeSession(SESSION_ID, {
        actual_closing_amount: OPENING_AMOUNT,
        expected_closing_amount_seen: EXPECTED_FRESH,
        pending_decision: 'override',
        pending_fingerprint: pendingFingerprint(),
        override_reason: 'Se entrega la caja al supervisor',
      } as any);

      expect(closed.status).toBe('closed');
      const data = prismaMock.cash_register_sessions.updateMany.mock.calls.at(-1)[0].data;
      expect(data.summary.pending_orders_snapshot).toMatchObject({
        version: 1,
        status: 'tracked',
        rows: [{ id: 101, order_number: 'POS-101', state: 'processing', remaining_balance: 25.5 }],
        fingerprint: pendingFingerprint(),
        decision: 'override',
        actor_id: USER_ID,
        override_reason: 'Se entrega la caja al supervisor',
      });
      expect(prismaMock.cash_register_movements.create).toHaveBeenCalledTimes(1);
    });

    it('permite cerrar una sesión legacy sin pendientes sin motivo de excepción', async () => {
      stubCloseFlow({}, { ...OPEN_SESSION, pending_orders_tracking_enabled: false });
      const closed = await service.closeSession(SESSION_ID, {
        actual_closing_amount: OPENING_AMOUNT,
        pending_decision: 'resolved',
        pending_fingerprint: createHash('sha256').digest('hex'),
      } as any);
      expect(closed.status).toBe('closed');
      const data = prismaMock.cash_register_sessions.updateMany.mock.calls.at(-1)[0].data;
      expect(data.summary.pending_orders_snapshot).toMatchObject({
        status: 'untracked',
        rows: [],
        fingerprint: null,
        decision: 'resolved',
        override_reason: null,
      });
    });

    it('rechaza con 409 cuando el esperado visto por el cliente ya no coincide', async () => {
      prismaMock.cash_register_sessions.findFirst.mockResolvedValue(
        OPEN_SESSION,
      );

      // El operario abrió el modal viendo $100.000 y contó contra esa cifra;
      // el `cash_in` de $27.000 entró mientras contaba.
      const promise = service.closeSession(SESSION_ID, {
        actual_closing_amount: OPENING_AMOUNT,
        expected_closing_amount_seen: OPENING_AMOUNT,
      } as any);

      await expect(promise).rejects.toThrow(VendixHttpException);
      await expect(promise).rejects.toMatchObject({
        errorCode: 'CASH_SESSION_EXPECTED_STALE_001',
      });

      // La lectura fresca ocurre bajo lock y el rechazo revierte la transacción.
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      expect(prismaMock.cash_register_sessions.updateMany).not.toHaveBeenCalled();
    });

    it('expone el delta en los details para que la UI pueda explicar el rechazo', async () => {
      prismaMock.cash_register_sessions.findFirst.mockResolvedValue(
        OPEN_SESSION,
      );

      await service
        .closeSession(SESSION_ID, {
          actual_closing_amount: OPENING_AMOUNT,
          expected_closing_amount_seen: OPENING_AMOUNT,
        } as any)
        .catch((error: VendixHttpException) => {
          expect(error.getStatus()).toBe(409);
          expect(error.getResponse()).toMatchObject({
            error_code: 'CASH_SESSION_EXPECTED_STALE_001',
            details: {
              expected_now: EXPECTED_FRESH,
              expected_seen: OPENING_AMOUNT,
              delta: CASH_IN_AMOUNT,
            },
          });
        });

      expect.assertions(2);
    });

    it('cierra cuando el esperado visto coincide con el fresco', async () => {
      const actual = 130000;
      stubCloseFlow({
        expected_closing_amount: EXPECTED_FRESH,
        actual_closing_amount: actual,
        difference: actual - EXPECTED_FRESH,
        closed_by: USER_ID,
      });

      const closed = await service.closeSession(SESSION_ID, {
        actual_closing_amount: actual,
        expected_closing_amount_seen: EXPECTED_FRESH,
      } as any);

      expect(closed.status).toBe('closed');
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      expect(
        prismaMock.cash_register_sessions.updateMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'closed',
            expected_closing_amount: EXPECTED_FRESH,
            actual_closing_amount: actual,
            difference: 3000,
          }),
        }),
      );
      expect(event_emitter.emit).toHaveBeenCalledWith(
        'cash_register.closed',
        expect.objectContaining({ session_id: SESSION_ID, difference: 3000 }),
      );
    });

    it('tolera diferencias por debajo de un centavo (Decimal en DB vs number en JSON)', async () => {
      stubCloseFlow({
        expected_closing_amount: EXPECTED_FRESH,
        actual_closing_amount: EXPECTED_FRESH,
        difference: 0,
      });

      await expect(
        service.closeSession(SESSION_ID, {
          actual_closing_amount: EXPECTED_FRESH,
          expected_closing_amount_seen: EXPECTED_FRESH + 0.004,
        } as any),
      ).resolves.toBeDefined();

      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    });

    // F-222 — el umbral es el MISMO que el `> 0.01` original (tolera 1 centavo),
    // sólo que medido en centavos enteros (`>= 2` ¢). Los dos casos de abajo
    // fijan los dos lados del borde para que nadie lo mueva sin querer: con
    // `Math.abs` sobre floats el veredicto del centavo dependía de la MAGNITUD
    // (2425.00 − 2424.99 = 0.0100000000002 rechazaba; 13603.13 − 13603.12 =
    // 0.0099999999984 no), y eso es lo que desaparece.
    it('F-222: 1¢ de diferencia se TOLERA (el umbral original no cambia)', async () => {
      stubCloseFlow({
        expected_closing_amount: EXPECTED_FRESH,
        actual_closing_amount: EXPECTED_FRESH,
        difference: 0,
      });

      await expect(
        service.closeSession(SESSION_ID, {
          actual_closing_amount: EXPECTED_FRESH,
          expected_closing_amount_seen: EXPECTED_FRESH + 0.01,
        } as any),
      ).resolves.toBeDefined();

      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    });

    it('F-222: 2¢ de diferencia SÍ rechaza por cifra rancia', async () => {
      prismaMock.cash_register_sessions.findFirst.mockResolvedValue(
        OPEN_SESSION,
      );

      const promise = service.closeSession(SESSION_ID, {
        actual_closing_amount: OPENING_AMOUNT,
        expected_closing_amount_seen: EXPECTED_FRESH + 0.02,
      } as any);

      await expect(promise).rejects.toMatchObject({
        errorCode: 'CASH_SESSION_EXPECTED_STALE_001',
      });
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    });

    it('cierra igual que antes cuando el campo no llega (compatibilidad con apps/mobile)', async () => {
      const actual = OPENING_AMOUNT;
      stubCloseFlow({
        expected_closing_amount: EXPECTED_FRESH,
        actual_closing_amount: actual,
        difference: actual - EXPECTED_FRESH,
      });

      // El saldo esperado se obtiene dentro del lock aunque el cliente no lo envíe.
      const closed = await service.closeSession(SESSION_ID, {
        actual_closing_amount: actual,
      } as any);

      expect(closed.status).toBe('closed');
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      expect(
        prismaMock.cash_register_sessions.updateMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            expected_closing_amount: EXPECTED_FRESH,
            difference: -CASH_IN_AMOUNT,
          }),
        }),
      );
    });
  });

  describe('getCashSummary — desglose autoritativo', () => {
    it('calcula el esperado como apertura + venta efectivo + cash_in − refund efectivo − cash_out', async () => {
      prismaMock.cash_register_sessions.findFirst.mockResolvedValue(
        OPEN_SESSION,
      );
      prismaMock.cash_register_movements.findMany.mockResolvedValue([
        { type: 'opening_balance', amount: OPENING_AMOUNT, payment_method: 'cash' },
        { type: 'sale', amount: 50000, payment_method: 'cash' },
        { type: 'sale', amount: 30000, payment_method: 'card' },
        { type: 'cash_in', amount: 20000, payment_method: 'cash' },
        { type: 'refund', amount: 5000, payment_method: 'cash' },
        { type: 'cash_out', amount: 10000, payment_method: 'cash' },
      ]);

      const summary = await service.getCashSummary(SESSION_ID);

      // 100.000 + 50.000 + 20.000 − 5.000 − 10.000 = 155.000.
      // La venta con tarjeta NO participa del arqueo de efectivo.
      expect(summary.expected_cash_total).toBe(155000);
      expect(summary.opening).toBe(OPENING_AMOUNT);
      expect(summary.cash_sales).toBe(50000);
      expect(summary.cash_in).toBe(20000);
      expect(summary.cash_refunds).toBe(5000);
      expect(summary.cash_out).toBe(10000);

      // …pero sí suma en el total de ventas y en el no-efectivo.
      expect(summary.sales_total).toBe(80000);
      expect(summary.sales_count).toBe(2);
      expect(summary.non_cash_total).toBe(30000);
    });

    it('ordena sales_by_method con cash primero y el resto alfabético', async () => {
      prismaMock.cash_register_sessions.findFirst.mockResolvedValue(
        OPEN_SESSION,
      );
      prismaMock.cash_register_movements.findMany.mockResolvedValue([
        { type: 'sale', amount: 10000, payment_method: 'transfer' },
        { type: 'sale', amount: 30000, payment_method: 'card' },
        { type: 'sale', amount: 50000, payment_method: 'cash' },
        { type: 'sale', amount: 7000, payment_method: 'card' },
      ]);

      const summary = await service.getCashSummary(SESSION_ID);

      // Orden estable entre polls: la UI refresca este endpoint y las filas no
      // deben saltar de sitio entre refrescos.
      expect(summary.sales_by_method).toEqual([
        { method: 'cash', count: 1, total: 50000 },
        { method: 'card', count: 2, total: 37000 },
        { method: 'transfer', count: 1, total: 10000 },
      ]);
    });

    it('funciona sobre una sesión ya cerrada', async () => {
      prismaMock.cash_register_sessions.findFirst.mockResolvedValue({
        ...OPEN_SESSION,
        status: 'closed',
      });
      prismaMock.cash_register_movements.findMany.mockResolvedValue([
        ...REPRO_MOVEMENTS,
        { type: 'closing_balance', amount: EXPECTED_FRESH, payment_method: 'cash' },
      ]);

      const summary = await service.getCashSummary(SESSION_ID);

      // `closing_balance` no participa: la apertura ya entra por
      // `session.opening_amount` y el cierre no es un movimiento de caja.
      expect(summary.expected_cash_total).toBe(EXPECTED_FRESH);
      expect(summary.sales_total).toBe(0);
    });

    it('lanza 404 cuando la sesión no existe', async () => {
      prismaMock.cash_register_sessions.findFirst.mockResolvedValue(null);

      await expect(service.getCashSummary(SESSION_ID)).rejects.toThrow(
        'Sesión de caja no encontrada',
      );
    });
  });

  /**
   * QUI-784 — el "Resumen IA del Cierre" mostraba "USD" hardcodeado para todas
   * las tiendas porque la plantilla del AI app y `formatGrouped` inyectaban `$`
   * literal. Antes del fix, la única moneda que viajaba al prompt era el símbolo
   * `$`, así que el AI interpretaba cualquier tienda como USD. Ahora la moneda
   * real de la tienda viaja al reporte y al prompt; sin esos cambios el AI sigue
   * etiquetando todo como USD por reflejo de entrenamiento.
   */
  describe('QUI-784 — moneda real viaja al resumen IA del cierre', () => {
    /**
     * `findOne` hace `findFirst` con `include.movements`, así que el mock tiene
     * que devolver una sesión con `movements: []` para que `groupMovementsByType`
     * no falle. El reporte no lee `cash_register_movements.findMany` (eso lo
     * usa `getCashSummary`).
     */
    const stubSessionWithMovements = () => {
      prismaMock.cash_register_sessions.findFirst.mockResolvedValue({
        ...OPEN_SESSION,
        movements: [],
      });
    };

    it('getSessionReport expone currency.code de la tienda', async () => {
      stubSessionWithMovements();

      const report = await service.getSessionReport(SESSION_ID);

      expect(report.currency).toEqual({ code: 'COP', symbol: '$' });
    });

    it('USD para tienda en USD: el código cambia, el símbolo también es $', async () => {
      (service as any).settingsService.getStoreCurrency.mockResolvedValue('USD');
      stubSessionWithMovements();

      const report = await service.getSessionReport(SESSION_ID);

      expect(report.currency).toEqual({ code: 'USD', symbol: '$' });
    });

    it('EUR para tienda europea: símbolo €, código EUR', async () => {
      (service as any).settingsService.getStoreCurrency.mockResolvedValue('EUR');
      stubSessionWithMovements();

      const report = await service.getSessionReport(SESSION_ID);

      expect(report.currency).toEqual({ code: 'EUR', symbol: '€' });
    });

    it('incluye currency_code y currency_symbol explícitos para el AI app', async () => {
      stubSessionWithMovements();

      const report = await service.getSessionReport(SESSION_ID);

      expect(report.currency.code).toBe('COP');
      expect(report.currency.symbol).toBe('$');
      // El reporte ya NO depende de inferencia desde `session.register` ni de
      // valores hardcoded; el AI app debe leer esto explícitamente.
    });

    it('incluye en el resumen IA todas las órdenes que quedaron pendientes', () => {
      const section = (service as any).pendingOrdersSummarySection({
        currency: { code: 'COP', symbol: '$' },
        pending_orders_snapshot: {
          status: 'tracked',
          rows: [
            { order_number: 'POS-2026-0033', state: 'draft', grand_total: 180000, remaining_balance: 180000 },
            { order_number: 'POS-2026-0034', state: 'processing', grand_total: 95000, remaining_balance: 0 },
          ],
        },
      });

      expect(section).toContain('POS-2026-0033 · Borrador · Total $180.000 COP · Falta cobrar $180.000 COP');
      expect(section).toContain('POS-2026-0034 · En proceso · Total $95.000 COP');
      expect(section.match(/^- POS-/gm)).toHaveLength(2);
    });

    it('no afirma que no quedaron órdenes si la sesión no tenía seguimiento', () => {
      const section = (service as any).pendingOrdersSummarySection({
        pending_orders_snapshot: { status: 'untracked', rows: [] },
      });

      expect(section).toContain('No se pudo confirmar cuáles órdenes quedaron pendientes');
      expect(section).not.toContain('No quedaron órdenes pendientes.');
    });

    it('getStoreCurrency devuelve "USD" cuando SettingsService no resuelve moneda', async () => {
      // SettingsService.getStoreCurrency ya tiene try/catch interno que cae a
      // 'USD'. Este test documenta que la integración con getSessionReport
      // respeta ese fallback sin necesidad de catch adicional acá.
      (service as any).settingsService.getStoreCurrency.mockResolvedValue('USD');
      stubSessionWithMovements();

      const report = await service.getSessionReport(SESSION_ID);

      expect(report.currency).toEqual({ code: 'USD', symbol: '$' });
    });
  });

  describe('getCloseReport — cierre consolidado', () => {
    const ORDER_A = 501; // con domicilio con impuesto
    const ORDER_B = 502; // reembolsada
    const rows = {
      orders: [
        {
          id: ORDER_A,
          subtotal_amount: 100000,
          discount_amount: 10000,
          tax_amount: 7200,
          shipping_cost: 10800, // BRUTO: 10.000 neto + 800 de impuesto
          shipping_tax_amount: 800,
          tip_amount: 2000,
          grand_total: 110000,
          coupon_code: null,
        },
        {
          id: ORDER_B,
          subtotal_amount: 50000,
          discount_amount: 0,
          tax_amount: 4000,
          shipping_cost: 0,
          shipping_tax_amount: 0,
          tip_amount: 0,
          grand_total: 54000,
          coupon_code: null,
        },
      ],
    };

    beforeEach(() => {
      prismaMock.cash_register_sessions.findFirst.mockResolvedValue({
        ...OPEN_SESSION,
        opened_at: new Date('2026-09-28T13:00:00Z'),
        closed_at: null,
        opened_by: USER_ID,
        closed_by: null,
        register: null,
        opened_by_user: null,
        closed_by_user: null,
      });
      prismaMock.cash_register_movements.findMany.mockResolvedValue([
        { id: 1, type: 'sale', amount: 110000, payment_method: 'cash', order_id: ORDER_A, session_id: SESSION_ID, created_at: new Date('2026-09-28T14:00:00Z') },
        { id: 2, type: 'sale', amount: 54000, payment_method: 'bank_transfer', order_id: ORDER_B, session_id: SESSION_ID, created_at: new Date('2026-09-28T15:00:00Z') },
        { id: 3, type: 'refund', amount: 54000, payment_method: 'bank_transfer', reference: 'refund:9', order_id: ORDER_B },
        { id: 4, type: 'refund', amount: 1000, payment_method: 'cash', reference: 'payment_cancelled', order_id: ORDER_A },
      ]);
      prismaMock.orders = {
        findMany: jest.fn().mockImplementation(async (args: any) => {
          if (args?.where?.remaining_balance) {
            return [
              { remaining_balance: 30000 },
              { remaining_balance: 12500.5 },
            ];
          }
          return rows.orders;
        }),
      };
      prismaMock.order_promotions = { findMany: jest.fn().mockResolvedValue([]) };
      prismaMock.coupon_uses = { findMany: jest.fn().mockResolvedValue([]) };
      prismaMock.refunds = {
        findMany: jest.fn().mockResolvedValue([
          { id: 9, amount: 54000, tax_refund: 4000, refund_method: 'bank_transfer' },
        ]),
      };
    });

    it('separa impuesto de productos y de domicilio, con envío neto y total cuadrado', async () => {
      const report = await service.getCloseReport(SESSION_ID);
      const s = report.sales;

      expect(s.product_taxes).toBe(11200);
      expect(s.shipping_taxes).toBe(800);
      expect(s.taxes).toBe(s.product_taxes + s.shipping_taxes);
      expect(s.shipping).toBe(10000);
      // Subtotal − Descuentos + Impuestos + Envíos + Propinas === Total cobrado
      expect(
        s.subtotal - s.discounts + s.taxes + s.shipping + s.tips,
      ).toBe(s.grand_total);
      expect(s.grand_total).toBe(164000);
    });

    it('bloque returns y net se derivan de los mismos valores que refunds', async () => {
      const report = await service.getCloseReport(SESSION_ID);

      expect(report.returns).toEqual({
        refunds_count: 1,
        refunds_total: 54000,
        refunds_tax: 4000,
        payments_cancelled_count: 1,
        payments_cancelled_total: 1000,
      });
      expect(report.returns.refunds_total).toBe(report.refunds.total);
      expect(report.returns.payments_cancelled_total).toBe(
        report.refunds.payment_cancellations.total,
      );
      expect(report.net.net_sales).toBe(164000 - 54000 - 1000);
      expect(report.net.net_taxes).toBe(report.sales.taxes - 4000);
    });

    it('pending_collection cuenta órdenes shipped/delivered con saldo', async () => {
      const report = await service.getCloseReport(SESSION_ID);

      expect(report.pending_collection).toEqual({ count: 2, total: 42500.5 });
      const call = prismaMock.orders.findMany.mock.calls.find(
        (c: any[]) => c[0]?.where?.origin_cash_session_id,
      );
      expect(call[0].where.origin_cash_session_id).toBe(SESSION_ID);
      expect(call[0].where.remaining_balance).toEqual({ gt: 0.01 });
    });

    it('pending_collection cerrado reproduce la foto del cierre sin consultar órdenes actuales', async () => {
      prismaMock.cash_register_sessions.findFirst.mockResolvedValue({
        ...OPEN_SESSION,
        status: 'closed',
        summary: {
          pending_orders_snapshot: {
            rows: [
              { id: 1, remaining_balance: 125.5 },
              { id: 2, remaining_balance: 0 },
            ],
          },
        },
        opened_at: new Date('2026-09-28T13:00:00Z'),
        closed_at: new Date('2026-09-28T18:00:00Z'),
        opened_by: USER_ID,
        closed_by: USER_ID,
        register: null,
        opened_by_user: null,
        closed_by_user: null,
      });

      const report = await service.getCloseReport(SESSION_ID);

      expect(report.pending_collection).toEqual({ count: 1, total: 125.5 });
      expect(
        prismaMock.orders.findMany.mock.calls.some(
          (call: any[]) => call[0]?.where?.origin_cash_session_id,
        ),
      ).toBe(false);
    });
  });

  describe('getCloseReport — consolidado por método, salidas e integridad', () => {
    const T = (h: number) => new Date(`2026-09-28T${h}:00:00Z`);
    const base = {
      ...OPEN_SESSION,
      opened_at: T(13),
      closed_at: null,
      opened_by: USER_ID,
      closed_by: null,
      register: null,
      opened_by_user: null,
      closed_by_user: null,
    };
    const movs = [
      { id: 1, type: 'sale', amount: 100000, payment_method: 'cash', order_id: 1, session_id: SESSION_ID, created_at: T(14) },
      { id: 2, type: 'sale', amount: 60000, payment_method: 'card', order_id: 2, session_id: SESSION_ID, created_at: T(14) },
      { id: 3, type: 'sale', amount: 40000, payment_method: 'bank_transfer', order_id: 3, session_id: SESSION_ID, created_at: T(15) },
      { id: 4, type: 'refund', amount: 5000, payment_method: 'cash', reference: 'refund:9', order_id: 1, notes: null, created_at: T(16), user: { first_name: 'Ana', last_name: 'Paz' } },
      { id: 5, type: 'refund', amount: 60000, payment_method: 'card', reference: 'payment_cancelled', order_id: 2, created_at: T(17) },
      { id: 6, type: 'cash_out', amount: 7000, payment_method: 'cash', reference: 'Cancelación orden #X', order_id: 3, created_at: T(18) },
      { id: 7, type: 'cash_out', amount: 3000, payment_method: 'cash', reference: null, notes: 'Compra hielo', created_at: T(19) },
      { id: 8, type: 'cash_in', amount: 2000, payment_method: 'cash', created_at: T(20) },
      { id: 9, type: 'opening_balance', amount: OPENING_AMOUNT, payment_method: 'cash' },
    ];

    const wire = (session: any, orders: any[]) => {
      prismaMock.cash_register_sessions.findFirst.mockResolvedValue(session);
      prismaMock.cash_register_movements.findMany.mockResolvedValue(movs);
      prismaMock.orders = {
        findMany: jest.fn().mockImplementation(async (args: any) => {
          if (args?.where?.state) return [];
          return orders;
        }),
      };
      prismaMock.order_promotions = { findMany: jest.fn().mockResolvedValue([]) };
      prismaMock.coupon_uses = { findMany: jest.fn().mockResolvedValue([]) };
      prismaMock.refunds = {
        findMany: jest.fn().mockResolvedValue([{ id: 9, reason: 'Producto dañado', amount: 5000 }]),
      };
    };
    const ord = (id: number, total: number, state = 'finished') => ({
      id, order_number: `ORD-${id}`, state, subtotal_amount: total, discount_amount: 0,
      tax_amount: 0, shipping_cost: 0, shipping_tax_amount: 0, tip_amount: 0, grand_total: total, coupon_code: null,
    });

    it('arma filas por método y la fila cash coincide con el esperado vigente', async () => {
      wire(base, [ord(1, 100000), ord(2, 60000, 'cancelled'), ord(3, 40000, 'refunded')]);
      const report = await service.getCloseReport(SESSION_ID);
      const cash = report.consolidated.rows[0];
      expect(cash.method).toBe('cash');
      expect(cash).toMatchObject({
        sales: 100000, cash_in: 2000, entered: 102000,
        refunds: 5000, cancellations: 7000, withdrawals: 3000, exited: 15000,
        expected: 187000, counted: null, difference: null,
      });
      // esperado vigente: 100000 + 100000 + 2000 − 5000 − (7000 + 3000)
      expect(cash.expected).toBe(
        (await service.getCashSummary(SESSION_ID)).expected_cash_total,
      );
      expect(report.cash.expected).toBe(cash.expected);
      const card = report.consolidated.rows.find((r) => r.method === 'card')!;
      expect(card).toMatchObject({ entered: 60000, exited: 60000, expected: 0, counted: null });
      const bank = report.consolidated.rows.find((r) => r.method === 'bank_transfer')!;
      expect(bank.expected).toBe(40000);
      expect(report.consolidated.rows.map((r) => r.method)).toEqual(['cash', 'card', 'bank_transfer']);
      expect(report.consolidated.totals).toEqual({ entered: 202000, exited: 75000, expected: 227000 });
      expect(report.cash_breakdown).toMatchObject({
        opening: 100000, sales: 100000, cash_in: 2000, refunds: 5000,
        cancellations: 7000, withdrawals: 3000, expected: 187000,
      });
    });

    it('lista única de salidas con tipo, orden, motivo y usuario', async () => {
      wire(base, [ord(1, 100000), ord(2, 60000, 'cancelled'), ord(3, 40000, 'refunded')]);
      const { outflows } = await service.getCloseReport(SESSION_ID);
      expect(outflows.map((o) => [o.id, o.kind, o.payment_method, o.amount])).toEqual([
        [4, 'refund', 'cash', 5000],
        [5, 'cancellation', 'card', 60000],
        [6, 'cancellation', 'cash', 7000],
        [7, 'withdrawal', 'cash', 3000],
      ]);
      expect(outflows[0]).toMatchObject({ reason: 'Producto dañado', user_name: 'Ana Paz', order_number: 'ORD-1' });
      expect(outflows[3].reason).toBe('Compra hielo');
    });

    it('outflow withdrawal expone reference y notes y conserva reason', async () => {
      wire(base, [ord(1, 100000)]);
      prismaMock.cash_register_movements.findMany.mockResolvedValue([
        ...movs,
        { id: 10, type: 'cash_out', amount: 1500, payment_method: 'cash', reference: '  Taxi  ', notes: ' Mensajero ', created_at: T(21) },
      ]);
      const { outflows } = await service.getCloseReport(SESSION_ID);
      const w = outflows.find((o) => o.id === 10)!;
      expect(w).toMatchObject({ kind: 'withdrawal', reference: 'Taxi', notes: 'Mensajero', reason: ' Mensajero ' });
    });

    it('referencias internas no se exponen como reference', async () => {
      wire(base, [ord(1, 100000)]);
      prismaMock.cash_register_movements.findMany.mockResolvedValue([
        ...movs,
        { id: 11, type: 'refund', amount: 100, payment_method: 'cash', reference: 'order_cancelled', created_at: T(21) },
      ]);
      const { outflows } = await service.getCloseReport(SESSION_ID);
      expect(outflows.find((o) => o.id === 4)!.reference).toBeNull(); // refund:9
      expect(outflows.find((o) => o.id === 5)!.reference).toBeNull(); // payment_cancelled
      expect(outflows.find((o) => o.id === 11)!.reference).toBeNull(); // order_cancelled
      expect(outflows.find((o) => o.id === 7)!.reference).toBeNull(); // sin reference
      expect(humanCashReference('dispatch_route:1:stop:2')).toBeNull();
      expect(humanCashReference('   ')).toBeNull();
    });

    it('inflows lista los cash_in con reference/notes ordenados', async () => {
      wire(base, [ord(1, 100000)]);
      prismaMock.cash_register_movements.findMany.mockResolvedValue([
        { id: 21, type: 'cash_in', amount: 500, payment_method: 'cash', reference: 'Cambio', notes: 'Billetes', created_at: T(22), user: { first_name: 'Ana', last_name: 'Paz' } },
        ...movs,
        { id: 20, type: 'cash_in', amount: 300.456, payment_method: 'cash', reference: 'refund:3', notes: null, created_at: T(20) },
      ]);
      const { inflows } = await service.getCloseReport(SESSION_ID);
      expect(inflows).toEqual([
        { id: 8, at: T(20).toISOString(), amount: 2000, reference: null, notes: null, user_name: null, payment_method: 'cash' },
        { id: 20, at: T(20).toISOString(), amount: 300.46, reference: null, notes: null, user_name: null, payment_method: 'cash' },
        { id: 21, at: T(22).toISOString(), amount: 500, reference: 'Cambio', notes: 'Billetes', user_name: 'Ana Paz', payment_method: 'cash' },
      ]);
    });

    it('sesión cerrada con snapshot viejo: enriquece reference/notes/inflows sin escribir', async () => {
      const snapshot = {
        outflows: [
          { id: 7, at: T(19).toISOString(), kind: 'withdrawal', order_id: null, order_number: null, payment_method: 'cash', amount: 3000, reason: 'Compra hielo', user_name: null },
          { id: 999, at: T(19).toISOString(), kind: 'withdrawal', order_id: null, order_number: null, payment_method: 'cash', amount: 1, reason: null, user_name: null },
        ],
      };
      wire({ ...base, status: 'closed', closed_at: T(21), actual_closing_amount: 187000, expected_closing_amount: 187000, difference: 0, summary: snapshot }, [ord(1, 100000)]);
      prismaMock.cash_register_movements.findMany.mockResolvedValue(
        movs.map((m) => (m.id === 7 ? { ...m, reference: 'Hielo', notes: 'Compra hielo' } : m)),
      );
      prismaMock.cash_register_sessions.update = jest.fn();
      const r = await service.getCloseReport(SESSION_ID);
      expect(r.outflows[0]).toMatchObject({ id: 7, reference: 'Hielo', notes: 'Compra hielo', reason: 'Compra hielo' });
      expect(r.outflows[1]).toMatchObject({ id: 999, reference: null, notes: null });
      expect(r.inflows.map((i) => i.id)).toEqual([8]);
      expect(prismaMock.cash_register_sessions.update).not.toHaveBeenCalled();
      expect(prismaMock.cash_register_sessions.updateMany).not.toHaveBeenCalled();
    });

    it('sales_summary excluye canceladas/reembolsadas y total cobrado sale de movimientos', async () => {
      wire(base, [ord(1, 100000), ord(2, 60000, 'cancelled'), ord(3, 40000, 'refunded')]);
      const r = await service.getCloseReport(SESSION_ID);
      expect(r.sales_summary).toMatchObject({
        orders_count: 1, payments_count: 3, subtotal: 100000,
        grand_total: 200000, orders_grand_total: 100000,
        cancelled: { count: 2, total: 100000 },
      });
      expect(r.sales.orders_count).toBe(3); // bloque legado intacto
      expect(r.integrity).toEqual({ sales_match: true, notes: [] });
    });

    it('integrity marca pago parcial en vez de esconderlo', async () => {
      wire(base, [ord(1, 130000), ord(2, 60000), ord(3, 40000)]);
      const r = await service.getCloseReport(SESSION_ID);
      expect(r.integrity.sales_match).toBe(false);
      expect(r.integrity.notes.join(' ')).toContain('ORD-1');
    });

    it('sesión cerrada con snapshot: usa el snapshot, no recalcula', async () => {
      const snapshot = {
        consolidated: { rows: [], totals: { entered: 1, exited: 2, expected: 3 } },
        cash_breakdown: { opening: 1, sales: 0, cash_in: 0, refunds: 0, cancellations: 0, withdrawals: 0, expected: 1, counted: 1, difference: 0 },
        outflows: [],
      };
      wire({ ...base, status: 'closed', closed_at: T(21), actual_closing_amount: 187000, expected_closing_amount: 187000, difference: 0, summary: snapshot }, [ord(1, 100000)]);
      const r = await service.getCloseReport(SESSION_ID);
      expect(r.consolidated).toEqual(snapshot.consolidated);
      expect(r.cash_breakdown).toEqual(snapshot.cash_breakdown);
      expect(r.outflows).toEqual([]);
    });

    it('sesión cerrada sin snapshot (vieja): calcula en vivo con counted', async () => {
      wire({ ...base, status: 'closed', closed_at: T(21), actual_closing_amount: 186000, expected_closing_amount: 187000, difference: -1000, summary: { by_type: {} } }, [ord(1, 100000)]);
      const r = await service.getCloseReport(SESSION_ID);
      expect(r.consolidated.rows[0]).toMatchObject({ counted: 186000, difference: -1000 });
      expect(r.outflows).toHaveLength(4);
    });

    it('closeSession guarda consolidated, cash_breakdown y outflows en summary sin borrar claves', async () => {
      prismaMock.cash_register_sessions.findFirst
        .mockResolvedValueOnce({ ...OPEN_SESSION, summary: { extra: 'keep' } })
        .mockResolvedValueOnce({ ...OPEN_SESSION, status: 'closed' });
      prismaMock.cash_register_movements.findMany.mockResolvedValue(movs);
      prismaMock.orders = { findMany: jest.fn().mockResolvedValue([]) };
      prismaMock.refunds = { findMany: jest.fn().mockResolvedValue([]) };
      await service.closeSession(SESSION_ID, { actual_closing_amount: 187000 } as any);
      const data = prismaMock.cash_register_sessions.updateMany.mock.calls[0][0].data;
      expect(data.summary.extra).toBe('keep');
      expect(data.summary.by_type).toBeDefined();
      expect(data.summary.consolidated.rows[0]).toMatchObject({ method: 'cash', counted: 187000, difference: 0 });
      expect(data.summary.cash_breakdown.counted).toBe(187000);
      expect(data.summary.outflows).toHaveLength(4);
      expect(data.summary.inflows).toHaveLength(1);
      expect(data.expected_closing_amount).toBe(187000);
    });
  });

  /**
   * Gate único de caja para cobros (`assertSessionForSales`): con
   * `pos.cash_register.enabled`, quien cobra debe tener SU sesión abierta
   * (`require_session_for_sales` está obsoleto y se ignora). Lo consumen `processPosPayment` (ventas, no
   * borradores), `processPayment`, `payOrder`, `registerCreditPayment` y el
   * cobro de cuentas divididas.
   */
  describe('assertSessionForSales — gate único de caja para cobros', () => {
    const withCashSettings = (cash_register: Record<string, unknown>) => {
      (service as any).settingsService.getSettings.mockResolvedValue({
        pos: { cash_register },
      });
    };

    it('switch apagado (módulo deshabilitado): no lanza ni busca sesión', async () => {
      withCashSettings({ enabled: false, require_session_for_sales: true });

      await expect(service.assertSessionForSales(USER_ID)).resolves.toBeUndefined();
      expect(
        prismaMock.cash_register_sessions.findFirst,
      ).not.toHaveBeenCalled();
    });

    it('caja activa + require_session_for_sales=false + sin sesión: igual lanza CASH_SESSION_REQUIRED_001 (flag obsoleto)', async () => {
      withCashSettings({ enabled: true, require_session_for_sales: false });
      prismaMock.cash_register_sessions.findFirst.mockResolvedValue(null);

      await expect(service.assertSessionForSales(USER_ID)).rejects.toMatchObject({
        errorCode: 'CASH_SESSION_REQUIRED_001',
      });
    });

    it('switch encendido + sesión propia: no lanza', async () => {
      withCashSettings({ enabled: true, require_session_for_sales: true });
      prismaMock.cash_register_sessions.findFirst.mockResolvedValue({
        id: SESSION_ID,
        opened_by: USER_ID,
      });

      await expect(service.assertSessionForSales(USER_ID)).resolves.toBeUndefined();
      expect(
        prismaMock.cash_register_sessions.findFirst,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            store_id: STORE_ID,
            status: 'open',
            opened_by: USER_ID,
          }),
        }),
      );
    });

    it('switch encendido + sin sesión: lanza CASH_SESSION_REQUIRED_001 (409)', async () => {
      withCashSettings({ enabled: true, require_session_for_sales: true });
      prismaMock.cash_register_sessions.findFirst.mockResolvedValue(null);

      const promise = service.assertSessionForSales(USER_ID);

      await expect(promise).rejects.toThrow(VendixHttpException);
      await expect(promise).rejects.toMatchObject({
        errorCode: 'CASH_SESSION_REQUIRED_001',
      });
      await promise.catch((error: VendixHttpException) => {
        expect(error.getStatus()).toBe(409);
        expect(error.getResponse()).toMatchObject({
          error_code: 'CASH_SESSION_REQUIRED_001',
          message: 'Abre tu caja para registrar pagos.',
        });
      });
      expect.assertions(4);
    });

    it('fail-closed: sin userId rechaza aunque haya sesiones abiertas en la tienda', async () => {
      withCashSettings({ enabled: true, require_session_for_sales: true });

      await expect(service.assertSessionForSales(undefined)).rejects.toMatchObject({
        errorCode: 'CASH_SESSION_REQUIRED_001',
      });
      // No cae al lookup de tienda de `getActiveSession` (sin `opened_by`).
      expect(
        prismaMock.cash_register_sessions.findFirst,
      ).not.toHaveBeenCalled();
    });
  });
});
