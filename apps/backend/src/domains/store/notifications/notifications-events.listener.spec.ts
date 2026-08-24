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
