import { InvoiceDeliveryService } from './invoice-delivery.service';

/**
 * Cubre el ciclo de E.6 (ERR-06/07/08): correo inválido → 422, borrador → 409,
 * fallo del proveedor → 502 con la traza YA escrita, factura de una tienda
 * inalcanzable (nunca 200, nunca escribe), y un envío exitoso deja exactamente
 * una fila en `invoice_delivery_events`.
 *
 * La factura se lee vía `prisma.invoices.findFirst` — el mismo punto que
 * `StorePrismaService` auto-alcanza por `store_id` en producción (ver
 * `dian-events.service.spec.ts` para el mismo patrón de mock). Un `findFirst`
 * que resuelve `null` representa TANTO una factura inexistente COMO una de
 * otra tienda: la extensión de alcance las hace indistinguibles a propósito.
 *
 * BE-E5 (E.5) — los tests del final (`describe('E.5 — AttachedDocument y PDF
 * según formato')`) cierran casillas 3, 4 y 5: el ZIP armado lleva el XML
 * envuelto en un `AttachedDocument` validable (con el PDF embebido en
 * `cbc:Note`), y el PDF del ZIP sale del motor `renderBuffer` cuando está
 * disponible, no del PDF persistido en S3.
 */
describe('InvoiceDeliveryService', () => {
  const acceptedInvoice = {
    id: 12,
    organization_id: 1,
    store_id: 10,
    invoice_number: 'FE100',
    invoice_type: 'sales_invoice',
    status: 'accepted',
    customer_id: null,
    customer: null,
    customer_name: 'Cliente de Prueba',
    customer_tax_id: '79123456',
    customer_document_type: '13',
    organization: {
      id: 1,
      name: 'Vendix Demo',
      legal_name: 'Vendix Demo SAS',
      tax_id: '900123456',
      document_type: '31',
      verification_digit: '1',
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

    // BE-E5 — el lookup de `dian_configurations.environment` se hace dentro
    // de `prisma.withoutScope().dian_configurations.findFirst(...)`. Por
    // defecto resuelve `null` (la mayoría de tiendas; ver docblock).
    const dianEnvFindFirst = jest.fn().mockResolvedValue(null);
    const prisma = {
      invoices: {
        findFirst: jest.fn().mockResolvedValue(acceptedInvoice),
      },
      withoutScope: jest.fn((arg: any) => {
        if (arg !== undefined) {
          return arg;
        }
        return {
          invoice_delivery_events: { create: deliveryEventsCreate },
          dian_configurations: { findFirst: dianEnvFindFirst },
        };
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

    const fiscalPdfRender = {
      renderBuffer: jest
        .fn()
        .mockResolvedValue(Buffer.from('rendered-pdf-bytes')),
      ...overrides.fiscalPdfRender,
    };

    const service = new InvoiceDeliveryService(
      prisma as any,
      s3Service as any,
      emailService as any,
      fiscalPdfRender as any,
    );

    return {
      service,
      prisma,
      s3Service,
      emailService,
      fiscalPdfRender,
      deliveryEventsCreate,
      dianEnvFindFirst,
    };
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

  /**
   * BE-E5 (E.5, casillas 3 + 4 + 5). El ZIP de reenvío, cuando hay PDF y XML
   * disponibles, lleva TRES archivos:
   *   · `Factura-FE100.pdf`  — el PDF del FORMATO ACTUAL de la tienda
   *                            (re-renderizado por `renderBuffer`).
   *   · `Factura-FE100.xml`  — el XML firmado CRUDO (legible).
   *   · `Factura-FE100-attached-document.xml` — el sobre `AttachedDocument`
   *                            que exige el Anexo 1.9 §9.1, con el XML
   *                            embebido en base64 y el PDF en un `cbc:Note`.
   *
   * Compuerta del wire-up: verifica que el render bajo demanda fue llamado
   * (no el S3 PDF), y que el sobre lleva el XML firmado dentro.
   */
  it('E.5 — el ZIP lleva AttachedDocument + PDF re-renderizado + XML crudo', async () => {
    const xml_document =
      '<Invoice><ID>FE100</ID><UUID schemeName="CUFE-SHA384">' +
      'a'.repeat(96) +
      '</UUID></Invoice>';

    const { service, fiscalPdfRender, s3Service, emailService } = createService({
      prisma: {
        invoices: {
          findFirst: jest.fn().mockResolvedValue({
            ...acceptedInvoice,
            pdf_url: 'invoices/fe100.pdf',
            xml_document,
          }),
        },
      },
    });

    const result = await service.deliver(10, {
      email: 'cliente@test.com',
    } as any);

    expect(result.zip_name).toBe('Factura-FE100.zip');
    expect(emailService.sendEmailWithAttachments).toHaveBeenCalledTimes(1);

    // Casilla 4: el PDF salió del motor `renderBuffer`, no de S3.
    expect(fiscalPdfRender.renderBuffer).toHaveBeenCalledTimes(1);
    expect(fiscalPdfRender.renderBuffer).toHaveBeenCalledWith(10, 12);
    expect(s3Service.downloadFile).not.toHaveBeenCalled();

    const [, , , attachments] = (emailService.sendEmailWithAttachments as jest.Mock)
      .mock.calls[0];
    const AdmZip = require('adm-zip');
    const sent_zip = new AdmZip(attachments[0].content);
    const entry_names = sent_zip.getEntries()
      .map((e: any) => e.entryName)
      .sort();

    expect(entry_names).toEqual([
      'Factura-FE100-attached-document.xml',
      'Factura-FE100.pdf',
      'Factura-FE100.xml',
    ]);

    // Casilla 3 + 5: el sobre es un AttachedDocument válido — ver
    // `ub-attached-document.builder.spec.ts` para la matriz de
    // validaciones contra el XSD. Aquí basta con confirmar que el XML
    // firmado va EMBEBIDO en base64 dentro del `cac:Attachment` Y que el
    // PDF va en el `cbc:Note` de representación gráfica. Eso es exactamente
    // lo que el anexo pide y lo que la spec del builder verifica.
    const attached_entry = sent_zip.getEntry(
      'Factura-FE100-attached-document.xml',
    );
    const attached_xml = attached_entry.getData().toString('utf-8');
    const xml_base64 = Buffer.from(xml_document, 'utf-8').toString('base64');
    expect(attached_xml).toContain('AttachedDocument');
    expect(attached_xml).toContain('xmlns="urn:oasis:names:specification:ubl:schema:xsd:AttachedDocument-2"');
    // El `cbc:UUID` del sobre lleva el CUFE/CUDE del documento envuelto y
    // su `@schemeName` (CUFE-SHA384 para `sales_invoice`).
    expect(attached_xml).toContain(
      `<cbc:UUID schemeName="CUFE-SHA384">${'a'.repeat(96)}</cbc:UUID>`,
    );
    // El `cac:Attachment/cbc:EmbeddedDocumentBinaryObject` lleva el XML
    // firmado embebido en base64 con `mimeCode="text/xml"`.
    expect(attached_xml).toContain(
      `<cbc:EmbeddedDocumentBinaryObject mimeCode="text/xml" filename="Factura-FE100.xml">${xml_base64}</cbc:EmbeddedDocumentBinaryObject>`,
    );
    // La representación gráfica (PDF) viaja como `cbc:Note` con prefijo.
    const pdf_base64 = Buffer.from('rendered-pdf-bytes').toString('base64');
    expect(attached_xml).toContain(
      `<cbc:Note>Representación gráfica (PDF), base64: ${pdf_base64}</cbc:Note>`,
    );
    // Emisor y adquiriente en el sobre, con los códigos de la tabla DIAN.
    expect(attached_xml).toContain(
      '<cbc:CompanyID schemeName="31" schemeID="1">900123456</cbc:CompanyID>',
    );
    expect(attached_xml).toContain(
      '<cbc:CompanyID schemeName="13">79123456</cbc:CompanyID>',
    );
    // El `parent_document_id` y `cbc:ID` del contenedor son el número de
    // la factura (el sobre es 1:1 con el documento envuelto, criterio de
    // `UblAttachedDocumentBuilder`).
    expect(attached_xml).toContain(
      '<cbc:ParentDocumentID>FE100</cbc:ParentDocumentID>',
    );
    expect(attached_xml).toContain('<cbc:ID>FE100</cbc:ID>');
  });

  /**
   * Casilla 4 (camino de FALLO del render): si `renderBuffer` falla (por
   * identidad fiscal incompleta, S3 sin logo, etc.), el servicio cae al
   * PDF persistido en S3 — y el AttachedDocument sigue saliendo (sin
   * `cbc:Note` de representación gráfica, porque `pdf_buffer` quedó
   * undefined). Esta es la pieza de «degradación operativa» que comparte
   * criterio con el resto del ZIP.
   */
  it('E.5 — si renderBuffer falla, el ZIP usa el PDF persistido y el sobre se construye sin cbc:Note', async () => {
    const xml_document =
      '<Invoice><ID>FE100</ID><UUID schemeName="CUFE-SHA384">' +
      'a'.repeat(96) +
      '</UUID></Invoice>';

    const { service, fiscalPdfRender, s3Service, emailService } = createService({
      prisma: {
        invoices: {
          findFirst: jest.fn().mockResolvedValue({
            ...acceptedInvoice,
            pdf_url: 'invoices/fe100.pdf',
            xml_document,
          }),
        },
      },
      fiscalPdfRender: {
        renderBuffer: jest
          .fn()
          .mockRejectedValue(new Error('FISCAL_IDENTITY_INCOMPLETE')),
      },
    });

    await service.deliver(10, { email: 'cliente@test.com' } as any);

    expect(fiscalPdfRender.renderBuffer).toHaveBeenCalledTimes(1);
    // Cae al PDF persistido.
    expect(s3Service.downloadFile).toHaveBeenCalledWith('invoices/fe100.pdf');

    const [, , , atts] = (emailService.sendEmailWithAttachments as jest.Mock)
      .mock.calls[0];
    const AdmZip = require('adm-zip');
    const sent_zip = new AdmZip(atts[0].content);
    const attached_xml = sent_zip
      .getEntry('Factura-FE100-attached-document.xml')
      .getData()
      .toString('utf-8');

    // Sin PDF embebido → el sobre NO incluye el `cbc:Note` de
    // representación gráfica, sólo el XML firmado en `cac:Attachment`.
    expect(attached_xml).not.toContain('<cbc:Note>');
    expect(attached_xml).toContain('<cac:Attachment>');
    // Pero el resto del sobre sigue presente y es válido.
    expect(attached_xml).toContain('AttachedDocument');
  });

  /**
   * Sin XML no hay sobre que envolver (paso 5.b salta, paso 5.c también) —
   * pero el ZIP sigue saliendo con el PDF si está disponible, y la
   * degradación histórica «sin adjunto si nada trae nada» se mantiene.
   * Esto protege el camino del PDF-only (XML ausente en facturas legacy).
   */
  it('E.5 — sin xml_document el ZIP sale sin sobre AttachedDocument', async () => {
    const { service, emailService, fiscalPdfRender } = createService({
      prisma: {
        invoices: {
          findFirst: jest.fn().mockResolvedValue({
            ...acceptedInvoice,
            pdf_url: 'invoices/fe100.pdf',
            xml_document: null,
          }),
        },
      },
    });

    await service.deliver(10, { email: 'cliente@test.com' } as any);

    const [, , , attachments] = (emailService.sendEmailWithAttachments as jest.Mock)
      .mock.calls[0];
    const AdmZip = require('adm-zip');
    const sent_zip = new AdmZip(attachments[0].content);
    const entry_names = sent_zip.getEntries()
      .map((e: any) => e.entryName)
      .sort();

    // PDF sí (vino de renderBuffer); NO hay XML crudo ni sobre.
    expect(entry_names).toEqual(['Factura-FE100.pdf']);
    expect(fiscalPdfRender.renderBuffer).toHaveBeenCalledTimes(1);
  });

  /**
   * El ambiente del sobre (`cbc:ProfileExecutionID`) sale de
   * `dian_configurations.environment` cuando hay fila. Verifica que
   * 'production' → ProfileExecutionID = '1', 'test' → ProfileExecutionID
   * = '2'. Sin fila (la mayoría de tiendas, ver medición del 2026-08-24:
   * 1 de 21), el sobre queda en '2' (test) y sigue siendo XML válido.
   */
  it('E.5 — el ProfileExecutionID del sobre = 1 cuando dian_configurations está en producción', async () => {
    const xml_document =
      '<Invoice><ID>FE100</ID><UUID schemeName="CUFE-SHA384">' +
      'a'.repeat(96) +
      '</UUID></Invoice>';

    const { service, emailService, dianEnvFindFirst } = createService({
      prisma: {
        invoices: {
          findFirst: jest.fn().mockResolvedValue({
            ...acceptedInvoice,
            xml_document,
          }),
        },
      },
    });
    dianEnvFindFirst.mockResolvedValueOnce({ environment: 'production' });

    await service.deliver(10, { email: 'a@b.com' } as any);

    const [, , , atts] = (emailService.sendEmailWithAttachments as jest.Mock)
      .mock.calls[0];
    const AdmZip = require('adm-zip');
    const z = new AdmZip(atts[0].content);
    const ax = z
      .getEntry('Factura-FE100-attached-document.xml')
      .getData()
      .toString('utf-8');
    expect(ax).toContain('<cbc:ProfileExecutionID>1</cbc:ProfileExecutionID>');
  });

  it('E.5 — el ProfileExecutionID del sobre = 2 cuando no hay dian_configurations', async () => {
    const xml_document =
      '<Invoice><ID>FE100</ID><UUID schemeName="CUFE-SHA384">' +
      'a'.repeat(96) +
      '</UUID></Invoice>';

    const { service, emailService } = createService({
      prisma: {
        invoices: {
          findFirst: jest.fn().mockResolvedValue({
            ...acceptedInvoice,
            xml_document,
          }),
        },
      },
    });
    // dianEnvFindFirst ya resuelve null por default → ProfileExecutionID = 2.

    await service.deliver(10, { email: 'a@b.com' } as any);

    const [, , , atts] = (emailService.sendEmailWithAttachments as jest.Mock)
      .mock.calls[0];
    const AdmZip = require('adm-zip');
    const z = new AdmZip(atts[0].content);
    const ax = z
      .getEntry('Factura-FE100-attached-document.xml')
      .getData()
      .toString('utf-8');
    expect(ax).toContain('<cbc:ProfileExecutionID>2</cbc:ProfileExecutionID>');
  });
});
