import { NotificationsEventsListener } from './notifications-events.listener';
import { AppointmentQueueService } from '../reservations/appointment-queue/appointment-queue.service';

describe('NotificationsEventsListener — appointment redesign handlers', () => {
  function buildListener() {
    const notificationsService = {
      createAndBroadcast: jest.fn().mockResolvedValue({}),
    } as any;
    const globalPrisma = {} as any;
    const emailService = {} as any;
    const s3Service = {} as any;
    const appointmentQueueService = {
      refreshAndBroadcastQueue: jest.fn().mockResolvedValue({ updated: 0, promoted: null }),
    } as any;
    // Sexta dependencia del constructor. Faltaba: la suite entera fallaba con
    // «Test suite failed to run» (TS2554), es decir CERO pruebas ejecutadas —
    // y un cero no aparece como rojo en el recuento de «Tests», sólo en el de
    // «Test Suites».
    const eventEmitter = { emit: jest.fn() } as any;

    const listener = new NotificationsEventsListener(
      notificationsService,
      globalPrisma,
      emailService,
      s3Service,
      appointmentQueueService,
      eventEmitter,
    );

    return {
      listener,
      notificationsService,
      appointmentQueueService,
      eventEmitter,
    };
  }

  it('handleAppointmentUpcoming emits appointment_upcoming with the right payload', async () => {
    const { listener, notificationsService } = buildListener();
    await listener.handleAppointmentUpcoming({
      store_id: 1,
      booking_id: 42,
      booking_number: 'BKG-1',
      proximity_minutes: 15,
      customer_name: 'Juan Pérez',
      service_name: 'Corte',
      date: '2026-07-18',
      start_time: '10:00',
    });

    expect(notificationsService.createAndBroadcast).toHaveBeenCalledWith(
      1,
      'appointment_upcoming',
      'Tu cita está por comenzar',
      expect.stringContaining('Juan Pérez'),
      expect.objectContaining({
        booking_id: 42,
        proximity_minutes: 15,
        kind: 'proximity',
      }),
    );
  });

  it('handleAppointmentCheckedIn emits appointment_checked_in', async () => {
    const { listener, notificationsService } = buildListener();
    await listener.handleAppointmentCheckedIn({
      store_id: 2,
      booking_id: 99,
      booking_number: 'BKG-99',
      customer_name: 'Ana',
      service_name: 'Color',
      provider_id: 7,
    });
    expect(notificationsService.createAndBroadcast).toHaveBeenCalledWith(
      2,
      'appointment_checked_in',
      'Cliente en sala de espera',
      expect.stringContaining('Ana'),
      expect.objectContaining({ booking_id: 99, provider_id: 7, kind: 'arrival' }),
    );
  });

  it('handleBookingArrivalRecorded triggers queue refresh and survives queue errors', async () => {
    const { listener, appointmentQueueService } = buildListener();
    appointmentQueueService.refreshAndBroadcastQueue.mockRejectedValueOnce(
      new Error('queue blew up'),
    );

    await expect(
      listener.handleBookingArrivalRecorded({
        store_id: 3,
        booking_id: 100,
        date: '2026-07-18',
      }),
    ).resolves.toBeUndefined();

    expect(appointmentQueueService.refreshAndBroadcastQueue).toHaveBeenCalledWith(
      3,
      '2026-07-18',
    );
  });

  it('handleBookingDoubleBooking alerts staff with booking_attending', async () => {
    const { listener, notificationsService } = buildListener();
    await listener.handleBookingDoubleBooking({
      store_id: 4,
      booking_id: 50,
      booking_number: 'BKG-50',
    });
    expect(notificationsService.createAndBroadcast).toHaveBeenCalledWith(
      4,
      'booking_attending',
      'Doble booking detectado',
      expect.stringContaining('BKG-50'),
      expect.objectContaining({ booking_id: 50, kind: 'double_booking' }),
    );
  });
  /**
   * Asunto DIAN — Anexo Técnico FEV 1.9 §9.1. La función pura tiene su propio
   * spec (`dian-email-subject.util.spec.ts`); lo que se prueba aquí es el
   * CABLEADO: de qué columnas sale cada campo y qué pasa cuando la identidad
   * fiscal está incompleta. Se invoca el método privado a propósito: la
   * alternativa —conducir `handleInvoicePdfGenerated` completo— exige simular
   * Prisma, S3 y el servicio de correo, y probaría el envío, no la decisión.
   */
  describe('buildInvoiceEmailSubject', () => {
    function subjectOf(invoice: any, fallbackName = 'FALLBACK SAS'): string {
      const { listener } = buildListener();
      return (listener as any).buildInvoiceEmailSubject(invoice, fallbackName);
    }

    const ELECTRONIC = {
      invoice_number: 'FVET2254',
      invoice_type: 'sales_invoice',
      dian_status: 'accepted',
    };

    it('arma los cinco campos del anexo a partir de la organización', () => {
      expect(
        subjectOf({
          ...ELECTRONIC,
          organization: {
            name: 'Texmall Store',
            legal_name: 'TEXMALL SAS',
            tax_id: '901280137-1',
            fiscal_scope: 'ORGANIZATION',
            organization_settings: { settings: {} },
          },
          store: null,
        }),
      ).toBe('901280137;TEXMALL SAS;FVET2254;01;Texmall Store');
    });

    it('bajo fiscal_scope = STORE lee la identidad de los ajustes de la TIENDA', () => {
      // Éste es el defecto que el cableado cierra: el listener leía
      // `organizations.tax_id` a pelo, así que el asunto salía con el NIT de la
      // organización mientras el XML se firmaba con el de la tienda.
      const subject = subjectOf({
        ...ELECTRONIC,
        organization: {
          name: 'Grupo Matriz',
          legal_name: 'GRUPO MATRIZ SAS',
          tax_id: '900111222-1',
          fiscal_scope: 'STORE',
          organization_settings: { settings: { fiscal_data: { nit: '900111222' } } },
        },
        store: {
          name: 'Sucursal Chapinero',
          legal_name: 'SUCURSAL CHAPINERO SAS',
          tax_id: '901280137',
          store_settings: {
            settings: {
              fiscal_data: { nit: '901280137-1', legal_name: 'TEXMALL SAS' },
            },
          },
        },
      });
      expect(subject).toBe('901280137;TEXMALL SAS;FVET2254;01;Sucursal Chapinero');
      expect(subject).not.toContain('900111222');
    });

    it('el recibo interno (dian_status not_applicable) conserva el asunto legible', () => {
      expect(
        subjectOf({
          ...ELECTRONIC,
          dian_status: 'not_applicable',
          organization: {
            name: 'Texmall Store',
            legal_name: 'TEXMALL SAS',
            tax_id: '901280137-1',
            fiscal_scope: 'ORGANIZATION',
          },
          store: null,
        }),
      ).toBe('FALLBACK SAS - Factura FVET2254');
    });

    it('una identidad fiscal incompleta cae al asunto legible, NO tumba el correo', () => {
      expect(
        subjectOf({
          ...ELECTRONIC,
          organization: {
            name: null,
            legal_name: null,
            tax_id: null,
            fiscal_scope: 'ORGANIZATION',
            organization_settings: { settings: {} },
          },
          store: null,
        }),
      ).toBe('FALLBACK SAS - Factura FVET2254');
    });

    it('un tipo sin código de emisión cae al asunto legible en vez de inventarlo', () => {
      // `equivalent_adjustment_note` es '93' débito o '94' crédito según el
      // numeral 16.3, y el tipo interno no distingue: el resolvedor devuelve
      // undefined y el builder lanza, así que el asunto normativo no se emite.
      expect(
        subjectOf({
          ...ELECTRONIC,
          invoice_type: 'equivalent_adjustment_note',
          organization: {
            name: 'Texmall Store',
            legal_name: 'TEXMALL SAS',
            tax_id: '901280137-1',
            fiscal_scope: 'ORGANIZATION',
          },
          store: null,
        }),
      ).toBe('FALLBACK SAS - Factura FVET2254');
    });
  });
});

