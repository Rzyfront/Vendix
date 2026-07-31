import { SessionsService } from './sessions.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { MovementsService } from '../movements/movements.service';
import { AIEngineService } from '../../../../ai-engine/ai-engine.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors';

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
  const stubCloseFlow = (closed: Record<string, unknown>) => {
    prismaMock.cash_register_sessions.findFirst
      .mockResolvedValueOnce(OPEN_SESSION)
      .mockResolvedValueOnce({ ...OPEN_SESSION, status: 'closed', ...closed });
  };

  beforeEach(() => {
    jest.clearAllMocks();

    prismaMock = {
      cash_register_sessions: {
        findFirst: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      cash_register_movements: {
        findMany: jest.fn().mockResolvedValue(REPRO_MOVEMENTS),
        create: jest.fn().mockResolvedValue({}),
      },
      stores: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ organization_id: ORGANIZATION_ID }),
      },
      $transaction: jest.fn((cb: any) => cb(prismaMock)),
    };

    event_emitter = { emit: jest.fn() };

    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      store_id: STORE_ID,
      organization_id: ORGANIZATION_ID,
      user_id: USER_ID,
      is_super_admin: false,
    } as any);

    service = new SessionsService(
      prismaMock as unknown as StorePrismaService,
      {} as unknown as MovementsService,
      event_emitter as any,
      {} as unknown as AIEngineService,
    );
  });

  describe('closeSession — candado de esperado rancio', () => {
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

      // Lo que importa: el rechazo ocurre ANTES de abrir la transacción, así que
      // no queda ninguna escritura a medias ni un faltante inventado.
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
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

    it('cierra igual que antes cuando el campo no llega (compatibilidad con apps/mobile)', async () => {
      const actual = OPENING_AMOUNT;
      stubCloseFlow({
        expected_closing_amount: EXPECTED_FRESH,
        actual_closing_amount: actual,
        difference: actual - EXPECTED_FRESH,
      });

      // Sin `expected_closing_amount_seen` el comportamiento es el de hoy:
      // se cierra y se registra el faltante calculado contra datos frescos.
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
});
