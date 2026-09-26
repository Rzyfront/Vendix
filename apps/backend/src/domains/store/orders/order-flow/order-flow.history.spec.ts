import { OrderFlowService } from './order-flow.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { PaymentType } from './dto';
import { Prisma } from '@prisma/client';
import {
  createPrismaMock,
  mockRequestContext,
  PrismaMock,
} from 'src/testing/prisma-mock';
import { buildOrder, buildPayment } from 'src/testing/money-fixtures';
import { OrderHistoryService } from '../order-history/order-history.service';

/**
 * Plan order-truth-and-invoice-tz — paso 6 verificación. `OrderHistoryService
 * .record` fue cableado en cada escritor de estado/pago de `OrderFlowService`
 * (b8db4e0ba..a5f5a17b1) pero ningún spec afirmaba las llamadas. Este archivo
 * es NUEVO a propósito — no toca `order-flow.service.spec.ts` (4700+ líneas) —
 * y cubre, por sitio de llamada: `type`, `fromState`/`toState`, `storeId` e
 * ids relevantes.
 *
 * Convención de mock: `orderHistoryService` entra como el 16º parámetro
 * posicional (`@Optional()`, último del constructor). La mayoría de los casos
 * usan un stub `{ record: jest.fn() }` e inspeccionan los argumentos de la
 * llamada; los casos que afirman una NO-escritura ("no registra
 * state_changed") usan la `OrderHistoryService` REAL para que su guarda
 * `fromState === toState` (order-history.service.ts:53-59) se ejecute de
 * verdad contra un `tx.order_events.create` espiado.
 */
// `mockRequestContext` (usado por confirmPayment/cancelPayment/cancelOrder
// más abajo) espía `RequestContextService.getContext` con
// `jest.spyOn(...).mockReturnValue(...)`. Ese spy sobrevive entre `it()` de
// TODO el archivo si nadie lo restaura: un grupo posterior que dependa del
// contexto real (sin ALS activo, `getUserId()` -> `undefined`) heredaría el
// `user_id` mockeado por un grupo anterior. Restaurar tras cada test aisla
// los casos entre si.
afterEach(() => {
  jest.restoreAllMocks();
});

describe('OrderFlowService.updateOrderState — order_events (plan order-truth-and-invoice-tz)', () => {
  const ORDER_ID = 9001;

  it('newState="finished" (rama transaccional): registra state_changed con fromState real y source mapeado', async () => {
    const prismaMock = createPrismaMock({ orders: ['findUnique', 'update'] });
    prismaMock.orders.findUnique.mockImplementation(async (args: any) => {
      if (args?.select?.internal_notes !== undefined) return { internal_notes: null };
      return {
        state: 'delivered',
        store_id: 100,
        order_number: 'ORD-1',
        stores: { organization_id: 1 },
      };
    });
    prismaMock.orders.update.mockResolvedValue({
      id: ORDER_ID,
      store_id: 100,
      stores: { id: 100, name: 'Test Store', store_code: 'T1', organization_id: 1 },
      order_items: [],
      payments: [],
    });
    const orderStockCommit = {
      commitOrderDelivery: jest.fn().mockResolvedValue({ totalCost: 0 }),
    };
    const orderHistoryService = { record: jest.fn().mockResolvedValue(null) };

    const service = new OrderFlowService(
      prismaMock as unknown as StorePrismaService,
      { emit: jest.fn() } as any,
      {} as any, {} as any, {} as any, {} as any, {} as any,
      orderStockCommit as any,
      { logCustom: jest.fn().mockResolvedValue(undefined) } as any,
      undefined, undefined, undefined, undefined, undefined, undefined,
      orderHistoryService as any,
    );

    await (service as any).updateOrderState(
      ORDER_ID,
      'finished',
      { auto_finished: true },
      { source: 'job' },
    );

    expect(orderHistoryService.record).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({
        orderId: ORDER_ID,
        storeId: 100,
        organizationId: 1,
        type: 'state_changed',
        fromState: 'delivered',
        toState: 'finished',
        source: 'job',
      }),
    );
  });

  it('newState genérico (rama no transaccional): registra state_changed con el previous_order leído', async () => {
    const prismaMock = createPrismaMock({ orders: ['findUnique', 'update'] });
    prismaMock.orders.findUnique.mockResolvedValue({
      state: 'processing',
      store_id: 100,
      order_number: 'ORD-2',
      stores: { organization_id: 1 },
    });
    prismaMock.orders.update.mockResolvedValue({
      id: ORDER_ID,
      store_id: 100,
      stores: { id: 100, name: 'Test Store', store_code: 'T1' },
      order_items: [],
      payments: [],
    });
    const orderHistoryService = { record: jest.fn().mockResolvedValue(null) };

    const service = new OrderFlowService(
      prismaMock as unknown as StorePrismaService,
      { emit: jest.fn() } as any,
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
      { logCustom: jest.fn().mockResolvedValue(undefined) } as any,
      undefined, undefined, undefined, undefined, undefined, undefined,
      orderHistoryService as any,
    );

    await (service as any).updateOrderState(ORDER_ID, 'shipped', {}, {});

    expect(orderHistoryService.record).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({
        orderId: ORDER_ID,
        storeId: 100,
        organizationId: 1,
        type: 'state_changed',
        fromState: 'processing',
        toState: 'shipped',
        source: undefined,
      }),
    );
  });

  it('opts.historyFromState pisa el estado leído de la fila (fix 5db736e6f)', async () => {
    const prismaMock = createPrismaMock({ orders: ['findUnique', 'update'] });
    // La fila real dice 'processing' (el claim transitorio de payOrder) —
    // el historial debe mostrar el `historyFromState` explícito, NUNCA esto.
    prismaMock.orders.findUnique.mockResolvedValue({
      state: 'processing',
      store_id: 100,
      order_number: 'ORD-3',
      stores: { organization_id: 1 },
    });
    prismaMock.orders.update.mockResolvedValue({
      id: ORDER_ID,
      store_id: 100,
      stores: { id: 100, name: 'Test Store', store_code: 'T1' },
      order_items: [],
      payments: [],
    });
    const orderHistoryService = { record: jest.fn().mockResolvedValue(null) };

    const service = new OrderFlowService(
      prismaMock as unknown as StorePrismaService,
      { emit: jest.fn() } as any,
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
      { logCustom: jest.fn().mockResolvedValue(undefined) } as any,
      undefined, undefined, undefined, undefined, undefined, undefined,
      orderHistoryService as any,
    );

    await (service as any).updateOrderState(
      ORDER_ID,
      'shipped',
      {},
      { historyFromState: 'created' },
    );

    expect(orderHistoryService.record).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({
        type: 'state_changed',
        fromState: 'created', // NO 'processing' — ese es el bug que el fix cierra.
        toState: 'shipped',
      }),
    );
  });
});

