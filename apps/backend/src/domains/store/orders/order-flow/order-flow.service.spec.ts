import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { OrderFlowService } from './order-flow.service';
import { OrderFlowController } from './order-flow.controller';
import { PERMISSIONS_KEY } from '../../../auth/decorators/permissions.decorator';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { PaymentType } from './dto';
import { Prisma } from '@prisma/client';
import {
  createPrismaMock,
  mockRequestContext,
  PrismaMock,
} from 'src/testing/prisma-mock';
import { buildOrder, buildPayment } from 'src/testing/money-fixtures';

describe('OrderFlowService.payOrder — reserva del draft tras el claim POS (E.2)', () => {
  const DTO: any = { store_payment_method_id: 1, payment_type: PaymentType.DIRECT };

  const harness = (consumedAtFire = false) => {
    let state = 'draft';
    const reservations: Array<{ product_id: number; status: string }> = [];
    const events: Array<string> = [];
    const tx: any = {
      $queryRaw: jest.fn(async () => [{ id: 1, state }]),
      orders: {
        findFirst: jest.fn(async () => ({
          id: 1,
          store_id: 4,
          order_items: [{
            product_id: 701,
            product_variant_id: null,
            quantity: 2,
            inventory_consumed_at_fire: consumedAtFire,
            products: { id: 701, track_inventory: true, product_type: 'product' },
          }],
        })),
        update: jest.fn(async ({ data }: any) => { state = data.state; return { id: 1, state }; }),
      },
      stock_reservations: {
        findFirst: jest.fn(async () => reservations.find((row) => row.status === 'active') ?? null),
      },
    };
    const prismaMock: any = {
      $transaction: jest.fn(async (callback: any) => callback(tx)),
      orders: {
        findFirst: jest.fn(async ({ select }: any) => select?.state
          ? { state }
          : { active_financial_split_id: null, delivery_type: 'direct_delivery', shipping_method_id: null, order_items: [{ products: { product_type: 'product' } }] }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          if (where.state?.in && !where.state.in.includes(state)) return { count: 0 };
          if (where.state && typeof where.state === 'string' && where.state !== state) return { count: 0 };
          state = data.state;
          return { count: 1 };
        }),
      },
      stock_reservations: {
        count: jest.fn(async () => reservations.filter((row) => row.status === 'active').length),
      },
      store_payment_methods: { findFirst: jest.fn(async () => ({ id: 1, system_payment_method: { type: 'card' } })) },
      payments: { create: jest.fn(async () => { events.push('payment'); return { id: 99, gateway_response: {} }; }) },
    };
    const stock: any = {
      getDefaultLocationForProduct: jest.fn(async () => 11),
      reserveStock: jest.fn(async (...args: any[]) => {
        events.push('reserve');
        reservations.push({ product_id: args[0], status: 'active' });
      }),
    };
    const audit: any = { logCustom: jest.fn(async () => undefined) };
    const service = new OrderFlowService(
      prismaMock, {} as any, {} as any, {} as any, {} as any, stock,
      {} as any, {} as any, audit,
    );
    jest.spyOn(service as any, 'getOrder').mockImplementation(async () => ({
      id: 1, state, store_id: 4, customer_id: 44, delivery_type: 'direct_delivery',
      grand_total: 100, currency: 'COP',
    }));
    jest.spyOn(service as any, 'appendFlowMetadata').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'updateOrderState').mockImplementation(async (_id: number, nextState: string) => {
      state = nextState;
      return { id: 1, state };
    });
    jest.spyOn(service as any, 'commitCouponUseForOrder').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'generateTransactionId').mockResolvedValue('TXN-1');
    jest.spyOn(service as any, 'hasPendingKitchenItems').mockResolvedValue(false);
    jest.spyOn(service as any, 'recordPayOrderCashMovement').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'computeAndPersistEta').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'emitPosSaleCompletedIfFullyPaid').mockResolvedValue(undefined);
    return { service, prismaMock, tx, stock, audit, reservations, events, getState: () => state };
  };

  it('reserva antes del pago, mantiene processing durante el cobro y audita el conteo', async () => {
    const h = harness();
    await h.service.payOrder(1, DTO);
    expect(h.reservations).toHaveLength(1);
    expect(h.events).toEqual(['reserve', 'payment']);
    expect(h.prismaMock.payments.create).toHaveBeenCalledTimes(1);
    const args = h.stock.reserveStock.mock.calls[0];
    expect(args.slice(0, 6)).toEqual([701, undefined, 11, 2, 'order', 1]);
    expect([args[7], args[8], args[10], args[12]]).toEqual([
      false, h.tx, false, true,
    ]);
    expect(h.audit.logCustom).toHaveBeenCalledWith(
      expect.any(Number), 'order.promoted_to_created', expect.anything(),
      expect.objectContaining({ order_id: 1, reservation_count: 1 }), 1,
    );
    expect(h.getState()).toBe('finished');
  });

  it('segundo submit no reserva ni cobra y conserva el 409 tipado', async () => {
    const h = harness();
    await h.service.payOrder(1, DTO);
    const error = await h.service.payOrder(1, DTO).catch((failure) => failure);
    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.errorCode).toBe('ORD_FLOW_PAYMENT_FAILED_001');
    expect(error.getStatus()).toBe(409);
    expect(h.stock.reserveStock).toHaveBeenCalledTimes(1);
    expect(h.prismaMock.payments.create).toHaveBeenCalledTimes(1);
  });

  it('stock agotado no bloquea el cobro; consumo en cocina evita descontar otra vez', async () => {
    const h = harness(true);
    await h.service.payOrder(1, DTO);
    const args = h.stock.reserveStock.mock.calls[0];
    expect([args[7], args[8], args[10], args[12]]).toEqual([
      false, h.tx, true, true,
    ]);
    expect(h.prismaMock.payments.create).toHaveBeenCalledTimes(1);
  });

  it('si falla la infraestructura de reserva, no cobra y restaura el draft', async () => {
    const h = harness();
    h.stock.reserveStock.mockRejectedValueOnce(new Error('db unavailable'));
    const error = await h.service.payOrder(1, DTO).catch((failure) => failure);
    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.errorCode).toBe('ORD_FLOW_PAYMENT_FAILED_001');
    expect(h.prismaMock.payments.create).not.toHaveBeenCalled();
    expect(h.reservations).toHaveLength(0);
    expect(h.getState()).toBe('draft');
  });

  it('la promoción independiente de mesa/split sigue dejando created', async () => {
    const h = harness();
    const promoted = await (h.service as any).promoteDraftToCreated(1, 4);
    expect(promoted).toBe(true);
    expect(h.getState()).toBe('created');
    expect(h.reservations).toHaveLength(1);
    expect(h.prismaMock.payments.create).not.toHaveBeenCalled();
  });
});

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
  let projectTablePayment: jest.Mock;

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
    projectTablePayment = jest.fn().mockResolvedValue(null);
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
      undefined,
      undefined,
      { get: jest.fn(() => ({ projectOrderPaymentToTableSession: projectTablePayment })) } as any,
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
    expect(projectTablePayment).toHaveBeenCalledWith(1, 999);
  });

  it('proyección falla post-commit: conserva el pago y responde ERR-33 tipado (409)', async () => {
    jest.spyOn(service as any, 'updateOrderState').mockResolvedValue({ id: 1, state: 'finished' });
    projectTablePayment.mockRejectedValue(new Error('mesa cerrada'));

    const error = await service.payOrder(1, DTO).catch((failure) => failure);
    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.errorCode).toBe(ErrorCodes.POS_TABLE_SESSION_PROJECTION_FAILED_001.code);
    expect(error.getStatus()).toBe(409);
    expect(prismaMock.payments.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.payments.update).not.toHaveBeenCalled();
    expect(projectTablePayment).toHaveBeenCalledWith(1, 999);
  });
});

