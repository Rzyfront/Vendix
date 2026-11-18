import { HttpException } from '@nestjs/common';
import { InvoiceFlowService, resolveDiscardRoute } from './invoice-flow.service';

/**
 * QUI-683 — ciclo de vida del documento soporte después de aceptado.
 *
 * Un documento soporte ACEPTADO por la DIAN no se anula: se corrige con una
 * nota de ajuste al documento soporte (tipo 95). Recomendarle «nota crédito»
 * al operador lo manda a un documento que la DIAN no recibe sobre un CUDS. Las
 * facturas de venta conservan su salida de siempre: la nota crédito.
 *
 * El endpoint `GET store/invoicing/:id/dian-status` consulta la DIAN en vivo
 * con la llave fiscal guardada, por el cliente con alcance de tienda: un id de
 * otra tienda no existe para quien pregunta (404) y la DIAN ni se consulta.
 */

type InvoiceRow = Record<string, unknown>;

function buildService(options: {
  invoice: InvoiceRow | null;
  provider?: { checkStatus: jest.Mock };
}) {
  const invoices = {
    findFirst: jest.fn().mockResolvedValue(options.invoice),
  };
  const prisma = { invoices };
  const resolver = {
    resolve: jest.fn().mockResolvedValue(options.provider ?? null),
  };
  const service = new InvoiceFlowService(
    prisma as never,
    resolver as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, invoices, resolver };
}

async function captureError(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (error) {
    return error as HttpException;
  }
  throw new Error('Expected the call to reject');
}

function body(error: HttpException): {
  error_code: string;
  message: string;
  details?: { discard_route?: { action: string; label: string } };
} {
  return error.getResponse() as never;
}

describe('InvoiceFlowService — documento soporte aceptado se corrige con nota de ajuste', () => {
  it('anular un documento soporte aceptado sugiere la nota de ajuste, no la nota crédito', async () => {
    const { service } = buildService({
      invoice: { id: 9, invoice_type: 'support_document', status: 'accepted' },
    });

    const error = await captureError(service.void(9));

    expect(error.getStatus()).toBe(400);
    expect(body(error).error_code).toBe('INVOICING_STATUS_002');
    expect(body(error).message).toMatch(/nota de ajuste/i);
    expect(body(error).message).not.toMatch(/nota crédito/i);
    expect(body(error).details?.discard_route).toMatchObject({
      action: 'adjustment_note',
      label: 'Emitir nota de ajuste',
    });
  });

  it('una factura de venta aceptada sigue sugiriendo la nota crédito', async () => {
    const { service } = buildService({
      invoice: { id: 10, invoice_type: 'sales_invoice', status: 'accepted' },
    });

    const error = await captureError(service.void(10));

    expect(body(error).error_code).toBe('INVOICING_STATUS_002');
    expect(body(error).message).toBe(
      'Un documento aceptado por la DIAN no se anula: emite una nota crédito que lo corrija o lo revierta. La anulación sólo aplica a documentos que la DIAN nunca aceptó.',
    );
    expect(body(error).details?.discard_route).toMatchObject({
      action: 'credit_note',
      label: 'Emitir nota crédito',
    });
  });

  it('descartar un documento soporte aceptado también nombra la nota de ajuste', async () => {
    const { service } = buildService({
      invoice: { id: 11, invoice_type: 'support_document', status: 'accepted' },
    });

    const error = await captureError(service.cancel(11));

    expect(body(error).error_code).toBe('INVOICING_STATUS_001');
    expect(body(error).message).toContain('«Emitir nota de ajuste»');
    expect(body(error).details?.discard_route?.action).toBe('adjustment_note');
  });

  it('la ruta de descarte solo cambia para soportes aceptados', () => {
    expect(
      resolveDiscardRoute({ status: 'accepted', invoice_type: 'support_document' }).action,
    ).toBe('adjustment_note');
    expect(
      resolveDiscardRoute({ status: 'accepted', invoice_type: 'support_adjustment_note' }).action,
    ).toBe('adjustment_note');
    expect(
      resolveDiscardRoute({ status: 'accepted', invoice_type: 'purchase_invoice' }).action,
    ).toBe('adjustment_note');
    expect(
      resolveDiscardRoute({ status: 'accepted', invoice_type: 'sales_invoice' }).action,
    ).toBe('credit_note');
    expect(
      resolveDiscardRoute({ status: 'rejected', invoice_type: 'support_document' }),
    ).toMatchObject({ action: 'void', label: 'Anular' });
    expect(
      resolveDiscardRoute({ status: 'draft', invoice_type: 'support_document' }).action,
    ).toBe('cancel');
  });
});

