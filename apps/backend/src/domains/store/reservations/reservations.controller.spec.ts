import { ReservationsController } from './reservations.controller';
import { BookingConfirmationService } from './booking-confirmation.service';
import { AppointmentQueueService } from './appointment-queue/appointment-queue.service';
import { RequestContextService } from '@common/context/request-context.service';

describe('ReservationsController — appointment redesign endpoints (smoke)', () => {
  function buildController() {
    const reservationsService = {
      sendConfirmationRequest: jest.fn().mockResolvedValue({}),
      getQueue: jest.fn(),
      computeQueueForStore: jest.fn(),
      markArriving: jest.fn().mockResolvedValue({ id: 1, status: 'arriving' }),
      markAttending: jest.fn().mockResolvedValue({ id: 1, status: 'attending' }),
      findOne: jest.fn().mockResolvedValue({ id: 1 }),
      assignTable: jest.fn(),
      seatBooking: jest.fn(),
      reschedule: jest.fn(),
      findAll: jest.fn(),
      getStats: jest.fn(),
      getToday: jest.fn(),
      getCalendar: jest.fn(),
      create: jest.fn(),
      confirm: jest.fn(),
      start: jest.fn(),
      cancel: jest.fn(),
      complete: jest.fn(),
      noShow: jest.fn(),
      checkIn: jest.fn().mockResolvedValue({ id: 1 }),
      update: jest.fn(),
    } as any;

    const availabilityService = {
      getAvailableSlots: jest.fn(),
    } as any;

    const bookingConfirmationService = {
      sendConfirmationRequest: jest.fn().mockResolvedValue({ expires_at: 'x' }),
      processToken: jest.fn(),
    } as any;

    const appointmentQueueService = {
      computeQueueForStore: jest.fn().mockResolvedValue([]),
      refreshAndBroadcastQueue: jest.fn(),
    } as any;

    const responseService = {
      success: jest.fn((data: any, _msg: string) => ({ success: true, data })),
      created: jest.fn((data: any, _msg: string) => ({ success: true, data })),
    } as any;

    // Sexta dependencia (StorePrismaService): ningún test de este smoke suite
    // ejercita los métodos que la usan (`booking_reschedule_requests.*`), así
    // que un stub vacío basta para satisfacer el constructor real.
    const prisma = {} as any;

    const controller = new ReservationsController(
      reservationsService,
      availabilityService,
      bookingConfirmationService,
      appointmentQueueService,
      responseService,
      prisma,
    );

    return { controller, reservationsService, bookingConfirmationService, appointmentQueueService, responseService };
  }

  it('markArriving delegates to the service and wraps the response', async () => {
    const { controller, reservationsService, responseService } = buildController();
    const dto = { source: 'staff' as const };
    // Empty body — controller does not need it.
    void dto;
    await controller.markArriving(1);
    expect(reservationsService.markArriving).toHaveBeenCalledWith(1);
    expect(responseService.success).toHaveBeenCalledWith(
      { id: 1, status: 'arriving' },
      expect.stringContaining('arriving'),
    );
  });

  it('markAttending delegates to the service', async () => {
    const { controller, reservationsService } = buildController();
    await controller.markAttending(1);
    expect(reservationsService.markAttending).toHaveBeenCalledWith(1);
  });

  it('sendConfirmation delegates to BookingConfirmationService.sendConfirmationRequest', async () => {
    const { controller, bookingConfirmationService } = buildController();
    await controller.sendConfirmation(99, { source: 'staff' } as any);
    expect(bookingConfirmationService.sendConfirmationRequest).toHaveBeenCalledWith(
      99,
      'staff',
    );
  });

  it('checkIn returns success', async () => {
    const { controller, reservationsService, responseService } = buildController();
    await controller.checkIn(1);
    expect(reservationsService.checkIn).toHaveBeenCalledWith(1, 'staff');
    expect(responseService.success).toHaveBeenCalled();
  });

  it('getQueue delegates to AppointmentQueueService.computeQueueForStore', async () => {
    const { controller, appointmentQueueService } = buildController();
    // F-159: al añadirse `prisma = {}` como sexta dependencia del constructor,
    // el test dejó de morir ahí y llegó de verdad al guardia de contexto de
    // `getQueue` (reservations.controller.ts:512-517), que exige un
    // `store_id` real. Sin estubar `getStoreId()` el handler bajo prueba
    // nunca se ejercita — revienta antes en el guardia.
    const storeIdSpy = jest
      .spyOn(RequestContextService, 'getStoreId')
      .mockReturnValue(1);
    try {
      await controller.getQueue('2026-07-18');
      expect(appointmentQueueService.computeQueueForStore).toHaveBeenCalledWith(
        1,
        '2026-07-18',
      );
    } finally {
      storeIdSpy.mockRestore();
    }
  });
});