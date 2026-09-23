import { PosFiscalEmissionService } from './pos-fiscal-emission.service';
import { mockRequestContext } from 'src/testing/prisma-mock';

// Reproduce el defecto reportado: un fallo PERMANENTE de `send()` (no un
// error transitorio que la cola reintenta solo) llegaba al POS como
// `state: 'pending'` en vez de `failed`, porque `deriveState` sólo miraba
// `invoice.status` / `has_live_retry` / `blocked_error` y ninguno de los tres
// se mueve cuando `send()` lanza sin cambiar la fila. El cajero veía «Enviando
// a la DIAN…» sobre un documento que no iba a salir nunca, y `registerFailure`
// —que sólo actúa sobre `state === 'failed'`— nunca dejaba constancia.
describe('PosFiscalEmissionService', () => {
  const createService = (overrides: any = {}) => {
    const validatedInvoice = {
      id: 5,
      invoice_number: 'FE-5',
      status: 'validated',
      transmission_status: null,
      cufe: null,
      pdf_url: null,
      contingency_deadline: null,
    };

    const prisma = {
      orders: {
        findFirst: jest.fn().mockResolvedValue({ id: 1 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      invoices: {
        findFirst: jest.fn().mockResolvedValue(validatedInvoice),
      },
      invoice_data_requests: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      fiscal_operation_events: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 900 }),
      },
      ...overrides.prisma,
    };

    const invoicing = {
      getElectronicEmissionEligibility: jest
        .fn()
        .mockResolvedValue({ eligible: true, reason: null }),
      getPosInvoicingSettings: jest
        .fn()
        .mockResolvedValue({ on_failure: 'block' }),
      createFromOrder: jest.fn(),
      ...overrides.invoicing,
    };

    const invoice_flow = {
      validate: jest.fn().mockResolvedValue(undefined),
      send: jest.fn().mockResolvedValue(undefined),
      ...overrides.invoice_flow,
    };

    const retry_queue = {
      getRetryStatusByInvoiceIds: jest.fn().mockResolvedValue(new Map()),
      recordBlocked: jest.fn().mockResolvedValue(undefined),
      ...overrides.retry_queue,
    };

    const fiscal_scope = {
      findFiscalAccountingEntityId: jest.fn().mockResolvedValue(77),
      ...overrides.fiscal_scope,
    };

    return {
      service: new PosFiscalEmissionService(
        prisma as any,
        invoicing as any,
        invoice_flow as any,
        retry_queue as any,
        fiscal_scope as any,
      ),
      prisma,
      invoicing,
      invoice_flow,
      retry_queue,
      fiscal_scope,
      validatedInvoice,
    };
  };

  it('reporta `failed` (no `pending`) cuando send() falla sin encolar reintento, y deja constancia', async () => {
    const { service, prisma, invoice_flow, retry_queue } = createService();
    invoice_flow.send.mockRejectedValue(
      new Error('El certificado de firma expiró.'),
    );
    // Una sola fila para las TRES lecturas que hace el flujo (la inicial, la
    // que releé tras el catch, y la de `registerFailure`): ninguna la mueve,
    // que es justo el punto — un fallo permanente no cambia `invoices.status`.
    prisma.invoices.findFirst.mockResolvedValue({
      id: 5,
      invoice_number: 'FE-5',
      status: 'validated',
      transmission_status: null,
      cufe: null,
      pdf_url: null,
      contingency_deadline: null,
      organization_id: 10,
      store_id: 20,
    });

    const result = await service.emitForOrder(1);

    expect(result.state).toBe('failed');
    expect(result.message).toContain('certificado');
    expect(result.invoice_id).toBe(5);

    // La constancia que `registerFailure` deja para que el documento no se
    // pierda en cuanto el cajero pase a la siguiente venta.
    expect(retry_queue.recordBlocked).toHaveBeenCalledWith(
      5,
      10,
      20,
      expect.stringContaining('certificado'),
    );
  });

  it('sigue reportando `pending` cuando NO hubo ningún intento fallido todavía', async () => {
    const { service } = createService();

    // `getStatusForOrder` nunca pasa `failure_message` — es sondeo puro, sin
    // intentar transmitir. Debe seguir viéndose como «en camino».
    const result = await service.getStatusForOrder(1);

    expect(result.state).toBe('pending');
  });

  it('no toca `registerFailure` cuando el reintento sigue vivo (el fallo es transitorio)', async () => {
    const { service, invoice_flow, retry_queue } = createService();
    invoice_flow.send.mockRejectedValue(new Error('ETIMEDOUT'));
    retry_queue.getRetryStatusByInvoiceIds.mockResolvedValue(
      new Map([
        [
          5,
          {
            status: 'pending',
            attempts: 1,
            max_attempts: 5,
            next_retry_at: new Date(),
            last_error: 'ETIMEDOUT',
          },
        ],
      ]),
    );

    const result = await service.emitForOrder(1);

    expect(result.state).toBe('pending');
    expect(retry_queue.recordBlocked).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Cobertura fiscal: la venta cobrada que NUNCA llegó a tener fila de factura.
  //
  // `createFromOrder` puede lanzar ANTES de escribir nada (sin resolución
  // vigente, período cerrado, identidad del emisor incompleta). Entonces no hay
  // `invoice_id`, y `invoice_retry_queue.invoice_id` es NOT NULL: la cola no
  // puede guardar la constancia. El documento no existe y el cobro sí — esa es
  // exactamente la condición que nombra INVOICING_FISCAL_COVERAGE_001.
  //
  // Las DOS mitades se afirman por separado, porque son dos mecanismos
  // distintos y una sola aserción no dice cuál de los dos funciona:
  //   (a) que la constancia SE ESCRIBE en `fiscal_operation_events`,
  //   (b) que el semáforo LA LEE y deja de decir «Emitiendo…» para siempre.
  // ---------------------------------------------------------------------------

  it('(a) escribe la constancia en fiscal_operation_events cuando createFromOrder lanza antes de crear la fila', async () => {
    mockRequestContext({ organization_id: 10, store_id: 20 });
    const { service, prisma, invoicing, fiscal_scope } = createService();

    // No hay NINGUNA factura del pedido: ni antes ni después del intento.
    prisma.invoices.findFirst.mockResolvedValue(null);
    invoicing.createFromOrder.mockRejectedValue(
      new Error('No hay resolución de facturación vigente para esta tienda.'),
    );

    const result = await service.emitForOrder(1);

    expect(result.state).toBe('failed');
    expect(result.invoice_id).toBeNull();

    // La constancia: quién (org/tienda/entidad fiscal), sobre qué (el pedido) y
    // por qué (el error tipado + el mensaje que vio el cajero).
    expect(fiscal_scope.findFiscalAccountingEntityId).toHaveBeenCalledWith({
      organization_id: 10,
      store_id: 20,
    });
    expect(prisma.fiscal_operation_events.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organization_id: 10,
        store_id: 20,
        accounting_entity_id: 77,
        event_type: 'pos_sale_without_fiscal_document',
        resource_type: 'order',
        resource_id: 1,
        metadata: expect.objectContaining({
          error_code: 'INVOICING_FISCAL_COVERAGE_001',
          error: expect.stringContaining('resolución'),
        }),
      }),
    });
  });

  it('(b) getStatusForOrder reporta `failed` leyendo la constancia, en vez de «Emitiendo…» para siempre', async () => {
    mockRequestContext({ organization_id: 10, store_id: 20 });
    const { service, prisma } = createService();

    // Sigue sin haber factura — es el estado permanente de una venta descubierta.
    prisma.invoices.findFirst.mockResolvedValue(null);
    prisma.fiscal_operation_events.findFirst.mockResolvedValue({
      metadata: {
        error_code: 'INVOICING_FISCAL_COVERAGE_001',
        error: 'No hay resolución de facturación vigente para esta tienda.',
      },
    });

    const result = await service.getStatusForOrder(1);

    expect(result.state).toBe('failed');
    expect(result.message).toContain('resolución');

    // La sonda DEBE pedir el campo que la aserción de arriba afirma: si el
    // `select` no trajera `metadata`, el mensaje se compararía contra
    // `undefined` y el test pasaría sin que el dato viajara.
    expect(prisma.fiscal_operation_events.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          event_type: 'pos_sale_without_fiscal_document',
          resource_type: 'order',
          resource_id: 1,
        }),
        select: expect.objectContaining({ metadata: true }),
      }),
    );
  });

  it('NO-REGRESIÓN: una emisión aceptada sigue devolviendo `issued` y no escribe constancia de fallo', async () => {
    mockRequestContext({ organization_id: 10, store_id: 20 });
    const { service, prisma } = createService();

    prisma.invoices.findFirst.mockResolvedValue({
      id: 5,
      invoice_number: 'FE-5',
      status: 'accepted',
      transmission_status: 'accepted',
      cufe: 'CUFE-5',
      pdf_url: null,
      contingency_deadline: null,
    });

    const result = await service.emitForOrder(1);

    expect(result.state).toBe('issued');
    expect(result.invoice_id).toBe(5);
    expect(prisma.fiscal_operation_events.create).not.toHaveBeenCalled();
  });

  describe('banner INVOICE_AUTO_SEND_FAILED (orders.fiscal_alert_code)', () => {
    const MARK = {
      where: {
        id: 1,
        OR: [
          { fiscal_alert_code: null },
          { fiscal_alert_code: 'INVOICE_AUTO_SEND_FAILED' },
        ],
      },
      data: { fiscal_alert_code: 'INVOICE_AUTO_SEND_FAILED' },
    };
    const CLEAR = {
      where: { id: 1, fiscal_alert_code: 'INVOICE_AUTO_SEND_FAILED' },
      data: { fiscal_alert_code: null },
    };
    const failedStatus: any = { order_id: 1, state: 'failed', message: 'x', invoice_id: 5 };

    it('emisión aceptada LIMPIA sólo su propio código', async () => {
      const { service, prisma } = createService();
      prisma.invoices.findFirst.mockResolvedValue({
        id: 5, invoice_number: 'FE-5', status: 'accepted',
        transmission_status: 'accepted', cufe: 'CUFE-5', pdf_url: null,
        contingency_deadline: null,
      });

      const result = await service.emitForOrder(1);

      expect(result.state).toBe('issued');
      expect(prisma.orders.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.orders.updateMany).toHaveBeenCalledWith(CLEAR);
    });

    it('emisión fallida desde emitForOrder NO marca (sólo el listener automático marca)', async () => {
      const { service, prisma, invoice_flow } = createService();
      invoice_flow.send.mockRejectedValue(new Error('El certificado de firma expiró.'));

      const result = await service.emitForOrder(1);

      expect(result.state).toBe('failed');
      expect(prisma.orders.updateMany).not.toHaveBeenCalled();
    });

    it('markAutoSendFailedAlert con estado failed y factura validated marca INVOICE_AUTO_SEND_FAILED sin pisar códigos ajenos', async () => {
      const { service, prisma } = createService();

      await service.markAutoSendFailedAlert(1, failedStatus);

      expect(prisma.orders.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.orders.updateMany).toHaveBeenCalledWith(MARK);
    });

    it('markAutoSendFailedAlert sin factura (createFromOrder lanzó) también marca', async () => {
      const { service, prisma } = createService();
      prisma.invoices.findFirst.mockResolvedValue(null);

      await service.markAutoSendFailedAlert(1, { ...failedStatus, invoice_id: null });

      expect(prisma.orders.updateMany).toHaveBeenCalledWith(MARK);
    });

    it.each(['pending', 'contingency', 'not_applicable', 'issued'])(
      'markAutoSendFailedAlert con estado %s no escribe nada',
      async (state) => {
        const { service, prisma } = createService();

        await service.markAutoSendFailedAlert(1, { ...failedStatus, state });

        expect(prisma.orders.updateMany).not.toHaveBeenCalled();
      },
    );

    it('markAutoSendFailedAlert que relee la factura ya accepted LIMPIA en vez de marcar', async () => {
      const { service, prisma } = createService();
      prisma.invoices.findFirst.mockResolvedValue({ id: 5, status: 'accepted' });

      await service.markAutoSendFailedAlert(1, failedStatus);

      expect(prisma.orders.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.orders.updateMany).toHaveBeenCalledWith(CLEAR);
    });

    it.each(['voided', 'cancelled'])(
      'markAutoSendFailedAlert sobre factura %s no marca (anulación deliberada)',
      async (status) => {
        const { service, prisma } = createService();
        prisma.invoices.findFirst.mockResolvedValue({ id: 5, status });

        await service.markAutoSendFailedAlert(1, failedStatus);

        expect(prisma.orders.updateMany).not.toHaveBeenCalled();
      },
    );

    it('markAutoSendFailedAlert nunca lanza aunque la escritura falle', async () => {
      const { service, prisma } = createService();
      prisma.orders.updateMany.mockRejectedValue(new Error('db down'));

      await expect(
        service.markAutoSendFailedAlert(1, failedStatus),
      ).resolves.toBeUndefined();
    });
  });
});
