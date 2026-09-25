import { EcommerceInvoiceDataController } from './ecommerce-invoice-data.controller';

describe('EcommerceInvoiceDataController (paso 4: comprobante guest)', () => {
  const TOKEN = 'tok-guest-1';
  const PAYMENT_ID = 895;

  const createController = (overrides: any = {}) => {
    const invoiceDataService = {
      getOrderSummaryByToken: jest.fn(),
      getByToken: jest.fn(),
      submitData: jest.fn(),
      getGuestPaymentReceiptUrl: jest.fn(),
      uploadGuestPaymentReceipt: jest.fn(),
      ...overrides.invoiceDataService,
    };
    // ResponseService real: success(data, message?) envuelve; el stub
    // replica el envelope para que el spec fije el contrato observado.
    const responseService = {
      success: jest.fn((data: any, message?: string) => ({
        success: true,
        ...(message ? { message } : {}),
        data,
      })),
    };
    // Paso 6: el controller inyecta `NotificationsSseService` para el
    // stream guest; los endpoints REST no lo usan.
    const sseService = {
      getOrCreate: jest.fn(),
      push: jest.fn(),
      unsubscribe: jest.fn(),
    };
    return {
      controller: new EcommerceInvoiceDataController(
        invoiceDataService as any,
        responseService as any,
        sseService as any,
      ),
      invoiceDataService,
      responseService,
      sseService,
    };
  };

  it('GET receipt-url delega (token, paymentId) y envuelve en success', async () => {
    const payload = {
      url: 'https://s3/signed',
      expires_at: '2026-09-25T05:16:32.000Z',
      content_type: 'image/png',
    };
    const { controller, invoiceDataService } = createController({
      invoiceDataService: {
        getGuestPaymentReceiptUrl: jest.fn().mockResolvedValue(payload),
      },
    });

    const res = await controller.getGuestPaymentReceiptUrl(TOKEN, PAYMENT_ID);

    expect(invoiceDataService.getGuestPaymentReceiptUrl).toHaveBeenCalledWith(
      TOKEN,
      PAYMENT_ID,
    );
    expect(res).toEqual({ success: true, data: payload });
  });

  it('POST receipt delega (token, paymentId, file) con mensaje ES', async () => {
    const payload = {
      payment_id: PAYMENT_ID,
      has_receipt: true,
      receipt_content_type: 'image/png',
      receipt_uploaded_at: new Date('2026-09-25T05:11:32.000Z'),
    };
    const file = {
      originalname: 'soporte.png',
      mimetype: 'image/png',
      size: 1234,
      buffer: Buffer.from('fake'),
    } as any;
    const { controller, invoiceDataService } = createController({
      invoiceDataService: {
        uploadGuestPaymentReceipt: jest.fn().mockResolvedValue(payload),
      },
    });

    const res = await controller.uploadGuestPaymentReceipt(
      TOKEN,
      PAYMENT_ID,
      file,
    );

    expect(invoiceDataService.uploadGuestPaymentReceipt).toHaveBeenCalledWith(
      TOKEN,
      PAYMENT_ID,
      file,
    );
    expect(res.success).toBe(true);
    expect(res.data).toEqual(payload);
    expect(res.message).toContain('Comprobante recibido');
  });

  it('propaga el 404 ciego del binding sin envolverlo', async () => {
    const blind404 = Object.assign(new Error('Payment not found'), {
      status: 404,
    });
    const { controller } = createController({
      invoiceDataService: {
        getGuestPaymentReceiptUrl: jest.fn().mockRejectedValue(blind404),
      },
    });

    await expect(
      controller.getGuestPaymentReceiptUrl(TOKEN, 999999),
    ).rejects.toBe(blind404);
  });
});