describe('OrderFlowService.payOrder — payment_registered / state_changed', () => {
  const ORDER_ID = 1;

  it('delivered sin pago liquidado: registra payment_registered por tramo y NO un state_changed a finished', async () => {
    let paySeq = 500;
    const prismaMock: any = {
      store_payment_methods: {
        findFirst: jest.fn().mockResolvedValue({
          id: 1,
          system_payment_method: { type: 'cash', processing_mode: 'DIRECT' },
        }),
      },
      payments: {
        create: jest.fn().mockImplementation(async ({ data }: any) => ({
          id: ++paySeq,
          ...data,
        })),
        count: jest.fn().mockResolvedValue(0),
      },
      orders: {
        findFirst: jest.fn().mockImplementation(async (args: any) => {
          const sel = args?.select;
          if (sel?.state !== undefined && sel?.payment_form !== undefined) {
            return { state: 'delivered', payment_form: null };
          }
          if (sel?.coupon_id !== undefined) {
            return { id: ORDER_ID, coupon_id: null, coupon_code: null, discount_amount: null, store_id: 4 };
          }
          return {
            id: ORDER_ID,
            active_financial_split_id: null,
            delivery_type: 'direct_delivery',
            shipping_method_id: null,
            order_items: [],
          };
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({ id: ORDER_ID }),
      },
    };

    const orderHistoryService = { record: jest.fn().mockResolvedValue(null) };
    const service = new OrderFlowService(
      prismaMock as unknown as StorePrismaService,
      { emit: jest.fn() } as any,
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
      { logCustom: jest.fn().mockResolvedValue(undefined) } as any,
      undefined, undefined, undefined, undefined, undefined, undefined,
      orderHistoryService as any,
    );

    jest.spyOn(service as any, 'getOrder').mockResolvedValue({
      id: ORDER_ID,
      state: 'processing',
      delivery_type: 'direct_delivery',
      store_id: 4,
      customer_id: 44,
      currency: 'COP',
      subtotal_amount: 50,
      tax_amount: 9.5,
      grand_total: 59.5,
      payments: [],
    });
    jest.spyOn(service as any, 'generateTransactionId').mockResolvedValue('TXN-1');
    jest.spyOn(service as any, 'recordPayOrderCashMovement').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'emitPosSaleCompletedIfFullyPaid').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'projectPaidOrderToTable').mockResolvedValue(undefined);
    // La orden permanece en 'delivered' — updateOrderState real corre, pero
    // como fromState === toState ('delivered' → 'delivered') no es una
    // transición real. Sólo nos interesa que createLegPayments registre el
    // payment_registered; no forzamos aquí la escritura real de updateOrderState.
    jest.spyOn(service as any, 'updateOrderState').mockResolvedValue({ id: ORDER_ID, state: 'delivered' });

    const DTO: any = { store_payment_method_id: 1, payment_type: PaymentType.DIRECT };
    await service.payOrder(ORDER_ID, DTO);

    expect(orderHistoryService.record).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({
        orderId: ORDER_ID,
        type: 'payment_registered',
        amount: 59.5,
      }),
    );
    expect(orderHistoryService.record).not.toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({ type: 'state_changed', toState: 'finished' }),
    );
  });

  it('shipped: registra sólo payment_registered — el guard real de OrderHistoryService suprime el state_changed no-op (fix 5db736e6f)', async () => {
    const prismaMock: any = {
      store_payment_methods: {
        findFirst: jest.fn().mockResolvedValue({
          id: 1,
          system_payment_method: { type: 'cash', processing_mode: 'DIRECT' },
        }),
      },
      payments: {
        create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 501, ...data })),
      },
      orders: {
        findFirst: jest.fn().mockImplementation(async (args: any) => {
          const sel = args?.select;
          if (sel?.state !== undefined && sel?.payment_form !== undefined) {
            return { state: 'shipped', payment_form: null };
          }
          if (sel?.coupon_id !== undefined) {
            return { id: ORDER_ID, coupon_id: null, coupon_code: null, discount_amount: null, store_id: 4 };
          }
          return {
            id: ORDER_ID,
            active_financial_split_id: null,
            delivery_type: 'direct_delivery',
            shipping_method_id: null,
            order_items: [],
          };
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({
          id: ORDER_ID,
          store_id: 4,
          stores: { id: 4, name: 'Test Store', store_code: 'T1' },
          order_items: [],
          payments: [],
        }),
        findUnique: jest.fn().mockResolvedValue({
          state: 'processing',
          store_id: 4,
          order_number: 'ORD-SHIPPED',
          stores: { organization_id: 9 },
        }),
      },
      // Real OrderHistoryService target: la ÚNICA forma de probar "NO
      // registra" es dejar correr la guarda real (fromState === toState).
      order_events: { create: jest.fn().mockResolvedValue({ id: 1 }) },
    };

    const orderHistoryService = new OrderHistoryService({} as any);
    const service = new OrderFlowService(
      prismaMock as unknown as StorePrismaService,
      { emit: jest.fn() } as any,
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
      { logCustom: jest.fn().mockResolvedValue(undefined) } as any,
      undefined, undefined, undefined, undefined, undefined, undefined,
      orderHistoryService as any,
    );

    jest.spyOn(service as any, 'getOrder').mockResolvedValue({
      id: ORDER_ID,
      state: 'processing',
      delivery_type: 'direct_delivery',
      store_id: 4,
      customer_id: 44,
      currency: 'COP',
      subtotal_amount: 50,
      tax_amount: 9.5,
      grand_total: 59.5,
      payments: [],
    });
    jest.spyOn(service as any, 'generateTransactionId').mockResolvedValue('TXN-1');
    jest.spyOn(service as any, 'recordPayOrderCashMovement').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'emitPosSaleCompletedIfFullyPaid').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'projectPaidOrderToTable').mockResolvedValue(undefined);

    const DTO: any = { store_payment_method_id: 1, payment_type: PaymentType.DIRECT };
    await service.payOrder(ORDER_ID, DTO);

    const eventsCreated = prismaMock.order_events.create.mock.calls.map((c: any) => c[0].data);
    const paymentEvent = eventsCreated.find((d: any) => d.event_type === 'payment_registered');
    expect(paymentEvent).toBeDefined();
    expect(Number(paymentEvent.amount)).toBe(59.5);
    // La guarda real (order-history.service.ts:53-59) descarta fromState===toState
    // ('shipped'→'shipped'): CERO filas state_changed llegan a `create`.
    expect(eventsCreated.some((d: any) => d.event_type === 'state_changed')).toBe(false);
  });

  it('created con delivery_type que requiere fulfillment: registra state_changed created→processing, nunca processing→processing', async () => {
    const prismaMock: any = {
      store_payment_methods: {
        findFirst: jest.fn().mockResolvedValue({
          id: 1,
          system_payment_method: { type: 'cash', processing_mode: 'DIRECT' },
        }),
      },
      payments: {
        create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 601, ...data })),
        count: jest.fn().mockResolvedValue(0),
      },
      orders: {
        findFirst: jest.fn().mockImplementation(async (args: any) => {
          const sel = args?.select;
          if (sel?.state !== undefined && sel?.payment_form !== undefined) {
            return { state: 'created', payment_form: null };
          }
          if (sel?.coupon_id !== undefined) {
            return { id: ORDER_ID, coupon_id: null, coupon_code: null, discount_amount: null, store_id: 4 };
          }
          return {
            id: ORDER_ID,
            active_financial_split_id: null,
            delivery_type: 'home_delivery',
            shipping_method_id: 7,
            order_items: [{ products: { product_type: 'product' } }],
          };
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({
          id: ORDER_ID,
          store_id: 4,
          stores: { id: 4, name: 'Test Store', store_code: 'T1' },
          order_items: [],
          payments: [],
        }),
        findUnique: jest.fn().mockResolvedValue({
          state: 'processing',
          store_id: 4,
          order_number: 'ORD-CREATED',
          stores: { organization_id: 9 },
        }),
      },
    };

    const orderHistoryService = { record: jest.fn().mockResolvedValue(null) };
    const service = new OrderFlowService(
      prismaMock as unknown as StorePrismaService,
      { emit: jest.fn() } as any,
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
      { logCustom: jest.fn().mockResolvedValue(undefined) } as any,
      undefined, undefined, undefined, undefined, undefined, undefined,
      orderHistoryService as any,
    );

    jest.spyOn(service as any, 'getOrder').mockResolvedValue({
      id: ORDER_ID,
      state: 'processing',
      delivery_type: 'home_delivery',
      store_id: 4,
      customer_id: 44,
      currency: 'COP',
      subtotal_amount: 50,
      tax_amount: 9.5,
      grand_total: 59.5,
      payments: [],
    });
    jest.spyOn(service as any, 'generateTransactionId').mockResolvedValue('TXN-1');
    jest.spyOn(service as any, 'validateTransition').mockReturnValue(undefined);
    jest.spyOn(service as any, 'recordPayOrderCashMovement').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'emitPosSaleCompletedIfFullyPaid').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'projectPaidOrderToTable').mockResolvedValue(undefined);

    const DTO: any = { store_payment_method_id: 1, payment_type: PaymentType.DIRECT };
    await service.payOrder(ORDER_ID, DTO);

    expect(orderHistoryService.record).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({
        orderId: ORDER_ID,
        storeId: 4,
        organizationId: 9,
        type: 'state_changed',
        fromState: 'created',
        toState: 'processing',
      }),
    );
    expect(orderHistoryService.record).not.toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({
        type: 'state_changed',
        fromState: 'processing',
        toState: 'processing',
      }),
    );
  });
});

