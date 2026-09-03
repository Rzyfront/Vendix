import { PosFiscalEmissionService } from './pos-fiscal-emission.service';

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
      },
      invoices: {
        findFirst: jest.fn().mockResolvedValue(validatedInvoice),
      },
      invoice_data_requests: {
        findFirst: jest.fn().mockResolvedValue(null),
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

    return {
      service: new PosFiscalEmissionService(
        prisma as any,
        invoicing as any,
        invoice_flow as any,
        retry_queue as any,
      ),
      prisma,
      invoicing,
      invoice_flow,
      retry_queue,
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
});
