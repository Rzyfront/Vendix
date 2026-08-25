import { InvoiceDeliveryService } from './invoice-delivery.service';

/**
 * Cubre el ciclo de E.6 (ERR-06/07/08): correo inválido → 422, borrador → 409,
 * fallo del proveedor → 502 con la traza YA escrita, factura de otra tienda
 * inalcanzable (nunca 200, nunca escribe), y un envío exitoso deja exactamente
 * una fila en `invoice_delivery_events`.
 *
 * La factura se lee vía `prisma.invoices.findFirst` — el mismo punto que
 * `StorePrismaService` auto-alcanza por `store_id` en producción (ver
 * `dian-events.service.spec.ts` para el mismo patrón de mock). Un `findFirst`
 * que resuelve `null` representa TANTO una factura inexistente COMO una de
 * otra tienda: la extensión de alcance las hace indistinguibles a propósito.
 */
describe('InvoiceDeliveryService', () => {
  const acceptedInvoice = {
    id: 12,
    organization_id: 1,
    store_id: 10,
    invoice_number: 'FE100',
    invoice_type: 'invoice',
    status: 'accepted',
    customer_id: null,
    customer: null,
    customer_name: 'Cliente de Prueba',
    organization: {
      id: 1,
      name: 'Vendix Demo',
      legal_name: 'Vendix Demo SAS',
      tax_id: '900123456',
      phone: '3000000000',
      email: 'facturas@demo.test',
      addresses: [],
    },
    invoice_items: [],
    subtotal_amount: 1000,
    discount_amount: 0,
    tax_amount: 190,
    withholding_amount: 0,
    total_amount: 1190,
    currency: 'COP',
    cufe: 'a'.repeat(96),
    notes: null,
    issue_date: new Date('2026-08-20T12:00:00Z'),
    due_date: null,
    pdf_url: null,
    xml_document: null,
  };

  function createService(overrides: any = {}) {
    const deliveryEventsCreate = jest
      .fn()
      .mockImplementation(({ data }: any) => ({ id: 1, ...data }));

    const prisma = {
      invoices: {
        findFirst: jest.fn().mockResolvedValue(acceptedInvoice),
      },
      withoutScope: jest.fn().mockReturnValue({
        invoice_delivery_events: { create: deliveryEventsCreate },
      }),
      ...overrides.prisma,
    };

    const s3Service = {
      downloadFile: jest.fn().mockResolvedValue(Buffer.from('pdf-bytes')),
      ...overrides.s3Service,
    };

    const emailService = {
      sendEmail: jest.fn().mockResolvedValue({ success: true, messageId: 'msg-1' }),
      sendEmailWithAttachments: jest
        .fn()
        .mockResolvedValue({ success: true, messageId: 'msg-1' }),
      ...overrides.emailService,
    };

    const service = new InvoiceDeliveryService(
      prisma as any,
      s3Service as any,
      emailService as any,
    );

    return { service, prisma, s3Service, emailService, deliveryEventsCreate };
  }

  it('rechaza un correo con formato inválido con INVOICING_DELIVERY_001 (422)', async () => {
    const { service, deliveryEventsCreate, emailService } = createService();

    const promise = service.deliver(12, { email: 'no-es-un-correo' } as any);

    await expect(promise).rejects.toMatchObject({ errorCode: 'INVOICING_DELIVERY_001' });
    await expect(promise.catch((e) => e.getStatus())).resolves.toBe(422);
    expect(emailService.sendEmail).not.toHaveBeenCalled();
    expect(deliveryEventsCreate).not.toHaveBeenCalled();
  });

  it('rechaza el reenvío de una factura en borrador con INVOICING_DELIVERY_002 (409)', async () => {
    const { service, deliveryEventsCreate, emailService } = createService({
      prisma: {
        invoices: {
          findFirst: jest.fn().mockResolvedValue({ ...acceptedInvoice, status: 'draft' }),
        },
      },
    });

    const promise = service.deliver(12, { email: 'cliente@test.com' } as any);

    await expect(promise).rejects.toMatchObject({ errorCode: 'INVOICING_DELIVERY_002' });
    await expect(promise.catch((e) => e.getStatus())).resolves.toBe(409);
    expect(emailService.sendEmail).not.toHaveBeenCalled();
    expect(deliveryEventsCreate).not.toHaveBeenCalled();
  });

  it('una factura de otra tienda es inalcanzable: nunca 200, nunca escribe traza', async () => {
    const { service, deliveryEventsCreate, emailService } = createService({
      prisma: { invoices: { findFirst: jest.fn().mockResolvedValue(null) } },
    });

    const promise = service.deliver(999, { email: 'cliente@test.com' } as any);

    await expect(promise).rejects.toMatchObject({ errorCode: 'INVOICING_FIND_001' });
    await expect(promise.catch((e) => e.getStatus())).resolves.toBe(404);
    expect(emailService.sendEmail).not.toHaveBeenCalled();
    expect(deliveryEventsCreate).not.toHaveBeenCalled();
  });

  it('un fallo del proveedor de correo escribe la traza en error ANTES de lanzar 502', async () => {
    const { service, deliveryEventsCreate } = createService({
      emailService: {
        sendEmail: jest
          .fn()
          .mockResolvedValue({ success: false, error: 'SMTP timeout' }),
      },
    });

    const promise = service.deliver(12, { email: 'cliente@test.com' } as any);

    await expect(promise).rejects.toMatchObject({ errorCode: 'INVOICING_DELIVERY_003' });
    await expect(promise.catch((e) => e.getStatus())).resolves.toBe(502);

    // La traza se escribió UNA vez, en error, con el mensaje del proveedor —
    // y esto se verifica pase lo que pase con la excepción de arriba.
    expect(deliveryEventsCreate).toHaveBeenCalledTimes(1);
    expect(deliveryEventsCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        invoice_id: 12,
        organization_id: 1,
        store_id: 10,
        channel: 'email',
        recipient: 'cliente@test.com',
        status: 'error',
        provider_error: 'SMTP timeout',
      }),
    });
  });

  it('un envío exitoso deja EXACTAMENTE una fila en invoice_delivery_events', async () => {
    const { service, deliveryEventsCreate, emailService } = createService();

    const result = await service.deliver(12, { email: 'otro-correo@test.com' } as any);

    expect(result).toMatchObject({
      invoice_id: 12,
      invoice_number: 'FE100',
      recipient: 'otro-correo@test.com',
    });
    expect(emailService.sendEmail).toHaveBeenCalledTimes(1);
    expect(deliveryEventsCreate).toHaveBeenCalledTimes(1);
    expect(deliveryEventsCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        invoice_id: 12,
        organization_id: 1,
        store_id: 10,
        channel: 'email',
        recipient: 'otro-correo@test.com',
        status: 'sent',
        provider_error: null,
      }),
    });
  });

  /**
   * Salvaguarda operativa de 2 MB (NO es cumplimiento DIAN §9.1 — ver el
   * docblock de `InvoiceDeliveryService`). Un PDF incompresible de 3 MB fuerza
   * el descarte: el zip enviado debe pesar < 2 MB y conservar sólo el XML.
   */
  it('descarta el PDF cuando el zip supera 2 MB y reenvía sólo con el XML', async () => {
    const big_pdf = require('crypto').randomBytes(3 * 1024 * 1024);
    const { service, emailService, deliveryEventsCreate } = createService({
      prisma: {
        invoices: {
          findFirst: jest.fn().mockResolvedValue({
            ...acceptedInvoice,
            pdf_url: 'invoices/fe100.pdf',
            xml_document: '<xml>factura</xml>',
          }),
        },
      },
      s3Service: {
        downloadFile: jest.fn().mockResolvedValue(big_pdf),
      },
    });

    const result = await service.deliver(12, { email: 'cliente@test.com' } as any);

    expect(result.zip_name).toBe('Factura-FE100.zip');
    expect(emailService.sendEmailWithAttachments).toHaveBeenCalledTimes(1);

    const [, , , attachments] = (emailService.sendEmailWithAttachments as jest.Mock).mock
      .calls[0];
    expect(attachments).toHaveLength(1);
    expect(attachments[0].content.length).toBeLessThan(2 * 1024 * 1024);

    // El zip que efectivamente se envía NO trae el PDF —se descartó—, sólo el XML.
    const AdmZip = require('adm-zip');
    const sent_zip = new AdmZip(attachments[0].content);
    const entry_names = sent_zip.getEntries().map((e: any) => e.entryName);
    expect(entry_names).toEqual(['Factura-FE100.xml']);

    expect(deliveryEventsCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'sent', zip_name: 'Factura-FE100.zip' }),
    });
  });
});