describe('OrderFlowService.confirmPayment — payment_registered + state_changed', () => {
  const ORDER_ID = 9001;
  let prismaMock: PrismaMock;

  const buildHarness = () => {
    prismaMock = createPrismaMock({
      orders: ['update', 'updateMany', 'findFirst'],
      payments: ['update', 'updateMany'],
    });
    prismaMock.$queryRaw = jest.fn().mockResolvedValue([{ id: ORDER_ID, state: 'pending_payment' }]);
    prismaMock.orders.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.orders.update.mockResolvedValue({ id: ORDER_ID, state: 'processing' });
    prismaMock.orders.findFirst.mockResolvedValue({ id: ORDER_ID, state: 'processing', payments: [] });
    prismaMock.payments.update.mockResolvedValue({});
    prismaMock.payments.updateMany.mockResolvedValue({ count: 1 });

    const orderHistoryService = { record: jest.fn().mockResolvedValue(null) };
    const service = new OrderFlowService(
      prismaMock as unknown as StorePrismaService,
      { emit: jest.fn() } as any,
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
      { log: jest.fn().mockResolvedValue(undefined), logCustom: jest.fn().mockResolvedValue(undefined) } as any,
      undefined, undefined, undefined, undefined, undefined, undefined,
      orderHistoryService as any,
    );
    jest.spyOn(service as any, 'commitCouponUseForOrder').mockResolvedValue(undefined);
    return { service, orderHistoryService };
  };

  const grandTotal = new Prisma.Decimal('59.50');
  const pendingOrder = () =>
    buildOrder({
      id: ORDER_ID,
      state: 'pending_payment',
      grand_total: grandTotal,
      total_paid: new Prisma.Decimal('0'),
      remaining_balance: grandTotal,
      stores: { organization_id: 1 },
      payments: [buildPayment({ id: 5001, state: 'pending', amount: grandTotal })],
    });

  beforeEach(() => {
    jest.clearAllMocks();
    mockRequestContext({ store_id: 100, organization_id: 1, user_id: 7 });
  });

  it('sin opts.source: payment_registered + state_changed pending_payment→processing, source undefined', async () => {
    const { service, orderHistoryService } = buildHarness();
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(pendingOrder());

    await service.confirmPayment(ORDER_ID);

    expect(orderHistoryService.record).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({
        orderId: ORDER_ID,
        type: 'payment_registered',
        paymentId: 5001,
        amount: '59.5',
        source: undefined,
      }),
    );
    expect(orderHistoryService.record).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({
        orderId: ORDER_ID,
        type: 'state_changed',
        fromState: 'pending_payment',
        toState: 'processing',
        source: undefined,
      }),
    );
  });

  it('con opts.source="webhook": ambos eventos llevan source webhook', async () => {
    const { service, orderHistoryService } = buildHarness();
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(pendingOrder());

    await service.confirmPayment(ORDER_ID, { source: 'webhook' });

    expect(orderHistoryService.record).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({ type: 'payment_registered', source: 'webhook' }),
    );
    expect(orderHistoryService.record).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({ type: 'state_changed', source: 'webhook' }),
    );
  });
});

