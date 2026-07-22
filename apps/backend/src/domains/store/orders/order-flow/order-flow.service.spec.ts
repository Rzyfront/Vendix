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
    };

    // 8 args del constructor; solo prisma se ejercita (el resto se espía o no
    // se alcanza en la rama de bloqueo).
    service = new OrderFlowService(
      prismaMock as unknown as StorePrismaService,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
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
