import { OrderFlowService } from './order-flow.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { PaymentType } from './dto';

/**
 * Regresión de la compensación de pago en {@link OrderFlowService.payOrder}
 * rama `direct → finished` (POS).
 *
 * El pago (`state:'succeeded'`) se crea ANTES del finish. Si el finish bloquea
 * por stock insuficiente (`INV_STOCK_002`) o seriales faltantes
 * (`SERIAL_REQUIRED_001`), la orden queda `created` y ese pago quedaría
 * HUÉRFANO. Regla de negocio (confirmada): mantener + compensar → anular el
 * pago (`state:'cancelled'` + razón, preservando auditoría) y propagar el 409.
 *
 * El guard de cocina (`ORDER_HAS_PENDING_KITCHEN_ITEMS`) NO compensa: ahí
 * retener el pago es intencional. La compensación es exclusiva del throw de
 * `updateOrderState('finished')`.
 */
describe('OrderFlowService — compensación de pago POS cuando el finish bloquea', () => {
  let service: OrderFlowService;
  let prismaMock: any;

  const buildOrder = () => ({
    id: 1,
    state: 'created',
    delivery_type: 'direct_delivery', // → requiresFulfillment=false → intenta finished
    grand_total: 4000,
    currency: 'COP',
    store_id: 4,
  });

  const DTO: any = { store_payment_method_id: 1, payment_type: PaymentType.DIRECT };

  const CREATED_PAYMENT = {
    id: 999,
    gateway_response: { payment_type: 'direct' },
  };

  beforeEach(() => {
    prismaMock = {
      store_payment_methods: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 1, system_payment_method: { type: 'card' } }),
      },
      payments: {
        create: jest.fn().mockResolvedValue(CREATED_PAYMENT),
        update: jest.fn().mockResolvedValue({}),
      },
      // Round 1 MAJOR #13: payOrder ahora llama commitCouponUseForOrder
      // después de cada pago creado. La orden mockeada (buildOrder) NO trae
      // `coupon_id`, así que el primer findFirst devuelve `null` y el método
      // retorna sin tocar cupones. Mock explícito para evitar TypeErrors.
      orders: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      coupon_uses: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      coupons: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };

    // 9 args del constructor (incluye AuditService — F.2). Sólo `prisma`
    // se ejercita directamente; el resto se espía o no se alcanza en la
    // rama de bloqueo.
    service = new OrderFlowService(
      prismaMock as unknown as StorePrismaService,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { logCustom: jest.fn().mockResolvedValue(undefined) } as any,
    );

    // Aísla la rama: métodos privados/colaboradores reducidos a stubs.
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(buildOrder());
    jest
      .spyOn(service as any, 'generateTransactionId')
      .mockResolvedValue('TXN-1');
    jest
      .spyOn(service as any, 'hasPendingKitchenItems')
      .mockResolvedValue(false);
    jest.spyOn(service as any, 'validateTransition').mockReturnValue(undefined);
    jest
      .spyOn(service as any, 'recordPayOrderCashMovement')
      .mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'computeAndPersistEta')
      .mockResolvedValue(undefined);
  });

  it('finish → INV_STOCK_002: anula el pago succeeded y re-lanza el 409', async () => {
    jest
      .spyOn(service as any, 'updateOrderState')
      .mockRejectedValue(new VendixHttpException(ErrorCodes.INV_STOCK_002));

    await expect(service.payOrder(1, DTO)).rejects.toBeInstanceOf(
      VendixHttpException,
    );

    // Pago creado y luego anulado con razón de auditoría → sin pago huérfano.
    expect(prismaMock.payments.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.payments.update).toHaveBeenCalledWith({
      where: { id: 999 },
      data: expect.objectContaining({
        state: 'cancelled',
        gateway_response: expect.objectContaining({
          cancellation_reason: 'finish_blocked_insufficient_stock',
        }),
      }),
    });
  });

  it('finish OK: NO anula el pago', async () => {
    jest
      .spyOn(service as any, 'updateOrderState')
      .mockResolvedValue({ id: 1, state: 'finished' });

    await service.payOrder(1, DTO);

    expect(prismaMock.payments.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.payments.update).not.toHaveBeenCalled();
  });
});