describe('OrderFlowService.cancelPayment — payment_cancelled + state_changed', () => {
  const ORDER_ID = 9001;
  let prismaMock: PrismaMock;

  const directCashPayment = (overrides: Record<string, unknown> = {}) =>
    buildPayment({
      id: 5001,
      state: 'succeeded',
      amount: new Prisma.Decimal('59.50'),
      store_payment_method: {
        system_payment_method: { type: 'cash', processing_mode: 'DIRECT' },
      },
      ...overrides,
    });

  const buildHarness = () => {
    prismaMock = createPrismaMock({
      orders: ['update', 'findFirst'],
      payments: ['update'],
      invoices: ['findFirst'],
    });
    prismaMock.invoices.findFirst.mockResolvedValue(null);
    prismaMock.orders.update.mockResolvedValue({ id: ORDER_ID });
    prismaMock.orders.findFirst.mockResolvedValue({ id: ORDER_ID, payments: [] });

    const orderHistoryService = { record: jest.fn().mockResolvedValue(null) };
    const service = new OrderFlowService(
      prismaMock as unknown as StorePrismaService,
      { emit: jest.fn() } as any,
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
      { log: jest.fn().mockResolvedValue(undefined), logCustom: jest.fn().mockResolvedValue(undefined) } as any,
      undefined, undefined, undefined, undefined, undefined, undefined,
      orderHistoryService as any,
    );
    return { service, orderHistoryService };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockRequestContext({ store_id: 100, organization_id: 1, user_id: 7 });
  });

  it('fulfilled (delivered): registra payment_cancelled y NO un state_changed', async () => {
    const { service, orderHistoryService } = buildHarness();
    prismaMock.$queryRaw = jest
      .fn()
      .mockResolvedValueOnce([{ id: ORDER_ID, state: 'delivered' }])
      .mockResolvedValue([]);
    const order = buildOrder({
      id: ORDER_ID,
      state: 'delivered',
      grand_total: new Prisma.Decimal('59.50'),
      stores: { organization_id: 1 },
      payments: [directCashPayment()],
    });
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(order);

    await service.cancelPayment(ORDER_ID, { reason: 'QA' } as any, 'admin');

    expect(orderHistoryService.record).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({
        orderId: ORDER_ID,
        storeId: 100,
        organizationId: 1,
        type: 'payment_cancelled',
        paymentId: 5001,
        amount: '59.5',
      }),
    );
    expect(orderHistoryService.record).not.toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({ type: 'state_changed' }),
    );
  });

  it('no-fulfilled (pending_payment): registra payment_cancelled + state_changed →created', async () => {
    const { service, orderHistoryService } = buildHarness();
    prismaMock.$queryRaw = jest
      .fn()
      .mockResolvedValueOnce([{ id: ORDER_ID, state: 'pending_payment' }])
      .mockResolvedValue([]);
    const order = buildOrder({
      id: ORDER_ID,
      state: 'pending_payment',
      grand_total: new Prisma.Decimal('59.50'),
      stores: { organization_id: 1 },
      payments: [directCashPayment()],
    });
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(order);

    await service.cancelPayment(ORDER_ID, { reason: 'QA' } as any, 'admin');

    expect(orderHistoryService.record).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({
        type: 'payment_cancelled',
        paymentId: 5001,
      }),
    );
    expect(orderHistoryService.record).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({
        type: 'state_changed',
        fromState: 'pending_payment',
        toState: 'created',
      }),
    );
  });
});