/**
 * E.10 (2026-08-25) — la entrega PRIMARIA al adquiriente (Anexo Técnico 1.9
 * §9.1) vive en `handleInvoicePdfGenerated`, no en `InvoiceDeliveryService`
 * (ese es el reenvío de conveniencia, E.6). Antes de este bloque el método
 * NO tenía cobertura de su propia lógica de decisión: sólo se probaba
 * `buildInvoiceEmailSubject` por separado (ver comentario de esa suite). El
 * hallazgo que motivó esto: se estampaba `email_sent_at` con sólo mirar
 * `result.success` del proveedor de correo, así que un correo enviado con
 * CERO adjuntos (PDF no descargable de S3 + factura sin `xml_document`)
 * quedaba contado como "entregado" — 16 de 95 facturas así, sin ninguna fila
 * en `invoice_delivery_events` para auditarlo.
 *
 * Se construye el listener con mocks completos (Prisma/S3/email) y se llama
 * al método PÚBLICO tal como lo dispara el event emitter real — no el
 * método privado — porque lo que se prueba aquí es la decisión que cruza
 * "¿hubo adjunto?" con "¿el proveedor aceptó?", que vive en el cuerpo del
 * handler, no en una función pura extraíble.
 */
describe('NotificationsEventsListener.handleInvoicePdfGenerated (E.10)', () => {
  function buildInvoiceRow(overrides: Record<string, any> = {}) {
    return {
      id: 501,
      invoice_number: 'FVET9001',
      invoice_type: 'sales_invoice',
      invoice_items: [],
      subtotal_amount: 100,
      discount_amount: 0,
      tax_amount: 19,
      withholding_amount: 0,
      total_amount: 119,
      currency: 'COP',
      cufe: 'cufe-fake',
      notes: null,
      issue_date: new Date('2026-08-20'),
      due_date: null,
      xml_document: null,
      email_sent_at: null,
      organization_id: 6,
      store_id: 10,
      customer: { id: 200, first_name: 'Ana', last_name: 'Ríos', email: 'ana@example.com' },
      customer_name: null,
      organization: {
        id: 6, name: 'Roku', legal_name: 'ROKU SAS', tax_id: '900000000',
        phone: null, email: null, addresses: [], fiscal_scope: 'ORGANIZATION',
        document_type: null, person_type: null, organization_settings: null,
      },
      store: { id: 10, name: 'Roku Store', legal_name: null, tax_id: null, store_settings: null },
      ...overrides,
    };
  }

  function buildListenerWithMocks(invoiceRow: any) {
    const notificationsService = { createAndBroadcast: jest.fn() } as any;
    const invoicesUpdate = jest.fn().mockResolvedValue({});
    const deliveryEventsCreate = jest.fn().mockResolvedValue({});
    const globalPrisma = {
      invoices: {
        findUnique: jest.fn().mockResolvedValue(invoiceRow),
        update: invoicesUpdate,
      },
      invoice_delivery_events: { create: deliveryEventsCreate },
    } as any;
    const emailService = {
      sendEmail: jest.fn(),
      sendEmailWithAttachments: jest.fn(),
    } as any;
    const s3Service = { downloadImage: jest.fn() } as any;
    const appointmentQueueService = {} as any;
    const eventEmitter = { emit: jest.fn() } as any;

    const listener = new NotificationsEventsListener(
      notificationsService,
      globalPrisma,
      emailService,
      s3Service,
      appointmentQueueService,
      eventEmitter,
    );

    return { listener, globalPrisma, emailService, s3Service, invoicesUpdate, deliveryEventsCreate };
  }

  it('PDF no descargable + sin xml_document: NO estampa email_sent_at y deja fila status=error', async () => {
    const invoiceRow = buildInvoiceRow({ xml_document: null });
    const { listener, s3Service, emailService, invoicesUpdate, deliveryEventsCreate } =
      buildListenerWithMocks(invoiceRow);

    s3Service.downloadImage.mockRejectedValue(new Error('NoSuchKey: does-not-exist'));
    // Sin adjuntos, el handler cae a sendEmail (no sendEmailWithAttachments) y
    // el proveedor igual puede "aceptar" el envío — ese es justo el caso que
    // antes se contaba como entregado.
    emailService.sendEmail.mockResolvedValue({ success: true, messageId: 'm-1' });

    await listener.handleInvoicePdfGenerated({
      invoice_id: 501,
      pdf_key: 'invoices/does-not-exist.pdf',
    });

    expect(emailService.sendEmailWithAttachments).not.toHaveBeenCalled();
    expect(invoicesUpdate).not.toHaveBeenCalled();
    expect(deliveryEventsCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        invoice_id: 501,
        organization_id: 6,
        store_id: 10,
        channel: 'email',
        recipient: 'ana@example.com',
        zip_name: null,
        status: 'error',
        provider_error: expect.stringContaining('sin adjuntos'),
      }),
    });
  });

  it('descarga sana del PDF: estampa email_sent_at y deja fila status=sent', async () => {
    const invoiceRow = buildInvoiceRow({ xml_document: null });
    const { listener, s3Service, emailService, invoicesUpdate, deliveryEventsCreate } =
      buildListenerWithMocks(invoiceRow);

    s3Service.downloadImage.mockResolvedValue(Buffer.from('%PDF-fake'));
    emailService.sendEmailWithAttachments.mockResolvedValue({ success: true, messageId: 'm-2' });

    await listener.handleInvoicePdfGenerated({
      invoice_id: 501,
      pdf_key: 'invoices/501.pdf',
    });

    expect(emailService.sendEmailWithAttachments).toHaveBeenCalled();
    expect(invoicesUpdate).toHaveBeenCalledWith({
      where: { id: 501 },
      data: { email_sent_at: expect.any(Date) },
    });
    expect(deliveryEventsCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        invoice_id: 501,
        status: 'sent',
        provider_error: null,
      }),
    });
  });

  it('proveedor de correo falla incluso con adjunto: NO estampa y provider_error trae el motivo del proveedor', async () => {
    const invoiceRow = buildInvoiceRow({ xml_document: '<xml/>' });
    const { listener, s3Service, emailService, invoicesUpdate, deliveryEventsCreate } =
      buildListenerWithMocks(invoiceRow);

    s3Service.downloadImage.mockResolvedValue(Buffer.from('%PDF-fake'));
    emailService.sendEmailWithAttachments.mockResolvedValue({ success: false, error: 'SMTP timeout' });

    await listener.handleInvoicePdfGenerated({
      invoice_id: 501,
      pdf_key: 'invoices/501.pdf',
    });

    expect(invoicesUpdate).not.toHaveBeenCalled();
    expect(deliveryEventsCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'error', provider_error: 'SMTP timeout' }),
    });
  });
});
