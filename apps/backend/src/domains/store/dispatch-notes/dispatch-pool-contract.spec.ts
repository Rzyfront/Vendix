import { DispatchNotesService } from './dispatch-notes.service';
import { RequestContextService } from '@common/context/request-context.service';
import {
  poolMembershipWhere,
  POOL_VISIBLE_ORDER_STATES,
  POOL_PUBLISHABLE_ORDER_STATES,
} from '../carrier/carrier-pool.contract';

/**
 * Contrato del pool de despacho — regresión medida en producción.
 *
 * El flujo publica creando la remisión (`items: []` = quick-accept de todo lo
 * pendiente), así que `orders.dispatch_fulfillment` queda en `'full'` para toda
 * orden pooleada SANA. Con eso, dos cosas se rompieron a la vez:
 *
 *  1. `listPool` / `claim` filtraban `dispatch_fulfillment != 'full'` → la orden
 *     se publicaba con `success: true` y NUNCA aparecía en la app de reparto.
 *     Medido en prod: 5 de 6 órdenes pooleadas invisibles, y la única visible
 *     era una `finished` con el flag de pool rancio.
 *  2. Re-publicar devolvía 400 DSP_ORDER_STATE_001 porque las validaciones de
 *     entrada corrían ANTES de resolver la idempotencia, y la propia
 *     publicación anterior había dejado la orden en `'full'`.
 *
 * Estas pruebas fijan las dos mitades: la forma del predicado (para que lector y
 * claim no vuelvan a divergir del productor) y la idempotencia del publicador.
 */
describe('Contrato del pool de despacho — predicado de pertenencia', () => {
  it('NO restringe dispatch_fulfillment (el rollup queda en "full" al publicar)', () => {
    const where = poolMembershipWhere() as Record<string, unknown>;
    expect(where).not.toHaveProperty('dispatch_fulfillment');
  });

  it('exige publicada y sin reclamar', () => {
    const where = poolMembershipWhere();
    expect(where.dispatch_pool_at).toEqual({ not: null });
    expect(where.claimed_by_carrier_user_id).toBeNull();
  });

  it('mantiene visible una orden que el reconciliador ya subió a "shipped"', () => {
    // Sin `shipped`, la orden se autoexpulsaría del pool minutos después de
    // publicarla: `sendToDispatchPool` crea la remisión en `confirmed` y
    // `reconcileOrderFromDispatch` avanza la orden a `shipped` cuando no hay
    // parada de ruta abierta que la limite.
    expect([...POOL_VISIBLE_ORDER_STATES]).toContain('shipped');
    expect(poolMembershipWhere().state).toEqual({
      in: [...POOL_VISIBLE_ORDER_STATES],
    });
  });

  it('excluye los estados donde ya no hay nada que entregar', () => {
    const visible = [...POOL_VISIBLE_ORDER_STATES] as string[];
    for (const terminal of [
      'delivered',
      'finished',
      'cancelled',
      'refunded',
      'draft',
      'created',
    ]) {
      expect(visible).not.toContain(terminal);
    }
  });

  it('publicar exige un estado PRE-despacho (subconjunto estricto de lo visible)', () => {
    const publishable = [...POOL_PUBLISHABLE_ORDER_STATES] as string[];
    const visible = [...POOL_VISIBLE_ORDER_STATES] as string[];
    expect(publishable).toEqual(['processing', 'pending_payment']);
    expect(publishable.every((s) => visible.includes(s))).toBe(true);
    expect(publishable).not.toContain('shipped');
  });
});