describe('OrderFlowService.cancelOrder — state_changed →cancelled', () => {
  const ORDER_ID = 9001;

  const cancelableOrder = (overrides: Record<string, unknown> = {}) =>
    buildOrder({
      id: ORDER_ID,
      state: 'draft',
      order_number: 'POS-1',
      internal_notes: null,
      stores: { organization_id: 1 },
      payments: [],
      order_items: [],
      ...overrides,
    });

  it('cancela un draft: registra state_changed draft→cancelled', async () => {
    const prismaMock = createPrismaMock({
      orders: ['updateMany', 'update'],
      order_items: ['findMany'],
      payments: ['findMany', 'update'],
      table_sessions: ['findFirst'],
      invoices: ['findMany', 'findFirst'],
      accounts_receivable: ['findMany', 'update'],
      order_installments: ['updateMany'],
    });
    mockRequestContext({ store_id: 100, organization_id: 1, user_id: 7 });
    prismaMock.invoices.findMany.mockResolvedValue([]);
    prismaMock.accounts_receivable.findMany.mockResolvedValue([]);
    prismaMock.$queryRaw = jest.fn().mockResolvedValue([{ id: ORDER_ID, state: 'draft' }]);
    prismaMock.order_items.findMany.mockResolvedValue([]);
    prismaMock.orders.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.orders.update.mockResolvedValue({ id: ORDER_ID, store_id: 100, state: 'cancelled' });
    prismaMock.payments.update.mockResolvedValue({});
    prismaMock.payments.findMany.mockResolvedValue([]);
    prismaMock.table_sessions.findFirst.mockResolvedValue(null);

    const orderHistoryService = { record: jest.fn().mockResolvedValue(null) };
    const service = new OrderFlowService(
      prismaMock as unknown as StorePrismaService,
      { emit: jest.fn() } as any,
      { getSettings: jest.fn().mockResolvedValue({ pos: { cash_register: { enabled: true } } }) } as any,
      { getActiveSession: jest.fn().mockResolvedValue({ id: 1 }) } as any,
      { createManualMovement: jest.fn().mockResolvedValue({ id: 1 }) } as any,
      { releaseReservationsByReference: jest.fn().mockResolvedValue(undefined) } as any,
      {} as any, {} as any,
      { log: jest.fn().mockResolvedValue(undefined), logCustom: jest.fn().mockResolvedValue(undefined) } as any,
      undefined, undefined, undefined,
      { recordCancellationPendingRefunds: jest.fn().mockResolvedValue(undefined) } as any,
      undefined, undefined,
      orderHistoryService as any,
    );

    const draft = { ...cancelableOrder(), state: 'draft', order_items: [] };
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(draft);

    await expect(service.cancelOrder(ORDER_ID, { reason: 'El cliente desistió' } as any)).resolves.toMatchObject({
      state: 'cancelled',
    });

    expect(orderHistoryService.record).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({
        orderId: ORDER_ID,
        storeId: 100,
        organizationId: 1,
        type: 'state_changed',
        fromState: 'draft',
        toState: 'cancelled',
      }),
    );
  });
});

