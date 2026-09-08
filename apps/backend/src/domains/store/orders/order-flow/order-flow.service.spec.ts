import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
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
        // Fix v2 (race-claim FB-10): `payOrder` reclama la orden con
        // `orders.updateMany` ANTES de leerla. Sin este mock el describe
        // cae con `updateMany is not a function` (roto desde el PR que metió
        // el claim, sin relación con el seam cancelOrderItem). `count: 1`
        // = la orden era pagable y el flujo sigue a la rama que el test
        // espía (`updateOrderState`).
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      // CP-POS-MODAL-SCOPE-001 / C.4: `payOrder` exige cliente salvo escape
      // hatch `pos.allow_anonymous_sales`. La orden mockeada no trae
      // `customer_id`; sin este mock el describe cae con
      // `store_settings.findFirst is not a function` (misma staleness que
      // el claim de arriba). Se permite anónimo para preservar la ruta que
      // el test ejercita desde su creación.
      store_settings: {
        findFirst: jest.fn().mockResolvedValue({
          settings: { pos: { allow_anonymous_sales: true } },
        }),
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
 * `processing`?, ¿se transicionó a `delivered`? El método reporta
 * `{ order, transitioned, previousState }`: si devuelve la fila sin
 * transicionar (`transitioned: false`), el listener NO emite SSE — y esa
 * decisión se prueba aquí, no en el listener.
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
    expect(result.transitioned).toBe(true);
    expect(result.previousState).toBe('processing');
    expect(result.order?.state).toBe('delivered');
  });

  it('idempotencia: orden ya en delivered devuelve la fila sin transicionar', async () => {
    const { service, updateSpy } = buildService({ state: 'delivered' });

    const result = await service.markKitchenOrderDelivered(ORDER_ID);

    // Re-trigger desde KDS o reconexión SSE: no-op real. El listener decide
    // por `transitioned === true`, así que este no-op NO emite SSE (el
    // chequeo viejo por `state === 'delivered'` sí emitía, con `old_state`
    // inventado).
    expect(updateSpy).not.toHaveBeenCalled();
    expect(result.transitioned).toBe(false);
    expect(result.previousState).toBe('delivered');
    expect(result.order?.state).toBe('delivered');
  });

  it('idempotencia: orden en finished (auto-finalizada por job 4h) NO transiciona', async () => {
    const { service, updateSpy } = buildService({ state: 'finished' });

    const result = await service.markKitchenOrderDelivered(ORDER_ID);

    expect(updateSpy).not.toHaveBeenCalled();
    expect(result.transitioned).toBe(false);
    expect(result.previousState).toBe('finished');
    expect(result.order?.state).toBe('finished');
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
    expect(result.transitioned).toBe(true);
    expect(result.previousState).toBe('delivered');
    expect(result.order?.state).toBe('processing');
  });

  it('idempotencia: orden inexistente (findFirst retorna null) NO transiciona', async () => {
    const { service, updateSpy } = buildService(null);

    const result = await service.revertKitchenOrderDelivery(ORDER_ID);

    expect(updateSpy).not.toHaveBeenCalled();
    expect(result.order).toBeNull();
    expect(result.transitioned).toBe(false);
    expect(result.previousState).toBeNull();
  });

  it('idempotencia: orden en processing (ya estaba) NO transiciona', async () => {
    const { service, updateSpy } = buildService({
      id: ORDER_ID,
      state: 'processing',
    });

    const result = await service.revertKitchenOrderDelivery(ORDER_ID);

    expect(updateSpy).not.toHaveBeenCalled();
    expect(result.transitioned).toBe(false);
    expect(result.previousState).toBe('processing');
    expect(result.order?.state).toBe('processing');
  });

  it('idempotencia: orden en finished (pago confirmado antes de la reversa) NO transiciona', async () => {
    const { service, updateSpy } = buildService({
      id: ORDER_ID,
      state: 'finished',
    });

    const result = await service.revertKitchenOrderDelivery(ORDER_ID);

    expect(updateSpy).not.toHaveBeenCalled();
    expect(result.transitioned).toBe(false);
    expect(result.previousState).toBe('finished');
    expect(result.order?.state).toBe('finished');
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

/**
 * PLAN-order-detail-cancel-item (paso 1) — contrato del seam compartido
 * {@link OrderFlowService.cancelOrderItem} (mudado de mesa).
 *
 * Cubre: 404 orden / 404 ítem ajeno, guards paid/terminal (409), motivo
 * obligatorio (422 en llamada directa), idempotencia, derivación del tipo
 * contable, soft cancel + recálculo con `cancelled_at IS NULL`, cancel KDS
 * `pending` in-tx + SSE post-commit, TOCTOU (ticket avanzado → merma sin
 * tocar cocina) y fail-loud si el KDS no está cableado.
 */
describe('OrderFlowService.cancelOrderItem — seam compartido', () => {
  const ORDER_ID = 1017;
  const ITEM_ID = 501;
  const TICKET_ID = 77;

  const unfiredItem = (overrides: Record<string, unknown> = {}) => ({
    id: ITEM_ID,
    product_name: 'Bandeja paisa',
    inventory_consumed_at_fire: false,
    cancelled_at: null,
    kitchen_ticket_items: [],
    ...overrides,
  });

  const firedItemPending = () => ({
    ...unfiredItem({ inventory_consumed_at_fire: true }),
    kitchen_ticket_items: [
      {
        id: 900,
        status: 'pending',
        kitchen_ticket_id: TICKET_ID,
        kitchen_ticket: { id: TICKET_ID, status: 'pending' },
      },
    ],
  });

  const buildService = (opts: {
    order?: Record<string, unknown>;
    orderError?: unknown;
    // `undefined` → ítem base sin disparar; `null` → ítem inexistente (404).
    item?: Record<string, unknown> | null;
    freshTicketStatus?: string | null;
    activeItems?: Array<{ total_price: number; tax_amount_item: number | null }>;
    withKds?: boolean;
  }) => {
    const txMock: any = {
      kitchen_tickets: {
        findFirst: jest.fn().mockResolvedValue(
          opts.freshTicketStatus == null
            ? null
            : { status: opts.freshTicketStatus },
        ),
      },
      inventory_transactions: { findMany: jest.fn().mockResolvedValue([]) },
      order_items: {
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue(
          opts.activeItems ?? [{ total_price: 50000, tax_amount_item: 0 }],
        ),
      },
      orders: { update: jest.fn().mockResolvedValue({}) },
    };
    const prismaMock: any = {
      order_items: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            opts.item === undefined ? unfiredItem() : opts.item,
          ),
      },
      $transaction: jest.fn((cb: any) => cb(txMock)),
    };
    const stockLevelManager = {
      getDefaultLocationForProduct: jest.fn().mockResolvedValue(1),
      updateStock: jest.fn().mockResolvedValue({}),
    };
    const kitchenFireService = {
      cancelTicketInTx: jest.fn().mockResolvedValue(undefined),
      emitTicketCancelledEvent: jest.fn().mockResolvedValue(undefined),
    };

    const service = new OrderFlowService(
      prismaMock as unknown as StorePrismaService,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      stockLevelManager as any,
      {} as any,
      {} as any,
      { logCustom: jest.fn().mockResolvedValue(undefined) } as any,
      (opts.withKds === false ? undefined : kitchenFireService) as any,
    );

    if (opts.orderError !== undefined) {
      jest
        .spyOn(service as any, 'getOrder')
        .mockRejectedValue(opts.orderError);
    } else {
      jest
        .spyOn(service as any, 'getOrder')
        .mockResolvedValue(opts.order ?? { id: ORDER_ID, state: 'created' });
    }

    return { service, prismaMock, txMock, stockLevelManager, kitchenFireService };
  };

  it('404 si la orden no existe en la tienda', async () => {
    const { service, prismaMock } = buildService({
      orderError: new NotFoundException(`Order #${ORDER_ID} not found`),
    });

    await expect(
      service.cancelOrderItem(ORDER_ID, ITEM_ID, 'cliente se arrepintió'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prismaMock.order_items.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('404 si el ítem no pertenece a la orden (sin filtrar)', async () => {
    const { service, prismaMock } = buildService({ item: null });

    await expect(
      service.cancelOrderItem(ORDER_ID, 999999, 'cliente se arrepintió'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prismaMock.order_items.findFirst).toHaveBeenCalledWith({
      where: { id: 999999, order_id: ORDER_ID },
      select: expect.anything(),
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('idempotencia: ítem ya cancelado devuelve la vista sin reescribir', async () => {
    const CANCELLED_AT = new Date('2026-09-01T12:00:00.000Z');
    const { service, prismaMock, kitchenFireService } = buildService({
      item: unfiredItem({ cancelled_at: CANCELLED_AT }),
    });

    const result = await service.cancelOrderItem(
      ORDER_ID,
      ITEM_ID,
      'segundo intento con otro motivo',
    );

    expect((result as any).id).toBe(ORDER_ID);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(kitchenFireService.cancelTicketInTx).not.toHaveBeenCalled();
    expect(kitchenFireService.emitTicketCancelledEvent).not.toHaveBeenCalled();
  });

  it('409 si la orden está cobrada (payment_status paid)', async () => {
    const { service } = buildService({
      order: { id: ORDER_ID, state: 'created', payment_status: 'paid' },
    });

    await expect(
      service.cancelOrderItem(ORDER_ID, ITEM_ID, 'cliente se arrepintió'),
    ).rejects.toMatchObject({
      errorCode: 'TABLE_SESSION_ITEM_NOT_REMOVABLE',
    });
  });

  it('409 si la orden está en estado terminal', async () => {
    const { service, prismaMock } = buildService({
      order: { id: ORDER_ID, state: 'completed' },
    });

    await expect(
      service.cancelOrderItem(ORDER_ID, ITEM_ID, 'cliente se arrepintió'),
    ).rejects.toMatchObject({
      errorCode: 'TABLE_SESSION_ITEM_NOT_REMOVABLE',
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('422 si el motivo tiene menos de 3 caracteres (defensa en profundidad)', async () => {
    const { service, prismaMock } = buildService({});

    await expect(
      service.cancelOrderItem(ORDER_ID, ITEM_ID, 'x'),
    ).rejects.toMatchObject({
      errorCode: 'TABLE_SESSION_ADD_ITEMS_INVALID',
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('happy before_fire: soft cancel + recálculo excluyendo cancelados', async () => {
    const { service, txMock, kitchenFireService } = buildService({
      activeItems: [
        { total_price: 50000, tax_amount_item: 8000 },
        { total_price: 20000, tax_amount_item: 0 },
      ],
    });

    await service.cancelOrderItem(
      ORDER_ID,
      ITEM_ID,
      '  cliente se arrepintió  ',
    );

    expect(txMock.order_items.update).toHaveBeenCalledWith({
      where: { id: ITEM_ID },
      data: expect.objectContaining({
        cancellation_reason: 'cliente se arrepintió',
        cancellation_type: 'before_fire',
        updated_at: expect.any(Date),
      }),
    });
    const updateData = txMock.orders.update.mock.calls[0][0].data;
    expect(Number(updateData.subtotal_amount)).toBe(70000);
    expect(Number(updateData.tax_amount)).toBe(8000);
    expect(Number(updateData.grand_total)).toBe(78000);
    expect(kitchenFireService.cancelTicketInTx).not.toHaveBeenCalled();
    expect(kitchenFireService.emitTicketCancelledEvent).not.toHaveBeenCalled();
  });

  it('happy after_fire pending: cancela el ticket in-tx + SSE post-commit', async () => {
    const { service, txMock, kitchenFireService } = buildService({
      item: firedItemPending(),
      freshTicketStatus: 'pending',
    });

    await service.cancelOrderItem(ORDER_ID, ITEM_ID, 'se quemó el plato');

    expect(kitchenFireService.cancelTicketInTx).toHaveBeenCalledTimes(1);
    expect(kitchenFireService.cancelTicketInTx.mock.calls[0][1]).toBe(
      TICKET_ID,
    );
    expect(kitchenFireService.emitTicketCancelledEvent).toHaveBeenCalledWith(
      TICKET_ID,
    );
    expect(txMock.order_items.update).toHaveBeenCalledWith({
      where: { id: ITEM_ID },
      data: expect.objectContaining({ cancellation_type: 'after_fire_waste' }),
    });
  });

  it('TOCTOU: ticket avanzado en cocina → merma sin tocar el KDS', async () => {
    const { service, txMock, kitchenFireService } = buildService({
      item: firedItemPending(),
      freshTicketStatus: 'in_preparation',
    });

    await service.cancelOrderItem(ORDER_ID, ITEM_ID, 'el cliente se fue');

    expect(kitchenFireService.cancelTicketInTx).not.toHaveBeenCalled();
    expect(kitchenFireService.emitTicketCancelledEvent).not.toHaveBeenCalled();
    expect(txMock.order_items.update).toHaveBeenCalledWith({
      where: { id: ITEM_ID },
      data: expect.objectContaining({ cancellation_type: 'after_fire_waste' }),
    });
  });

  it('cancellation_type explícito se respeta aunque sea inconsistente', async () => {
    const { service, txMock, stockLevelManager } = buildService({});

    await service.cancelOrderItem(
      ORDER_ID,
      ITEM_ID,
      'merma pactada con el dueño',
      'after_fire_waste',
    );

    expect(txMock.order_items.update).toHaveBeenCalledWith({
      where: { id: ITEM_ID },
      data: expect.objectContaining({ cancellation_type: 'after_fire_waste' }),
    });
    expect(stockLevelManager.updateStock).not.toHaveBeenCalled();
  });

  it('falla fuerte si KitchenFireService no está cableado', async () => {
    const { service } = buildService({ withKds: false });

    await expect(
      service.cancelOrderItem(ORDER_ID, ITEM_ID, 'cliente se arrepintió'),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});