describe('DispatchNotesService.sendToDispatchPool — idempotencia', () => {
  let service: DispatchNotesService;
  let prismaMock: any;
  let eventEmitterMock: any;

  const STORE_ID = 64;
  const USER_ID = 1;
  const ORDER_ID = 3338;
  const POOLED_AT = new Date('2026-08-06T20:53:45.538Z');

  const buildService = () => {
    service = new DispatchNotesService(
      prismaMock,
      { generateNextNumber: jest.fn() } as any,
      {} as any, // routeNumberGenerator
      eventEmitterMock,
      {} as any, // stockValidator
      {} as any, // aiEngine
      {} as any, // receiptScanQueue
      { recomputeOrderFulfillment: jest.fn() } as any,
      undefined, // purchaseOrdersService (optional)
    );
  };

  beforeEach(() => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: STORE_ID, user_id: USER_ID } as any);

    prismaMock = {
      orders: { findFirst: jest.fn(), updateMany: jest.fn() },
      dispatch_notes: { count: jest.fn() },
    };
    eventEmitterMock = { emit: jest.fn() };
    buildService();
  });

  afterEach(() => jest.restoreAllMocks());

  it('una orden YA pooleada responde already_pooled en vez de 400 (forma exacta del bug de prod)', async () => {
    prismaMock.orders.findFirst.mockResolvedValue({
      id: ORDER_ID,
      state: 'processing',
      delivery_type: 'home_delivery',
      // Lo que la propia publicación anterior dejó — y lo que hacía estallar el
      // guard de `full` cuando corría antes de la idempotencia.
      dispatch_fulfillment: 'full',
      dispatch_pool_at: POOLED_AT,
    });

    const res = await service.sendToDispatchPool(ORDER_ID);

    expect(res).toEqual({
      order_id: ORDER_ID,
      pooled_at: POOLED_AT.toISOString(),
      already_pooled: true,
    });
    // No re-publica ni re-notifica: es un no-op puro.
    expect(prismaMock.orders.updateMany).not.toHaveBeenCalled();
    expect(eventEmitterMock.emit).not.toHaveBeenCalled();
  });

  it('el atajo idempotente NO revalida el estado (una orden pooleada ya "shipped" no da 400)', async () => {
    prismaMock.orders.findFirst.mockResolvedValue({
      id: 3337,
      // Fuera de POOL_PUBLISHABLE_ORDER_STATES: si el atajo no fuera primero,
      // esto sería DSP_ORDER_STATE_001 sobre una orden sana en el pool.
      state: 'shipped',
      delivery_type: 'home_delivery',
      dispatch_fulfillment: 'full',
      dispatch_pool_at: POOLED_AT,
    });

    await expect(service.sendToDispatchPool(3337)).resolves.toMatchObject({
      already_pooled: true,
    });
  });

  it('una orden NO pooleada y 100% remitida se publica si queda una remisión tomable', async () => {
    // Escenario de recuperación: una publicación anterior creó la remisión y
    // murió antes de escribir `dispatch_pool_at` (los dos pasos no comparten
    // transacción). El guard de `full` a secas la dejaba en 400 permanente.
    prismaMock.orders.findFirst.mockResolvedValue({
      id: ORDER_ID,
      state: 'processing',
      delivery_type: 'home_delivery',
      dispatch_fulfillment: 'full',
      dispatch_pool_at: null,
    });
    prismaMock.dispatch_notes.count
      .mockResolvedValueOnce(1) // remisiones tomables (sin parada activa)
      .mockResolvedValueOnce(1); // remisiones activas → NO se crea otra
    prismaMock.orders.updateMany.mockResolvedValue({ count: 1 });

    const res = await service.sendToDispatchPool(ORDER_ID);

    expect(res.already_pooled).toBe(false);
    expect(res.order_id).toBe(ORDER_ID);
    expect(eventEmitterMock.emit).toHaveBeenCalledWith('order.awaiting_carrier', {
      order_id: ORDER_ID,
      store_id: STORE_ID,
    });
  });

  it('una orden NO pooleada y 100% remitida SIN nada tomable sigue rechazada', async () => {
    prismaMock.orders.findFirst.mockResolvedValue({
      id: ORDER_ID,
      state: 'processing',
      delivery_type: 'home_delivery',
      dispatch_fulfillment: 'full',
      dispatch_pool_at: null,
    });
    // Todas sus remisiones ya están en una parada activa o son terminales.
    prismaMock.dispatch_notes.count.mockResolvedValueOnce(0);

    await expect(service.sendToDispatchPool(ORDER_ID)).rejects.toMatchObject({
      errorCode: 'DSP_ORDER_STATE_001',
    });
    expect(prismaMock.orders.updateMany).not.toHaveBeenCalled();
  });
});