/**
 * Tabla de derivación de {@link OrderFlowService.reconcileOrderFromDispatch}
 * (fuente única de verdad orden ↔ remisión). Se mockea prisma (orden, notas,
 * ruta abierta, modo) y se espía `updateOrderState` para capturar la escalera
 * caminada. `validateTransition` corre REAL (todas las aristas de la escalera
 * pending_payment→processing→shipped→delivered→finished existen en
 * VALID_TRANSITIONS).
 */
describe('OrderFlowService.reconcileOrderFromDispatch — tabla de derivación', () => {
  const STORE_ID = 10;
  const ORDER_ID = 55;

  type Note = { id: number; status: string };

  const buildService = (opts: {
    order: {
      state: string;
      delivery_type: string;
      remaining_balance: number;
    } | null;
    notes?: Note[];
    openRouteStop?: { id: number } | null;
    mode?: 'live' | 'on_close';
  }) => {
    const prismaMock: any = {
      orders: {
        findFirst: jest.fn().mockResolvedValue(
          opts.order
            ? { id: ORDER_ID, ...opts.order }
            : null,
        ),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      dispatch_notes: {
        findMany: jest.fn().mockResolvedValue(opts.notes ?? []),
      },
      dispatch_route_stops: {
        findFirst: jest.fn().mockResolvedValue(opts.openRouteStop ?? null),
      },
      store_settings: {
        findFirst: jest.fn().mockResolvedValue({
          settings: {
            dispatch: { order_state_update_mode: opts.mode ?? 'on_close' },
          },
        }),
      },
    };

    const service = new OrderFlowService(
      prismaMock as unknown as StorePrismaService,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { logCustom: jest.fn().mockResolvedValue(undefined) } as any,
    );

    const updateSpy = jest
      .spyOn(service as any, 'updateOrderState')
      .mockResolvedValue({});

    return { service, prismaMock, updateSpy };
  };

  const targets = (updateSpy: jest.SpyInstance) =>
    updateSpy.mock.calls.map((c) => c[1] as string);

  it('prepago (balance 0) + allFulfilled → finished', async () => {
    const { service, updateSpy } = buildService({
      order: {
        state: 'processing',
        delivery_type: 'home_delivery',
        remaining_balance: 0,
      },
      notes: [{ id: 1, status: 'delivered' }],
    });

    await service.reconcileOrderFromDispatch(ORDER_ID, STORE_ID);

    expect(targets(updateSpy)).toEqual(['shipped', 'delivered', 'finished']);
  });

  it('COD (balance > 0) + allFulfilled → delivered', async () => {
    const { service, updateSpy } = buildService({
      order: {
        state: 'processing',
        delivery_type: 'home_delivery',
        remaining_balance: 5000,
      },
      notes: [
        { id: 1, status: 'delivered' },
        { id: 2, status: 'invoiced' },
      ],
    });

    await service.reconcileOrderFromDispatch(ORDER_ID, STORE_ID);

    expect(targets(updateSpy)).toEqual(['shipped', 'delivered']);
  });

  it('parcial (anyFulfilled, !allFulfilled) → shipped', async () => {
    const { service, updateSpy } = buildService({
      order: {
        state: 'processing',
        delivery_type: 'home_delivery',
        remaining_balance: 5000,
      },
      notes: [
        { id: 1, status: 'delivered' },
        { id: 2, status: 'confirmed' },
      ],
    });

    await service.reconcileOrderFromDispatch(ORDER_ID, STORE_ID);

    expect(targets(updateSpy)).toEqual(['shipped']);
  });

  it('!anyFulfilled + anyDispatched (confirmed) → shipped', async () => {
    const { service, updateSpy } = buildService({
      order: {
        state: 'processing',
        delivery_type: 'home_delivery',
        remaining_balance: 5000,
      },
      notes: [{ id: 1, status: 'confirmed' }],
    });

    await service.reconcileOrderFromDispatch(ORDER_ID, STORE_ID);

    expect(targets(updateSpy)).toEqual(['shipped']);
  });

  it('cap on_close con ruta abierta: finished derivado → tope shipped', async () => {
    const { service, updateSpy, prismaMock } = buildService({
      order: {
        state: 'processing',
        delivery_type: 'home_delivery',
        remaining_balance: 0, // sin tope derivaría a finished
      },
      notes: [{ id: 1, status: 'delivered' }],
      openRouteStop: { id: 99 },
      mode: 'on_close',
    });

    await service.reconcileOrderFromDispatch(ORDER_ID, STORE_ID);

    expect(targets(updateSpy)).toEqual(['shipped']);
    expect(prismaMock.store_settings.findFirst).toHaveBeenCalled();
  });

  it('cap live con ruta abierta: finished derivado → tope delivered', async () => {
    const { service, updateSpy } = buildService({
      order: {
        state: 'processing',
        delivery_type: 'home_delivery',
        remaining_balance: 0,
      },
      notes: [{ id: 1, status: 'delivered' }],
      openRouteStop: { id: 99 },
      mode: 'live',
    });

    await service.reconcileOrderFromDispatch(ORDER_ID, STORE_ID);

    expect(targets(updateSpy)).toEqual(['shipped', 'delivered']);
  });

  it('NO-OP: delivery_type direct_delivery', async () => {
    const { service, updateSpy, prismaMock } = buildService({
      order: {
        state: 'processing',
        delivery_type: 'direct_delivery',
        remaining_balance: 0,
      },
      notes: [{ id: 1, status: 'delivered' }],
    });

    await service.reconcileOrderFromDispatch(ORDER_ID, STORE_ID);

    expect(updateSpy).not.toHaveBeenCalled();
    expect(prismaMock.dispatch_notes.findMany).not.toHaveBeenCalled();
  });

  it('NO-OP: delivery_type dine_in', async () => {
    const { service, updateSpy } = buildService({
      order: {
        state: 'processing',
        delivery_type: 'dine_in',
        remaining_balance: 0,
      },
      notes: [{ id: 1, status: 'delivered' }],
    });

    await service.reconcileOrderFromDispatch(ORDER_ID, STORE_ID);

    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('NO-OP: sin remisiones (|N| = 0)', async () => {
    const { service, updateSpy } = buildService({
      order: {
        state: 'processing',
        delivery_type: 'home_delivery',
        remaining_balance: 0,
      },
      notes: [],
    });

    await service.reconcileOrderFromDispatch(ORDER_ID, STORE_ID);

    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('NO-OP: estado no-escalera (created)', async () => {
    const { service, updateSpy } = buildService({
      order: {
        state: 'created',
        delivery_type: 'home_delivery',
        remaining_balance: 0,
      },
      notes: [{ id: 1, status: 'delivered' }],
    });

    await service.reconcileOrderFromDispatch(ORDER_ID, STORE_ID);

    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('solo drafts (nada despachado) → NO-OP', async () => {
    const { service, updateSpy } = buildService({
      order: {
        state: 'processing',
        delivery_type: 'home_delivery',
        remaining_balance: 5000,
      },
      notes: [{ id: 1, status: 'draft' }],
    });

    await service.reconcileOrderFromDispatch(ORDER_ID, STORE_ID);

    expect(updateSpy).not.toHaveBeenCalled();
  });
});

/**
 * QUI-777 — Cobertura dedicada del puente de cocina del
 * {@link OrderFlowService.markKitchenOrderDelivered} (y su reversa
 * {@link OrderFlowService.revertKitchenOrderDelivery}). El listener que
 * traduce `kitchen.order_all_delivered` a `OrderSseService.pushOrderEvent`
 * depende de la DECISIÓN que toma este método: ¿la orden estaba en
 * `processing`?, ¿se transicionó a `delivered`? Si este método devuelve
 * la fila sin transicionar (estado distinto de `processing`), el listener
 * NO emite SSE — y esa decisión se prueba aquí, no en el listener.
 *
 * Patrón: factory `buildService()` análogo al de `reconcileOrderFromDispatch`.
 * `getOrder` se espía (es método privado) y `updateOrderState` también, para
 * capturar argumentos exactos (incluido `source: 'kitchen_bridge'` T9).
 */
describe('OrderFlowService.markKitchenOrderDelivered — restaurant bridge', () => {
  const ORDER_ID = 77;

  const buildService = (order: { state: string } | null) => {
    const prismaMock: any = {
      orders: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const service = new OrderFlowService(
      prismaMock as unknown as StorePrismaService,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { logCustom: jest.fn().mockResolvedValue(undefined) } as any,
    );

    // `getOrder` es el seam público que el método usa para cargar la fila.
    // Espiamos con el order que el test quiera — refleja el SELECT real del
    // service (incluye state + order_number + delivery_type, no solo state).
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(
      order ? { id: ORDER_ID, ...order } : null,
    );
    const updateSpy = jest
      .spyOn(service as any, 'updateOrderState')
      .mockResolvedValue({ id: ORDER_ID, state: 'delivered' });

    return { service, prismaMock, updateSpy };
  };

  it('happy path: orden en processing transiciona a delivered con source kitchen_bridge', async () => {
    const { service, updateSpy } = buildService({ state: 'processing' });

    const result = await service.markKitchenOrderDelivered(ORDER_ID);

    expect(updateSpy).toHaveBeenCalledTimes(1);
    // T9: el source marca este flujo como "puente de cocina" para que el
    // listener de notificaciones silencie el evento (entregado NO alerta;
    // el LISTO ya sonó por `kitchen.ticket_ready`).
    expect(updateSpy).toHaveBeenCalledWith(
      ORDER_ID,
      'delivered',
      expect.objectContaining({
        delivered_at: expect.any(Date),
        kitchen_all_delivered: true,
      }),
      { source: 'kitchen_bridge' },
    );
    expect(result?.state).toBe('delivered');
  });

  it('idempotencia: orden ya en delivered devuelve la fila sin transicionar', async () => {
    const { service, updateSpy } = buildService({ state: 'delivered' });

    const result = await service.markKitchenOrderDelivered(ORDER_ID);

    // Re-trigger desde KDS o reconexión SSE: no-op real, NO emite SSE
    // (el listener chequea `updated?.state === 'delivered'`, pero como el
    // service ya hizo no-op y devolvió la fila original, la igualdad sí
    // pasa — la idempotencia vive en el chequeo del state que retorna,
    // no en el de la fila original).
    expect(updateSpy).not.toHaveBeenCalled();
    expect(result?.state).toBe('delivered');
  });

  it('idempotencia: orden en finished (auto-finalizada por job 4h) NO transiciona', async () => {
    const { service, updateSpy } = buildService({ state: 'finished' });

    const result = await service.markKitchenOrderDelivered(ORDER_ID);

    expect(updateSpy).not.toHaveBeenCalled();
    expect(result?.state).toBe('finished');
  });

  it('validateTransition lanza ORDER_INVALID_TRANSITION: el error se propaga al listener', async () => {
    // Defensa en profundidad: si por alguna razón la fila cargada tiene un
    // estado desde el que `delivered` no es alcanzable, validateTransition
    // lanza 409 ORDER_INVALID_TRANSITION. El listener captura con try/catch
    // (log + swallow) — pero el service NO debe silenciar el error.
    const prismaMock: any = {
      orders: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new OrderFlowService(
      prismaMock as unknown as StorePrismaService,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { logCustom: jest.fn().mockResolvedValue(undefined) } as any,
    );
    jest.spyOn(service as any, 'getOrder').mockResolvedValue({
      id: ORDER_ID,
      state: 'processing',
    });
    jest.spyOn(service as any, 'updateOrderState').mockResolvedValue({});
    jest
      .spyOn(service as any, 'validateTransition')
      .mockImplementation(() => {
        throw new BadRequestException('Invalid state transition');
      });

    await expect(
      service.markKitchenOrderDelivered(ORDER_ID),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

/**
 * QUI-777 — Hermano reverso del describe anterior. Cubre
 * {@link OrderFlowService.revertKitchenOrderDelivery} (delivered → processing
 * cuando el KDS revierte un ticket terminal). El método es la imagen espejo:
 * gate por `state === 'delivered'`, mismo seam `updateOrderState`, mismo
 * patrón de no-op idempotente.
 *
 * Diferencia clave vs. `markKitchenOrderDelivered`: este método NO usa
 * `getOrder()` — hace su propio `prisma.orders.findFirst` con select mínimo
 * (id + state). Cubrimos esa ruta aquí para que el spec refleje la
 * implementación real y no la contratemos por accidente.
 */
describe('OrderFlowService.revertKitchenOrderDelivery — kitchen bridge reverse', () => {
  const ORDER_ID = 99;

  const buildService = (order: { id: number; state: string } | null) => {
    const prismaMock: any = {
      orders: {
        findFirst: jest.fn().mockResolvedValue(order),
      },
    };
    const service = new OrderFlowService(
      prismaMock as unknown as StorePrismaService,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { logCustom: jest.fn().mockResolvedValue(undefined) } as any,
    );
    const updateSpy = jest
      .spyOn(service as any, 'updateOrderState')
      .mockResolvedValue({ id: ORDER_ID, state: 'processing' });

    return { service, prismaMock, updateSpy };
  };

  it('happy path: orden en delivered transiciona a processing', async () => {
    const { service, updateSpy, prismaMock } = buildService({
      id: ORDER_ID,
      state: 'delivered',
    });

    const result = await service.revertKitchenOrderDelivery(ORDER_ID);

    // El service usa su propio findFirst con select mínimo (id, state) —
    // NO pasa por getOrder. Cubrir esa ruta evita que un refactor futuro
    // acople accidentalmente los dos métodos.
    expect(prismaMock.orders.findFirst).toHaveBeenCalledWith({
      where: { id: ORDER_ID },
      select: { id: true, state: true },
    });
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith(
      ORDER_ID,
      'processing',
      expect.objectContaining({ kitchen_delivery_reverted: true }),
    );
    expect(result?.state).toBe('processing');
  });

  it('idempotencia: orden inexistente (findFirst retorna null) NO transiciona', async () => {
    const { service, updateSpy } = buildService(null);

    const result = await service.revertKitchenOrderDelivery(ORDER_ID);

    expect(updateSpy).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('idempotencia: orden en processing (ya estaba) NO transiciona', async () => {
    const { service, updateSpy } = buildService({
      id: ORDER_ID,
      state: 'processing',
    });

    const result = await service.revertKitchenOrderDelivery(ORDER_ID);

    expect(updateSpy).not.toHaveBeenCalled();
    expect(result?.state).toBe('processing');
  });

  it('idempotencia: orden en finished (pago confirmado antes de la reversa) NO transiciona', async () => {
    const { service, updateSpy } = buildService({
      id: ORDER_ID,
      state: 'finished',
    });

    const result = await service.revertKitchenOrderDelivery(ORDER_ID);

    expect(updateSpy).not.toHaveBeenCalled();
    expect(result?.state).toBe('finished');
  });

  it('validateTransition lanza: el error se propaga al listener', async () => {
    const { service } = buildService({ id: ORDER_ID, state: 'delivered' });
    jest
      .spyOn(service as any, 'validateTransition')
      .mockImplementation(() => {
        throw new BadRequestException('Invalid state transition');
      });

    await expect(
      service.revertKitchenOrderDelivery(ORDER_ID),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