describe('EcommerceInvoiceDataController (paso 6: stream SSE guest)', () => {
  const BINDING = { order_id: 42, store_id: 10 };
  const controller: any = new EcommerceInvoiceDataController(
    {} as any,
    {} as any,
    {} as any,
  );

  it('matchesGuest acepta ticket.* de SU orden y niega el resto', () => {
    expect(
      controller.matchesGuest(
        { type: 'ticket.ready', ticket: { order_id: 42 } },
        BINDING,
      ),
    ).toBe(true);
    // Otra orden de la misma tienda: default-deny.
    expect(
      controller.matchesGuest(
        { type: 'ticket.ready', ticket: { order_id: 43 } },
        BINDING,
      ),
    ).toBe(false);
    // Tipos KDS fuera del mapa (cancelled/updated/reverted): deny.
    expect(
      controller.matchesGuest(
        { type: 'ticket.cancelled', ticket: { order_id: 42 } },
        BINDING,
      ),
    ).toBe(false);
    // Ruido del subject (bell, ping, basura): deny.
    expect(
      controller.matchesGuest({ type: 'order.created', data: {} }, BINDING),
    ).toBe(false);
    expect(controller.matchesGuest({ type: 'ping' }, BINDING)).toBe(false);
    expect(controller.matchesGuest({}, BINDING)).toBe(false);
  });

  it('matchesGuest acepta order.* allowlist de SU orden', () => {
    expect(
      controller.matchesGuest(
        { type: 'order.status_changed', data: { order_id: 42 } },
        BINDING,
      ),
    ).toBe(true);
    expect(
      controller.matchesGuest(
        { type: 'order.shipping_assigned', data: { order_id: 42 } },
        BINDING,
      ),
    ).toBe(true);
    expect(
      controller.matchesGuest(
        { type: 'order.status_changed', data: { order_id: 43 } },
        BINDING,
      ),
    ).toBe(false);
  });

  it('projectForGuest renombra KDS y elimina costos/PII/staff', () => {
    const projected = controller.projectForGuest({
      type: 'ticket.ready',
      ticket: {
        id: 7,
        status: 'ready',
        daily_number: 12,
        fired_at: '2026-09-25T10:00:00.000Z',
        ready_at: '2026-09-25T10:05:00.000Z',
        order_id: 42,
        store_id: 10,
        total_cost: 15000,
        cogs_snapshot: { arroz: 3 },
        notes_internal: 'cliente conflictivo',
        items: [
          {
            quantity: 2,
            status: 'ready',
            unit_cost: 5000,
            recipe: { id: 1 },
            sku: 'PLT-001',
            product: { id: 9, name: 'Bandeja', cost_price: 4000 },
          },
        ],
      },
      ts: 123,
    });
    expect(projected.type).toBe('kitchen.ready');
    expect(projected.ticket).toEqual({
      id: 7,
      status: 'ready',
      daily_number: 12,
      fired_at: '2026-09-25T10:00:00.000Z',
      ready_at: '2026-09-25T10:05:00.000Z',
      items: [{ product_name: 'Bandeja', quantity: 2, status: 'ready' }],
    });
    const blob = JSON.stringify(projected);
    expect(blob).not.toMatch(/cost|settings|email|device_id|recipe|sku|notes_internal/);
  });

  it('projectForGuest blanquea order.* y descarta shipping_method_id', () => {
    const changed = controller.projectForGuest({
      type: 'order.status_changed',
      data: {
        order_id: 42,
        kind: 'order.status_changed',
        order_number: 'RK-100',
        old_state: 'processing',
        new_state: 'shipped',
        extra: { courier_phone: '3001112233' },
      },
    });
    expect(changed).toEqual({
      type: 'order.status_changed',
      order_id: 42,
      order_number: 'RK-100',
      old_state: 'processing',
      new_state: 'shipped',
      ts: expect.any(Number),
    });

    const assigned = controller.projectForGuest({
      type: 'order.shipping_assigned',
      data: { order_id: 42, shipping_method_id: 5, delivery_type: 'delivery' },
    });
    expect(assigned).toEqual({
      type: 'order.shipping_assigned',
      order_id: 42,
      delivery_type: 'delivery',
      ts: expect.any(Number),
    });
  });

  it('projectGuestSnapshot expone solo el subconjunto vivo (sin customer/totales)', () => {
    const projected = controller.projectGuestSnapshot({
      token: 'tok',
      customer: { first_name: 'Ana', email: 'ana@x.co' },
      store: { id: 10, name: 'Roku' },
      order: {
        id: 42,
        order_number: 'RK-100',
        state: 'processing',
        channel: 'ecommerce',
        subtotal_amount: 100,
        grand_total: 120,
        shipping_cost: 5000,
        currency: 'COP',
        created_at: '2026-09-25T10:00:00.000Z',
        placed_at: null,
        estimated_ready_at: '2026-09-25T10:30:00.000Z',
        estimated_delivered_at: null,
        prep_minutes_max: 25,
        delivery_type: 'delivery',
        shipping_address: { city: 'Bogotá' },
        items: [
          {
            product_name: 'Bandeja',
            quantity: 2,
            unit_price: 50,
            total_price: 100,
            kitchen_status: 'in_preparation',
            preparation_time_minutes: 25,
          },
        ],
        applied_promotions: [],
        applied_coupons: [],
        payments: [
          {
            payment_id: 1,
            state: 'pending',
            amount: 120,
            paid_at: null,
            method: 'Transferencia',
            has_receipt: true,
            receipt_content_type: 'image/png',
          },
        ],
        invoice: null,
      },
    } as any);
    expect(projected).toEqual({
      id: 42,
      order_number: 'RK-100',
      state: 'processing',
      delivery_type: 'delivery',
      estimated_ready_at: '2026-09-25T10:30:00.000Z',
      estimated_delivered_at: null,
      prep_minutes_max: 25,
      items: [
        {
          product_name: 'Bandeja',
          quantity: 2,
          kitchen_status: 'in_preparation',
          preparation_time_minutes: 25,
        },
      ],
      payments: [{ payment_id: 1, state: 'pending', has_receipt: true }],
    });
    const blob = JSON.stringify(projected);
    expect(blob).not.toMatch(/cost|settings|email|device_id/);
  });
});