describe('InvoiceFlowService.getDianStatus — consulta en vivo por CUDS', () => {
  const acceptedSupport = {
    id: 9,
    invoice_number: 'DS100',
    invoice_type: 'support_document',
    status: 'accepted',
    cufe: 'cuds-abc',
  };

  it('un id de otra tienda responde 404 y no consulta la DIAN', async () => {
    // El cliente con alcance de tienda (StorePrismaService) no devuelve filas
    // de otra tienda: para quien pregunta, el documento no existe.
    const { service, invoices, resolver } = buildService({ invoice: null });

    const error = await captureError(service.getDianStatus(77));

    expect(error.getStatus()).toBe(404);
    expect(body(error).error_code).toBe('INVOICING_FIND_001');
    expect(invoices.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 77 } }),
    );
    expect(resolver.resolve).not.toHaveBeenCalled();
  });

  it('consulta con el CUDS y la configuración del documento soporte, y mapea la respuesta', async () => {
    const provider = {
      checkStatus: jest.fn().mockResolvedValue({
        tracking_id: 'cuds-abc',
        status: 'accepted',
        message: 'Procesado Correctamente.',
        cufe: 'cuds-abc',
        provider_data: {
          dian_status_code: '00',
          rule_messages: [
            { code: 'RUT01', text: 'Responsabilidad no informada', severity: 'notificacion' },
          ],
          application_response_xml: '<xml/>',
          timed_out: false,
        },
      }),
    };
    const { service, resolver } = buildService({ invoice: acceptedSupport, provider });

    const result = await service.getDianStatus(9);

    expect(resolver.resolve).toHaveBeenCalledWith({ configuration_type: 'support_document' });
    expect(provider.checkStatus).toHaveBeenCalledWith('cuds-abc', {
      configuration_type: 'support_document',
    });
    expect(result).toEqual({
      invoice_id: 9,
      invoice_number: 'DS100',
      invoice_type: 'support_document',
      document_key: 'cuds-abc',
      document_key_label: 'CUDS',
      local_status: 'accepted',
      dian_status: 'accepted',
      dian_status_code: '00',
      message: 'Procesado Correctamente.',
      rules: [
        { code: 'RUT01', text: 'Responsabilidad no informada', severity: 'notificacion' },
      ],
      checked_at: expect.any(String),
    });
    // La evidencia cruda de la DIAN no viaja a la pantalla.
    expect(JSON.stringify(result)).not.toContain('<xml/>');
  });

  it('una DIAN que no respondió se informa como no disponible, no como rechazo', async () => {
    const provider = {
      checkStatus: jest.fn().mockResolvedValue({
        tracking_id: 'cuds-abc',
        status: 'rejected',
        message: 'Failed to parse response',
        provider_data: { dian_status_code: 'PARSE_ERROR', timed_out: true },
      }),
    };
    const { service } = buildService({ invoice: acceptedSupport, provider });

    const result = await service.getDianStatus(9);

    expect(result.dian_status).toBe('unavailable');
    expect(result.local_status).toBe('accepted');
  });

  it('un rechazo de la DIAN se informa como rechazo con sus reglas', async () => {
    const provider = {
      checkStatus: jest.fn().mockResolvedValue({
        tracking_id: 'cuds-abc',
        status: 'rejected',
        message: 'Documento con errores en campos mandatorios.',
        provider_data: {
          dian_status_code: '99',
          rule_messages: [{ code: 'DSAJ01', text: 'CUDS no válido', severity: 'rechazo' }],
          timed_out: false,
        },
      }),
    };
    const { service } = buildService({ invoice: acceptedSupport, provider });

    const result = await service.getDianStatus(9);

    expect(result.dian_status).toBe('rejected');
    expect(result.dian_status_code).toBe('99');
    expect(result.rules).toEqual([
      { code: 'DSAJ01', text: 'CUDS no válido', severity: 'rechazo' },
    ]);
  });

  it('una factura de venta consulta con su CUFE y la configuración de facturación', async () => {
    const provider = {
      checkStatus: jest.fn().mockResolvedValue({
        tracking_id: 'cufe-1',
        status: 'accepted',
        provider_data: { dian_status_code: '00', timed_out: false },
      }),
    };
    const { service, resolver } = buildService({
      invoice: {
        id: 3,
        invoice_number: 'FE3',
        invoice_type: 'sales_invoice',
        status: 'accepted',
        cufe: 'cufe-1',
      },
      provider,
    });

    const result = await service.getDianStatus(3);

    expect(resolver.resolve).toHaveBeenCalledWith({ configuration_type: 'invoicing' });
    expect(provider.checkStatus).toHaveBeenCalledWith('cufe-1', {
      configuration_type: 'invoicing',
    });
    expect(result.document_key_label).toBe('CUFE');
    expect(result.message).toBeNull();
    expect(result.rules).toEqual([]);
  });

  it('un documento sin CUDS todavía no se puede consultar y la DIAN no se llama', async () => {
    const { service, resolver } = buildService({
      invoice: { ...acceptedSupport, status: 'draft', cufe: null },
    });

    const error = await captureError(service.getDianStatus(9));

    expect(body(error).error_code).toBe('INVOICING_STATUS_002');
    expect(body(error).message).toMatch(/CUDS/);
    expect(resolver.resolve).not.toHaveBeenCalled();
  });

  it('un fallo de comunicación con la DIAN responde 502 con la causa', async () => {
    const provider = {
      checkStatus: jest.fn().mockRejectedValue(new Error('ETIMEDOUT dian')),
    };
    const { service } = buildService({ invoice: acceptedSupport, provider });

    const error = await captureError(service.getDianStatus(9));

    expect(error.getStatus()).toBe(502);
    expect(body(error).error_code).toBe('INVOICING_PROVIDER_001');
    expect(body(error).message).toContain('ETIMEDOUT dian');
  });
});
