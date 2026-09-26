import { OrderFlowService } from './order-flow.service';
import { PaymentType } from './dto';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { mockRequestContext } from 'src/testing/prisma-mock';
import { POS_SALE_COMPLETED_EVENT } from '../../invoicing/pos/pos-sale-completed.event';

/**
 * Facturación electrónica de las órdenes POS cobradas desde el DETALLE de la
 * orden (`POST /store/orders/:id/flow/pay` → `payOrder`) y confirmadas por
 * `confirmPayment`.
 *
 * Bug de producción: el único emisor de `POS_SALE_COMPLETED_EVENT` era
 * `payments.service.ts` (cobro de mostrador), así que 0/234 órdenes de mesa
 * cobradas desde el detalle salían con factura. Estos specs fijan que el MISMO
 * evento, con el MISMO payload, sale del flujo de orden cuando —y sólo
 * cuando— la orden POS queda pagada completa, sin split financiero activo y
 * sin un documento ya transmitido.
 *
 * `auto_emit` viaja en el payload (lo resuelve el emisor, como hace
 * payments.service) y lo aplica `PosSaleCompletedListener` — ver
 * `pos-sale-completed.listener.spec.ts`.
 */
describe('OrderFlowService — emisión de factura POS al completar el pago', () => {
  const ORDER_ID = 1;
  const STORE_ID = 4;
  const ORG_ID = 77;
  const USER_ID = 9;

  let service: OrderFlowService;
  let prismaMock: any;
  let eventEmitter: { emit: jest.Mock };
  let settingsService: { getSettings: jest.Mock };

  // Fila que lee el helper de emisión (select con `channel`).
  let emissionRow: any;
  // Última factura de venta del pedido (null = sin factura).
  let latestInvoice: any;

  const baseOrder = (overrides: Record<string, unknown> = {}) => ({
    id: ORDER_ID,
    state: 'created',
    delivery_type: 'direct_delivery',
    grand_total: 4000,
    currency: 'COP',
    store_id: STORE_ID,
    customer_id: 12,
    channel: 'pos',
    payments: [],
    ...overrides,
  });

  const DIRECT_DTO: any = {
    store_payment_method_id: 1,
    payment_type: PaymentType.DIRECT,
  };

  beforeEach(() => {
    mockRequestContext({
      store_id: STORE_ID,
      organization_id: ORG_ID,
      user_id: USER_ID,
    });

    emissionRow = {
      id: ORDER_ID,
      store_id: STORE_ID,
      order_number: 'ORD-0001',
      channel: 'pos',
      delivery_type: 'direct_delivery',
      grand_total: 4000,
      active_financial_split_id: null,
      payments: [{ state: 'succeeded', amount: 4000 }],
    };
    latestInvoice = null;

    prismaMock = {
      store_payment_methods: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 1, system_payment_method: { type: 'card' } }),
      },
      payments: {
        create: jest
          .fn()
          .mockResolvedValue({ id: 999, gateway_response: { payment_type: 'direct' } }),
        update: jest.fn().mockResolvedValue({}),
      },
      orders: {
        // Despacha por la forma del `select`: pre-claim (`state` +
        // `payment_form`), helper de emisión (`channel`) y el resto (probe de
        // envío, cupón) → null.
        findFirst: jest.fn().mockImplementation((args: any) => {
          const select = args?.select ?? {};
          if (select.channel) return Promise.resolve(emissionRow);
          const keys = Object.keys(select).sort().join(',');
          if (keys === 'payment_form,state' || keys === 'state') {
            return Promise.resolve({ state: 'created', payment_form: '1' });
          }
          return Promise.resolve(null);
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      invoices: {
        findFirst: jest.fn().mockImplementation(() => Promise.resolve(latestInvoice)),
      },
      stores: {
        findFirst: jest.fn().mockResolvedValue({ organization_id: ORG_ID }),
      },
      store_settings: { findFirst: jest.fn().mockResolvedValue(null) },
      coupon_uses: { findFirst: jest.fn().mockResolvedValue(null) },
      coupons: { findFirst: jest.fn().mockResolvedValue(null) },
    };

    eventEmitter = { emit: jest.fn() };
    settingsService = {
      getSettings: jest
        .fn()
        .mockResolvedValue({ invoicing: { pos: { auto_emit: true } } }),
    };

    service = new OrderFlowService(
      prismaMock as unknown as StorePrismaService,
      eventEmitter as any,
      settingsService as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { logCustom: jest.fn().mockResolvedValue(undefined) } as any,
    );

    jest.spyOn(service as any, 'getOrder').mockResolvedValue(baseOrder());
    jest.spyOn(service as any, 'generateTransactionId').mockResolvedValue('TXN-1');
    jest.spyOn(service as any, 'hasPendingKitchenItems').mockResolvedValue(false);
    jest.spyOn(service as any, 'validateTransition').mockReturnValue(undefined);
    jest.spyOn(service as any, 'recordPayOrderCashMovement').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'computeAndPersistEta').mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'updateOrderState')
      .mockResolvedValue({ id: ORDER_ID, state: 'finished' });
  });

  afterEach(() => jest.restoreAllMocks());

  const posEmits = () =>
    eventEmitter.emit.mock.calls.filter(([name]) => name === POS_SALE_COMPLETED_EVENT);

  it('pago directo completo (finished) de orden POS emite el evento UNA vez con el payload del mostrador', async () => {
    await service.payOrder(ORDER_ID, DIRECT_DTO);

    expect(posEmits()).toHaveLength(1);
    expect(posEmits()[0][1]).toEqual({
      organization_id: ORG_ID,
      store_id: STORE_ID,
      user_id: USER_ID,
      order_id: ORDER_ID,
      order_number: 'ORD-0001',
      auto_emit: true,
    });
  });

  it('pago directo que deja la orden en processing (requiere despacho) también emite', async () => {
    (service as any).getOrder.mockResolvedValue(
      baseOrder({ delivery_type: 'pickup' }),
    );
    (service as any).updateOrderState.mockResolvedValue({
      id: ORDER_ID,
      state: 'processing',
    });

    await service.payOrder(ORDER_ID, DIRECT_DTO);

    expect(posEmits()).toHaveLength(1);
  });

  it('pago parcial (Σ pagos < grand_total) NO emite', async () => {
    emissionRow.payments = [{ state: 'succeeded', amount: 1500 }];

    await service.payOrder(ORDER_ID, DIRECT_DTO);

    expect(posEmits()).toHaveLength(0);
  });

  it('pagos no liquidados (pending/cancelled) no cuentan para el saldo', async () => {
    emissionRow.payments = [
      { state: 'pending', amount: 4000 },
      { state: 'cancelled', amount: 4000 },
    ];

    await service.payOrder(ORDER_ID, DIRECT_DTO);

    expect(posEmits()).toHaveLength(0);
  });

  it.each(['home_delivery', 'pickup', 'other'])(
    'orden ecommerce %s NO emite por este camino (se factura por el carril web)',
    async (deliveryType) => {
      emissionRow.channel = 'ecommerce';
      emissionRow.delivery_type = deliveryType;

      await service.payOrder(ORDER_ID, DIRECT_DTO);

      expect(posEmits()).toHaveLength(0);
    },
  );

  it('mesa abierta por QR (ecommerce + dine_in) pagada completa desde el detalle emite como venta POS', async () => {
    emissionRow.channel = 'ecommerce';
    emissionRow.delivery_type = 'dine_in';
    emissionRow.order_number = 'ORD-QR-7';

    await service.payOrder(ORDER_ID, DIRECT_DTO);

    expect(posEmits()).toHaveLength(1);
    expect(posEmits()[0][1]).toEqual({
      organization_id: ORG_ID,
      store_id: STORE_ID,
      user_id: USER_ID,
      order_id: ORDER_ID,
      order_number: 'ORD-QR-7',
      auto_emit: true,
    });
  });

  it('mesa por QR con pago parcial NO emite', async () => {
    emissionRow.channel = 'ecommerce';
    emissionRow.delivery_type = 'dine_in';
    emissionRow.payments = [{ state: 'succeeded', amount: 3999 }];

    await service.payOrder(ORDER_ID, DIRECT_DTO);

    expect(posEmits()).toHaveLength(0);
  });

  it.each(['accepted', 'sent', 'voided', 'cancelled'])(
    'orden con factura de venta %s NO re-emite',
    async (status) => {
      latestInvoice = { id: 50, status };

      await service.payOrder(ORDER_ID, DIRECT_DTO);

      expect(posEmits()).toHaveLength(0);
    },
  );

  it.each(['draft', 'validated', 'rejected'])(
    'orden con factura %s sí emite (el listener reusa ese documento, no crea otro)',
    async (status) => {
      latestInvoice = { id: 50, status };

      await service.payOrder(ORDER_ID, DIRECT_DTO);

      expect(posEmits()).toHaveLength(1);
    },
  );

  it('split financiero activo NO emite (las cuentas se facturan por su camino)', async () => {
    emissionRow.active_financial_split_id = 33;

    await service.payOrder(ORDER_ID, DIRECT_DTO);

    expect(posEmits()).toHaveLength(0);
  });

  it('auto_emit=false viaja en el payload (el listener lo aplica)', async () => {
    settingsService.getSettings.mockResolvedValue({
      invoicing: { pos: { auto_emit: false } },
    });

    await service.payOrder(ORDER_ID, DIRECT_DTO);

    expect(posEmits()).toHaveLength(1);
    expect(posEmits()[0][1]).toEqual(expect.objectContaining({ auto_emit: false }));
  });

  it('auto_emit ausente ⇒ default del mostrador (true)', async () => {
    settingsService.getSettings.mockResolvedValue({});

    await service.payOrder(ORDER_ID, DIRECT_DTO);

    expect(posEmits()[0][1]).toEqual(expect.objectContaining({ auto_emit: true }));
  });

  it('un fallo al preparar la emisión nunca rompe el pago', async () => {
    prismaMock.invoices.findFirst.mockRejectedValue(new Error('db down'));

    await expect(service.payOrder(ORDER_ID, DIRECT_DTO)).resolves.toEqual(
      expect.objectContaining({ order: { id: ORDER_ID, state: 'finished' } }),
    );
    expect(posEmits()).toHaveLength(0);
  });

  it('pago online (pending_payment) NO emite: la orden aún no está pagada', async () => {
    (service as any).updateOrderState.mockResolvedValue({
      id: ORDER_ID,
      state: 'pending_payment',
    });

    await service.payOrder(ORDER_ID, {
      store_payment_method_id: 1,
      payment_type: PaymentType.ONLINE,
    } as any);

    expect(posEmits()).toHaveLength(0);
  });

  it('guarda de cocina (modo estricto, fast-track): cancela el pago, RESTAURA el estado previo al claim y rechaza con el errorCode de superficie', async () => {
    (service as any).hasPendingKitchenItems.mockResolvedValue(true);

    const error = await service
      .payOrder(ORDER_ID, DIRECT_DTO, { strictKitchenPending: true })
      .catch((e) => e);

    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.errorCode).toBe(ErrorCodes.ORD_FLOW_PAYMENT_FAILED_001.code);
    expect((error.getResponse() as any).details).toEqual(
      expect.objectContaining({
        stage: 'kitchen_pending',
        cause_code: ErrorCodes.ORDER_HAS_PENDING_KITCHEN_ITEMS.code,
      }),
    );

    expect(prismaMock.payments.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 999 },
        data: expect.objectContaining({ state: 'cancelled' }),
      }),
    );
    // claim (created → processing) + restauración (→ created)
    expect(prismaMock.orders.updateMany).toHaveBeenLastCalledWith({
      where: { id: ORDER_ID, state: 'processing' },
      data: expect.objectContaining({ state: 'created' }),
    });
    expect(posEmits()).toHaveLength(0);
  });

  describe('confirmPayment', () => {
    let txMock: any;
    let projectTablePayment: jest.Mock;

    beforeEach(() => {
      txMock = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: ORDER_ID, state: 'pending_payment' }]),
        payments: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        orders: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          findFirst: jest.fn().mockResolvedValue(null),
        },
      };
      prismaMock.$transaction = jest.fn((fn: any) => fn(txMock));
      projectTablePayment = jest.fn().mockResolvedValue(null);
      (service as any).moduleRef = {
        get: jest.fn().mockReturnValue({
          projectOrderPaymentToTableSession: projectTablePayment,
        }),
      };
      (service as any).getOrder.mockResolvedValue(
        baseOrder({
          state: 'pending_payment',
          payments: [{ id: 5, state: 'pending', amount: 4000 }],
        }),
      );
    });

    it('confirmación del pago online de orden POS emite una vez, después del commit', async () => {
      let committed = false;
      prismaMock.$transaction.mockImplementation(async (fn: any) => {
        const out = await fn(txMock);
        committed = true;
        return out;
      });
      // El helper de emisión envuelve `emit` en try/catch: un `expect` dentro
      // del mock se lo tragaría. Se captura el estado y se afirma afuera.
      const committedAtEmit: boolean[] = [];
      eventEmitter.emit.mockImplementation((name: string) => {
        if (name === POS_SALE_COMPLETED_EVENT) committedAtEmit.push(committed);
      });

      await service.confirmPayment(ORDER_ID);

      expect(committedAtEmit).toEqual([true]);
      expect(posEmits()).toHaveLength(1);
      expect(posEmits()[0][1]).toEqual(
        expect.objectContaining({ order_id: ORDER_ID, store_id: STORE_ID }),
      );
    });

    it('confirmación no aplicada (orden ya no estaba pendiente) NO emite', async () => {
      (service as any).getOrder.mockResolvedValue(baseOrder({ state: 'processing' }));

      await service.confirmPayment(ORDER_ID);

      expect(posEmits()).toHaveLength(0);
    });

    it('confirmación del pago online de una mesa QR (ecommerce + dine_in) emite una vez', async () => {
      emissionRow.channel = 'ecommerce';
      emissionRow.delivery_type = 'dine_in';

      await service.confirmPayment(ORDER_ID);

      expect(posEmits()).toHaveLength(1);
      expect(posEmits()[0][1]).toEqual(
        expect.objectContaining({ order_id: ORDER_ID, auto_emit: true }),
      );
    });

    it('confirmación de orden ecommerce de domicilio NO emite por este camino', async () => {
      emissionRow.channel = 'ecommerce';
      emissionRow.delivery_type = 'home_delivery';

      await service.confirmPayment(ORDER_ID);

      expect(posEmits()).toHaveLength(0);
    });

    it('proyecta la mesa tras confirmar el pago completo, sin cerrar la sesión', async () => {
      const pending = baseOrder({
        state: 'pending_payment',
        payments: [{ id: 5, state: 'pending', amount: 4000 }],
      });
      const settled = baseOrder({
        state: 'processing',
        payments: [{ id: 5, state: 'succeeded', amount: 4000 }],
      });
      (service as any).getOrder.mockResolvedValueOnce(pending)
        .mockResolvedValueOnce(pending).mockResolvedValueOnce(settled);

      await service.confirmPayment(ORDER_ID);

      expect(projectTablePayment).toHaveBeenCalledTimes(1);
      expect(projectTablePayment).toHaveBeenCalledWith(ORDER_ID, 5);
    });

    it('no marca la mesa pagada por una confirmación parcial', async () => {
      const partial = baseOrder({
        state: 'processing',
        payments: [{ id: 5, state: 'succeeded', amount: 1000 }],
      });
      (service as any).getOrder.mockResolvedValue(partial);
      prismaMock.table_sessions = { findFirst: jest.fn().mockResolvedValue({ id: 17 }) };

      await service.confirmPayment(ORDER_ID);

      expect(projectTablePayment).not.toHaveBeenCalled();
    });

    it('replay de orden procesando repara la mesa abierta sin segundo cobro', async () => {
      const settled = baseOrder({
        state: 'processing',
        payments: [{ id: 5, state: 'succeeded', amount: 4000 }],
      });
      (service as any).getOrder.mockResolvedValue(settled);
      prismaMock.table_sessions = { findFirst: jest.fn().mockResolvedValue({ id: 17 }) };

      const result = await service.confirmPayment(ORDER_ID);

      expect(result.payment_confirmation_applied).toBe(false);
      expect(txMock.payments.updateMany).not.toHaveBeenCalled();
      expect(projectTablePayment).toHaveBeenCalledWith(ORDER_ID, 5);
      expect(posEmits()).toHaveLength(0);
    });

    it('replay tras cierre legítimo de mesa no intenta reproyectar una sesión cerrada', async () => {
      const settled = baseOrder({
        state: 'processing',
        payments: [{ id: 5, state: 'succeeded', amount: 4000 }],
      });
      (service as any).getOrder.mockResolvedValue(settled);
      prismaMock.table_sessions = { findFirst: jest.fn().mockResolvedValue(null) };

      await service.confirmPayment(ORDER_ID);

      expect(projectTablePayment).not.toHaveBeenCalled();
    });

    it('si falla la proyección post-commit conserva el cobro y emite el estado antes de ERR-33', async () => {
      const pending = baseOrder({
        state: 'pending_payment',
        payments: [{ id: 5, state: 'pending', amount: 4000 }],
      });
      const settled = baseOrder({
        state: 'processing',
        payments: [{ id: 5, state: 'succeeded', amount: 4000 }],
      });
      (service as any).getOrder.mockResolvedValueOnce(pending)
        .mockResolvedValueOnce(pending).mockResolvedValueOnce(settled);
      projectTablePayment.mockRejectedValue(new Error('projection unavailable'));

      await expect(service.confirmPayment(ORDER_ID)).rejects.toMatchObject({
        errorCode: 'POS_TABLE_SESSION_PROJECTION_FAILED_001',
      });

      expect(txMock.payments.updateMany).toHaveBeenCalledTimes(1);
      expect(posEmits()).toHaveLength(1);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'order.status_changed',
        expect.objectContaining({ order_id: ORDER_ID, new_state: 'processing' }),
      );
    });
  });
});
