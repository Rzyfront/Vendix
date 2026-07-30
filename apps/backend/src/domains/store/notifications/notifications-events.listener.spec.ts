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

    const listener = new NotificationsEventsListener(
      notificationsService,
      globalPrisma,
      emailService,
      s3Service,
      appointmentQueueService,
    );

    return {
      listener,
      notificationsService,
      appointmentQueueService,
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
});