/** D.1 — la reversa de cocina devuelve consumos reales del ítem, no el plato vendido. */
describe('OrderFlowService.cancelOrder — kitchenDisposition y reversa de hojas BOM', () => {
  const ORDER_ID = 8101;
  const ITEM_ID = 8102;
  const TICKET_ID = 8103;
  const reason = '  cliente canceló el plato  ';

  const firedItem = (status: 'pending' | 'in_preparation' | 'ready') => ({
    id: ITEM_ID,
    inventory_consumed_at_fire: true,
    cancelled_at: null,
    products: { product_type: 'prepared' },
    kitchen_ticket_items: [{
      kitchen_ticket_id: TICKET_ID,
      kitchen_ticket: { id: TICKET_ID, status },
    }],
  });

  const buildKitchenHarness = (
    status: 'pending' | 'in_preparation' | 'ready',
    consumptions: Array<{
      product_id: number;
      product_variant_id: number | null;
      quantity_change: number;
    }> = [],
  ) => {
    const prismaMock = createPrismaMock({
      orders: ['updateMany', 'update'],
      order_items: ['findMany', 'update'],
      inventory_transactions: ['findMany'],
      kitchen_tickets: ['findFirst'],
    });
    prismaMock.$queryRaw = jest.fn().mockResolvedValue([{ id: ORDER_ID, state: 'processing' }]);
    prismaMock.orders.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.orders.update.mockResolvedValue({ id: ORDER_ID, store_id: 100, state: 'cancelled' });
    prismaMock.order_items.findMany.mockResolvedValue([firedItem(status)]);
    prismaMock.order_items.update.mockResolvedValue({});
    prismaMock.inventory_transactions.findMany.mockResolvedValue(consumptions);
    prismaMock.kitchen_tickets.findFirst.mockResolvedValue({ status });

    const stock = {
      getDefaultLocationForProduct: jest.fn().mockImplementation(
        async (productId: number, variantId?: number) => {
          if (productId === 701 && variantId === undefined) return 11;
          if (productId === 702 && variantId === 91) return 22;
          if (productId === 703 && variantId === undefined) return 33;
          throw new Error(`Unexpected leaf/location lookup ${productId}/${variantId}`);
        },
      ),
      updateStock: jest.fn().mockResolvedValue({}),
      releaseReservationsByReference: jest.fn().mockResolvedValue(undefined),
    };
    const kds = {
      cancelTicketInTx: jest.fn().mockResolvedValue(undefined),
      emitTicketCancelledEvent: jest.fn().mockResolvedValue(undefined),
    };
    const emitter = { emit: jest.fn() };
    const service = new OrderFlowService(
      prismaMock as unknown as StorePrismaService,
      emitter as any,
      {} as any,
      {} as any,
      {} as any,
      stock as any,
      {} as any,
      {} as any,
      { logCustom: jest.fn().mockResolvedValue(undefined) } as any,
      kds as any,
    );
    jest.spyOn(service, 'getOrder').mockResolvedValue(buildOrder({
      id: ORDER_ID,
      state: 'processing',
      internal_notes: null,
      payments: [],
      order_items: [{ id: ITEM_ID, inventory_consumed_at_fire: true }],
    }) as any);
    return { service, prismaMock, stock, kds, emitter };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockRequestContext({ store_id: 100, organization_id: 1, user_id: 7 });
  });

  it('kitchenDisposition reuse: devuelve exactamente las tres hojas consumidas, con signo absoluto y ubicación por variante', async () => {
    // Tres transacciones del ítem (una hoja variante) deliberadamente distintas
    // del producto preparado vendido; los valores esperados NO salen del mock.
    const { service, prismaMock, stock, kds, emitter } = buildKitchenHarness('in_preparation', [
      { product_id: 701, product_variant_id: null, quantity_change: -2.5 },
      { product_id: 702, product_variant_id: 91, quantity_change: -1.25 },
      { product_id: 703, product_variant_id: null, quantity_change: -4 },
    ]);

    await expect(service.cancelOrder(ORDER_ID, { reason, kitchenDisposition: 'reuse' }))
      .resolves.toMatchObject({ state: 'cancelled' });

    expect(prismaMock.inventory_transactions.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.inventory_transactions.findMany).toHaveBeenCalledWith({
      where: { order_item_id: ITEM_ID, quantity_change: { lt: 0 } },
      select: { product_id: true, product_variant_id: true, quantity_change: true },
    });
    expect(stock.getDefaultLocationForProduct.mock.calls).toEqual([
      [701, undefined], [702, 91], [703, undefined],
    ]);
    expect(stock.updateStock).toHaveBeenCalledTimes(3);
    const expectedReturns = [
      { product_id: 701, variant_id: undefined, location_id: 11, quantity_change: 2.5 },
      { product_id: 702, variant_id: 91, location_id: 22, quantity_change: 1.25 },
      { product_id: 703, variant_id: undefined, location_id: 33, quantity_change: 4 },
    ];
    expectedReturns.forEach((leaf, index) => {
      const [movement, tx] = stock.updateStock.mock.calls[index];
      expect(movement).toEqual({
        ...leaf,
        movement_type: 'return',
        reason: expect.stringContaining(`orden #${ORDER_ID} ítem #${ITEM_ID}`),
        source_module: 'order_item_cancellation',
        create_movement: true,
        validate_availability: false,
      });
      expect(movement).not.toHaveProperty('order_item_id');
      expect(tx).toBe(prismaMock);
    });
    expect(prismaMock.order_items.update).toHaveBeenCalledWith({
      where: { id: ITEM_ID },
      data: expect.objectContaining({
        cancellation_type: 'after_fire_reused',
        cancellation_reason: 'cliente canceló el plato',
      }),
    });
    expect(prismaMock.order_items.update.mock.calls[0][0].data)
      .not.toHaveProperty('inventory_consumed_at_fire');
    expect(kds.cancelTicketInTx).not.toHaveBeenCalled();
    expect(emitter.emit).toHaveBeenCalledWith('order.status_changed', expect.objectContaining({
      order_id: ORDER_ID, new_state: 'cancelled',
    }));
  });

  it('kitchenDisposition waste: registra merma sin consultar consumos ni devolver stock', async () => {
    const { service, prismaMock, stock, kds } = buildKitchenHarness('ready', [
      { product_id: 701, product_variant_id: null, quantity_change: -2.5 },
      { product_id: 702, product_variant_id: 91, quantity_change: -1.25 },
    ]);

    await expect(service.cancelOrder(ORDER_ID, { reason, kitchenDisposition: 'waste' }))
      .resolves.toMatchObject({ state: 'cancelled' });

    expect(prismaMock.orders.updateMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.order_items.update).toHaveBeenCalledWith({
      where: { id: ITEM_ID },
      data: expect.objectContaining({ cancellation_type: 'after_fire_waste' }),
    });
    expect(prismaMock.order_items.update.mock.calls[0][0].data)
      .not.toHaveProperty('inventory_consumed_at_fire');
    expect(prismaMock.inventory_transactions.findMany).not.toHaveBeenCalled();
    expect(stock.getDefaultLocationForProduct).not.toHaveBeenCalled();
    expect(stock.updateStock).not.toHaveBeenCalled();
    expect(kds.cancelTicketInTx).not.toHaveBeenCalled();
  });

  it('sin kitchenDisposition y ticket avanzado: error tipado antes del claim, sin efectos', async () => {
    const { service, prismaMock, stock } = buildKitchenHarness('in_preparation');

    await expect(service.cancelOrder(ORDER_ID, { reason })).rejects.toMatchObject({
      errorCode: 'TABLE_SESSION_ADD_ITEMS_INVALID',
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.orders.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.order_items.update).not.toHaveBeenCalled();
    expect(stock.updateStock).not.toHaveBeenCalled();
  });

  it('ticket pending: cancela sin kitchenDisposition y conserva after_fire_waste', async () => {
    const { service, prismaMock, stock, kds, emitter } = buildKitchenHarness('pending');

    await expect(service.cancelOrder(ORDER_ID, { reason }))
      .resolves.toMatchObject({ state: 'cancelled' });

    expect(prismaMock.kitchen_tickets.findFirst).toHaveBeenCalledWith({
      where: { id: TICKET_ID }, select: { status: true },
    });
    expect(kds.cancelTicketInTx).toHaveBeenCalledWith(prismaMock, TICKET_ID);
    expect(kds.emitTicketCancelledEvent).toHaveBeenCalledWith(TICKET_ID);
    expect(prismaMock.order_items.update).toHaveBeenCalledWith({
      where: { id: ITEM_ID },
      data: expect.objectContaining({ cancellation_type: 'after_fire_waste' }),
    });
    expect(prismaMock.inventory_transactions.findMany).not.toHaveBeenCalled();
    expect(stock.updateStock).not.toHaveBeenCalled();
    expect(emitter.emit).toHaveBeenCalledWith('order.status_changed', expect.anything());
  });

  it('kitchenDisposition reuse sin consumo registrado: cancela la línea sin devoluciones ni excepción', async () => {
    const { service, prismaMock, stock } = buildKitchenHarness('ready', []);

    await expect(service.cancelOrder(ORDER_ID, { reason, kitchenDisposition: 'reuse' }))
      .resolves.toMatchObject({ state: 'cancelled' });

    expect(prismaMock.inventory_transactions.findMany).toHaveBeenCalledWith({
      where: { order_item_id: ITEM_ID, quantity_change: { lt: 0 } },
      select: { product_id: true, product_variant_id: true, quantity_change: true },
    });
    expect(prismaMock.order_items.update).toHaveBeenCalledWith({
      where: { id: ITEM_ID },
      data: expect.objectContaining({ cancellation_type: 'after_fire_reused' }),
    });
    expect(stock.getDefaultLocationForProduct).not.toHaveBeenCalled();
    expect(stock.updateStock).not.toHaveBeenCalled();
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

  const buildService = (
    order: { state: string; delivery_type?: string } | null,
  ) => {
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

  it('domicilio: cocina terminada NO entrega la orden — queda en processing para despacho', async () => {
    const { service, updateSpy } = buildService({
      state: 'processing',
      delivery_type: 'home_delivery',
    });

    const result = await service.markKitchenOrderDelivered(ORDER_ID);

    // Entregar los platos es entregarlos al domiciliario, no al cliente. Si
    // el puente moviera la orden a `delivered`, el detalle perdería el botón
    // "Despachar Orden" y `createFromOrder` rechazaría la remisión (exige
    // `processing`/`pending_payment`).
    expect(updateSpy).not.toHaveBeenCalled();
    expect(result.transitioned).toBe(false);
    expect(result.previousState).toBe('processing');
    expect(result.order?.state).toBe('processing');
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
    // C.8/F-082 — `order_item_taxes` (fila autoritativa persistida por
    // línea), no `tax_amount_item` (ambiguo en unidad, F-003): el `select`
    // real de `cancelOrderItem` pide la relación, no el campo suelto.
    activeItems?: Array<{
      total_price: number;
      order_item_taxes?: Array<{ tax_amount: number | null }>;
    }>;
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
          opts.activeItems ?? [{ total_price: 50000, order_item_taxes: [] }],
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
        { total_price: 50000, order_item_taxes: [{ tax_amount: 8000 }] },
        { total_price: 20000, order_item_taxes: [{ tax_amount: 0 }] },
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

  // C.8/F-082 (blocker) — antes el recálculo escribía `grand_total` como
  // `subtotal + tax` a secas: envío, propina y descuento vivos en la orden
  // se perdían apenas se cancelaba UN ítem, aunque la orden siguiera
  // teniendo ambos cargos. Ahora los conserva (`shipping_cost + tip_amount
  // - discount_amount`), clampado a 0.
  it('F-082: conserva envío, propina y descuento al recalcular grand_total', async () => {
    const { service, txMock } = buildService({
      order: {
        id: ORDER_ID,
        state: 'created',
        shipping_cost: 12000,
        tip_amount: 20000,
        discount_amount: 5000,
      },
      activeItems: [
        { total_price: 50000, order_item_taxes: [{ tax_amount: 9500 }] },
        { total_price: 50000, order_item_taxes: [{ tax_amount: 9500 }] },
      ],
    });

    await service.cancelOrderItem(
      ORDER_ID,
      ITEM_ID,
      'cliente pidió una línea de menos',
    );

    const updateData = txMock.orders.update.mock.calls[0][0].data;
    expect(Number(updateData.subtotal_amount)).toBe(100000);
    expect(Number(updateData.tax_amount)).toBe(19000);
    // 100000 + 19000 + 12000 (envío) + 20000 (propina) - 5000 (descuento)
    expect(Number(updateData.grand_total)).toBe(146000);
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

describe('OrderFlowService — charge-time shipping gate (A.2 CP-facturacion-fixes)', () => {
  const DTO: any = { store_payment_method_id: 1, payment_type: PaymentType.DIRECT };

  const buildService = (probe: any) => {
    const prismaMock: any = {
      orders: {
        findFirst: jest.fn().mockResolvedValue(probe),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
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
    return { service, prismaMock };
  };

  const physicalProbe = (over: any = {}) => ({
    id: 1,
    state: 'created',
    customer_id: 5,
    store_id: 4,
    delivery_type: 'other',
    shipping_method_id: null,
    order_items: [
      { products: { product_type: 'physical' } },
    ],
    ...over,
  });

  it.each(['home_delivery', 'other'])(
    'blocks charging a %s order without shipping BEFORE the state claim',
    async (delivery_type) => {
      const { service, prismaMock } = buildService(
        physicalProbe({ delivery_type }),
      );

      await expect(service.payOrder(1, DTO)).rejects.toMatchObject({
        errorCode: ErrorCodes.ORD_SHIP_CHARGE_001.code,
      });
      // Read-only gate: the race claim was never taken.
      expect(prismaMock.orders.updateMany).not.toHaveBeenCalled();
    },
  );

  it('lets the charge through once a method is assigned', async () => {
    const { service, prismaMock } = buildService(
      physicalProbe({ shipping_method_id: 9 }),
    );

    try {
      await service.payOrder(1, DTO);
    } catch (e: any) {
      // Fails LATER (payment-method lookup unmocked here), never on the gate.
      expect(e?.errorCode).not.toBe(ErrorCodes.ORD_SHIP_CHARGE_001.code);
    }
    expect(prismaMock.orders.updateMany).toHaveBeenCalled();
  });

  it.each(['pickup', 'direct_delivery', 'dine_in'])(
    'does not block a %s order without shipping',
    async (delivery_type) => {
      const { service, prismaMock } = buildService(
        physicalProbe({ delivery_type }),
      );
      try {
        await service.payOrder(1, DTO);
      } catch (e: any) {
        // A later, unmocked payment step may reject; the shipping gate may not.
        expect(e?.errorCode).not.toBe(ErrorCodes.ORD_SHIP_CHARGE_001.code);
      }
      expect(prismaMock.orders.updateMany).toHaveBeenCalled();
    },
  );

  it('exempts services-only carts', async () => {
    const servicesOnly = buildService(
      physicalProbe({
        order_items: [{ products: { product_type: 'service' } }],
      }),
    );
    try {
      await servicesOnly.service.payOrder(1, DTO);
    } catch (e: any) {
      expect(e?.errorCode).not.toBe(ErrorCodes.ORD_SHIP_CHARGE_001.code);
    }
    expect(servicesOnly.prismaMock.orders.updateMany).toHaveBeenCalled();
  });
});

/**
 * Paso 2 sync cocina↔orden — propagación orden→cocina en
 * {@link OrderFlowService.deliverOrderItem} (DESPUÉS del stamp de
 * `delivered_at`, incluido el caso idempotente).
 *
 * Cubre: (a) ticket ready mono-ítem no-takeaway → deliver estampa el ítem,
 * cierra el ticket y emite el puente `kitchen.order_all_delivered` (el
 * listener mueve la orden `processing -> delivered` vía
 * `markKitchenOrderDelivered`); (b) ticket con hermano pendiente → solo la
 * fila del ítem cambia, ticket sigue abierto, sin evento; (c) ítem ya
 * delivered + fila ready (caso 6229) → reconcilia sin re-estampar;
 * (d) re-disparo en cocina (pending) → no toca; (e) sin filas → nada.
 *
 * Guards intactos: 404, idempotencia del stamp y ORDER_ITEM_NOT_DELIVERABLE
 * no se tocan — el sync es best-effort post-commit.
 */
describe('OrderFlowService.deliverOrderItem — sync orden→cocina (paso 2)', () => {
  const ORDER_ID = 2001;
  const ITEM_ID = 701;
  const STORE_ID = 4;
  const TICKET_ID = 55;

  const readyItem = (overrides: Record<string, unknown> = {}) => ({
    id: ITEM_ID,
    order_id: ORDER_ID,
    product_name: 'Pollo asado',
    item_type: 'prepared',
    delivered_at: null,
    kitchen_ticket_items: [{ id: 900, status: 'ready' }],
    ...overrides,
  });

  const buildService = (opts: {
    order?: Record<string, unknown>;
    // `undefined` → ítem base ready; `null` → ítem inexistente (404).
    item?: Record<string, unknown> | null;
    latestRow?: { id: number; status: string; kitchen_ticket_id: number } | null;
    // Filas del ticket VISTAS tras marcar la nuestra (el mock no muta solo).
    ticketRows?: Array<{ status: string }>;
    orderTickets?: Array<{ status: string }>;
  }) => {
    const eventEmitter = { emit: jest.fn() };
    const orderView = {
      id: ORDER_ID,
      store_id: STORE_ID,
      state: 'processing',
      delivery_type: 'direct_delivery',
      ...(opts.order ?? {}),
    };
    const prismaMock: any = {
      order_items: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            opts.item === undefined ? readyItem() : opts.item,
          ),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      kitchen_ticket_items: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            opts.latestRow === undefined ? null : opts.latestRow,
          ),
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue(opts.ticketRows ?? []),
      },
      kitchen_tickets: {
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue(opts.orderTickets ?? []),
      },
    };
    const service = new OrderFlowService(
      prismaMock as unknown as StorePrismaService,
      eventEmitter as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { logCustom: jest.fn().mockResolvedValue(undefined) } as any,
    );
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(orderView);
    return { service, prismaMock, eventEmitter, orderView };
  };

  it('(a) ticket ready mono-ítem no-takeaway → estampa, cierra ticket y emite puente', async () => {
    const { service, prismaMock, eventEmitter, orderView } = buildService({
      latestRow: { id: 900, status: 'ready', kitchen_ticket_id: TICKET_ID },
      ticketRows: [{ status: 'delivered' }],
      orderTickets: [{ status: 'delivered' }],
    });

    const result = await service.deliverOrderItem(ORDER_ID, ITEM_ID);

    // Stamp del ítem (el hecho de servicio).
    expect(prismaMock.order_items.updateMany).toHaveBeenCalledWith({
      where: { id: ITEM_ID, order_id: ORDER_ID },
      data: expect.objectContaining({ delivered_at: expect.any(Date) }),
    });
    // Solo LA fila del ítem pasa a delivered.
    expect(prismaMock.kitchen_ticket_items.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.kitchen_ticket_items.update).toHaveBeenCalledWith({
      where: { id: 900 },
      data: expect.objectContaining({ status: 'delivered' }),
    });
    // Ticket todo-terminal + ≥1 delivered → se cierra en delivered.
    expect(prismaMock.kitchen_tickets.update).toHaveBeenCalledWith({
      where: { id: TICKET_ID },
      data: expect.objectContaining({ status: 'delivered' }),
    });
    // Puente all-terminal (mismo criterio que markDelivered): el listener
    // mueve la orden `processing -> delivered`.
    expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'kitchen.order_all_delivered',
      { orderId: ORDER_ID, storeId: STORE_ID },
    );
    // Contrato intacto: devuelve la vista de la orden.
    expect(result).toEqual(orderView);
  });

  it('(b) ticket con hermano pendiente → solo la fila del ítem cambia, sin evento', async () => {
    const { service, prismaMock, eventEmitter } = buildService({
      latestRow: { id: 900, status: 'ready', kitchen_ticket_id: TICKET_ID },
      ticketRows: [{ status: 'delivered' }, { status: 'pending' }],
      orderTickets: [{ status: 'ready' }],
    });

    await service.deliverOrderItem(ORDER_ID, ITEM_ID);

    expect(prismaMock.order_items.updateMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.kitchen_ticket_items.update).toHaveBeenCalledWith({
      where: { id: 900 },
      data: expect.objectContaining({ status: 'delivered' }),
    });
    // El ticket sigue abierto (hermano pendiente) → no se cierra ni se emite.
    expect(prismaMock.kitchen_tickets.update).not.toHaveBeenCalled();
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });

  it('(c) ítem ya delivered + fila ready (caso 6229) → reconcilia sin re-estampar', async () => {
    const STAMP = new Date('2026-09-10T12:00:00.000Z');
    const { service, prismaMock, eventEmitter } = buildService({
      item: readyItem({ delivered_at: STAMP }),
      latestRow: { id: 900, status: 'ready', kitchen_ticket_id: TICKET_ID },
      ticketRows: [{ status: 'delivered' }],
      orderTickets: [{ status: 'delivered' }],
    });

    await service.deliverOrderItem(ORDER_ID, ITEM_ID);

    // Idempotencia del stamp: la primera entrega es la que ocurrió.
    expect(prismaMock.order_items.updateMany).not.toHaveBeenCalled();
    // Pero sí sincroniza: fila → delivered, ticket cierra, puente emite.
    expect(prismaMock.kitchen_ticket_items.update).toHaveBeenCalledWith({
      where: { id: 900 },
      data: expect.objectContaining({ status: 'delivered' }),
    });
    expect(prismaMock.kitchen_tickets.update).toHaveBeenCalledWith({
      where: { id: TICKET_ID },
      data: expect.objectContaining({ status: 'delivered' }),
    });
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'kitchen.order_all_delivered',
      { orderId: ORDER_ID, storeId: STORE_ID },
    );
  });

  it('(d) re-disparo en cocina (fila pending) → no toca cocina ni emite', async () => {
    const STAMP = new Date('2026-09-10T12:00:00.000Z');
    const { service, prismaMock, eventEmitter, orderView } = buildService({
      item: readyItem({ delivered_at: STAMP }),
      latestRow: { id: 901, status: 'pending', kitchen_ticket_id: TICKET_ID },
      ticketRows: [{ status: 'pending' }],
      orderTickets: [{ status: 'pending' }],
    });

    const result = await service.deliverOrderItem(ORDER_ID, ITEM_ID);

    expect(prismaMock.kitchen_ticket_items.update).not.toHaveBeenCalled();
    expect(prismaMock.kitchen_tickets.update).not.toHaveBeenCalled();
    expect(eventEmitter.emit).not.toHaveBeenCalled();
    expect(result).toEqual(orderView);
  });

  it('(e) sin filas de cocina → nada que hacer, contrato intacto', async () => {
    const { service, prismaMock, eventEmitter, orderView } = buildService({
      item: {
        ...readyItem(),
        item_type: 'physical',
        kitchen_ticket_items: [],
      },
      latestRow: null,
    });

    const result = await service.deliverOrderItem(ORDER_ID, ITEM_ID);

    expect(prismaMock.order_items.updateMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.kitchen_ticket_items.update).not.toHaveBeenCalled();
    expect(prismaMock.kitchen_tickets.update).not.toHaveBeenCalled();
    expect(eventEmitter.emit).not.toHaveBeenCalled();
    expect(result).toEqual(orderView);
  });
});

/**
 * 1060 paso 1 — guarda de entregado en {@link OrderFlowService.cancelOrderItem}.
 *
 * Un ítem con `delivered_at != null` es un hecho de servicio consumado: la
 * cancelación normal lo rechaza con `ITEM_ALREADY_DELIVERED` (409) SIN mutar
 * nada (sin tx, sin KDS, sin stock, sin soft cancel). Cubre mesa, legacy y
 * detalle porque las tres rutas pasan por este seam.
 */
describe('OrderFlowService.cancelOrderItem — guarda delivered (1060 paso 1)', () => {
  const ORDER_ID = 3017;
  const ITEM_ID = 701;

  const deliveredItem = (overrides: Record<string, unknown> = {}) => ({
    id: ITEM_ID,
    product_name: 'Pollo asado',
    inventory_consumed_at_fire: false,
    cancelled_at: null,
    delivered_at: new Date('2026-09-10T12:00:00.000Z'),
    kitchen_ticket_items: [],
    ...overrides,
  });

  const buildService = (item: Record<string, unknown>) => {
    const txMock: any = {
      kitchen_tickets: { findFirst: jest.fn() },
      inventory_transactions: { findMany: jest.fn().mockResolvedValue([]) },
      order_items: {
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
      orders: { update: jest.fn().mockResolvedValue({}) },
    };
    const prismaMock: any = {
      order_items: { findFirst: jest.fn().mockResolvedValue(item) },
      $transaction: jest.fn((cb: any) => cb(txMock)),
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
      {} as any,
      {} as any,
      {} as any,
      { logCustom: jest.fn().mockResolvedValue(undefined) } as any,
      kitchenFireService as any,
    );
    jest
      .spyOn(service as any, 'getOrder')
      .mockResolvedValue({ id: ORDER_ID, state: 'created' });
    return { service, prismaMock, txMock, kitchenFireService };
  };

  it('409 ITEM_ALREADY_DELIVERED sin mutación (ruta por defecto)', async () => {
    const { service, prismaMock, txMock, kitchenFireService } = buildService(
      deliveredItem(),
    );

    await expect(
      service.cancelOrderItem(ORDER_ID, ITEM_ID, 'cliente se arrepintió'),
    ).rejects.toMatchObject({ errorCode: 'ITEM_ALREADY_DELIVERED' });

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(txMock.order_items.update).not.toHaveBeenCalled();
    expect(txMock.orders.update).not.toHaveBeenCalled();
    expect(kitchenFireService.cancelTicketInTx).not.toHaveBeenCalled();
    expect(kitchenFireService.emitTicketCancelledEvent).not.toHaveBeenCalled();
  });

  it('409 ITEM_ALREADY_DELIVERED sin mutación (ruta con cancellation_type explícito)', async () => {
    const { service, prismaMock, txMock } = buildService(deliveredItem());

    await expect(
      service.cancelOrderItem(
        ORDER_ID,
        ITEM_ID,
        'merma pactada con el dueño',
        'after_fire_waste',
      ),
    ).rejects.toMatchObject({ errorCode: 'ITEM_ALREADY_DELIVERED' });

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(txMock.order_items.update).not.toHaveBeenCalled();
  });

  it('el conflicto de estado domina: entregado + motivo corto sigue siendo 409', async () => {
    const { service, prismaMock } = buildService(deliveredItem());

    await expect(
      service.cancelOrderItem(ORDER_ID, ITEM_ID, 'x'),
    ).rejects.toMatchObject({ errorCode: 'ITEM_ALREADY_DELIVERED' });

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});

/**
 * 1060 paso 2 — reversa de entrega {@link OrderFlowService.cancelDeliveredOrderItem}.
 *
 * Único camino para cancelar un ítem ya entregado: exige motivo (mín 3) y
 * destino (`restock` | `waste`). `restock` devuelve las unidades al stock vía
 * `StockLevelManager`; `waste` no toca stock (la merma queda auditada). Ambas
 * escriben `audit_logs` (`order_item.cancel_delivered` con usuario, motivo y
 * destino) y devuelven la vista de la orden.
 */
describe('OrderFlowService.cancelDeliveredOrderItem — reversa (1060 paso 2)', () => {
  const ORDER_ID = 4017;
  const ITEM_ID = 801;

  const deliveredItem = (overrides: Record<string, unknown> = {}) => ({
    id: ITEM_ID,
    product_id: 11,
    product_variant_id: null,
    product_name: 'Pollo asado',
    quantity: 2,
    delivered_at: new Date('2026-09-10T12:00:00.000Z'),
    cancelled_at: null,
    ...overrides,
  });

  const buildService = (opts: {
    order?: Record<string, unknown>;
    item?: Record<string, unknown> | null;
    activeItems?: Array<{
      total_price: number;
      order_item_taxes?: Array<{ tax_amount: number | null }>;
    }>;
  }) => {
    const txMock: any = {
      order_items: {
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue(
          opts.activeItems ?? [{ total_price: 30000, order_item_taxes: [] }],
        ),
      },
      orders: { update: jest.fn().mockResolvedValue({}) },
    };
    const prismaMock: any = {
      order_items: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            opts.item === undefined ? deliveredItem() : opts.item,
          ),
      },
      $transaction: jest.fn((cb: any) => cb(txMock)),
    };
    const stockLevelManager = {
      getDefaultLocationForProduct: jest.fn().mockResolvedValue(1),
      updateStock: jest.fn().mockResolvedValue({}),
    };
    const auditService = { logCustom: jest.fn().mockResolvedValue(undefined) };
    const service = new OrderFlowService(
      prismaMock as unknown as StorePrismaService,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      stockLevelManager as any,
      {} as any,
      {} as any,
      auditService as any,
    );
    const orderView = {
      id: ORDER_ID,
      state: 'created',
      store_id: 4,
      ...(opts.order ?? {}),
    };
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(orderView);
    return { service, prismaMock, txMock, stockLevelManager, auditService };
  };

  it.each(['succeeded', 'captured', 'partially_refunded', 'refunded'])(
    '409 tipado si hay pago %s, sin tocar totales, stock ni auditoría',
    async (state) => {
      const { service, prismaMock, stockLevelManager, auditService } = buildService({
        order: { state: 'finished', payments: [{ state }] },
      });

      await expect(service.cancelDeliveredOrderItem(
        ORDER_ID, ITEM_ID, 'mosca en el plato', 'waste',
      )).rejects.toMatchObject({ errorCode: 'ORD_ITEM_CANCEL_PAID_001' });
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(stockLevelManager.updateStock).not.toHaveBeenCalled();
      expect(auditService.logCustom).not.toHaveBeenCalled();
    },
  );

  it.each(['cancelled', 'refunded', 'finished'])(
    '409 tipado para estado terminal %s sin pago',
    async (state) => {
      const { service, prismaMock } = buildService({ order: { state, payments: [] } });
      const error = await service.cancelDeliveredOrderItem(
        ORDER_ID, ITEM_ID, 'mosca en el plato', 'waste',
      ).catch((caught) => caught);

      expect(error.errorCode).toBe('ORD_ITEM_CANCEL_STATE_001');
      expect(error.getResponse()).toMatchObject({ details: { state } });
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    },
  );

  it('pago pendiente no impide cancelar un plato de cuenta abierta', async () => {
    const { service, prismaMock } = buildService({
      order: { state: 'processing', payments: [{ state: 'pending' }] },
    });
    await service.cancelDeliveredOrderItem(
      ORDER_ID, ITEM_ID, 'mosca en el plato', 'waste',
    );
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  it('restock: devuelve stock, cancela suave y audita con destino', async () => {
    const { service, txMock, stockLevelManager, auditService } = buildService(
      {},
    );

    const result = await service.cancelDeliveredOrderItem(
      ORDER_ID,
      ITEM_ID,
      'el cliente devolvió el plato intacto',
      'restock',
    );

    // Destino aplicado: las 2 unidades vuelven al stock como `return`.
    expect(
      stockLevelManager.getDefaultLocationForProduct,
    ).toHaveBeenCalledWith(11, undefined);
    expect(stockLevelManager.updateStock).toHaveBeenCalledTimes(1);
    expect(stockLevelManager.updateStock.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        product_id: 11,
        quantity_change: 2,
        movement_type: 'return',
        source_module: 'order_item_cancel_delivered',
        create_movement: true,
        validate_availability: false,
      }),
    );
    // Soft cancel con el tipo contable de la reversa.
    expect(txMock.order_items.update).toHaveBeenCalledWith({
      where: { id: ITEM_ID },
      data: expect.objectContaining({
        cancellation_reason: 'el cliente devolvió el plato intacto',
        cancellation_type: 'delivered_restock',
        updated_at: expect.any(Date),
      }),
    });
    // Auditoría con usuario, motivo y destino.
    expect(auditService.logCustom).toHaveBeenCalledTimes(1);
    expect(auditService.logCustom.mock.calls[0][1]).toBe(
      'order_item.cancel_delivered',
    );
    expect(auditService.logCustom.mock.calls[0][3]).toEqual(
      expect.objectContaining({
        order_id: ORDER_ID,
        order_item_id: ITEM_ID,
        reason: 'el cliente devolvió el plato intacto',
        destination: 'restock',
      }),
    );
    expect((result as any).id).toBe(ORDER_ID);
  });

  it('waste: NO toca stock, deja merma auditada', async () => {
    const { service, txMock, stockLevelManager, auditService } = buildService(
      {},
    );

    await service.cancelDeliveredOrderItem(
      ORDER_ID,
      ITEM_ID,
      'se cayó el plato al llevarlo',
      'waste',
    );

    expect(stockLevelManager.updateStock).not.toHaveBeenCalled();
    expect(
      stockLevelManager.getDefaultLocationForProduct,
    ).not.toHaveBeenCalled();
    expect(txMock.order_items.update).toHaveBeenCalledWith({
      where: { id: ITEM_ID },
      data: expect.objectContaining({ cancellation_type: 'delivered_waste' }),
    });
    expect(auditService.logCustom).toHaveBeenCalledTimes(1);
    expect(auditService.logCustom.mock.calls[0][3]).toEqual(
      expect.objectContaining({ destination: 'waste' }),
    );
  });

  it('422 si el motivo tiene menos de 3 caracteres (sin mutación)', async () => {
    const { service, prismaMock, stockLevelManager, auditService } =
      buildService({});

    await expect(
      service.cancelDeliveredOrderItem(ORDER_ID, ITEM_ID, 'x', 'restock'),
    ).rejects.toMatchObject({
      errorCode: 'TABLE_SESSION_ADD_ITEMS_INVALID',
    });

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(stockLevelManager.updateStock).not.toHaveBeenCalled();
    expect(auditService.logCustom).not.toHaveBeenCalled();
  });

  it('422 si el destino no es restock|waste (sin mutación)', async () => {
    const { service, prismaMock, stockLevelManager, auditService } =
      buildService({});

    await expect(
      service.cancelDeliveredOrderItem(
        ORDER_ID,
        ITEM_ID,
        'motivo válido pero destino no',
        'invalid' as any,
      ),
    ).rejects.toMatchObject({
      errorCode: 'TABLE_SESSION_ADD_ITEMS_INVALID',
    });

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(stockLevelManager.updateStock).not.toHaveBeenCalled();
    expect(auditService.logCustom).not.toHaveBeenCalled();
  });

  it('409 si el ítem no está entregado (sin mutación)', async () => {
    const { service, prismaMock, stockLevelManager, auditService } =
      buildService({ item: deliveredItem({ delivered_at: null }) });

    await expect(
      service.cancelDeliveredOrderItem(
        ORDER_ID,
        ITEM_ID,
        'no hay entrega que reversar',
        'waste',
      ),
    ).rejects.toMatchObject({
      errorCode: 'TABLE_SESSION_ITEM_NOT_REMOVABLE',
    });

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(stockLevelManager.updateStock).not.toHaveBeenCalled();
    expect(auditService.logCustom).not.toHaveBeenCalled();
  });

  it('404 si el ítem no pertenece a la orden', async () => {
    const { service, prismaMock } = buildService({ item: null });

    await expect(
      service.cancelDeliveredOrderItem(ORDER_ID, 999999, 'motivo válido', 'waste'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('idempotencia: ítem ya cancelado devuelve la vista sin reescribir ni auditar', async () => {
    const { service, prismaMock, stockLevelManager, auditService } =
      buildService({
        item: deliveredItem({
          cancelled_at: new Date('2026-09-01T12:00:00.000Z'),
        }),
      });

    const result = await service.cancelDeliveredOrderItem(
      ORDER_ID,
      ITEM_ID,
      'segundo intento',
      'restock',
    );

    expect((result as any).id).toBe(ORDER_ID);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(stockLevelManager.updateStock).not.toHaveBeenCalled();
    expect(auditService.logCustom).not.toHaveBeenCalled();
  });
});

/**
 * 1060 paso 3 — si el finish falla tras el claim, `payOrder` restaura el
 * estado previo al claim (el pago compensado con motivo se conserva).
 */
describe('OrderFlowService.payOrder — finish-falla restaura estado (1060 paso 3)', () => {
  const DTO: any = { store_payment_method_id: 1, payment_type: PaymentType.DIRECT };

  const CREATED_PAYMENT = {
    id: 999,
    gateway_response: { payment_type: 'direct' },
  };

  const buildService = () => {
    const prismaMock: any = {
      store_payment_methods: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 1, system_payment_method: { type: 'card' } }),
      },
      payments: {
        create: jest.fn().mockResolvedValue(CREATED_PAYMENT),
        update: jest.fn().mockResolvedValue({}),
      },
      // Pre-claim (paso 3), shipping-gate y cupón comparten este mock: sin
      // `coupon_id` el cupón no hace nada; sin `delivery_type`/`shipping`
      // el gate no aplica; `state` alimenta la restauración.
      orders: {
        findFirst: jest.fn().mockResolvedValue({ state: 'created' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      store_settings: {
        findFirst: jest.fn().mockResolvedValue({
          settings: { pos: { allow_anonymous_sales: true } },
        }),
      },
      coupon_uses: { findFirst: jest.fn().mockResolvedValue(null) },
      coupons: { findFirst: jest.fn().mockResolvedValue(null) },
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
      id: 1,
      state: 'created',
      delivery_type: 'direct_delivery',
      grand_total: 4000,
      currency: 'COP',
      store_id: 4,
    });
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
    return { service, prismaMock };
  };

  it('finish → INV_STOCK_002: anula el pago Y restaura created', async () => {
    const { service, prismaMock } = buildService();
    jest
      .spyOn(service as any, 'updateOrderState')
      .mockRejectedValue(new VendixHttpException(ErrorCodes.INV_STOCK_002));

    await expect(service.payOrder(1, DTO)).rejects.toMatchObject({
      errorCode: 'ORD_FLOW_PAYMENT_FAILED_001',
    });

    // Pago compensado con motivo (regla existente, intacta).
    expect(prismaMock.payments.update).toHaveBeenCalledWith({
      where: { id: 999 },
      data: expect.objectContaining({
        state: 'cancelled',
        gateway_response: expect.objectContaining({
          cancellation_reason: 'finish_blocked_insufficient_stock',
        }),
      }),
    });
    // Estado restaurado al previo al claim (no varado en `processing`).
    const restoreCalls = prismaMock.orders.updateMany.mock.calls.filter(
      (c: any) => c[0]?.data?.state === 'created',
    );
    expect(restoreCalls.length).toBeGreaterThanOrEqual(1);
    expect(restoreCalls[0][0]).toEqual({
      where: { id: 1 },
      data: expect.objectContaining({ state: 'created' }),
    });
  });

  it('finish OK: NO restaura (el claim es el único updateMany)', async () => {
    const { service, prismaMock } = buildService();
    jest
      .spyOn(service as any, 'updateOrderState')
      .mockResolvedValue({ id: 1, state: 'finished' });

    await service.payOrder(1, DTO);

    expect(prismaMock.payments.update).not.toHaveBeenCalled();
    expect(prismaMock.orders.updateMany).toHaveBeenCalledTimes(1);
  });
});

/**
 * 1060 paso 2 (RBAC) — el endpoint de reversa exige el permiso propio
 * `store:orders:order_flow:cancel_delivered` (no hereda `order_flow:create`
 * del mesero). El seed lo asigna a cashier/admin/owner y NUNCA a
 * waiter/employee; el guard niega (403) a quien no lo porta.
 */
describe('OrderFlowController.cancelDeliveredOrderItem — permiso propio (1060 paso 2)', () => {
  it(`declara @Permissions('store:orders:order_flow:cancel_delivered')`, () => {
    const perms = Reflect.getMetadata(
      PERMISSIONS_KEY,
      (OrderFlowController.prototype as any).cancelDeliveredOrderItem,
    );
    expect(perms).toContain('store:orders:order_flow:cancel_delivered');
  });
});

/**
 * Cancelar una venta YA COBRADA EN EFECTIVO tiene que mover la caja.
 *
 * El dinero salió del cajón cuando el cliente pagó y vuelve a salir cuando se
 * le devuelve al cancelar: si nadie registra ese egreso, el arqueo del cierre
 * reporta un faltante sin causa. `createRefund` NO es reutilizable para
 * taparlo — `CANCELABLE_STATES` (`created`/`pending_payment`/`processing`) y
 * `REFUNDABLE_STATES` (`delivered`/`finished`) son conjuntos DISJUNTOS, así
 * que la llamada moriría en 400 antes de tocar caja.
 *
 * Lo que estos casos fijan:
 *  - el egreso se escribe contra la sesión de caja abierta, por el monto
 *    exacto de los pagos `succeeded` en efectivo (no de la orden: un cobro
 *    parcial o mixto devuelve sólo lo que entró en billetes);
 *  - un pago `pending` no movió dinero y NO genera egreso;
 *  - una venta con tarjeta cancela igual y no toca la caja;
 *  - cuando el egreso NO se puede registrar, la falla queda AUDITADA. El
 *    anti-ejemplo vivo es `recordRefundCashRegisterMovement`
 *    (refund-flow.service.ts:842): `catch {}` adentro y `.catch(() => {})`
 *    afuera — dos mordazas en serie que hacen indistinguible el egreso
 *    escrito del egreso perdido.
 */
describe('OrderFlowService.cancelOrder — egreso de caja de la venta cobrada en efectivo', () => {
  const ORDER_ID = 9001;
  const SESSION_ID = 77;
  const CASH_METHOD_ID = 11;
  const CARD_METHOD_ID = 22;
  const CASH_PAYMENT_ID = 5001;
  const CARD_PAYMENT_ID = 5002;

  const DTO: any = { reason: 'El cliente desistió de la compra' };

  let service: OrderFlowService;
  let prismaMock: PrismaMock;
  let settings: { getSettings: jest.Mock };
  let sessions: { getActiveSession: jest.Mock };
  let movements: { createManualMovement: jest.Mock };
  let audit: { log: jest.Mock; logCustom: jest.Mock };
  let stock: { releaseReservationsByReference: jest.Mock };
  let emitter: { emit: jest.Mock };

  /** Orden cancelable (estado `processing`) con los pagos que se le pasen. */
  const cancelableOrder = (payments: any[]) =>
    buildOrder({
      id: ORDER_ID,
      state: 'processing',
      order_number: 'POS-1',
      internal_notes: null,
      payments: payments.map((p) => ({
        ...p,
        store_payment_method: p.store_payment_method ?? { system_payment_method: {
          type: p.store_payment_method_id === CARD_METHOD_ID ? 'card' : 'cash', processing_mode: 'DIRECT',
        } },
      })),
    });

  beforeEach(() => {
    jest.clearAllMocks();
    // `getContext` es estático: el spy se re-aplica por test (ver prisma-mock).
    mockRequestContext({ store_id: 100, organization_id: 1, user_id: 7 });

    prismaMock = createPrismaMock({
      orders: ['updateMany', 'update'],
      order_items: ['findMany'],
      payments: ['findMany', 'update'],
      table_sessions: ['findFirst'],
    });
    prismaMock.$queryRaw = jest.fn().mockResolvedValue([{ id: ORDER_ID, state: 'processing' }]);
    // Sin ítems de cocina: la rama KDS de `cancelOrder` no participa aquí.
    prismaMock.order_items.findMany.mockResolvedValue([]);
    // El claim atómico gana (count=1) → corre la cadena de efectos.
    prismaMock.orders.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.orders.update.mockResolvedValue({
      id: ORDER_ID,
      store_id: 100,
      state: 'cancelled',
    });
    prismaMock.payments.update.mockResolvedValue({});
    // Por defecto: ningún pago del lote es en efectivo. Cada test que necesita
    // efectivo lo declara explícitamente.
    prismaMock.payments.findMany.mockResolvedValue([]);
    prismaMock.table_sessions.findFirst.mockResolvedValue(null);

    settings = {
      getSettings: jest
        .fn()
        .mockResolvedValue({ pos: { cash_register: { enabled: true } } }),
    };
    sessions = {
      getActiveSession: jest.fn().mockResolvedValue({ id: SESSION_ID }),
    };
    movements = {
      createManualMovement: jest.fn().mockResolvedValue({ id: 31 }),
    };
    audit = {
      log: jest.fn().mockResolvedValue(undefined),
      logCustom: jest.fn().mockResolvedValue(undefined),
    };
    stock = {
      releaseReservationsByReference: jest.fn().mockResolvedValue(undefined),
    };
    emitter = { emit: jest.fn() };

    service = new OrderFlowService(
      prismaMock as unknown as StorePrismaService,
      emitter as any,
      settings as any,
      sessions as any,
      movements as any,
      stock as any,
      {} as any,
      {} as any,
      audit as any,
    );
  });

  it('cancela un draft sin mesa mediante el claim condicional', async () => {
    const draft = { ...cancelableOrder([]), state: 'draft', order_items: [] };
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(draft);

    await expect(service.cancelOrder(ORDER_ID, DTO)).resolves.toMatchObject({ state: 'cancelled' });
    expect(prismaMock.orders.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: ORDER_ID, state: { in: expect.arrayContaining(['draft']) },
      }),
    }));
    expect(prismaMock.table_sessions.findFirst).toHaveBeenCalledWith({
      where: { order_id: ORDER_ID, store_id: 100, closed_at: null },
      select: { id: true },
    });
  });

  it('rechaza draft con mesa abierta antes de escribir, con código y sesión', async () => {
    jest.spyOn(service as any, 'getOrder').mockResolvedValue({
      ...cancelableOrder([]), state: 'draft', order_items: [],
    });
    prismaMock.table_sessions.findFirst.mockResolvedValue({ id: 55 });

    await expect(service.cancelOrder(ORDER_ID, DTO)).rejects.toMatchObject({
      errorCode: 'ORD_CANCEL_OPEN_TABLE_001',
      response: expect.objectContaining({ details: { table_session_id: 55 } }),
    });
    expect(prismaMock.orders.updateMany).not.toHaveBeenCalled();
    expect(stock.releaseReservationsByReference).not.toHaveBeenCalled();
  });

  it('pago succeeded en efectivo: registra el egreso por el monto exacto', async () => {
    jest
      .spyOn(service as any, 'getOrder')
      .mockResolvedValue(
        cancelableOrder([
          buildPayment({
            id: CASH_PAYMENT_ID,
            state: 'succeeded',
            store_payment_method_id: CASH_METHOD_ID,
            amount: new Prisma.Decimal('59.50'),
          }),
        ]),
      );
    prismaMock.payments.findMany.mockResolvedValue([
      { id: CASH_PAYMENT_ID, amount: new Prisma.Decimal('59.50') },
    ]);

    await service.cancelOrder(ORDER_ID, DTO);

    expect(movements.createManualMovement).toHaveBeenCalledTimes(1);
    const [sessionId, payload] = movements.createManualMovement.mock.calls[0];
    expect(sessionId).toBe(SESSION_ID);
    expect(payload.type).toBe('cash_out');
    // Comparación en Decimal: `59.5 === 59.50` como float esconde justo el
    // error de escala que este caso persigue.
    expect(
      new Prisma.Decimal(payload.amount).equals(new Prisma.Decimal('59.50')),
    ).toBe(true);
  });

  it('suma los pagos en efectivo del lote (cobro mixto: sólo el efectivo sale)', async () => {
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(
      cancelableOrder([
        buildPayment({
          id: CASH_PAYMENT_ID,
          state: 'succeeded',
          store_payment_method_id: CASH_METHOD_ID,
          amount: new Prisma.Decimal('40.00'),
        }),
        buildPayment({
          id: CARD_PAYMENT_ID,
          state: 'succeeded',
          store_payment_method_id: CARD_METHOD_ID,
          amount: new Prisma.Decimal('19.50'),
        }),
      ]),
    );
    // El filtro por canal vive en SQL: sólo vuelve el pago en efectivo.
    prismaMock.payments.findMany.mockResolvedValue([
      { id: CASH_PAYMENT_ID, amount: new Prisma.Decimal('40.00') },
    ]);

    await service.cancelOrder(ORDER_ID, DTO);

    const [, payload] = movements.createManualMovement.mock.calls[0];
    expect(
      new Prisma.Decimal(payload.amount).equals(new Prisma.Decimal('40.00')),
    ).toBe(true);
  });

  it('NO-REGRESIÓN — venta con tarjeta: cancela igual y no toca la caja', async () => {
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(
      cancelableOrder([
        buildPayment({
          id: CARD_PAYMENT_ID,
          state: 'succeeded',
          store_payment_method_id: CARD_METHOD_ID,
        }),
      ]),
    );
    prismaMock.payments.findMany.mockResolvedValue([]);

    const result = await service.cancelOrder(ORDER_ID, DTO);

    // El arnés alcanza el call site REAL: el claim atómico corrió con su WHERE
    // condicional, el pago quedó anulado y el evento post-commit salió. Sin
    // estas tres, el `not.toHaveBeenCalled` de abajo pasaría por no haber
    // ejecutado nada — un mock muerto también "no llama" a la caja.
    expect(prismaMock.orders.updateMany).toHaveBeenCalledWith({
      where: {
        id: ORDER_ID,
        state: { in: ['draft', 'created', 'pending_payment', 'processing'] },
      },
      data: expect.objectContaining({ state: 'cancelled' }),
    });
    expect(prismaMock.payments.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: CARD_PAYMENT_ID } }),
    );
    expect(emitter.emit).toHaveBeenCalledWith(
      'order.status_changed',
      expect.objectContaining({
        old_state: 'processing',
        new_state: 'cancelled',
      }),
    );
    expect(result).toMatchObject({ state: 'cancelled' });

    expect(movements.createManualMovement).not.toHaveBeenCalled();
  });

  it('pago en efectivo `pending`: nunca entró al cajón, no hay egreso', async () => {
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(
      cancelableOrder([
        buildPayment({
          id: CASH_PAYMENT_ID,
          state: 'pending',
          store_payment_method_id: CASH_METHOD_ID,
          amount: new Prisma.Decimal('59.50'),
        }),
      ]),
    );
    // Trampa deliberada: si el código mandara los pagos `pending` a la
    // clasificación por canal, esta fila lo delataría con un egreso fantasma.
    prismaMock.payments.findMany.mockResolvedValue([
      { id: CASH_PAYMENT_ID, amount: new Prisma.Decimal('59.50') },
    ]);

    await service.cancelOrder(ORDER_ID, DTO);

    expect(movements.createManualMovement).not.toHaveBeenCalled();
  });

  it('el egreso que falla deja constancia auditable (no es un catch mudo)', async () => {
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(
      cancelableOrder([
        buildPayment({
          id: CASH_PAYMENT_ID,
          state: 'succeeded',
          store_payment_method_id: CASH_METHOD_ID,
          amount: new Prisma.Decimal('59.50'),
        }),
      ]),
    );
    prismaMock.payments.findMany.mockResolvedValue([
      { id: CASH_PAYMENT_ID, amount: new Prisma.Decimal('59.50') },
    ]);
    movements.createManualMovement.mockRejectedValue(
      new Error('caja no disponible'),
    );

    // La cancelación ya hizo commit: relanzar aquí le diría al operador que
    // falló lo que sí ocurrió, y su reintento chocaría contra el 400 de
    // `CANCELABLE_STATES`. La falla se ESCALA, no se propaga.
    await expect(service.cancelOrder(ORDER_ID, DTO)).resolves.toMatchObject({
      state: 'cancelled',
    });

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'order.cancel.cash_out_unrecorded',
        resourceId: ORDER_ID,
        metadata: expect.objectContaining({ cause: 'movement_write_failed' }),
      }),
    );
  });

  it('sin sesión de caja abierta: no inventa el movimiento y escala la falla', async () => {
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(
      cancelableOrder([
        buildPayment({
          id: CASH_PAYMENT_ID,
          state: 'succeeded',
          store_payment_method_id: CASH_METHOD_ID,
          amount: new Prisma.Decimal('59.50'),
        }),
      ]),
    );
    prismaMock.payments.findMany.mockResolvedValue([
      { id: CASH_PAYMENT_ID, amount: new Prisma.Decimal('59.50') },
    ]);
    sessions.getActiveSession.mockResolvedValue(null);

    await service.cancelOrder(ORDER_ID, DTO);

    expect(movements.createManualMovement).not.toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'order.cancel.cash_out_unrecorded',
        metadata: expect.objectContaining({ cause: 'no_open_session' }),
      }),
    );
  });

  it('módulo de caja apagado: ni movimiento ni escalamiento', async () => {
    settings.getSettings.mockResolvedValue({
      pos: { cash_register: { enabled: false } },
    });
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(
      cancelableOrder([
        buildPayment({
          id: CASH_PAYMENT_ID,
          state: 'succeeded',
          store_payment_method_id: CASH_METHOD_ID,
          amount: new Prisma.Decimal('59.50'),
        }),
      ]),
    );
    prismaMock.payments.findMany.mockResolvedValue([
      { id: CASH_PAYMENT_ID, amount: new Prisma.Decimal('59.50') },
    ]);

    await service.cancelOrder(ORDER_ID, DTO);

    // La cancelación sí corrió (el mock no está muerto)...
    expect(prismaMock.orders.updateMany).toHaveBeenCalled();
    // ...pero sin cajón que cuadrar no hay egreso que registrar NI falla que
    // escalar: la venta tampoco registró su `sale` al cobrar (mismo gate en
    // `recordPayOrderCashMovement`), así que escribir sólo el egreso
    // descuadraría una sesión que no existe.
    expect(movements.createManualMovement).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });
  it.each([false, true])('rechaza cancelar stock comprometido incluso force=%s', async (force) => {
    const order = cancelableOrder([buildPayment({ state: 'succeeded' })]);
    order.order_items = [{ ...order.order_items[0], inventory_committed: true,
      inventory_consumed_at_fire: false }] as any;
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(order);
    await expect(service.cancelOrder(ORDER_ID, DTO, force)).rejects.toMatchObject({
      response: expect.objectContaining({ error_code: 'ORD_CANCEL_STOCK_COMMITTED_001' }),
    });
    expect(prismaMock.payments.update).not.toHaveBeenCalled();
    expect(stock.releaseReservationsByReference).not.toHaveBeenCalled();
  });

  it('no anula localmente un pago ONLINE confirmado sin devolución monetaria', async () => {
    const order = cancelableOrder([buildPayment({ state: 'succeeded',
      store_payment_method: { system_payment_method: { type: 'wompi', processing_mode: 'ONLINE' } },
    })]);
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(order);
    await expect(service.cancelOrder(ORDER_ID, DTO)).rejects.toMatchObject({
      response: expect.objectContaining({ error_code: 'ORD_CANCEL_PAYMENT_REVERSAL_REQUIRED_001' }),
    });
    expect(prismaMock.payments.update).not.toHaveBeenCalled();
  });

  it('cancelPayment tampoco puede anular un ONLINE succeeded', async () => {
    const order = cancelableOrder([buildPayment({ state: 'succeeded',
      store_payment_method: { system_payment_method: { type: 'wompi', processing_mode: 'ONLINE' } },
    })]);
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(order);
    await expect(service.cancelPayment(ORDER_ID, { reason: 'QA' }, 'admin')).rejects
      .toMatchObject({ errorCode: 'ORD_CANCEL_PAYMENT_REVERSAL_REQUIRED_001' });
    expect(prismaMock.payments.update).not.toHaveBeenCalled();
    expect(prismaMock.orders.update).not.toHaveBeenCalled();
  });

  it('relee líneas después de esperar el lock, no usa el snapshot cancelable anterior', async () => {
    const before = cancelableOrder([]);
    const after = { ...before, order_items: [{ inventory_committed: true }] };
    jest.spyOn(service as any, 'getOrder').mockResolvedValueOnce(before).mockResolvedValueOnce(after);
    await expect(service.cancelOrder(ORDER_ID, DTO)).rejects
      .toMatchObject({ errorCode: 'ORD_CANCEL_STOCK_COMMITTED_001' });
    expect(prismaMock.orders.updateMany).not.toHaveBeenCalled();
  });

  it('confirmPayment no resucita la orden si cancelación ganó el lock', async () => {
    const pending = { ...cancelableOrder([]), state: 'pending_payment' };
    jest.spyOn(service as any, 'getOrder').mockResolvedValueOnce(pending)
      .mockResolvedValueOnce({ ...pending, state: 'cancelled' });
    await expect(service.confirmPayment(ORDER_ID)).resolves.toMatchObject({
      state: 'cancelled', payment_confirmation_applied: false,
    });
    expect(prismaMock.orders.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.payments.update).not.toHaveBeenCalled();
    expect(emitter.emit).not.toHaveBeenCalled();
  });

  it('cancelación registra el estado fresco ganador, no la prelectura', async () => {
    const before = { ...cancelableOrder([]), state: 'pending_payment' };
    jest.spyOn(service as any, 'getOrder').mockResolvedValueOnce(before)
      .mockResolvedValueOnce({ ...before, state: 'processing' });
    await service.cancelOrder(ORDER_ID, DTO);
    expect(emitter.emit).toHaveBeenCalledWith('order.status_changed', expect.objectContaining({ old_state: 'processing' }));
    const write = prismaMock.orders.update.mock.calls[0][0];
    expect(JSON.parse(write.data.internal_notes)._flow_metadata.previous_state).toBe('processing');
  });

});