describe('OrderFlowService.deliverOrderItem — item_delivered', () => {
  const ORDER_ID = 2001;
  const ITEM_ID = 701;
  const STORE_ID = 4;
  const TICKET_ID = 55;

  it('estampa entrega y registra item_delivered con el actor', async () => {
    const eventEmitter = { emit: jest.fn() };
    const kitchenFireService = { emitTicketUpdatedEvent: jest.fn().mockResolvedValue(undefined) };
    const orderView = {
      id: ORDER_ID,
      store_id: STORE_ID,
      state: 'processing',
      delivery_type: 'direct_delivery',
      stores: { organization_id: 9 },
    };
    const prismaMock: any = {
      order_items: {
        findFirst: jest.fn().mockResolvedValue({
          id: ITEM_ID,
          order_id: ORDER_ID,
          product_name: 'Pollo asado',
          item_type: 'prepared',
          delivered_at: null,
          kitchen_ticket_items: [{ id: 900, status: 'ready' }],
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      kitchen_ticket_items: {
        findFirst: jest.fn().mockResolvedValue({ id: 900, status: 'ready', kitchen_ticket_id: TICKET_ID }),
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([{ status: 'delivered' }]),
      },
      kitchen_tickets: {
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([{ status: 'delivered' }]),
      },
    };
    const orderHistoryService = { record: jest.fn().mockResolvedValue(null) };
    const service = new OrderFlowService(
      prismaMock as unknown as StorePrismaService,
      eventEmitter as any,
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
      { logCustom: jest.fn().mockResolvedValue(undefined) } as any,
      kitchenFireService as any,
      undefined, undefined, undefined, undefined, undefined,
      orderHistoryService as any,
    );
    jest.spyOn(service as any, 'getOrder').mockResolvedValue(orderView);

    await service.deliverOrderItem(ORDER_ID, ITEM_ID);

    expect(orderHistoryService.record).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({
        orderId: ORDER_ID,
        storeId: STORE_ID,
        organizationId: 9,
        type: 'item_delivered',
        orderItemId: ITEM_ID,
        actorUserId: null,
      }),
    );
  });
});

describe('OrderFlowService.cancelOrderItem — item_cancelled', () => {
  const ORDER_ID = 1017;
  const ITEM_ID = 501;

  const unfiredItem = () => ({
    id: ITEM_ID,
    product_name: 'Bandeja paisa',
    inventory_consumed_at_fire: false,
    cancelled_at: null,
    kitchen_ticket_items: [],
  });

  it('cancela un ítem no disparado y registra item_cancelled con motivo + tipo', async () => {
    const txMock: any = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: ORDER_ID, state: 'created' }]),
      kitchen_tickets: { findFirst: jest.fn().mockResolvedValue(null) },
      inventory_transactions: { findMany: jest.fn().mockResolvedValue([]) },
      payments: { findFirst: jest.fn().mockResolvedValue(null) },
      order_items: {
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([{ total_price: 50000, order_item_taxes: [] }]),
      },
      orders: {
        findFirst: jest.fn().mockResolvedValue({ active_financial_split_id: null }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const prismaMock: any = {
      order_items: { findFirst: jest.fn().mockResolvedValue(unfiredItem()) },
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
    const orderHistoryService = { record: jest.fn().mockResolvedValue(null) };

    const service = new OrderFlowService(
      prismaMock as unknown as StorePrismaService,
      {} as any, {} as any, {} as any, {} as any,
      stockLevelManager as any,
      {} as any, {} as any,
      { logCustom: jest.fn().mockResolvedValue(undefined) } as any,
      kitchenFireService as any,
      undefined, undefined, undefined, undefined, undefined,
      orderHistoryService as any,
    );
    jest.spyOn(service as any, 'getOrder').mockResolvedValue({
      id: ORDER_ID,
      store_id: 4,
      state: 'created',
      stores: { organization_id: 9 },
    });

    await service.cancelOrderItem(ORDER_ID, ITEM_ID, 'cliente se arrepintió');

    expect(orderHistoryService.record).toHaveBeenCalledWith(
      txMock,
      expect.objectContaining({
        orderId: ORDER_ID,
        storeId: 4,
        organizationId: 9,
        type: 'item_cancelled',
        orderItemId: ITEM_ID,
        payload: expect.objectContaining({
          reason: 'cliente se arrepintió',
          cancellation_type: 'before_fire',
        }),
      }),
    );
  });
});

describe('OrderFlowService.cancelDeliveredOrderItem — item_delivery_reverted', () => {
  const ORDER_ID = 4017;
  const ITEM_ID = 801;

  it('reversa una entrega y registra item_delivery_reverted con destino', async () => {
    const txMock: any = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: ORDER_ID, state: 'created' }]),
      payments: { findFirst: jest.fn().mockResolvedValue(null) },
      order_items: {
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([{ total_price: 30000, order_item_taxes: [] }]),
      },
      orders: {
        findFirst: jest.fn().mockResolvedValue({ active_financial_split_id: null }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const prismaMock: any = {
      order_items: {
        findFirst: jest.fn().mockResolvedValue({
          id: ITEM_ID,
          product_id: 11,
          product_variant_id: null,
          product_name: 'Pollo asado',
          quantity: 2,
          delivered_at: new Date('2026-09-10T12:00:00.000Z'),
          cancelled_at: null,
        }),
      },
      $transaction: jest.fn((cb: any) => cb(txMock)),
    };
    const stockLevelManager = {
      getDefaultLocationForProduct: jest.fn().mockResolvedValue(1),
      updateStock: jest.fn().mockResolvedValue({}),
    };
    const auditService = { logCustom: jest.fn().mockResolvedValue(undefined) };
    const orderHistoryService = { record: jest.fn().mockResolvedValue(null) };

    const service = new OrderFlowService(
      prismaMock as unknown as StorePrismaService,
      {} as any, {} as any, {} as any, {} as any,
      stockLevelManager as any,
      {} as any, {} as any,
      auditService as any,
      undefined, undefined, undefined, undefined, undefined, undefined,
      orderHistoryService as any,
    );
    jest.spyOn(service as any, 'getOrder').mockResolvedValue({
      id: ORDER_ID,
      state: 'created',
      store_id: 4,
      active_financial_split_id: null,
      payments: [],
      stores: { organization_id: 9 },
    });

    await service.cancelDeliveredOrderItem(ORDER_ID, ITEM_ID, 'mosca en el plato', 'waste');

    expect(orderHistoryService.record).toHaveBeenCalledWith(
      txMock,
      expect.objectContaining({
        orderId: ORDER_ID,
        storeId: 4,
        organizationId: 9,
        type: 'item_delivery_reverted',
        orderItemId: ITEM_ID,
        actorUserId: null,
        payload: expect.objectContaining({ reason: 'mosca en el plato', destination: 'waste' }),
      }),
    );
  });
});

describe('OrderFlowService.reconcileOrderFromDispatch — source listener', () => {
  const ORDER_ID = 55;
  const STORE_ID = 10;

  it('parcial (anyFulfilled, !allFulfilled) → shipped: registra state_changed con source listener', async () => {
    const prismaMock: any = {
      orders: {
        findFirst: jest.fn().mockResolvedValue({
          id: ORDER_ID,
          state: 'processing',
          delivery_type: 'home_delivery',
          remaining_balance: 5000,
        }),
        findUnique: jest.fn().mockImplementation(async (args: any) => {
          if (args?.select?.internal_notes !== undefined) return { internal_notes: null };
          return {
            state: 'processing',
            store_id: STORE_ID,
            order_number: 'DSP-1',
            stores: { organization_id: 1 },
          };
        }),
        update: jest.fn().mockResolvedValue({
          id: ORDER_ID,
          store_id: STORE_ID,
          stores: { id: STORE_ID, name: 'Test Store', store_code: 'T1' },
          order_items: [],
          payments: [],
        }),
      },
      dispatch_notes: {
        findMany: jest.fn().mockResolvedValue([
          { id: 1, status: 'delivered' },
          { id: 2, status: 'confirmed' },
        ]),
      },
      dispatch_route_stops: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const orderHistoryService = { record: jest.fn().mockResolvedValue(null) };
    const service = new OrderFlowService(
      prismaMock as unknown as StorePrismaService,
      { emit: jest.fn() } as any,
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
      { logCustom: jest.fn().mockResolvedValue(undefined) } as any,
      undefined, undefined, undefined, undefined, undefined, undefined,
      orderHistoryService as any,
    );

    await service.reconcileOrderFromDispatch(ORDER_ID, STORE_ID);

    expect(orderHistoryService.record).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({
        orderId: ORDER_ID,
        storeId: STORE_ID,
        type: 'state_changed',
        fromState: 'processing',
        toState: 'shipped',
        source: 'listener',
      }),
    );
  });
});

describe('OrderFlowService.autoFinishDeliveredOrders — source job', () => {
  it('finaliza una orden delivered vencida y registra state_changed con source job', async () => {
    const ORDER_ID = 9001;
    const prismaMock = createPrismaMock({ orders: ['findMany', 'findUnique', 'update'] });
    prismaMock.orders.findMany
      .mockResolvedValueOnce([{ id: ORDER_ID }]) // pass 1 (ecommerce)
      .mockResolvedValueOnce([]); // pass 2 (restaurant)
    prismaMock.orders.findUnique.mockImplementation(async (args: any) => {
      if (args?.select?.internal_notes !== undefined) return { internal_notes: null };
      return {
        state: 'delivered',
        store_id: 100,
        order_number: 'ORD-9',
        stores: { organization_id: 1 },
      };
    });
    prismaMock.orders.update.mockResolvedValue({
      id: ORDER_ID,
      store_id: 100,
      stores: { id: 100, name: 'Test Store', store_code: 'T1', organization_id: 1 },
      order_items: [],
      payments: [],
    });
    const orderStockCommit = { commitOrderDelivery: jest.fn().mockResolvedValue({ totalCost: 0 }) };
    const orderHistoryService = { record: jest.fn().mockResolvedValue(null) };
    const service = new OrderFlowService(
      prismaMock as unknown as StorePrismaService,
      { emit: jest.fn() } as any,
      {} as any, {} as any, {} as any, {} as any, {} as any,
      orderStockCommit as any,
      { logCustom: jest.fn().mockResolvedValue(undefined) } as any,
      undefined, undefined, undefined, undefined, undefined, undefined,
      orderHistoryService as any,
    );
    jest.spyOn(service as any, 'hasPendingKitchenItems').mockResolvedValue(false);

    const finished = await service.autoFinishDeliveredOrders();

    expect(finished).toBe(1);
    expect(orderHistoryService.record).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({
        orderId: ORDER_ID,
        type: 'state_changed',
        toState: 'finished',
        source: 'job',
      }),
    );
  });
});
