import { ReservationsController } from './reservations.controller';
import { BookingConfirmationService } from './booking-confirmation.service';
import { AppointmentQueueService } from './appointment-queue/appointment-queue.service';
import { RequestContextService } from '@common/context/request-context.service';
import { PERMISSIONS_KEY } from '../../auth/decorators/permissions.decorator';

describe('ReservationsController — appointment redesign endpoints (smoke)', () => {
  function buildController() {
    const reservationsService = {
      sendConfirmationRequest: jest.fn().mockResolvedValue({}),
      getQueue: jest.fn(),
      computeQueueForStore: jest.fn(),
      markArriving: jest.fn().mockResolvedValue({ id: 1, status: 'arriving' }),
      markAttending: jest.fn().mockResolvedValue({ id: 1, status: 'attending' }),
      findOne: jest.fn().mockResolvedValue({ id: 1 }),
      findOneDetail: jest.fn().mockResolvedValue({ id: 1, deposit: null }),
      decideDeposit: jest.fn().mockResolvedValue({ id: 1 }),
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

    // Segunda dependencia (ReservationsExportService, QUI-975): este smoke
    // suite no ejercita el endpoint de exportar, así que un stub basta.
    const reservationsExportService = {
      getExportRows: jest.fn(),
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

    const reservationDeposits = {
      rotateLink: jest.fn().mockResolvedValue({ payment_path: '/pagar/abc', payment_request_id: 9 }),
    } as any;

    const rentalPrepay = {
      openLink: jest.fn().mockResolvedValue({ payment_path: '/pagar/pre', payment_request_id: 12, amount: 75000, expires_at: null }),
    } as any;

    const controller = new ReservationsController(
      reservationsService,
      reservationsExportService,
      availabilityService,
      bookingConfirmationService,
      appointmentQueueService,
      responseService,
      prisma,
      reservationDeposits,
      rentalPrepay,
    );

    return { controller, rentalPrepay, reservationDeposits, reservationsService, bookingConfirmationService, appointmentQueueService, responseService };
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

  it('GET :id returns the booking detail with its deposit block', async () => {
    const { controller, reservationsService, responseService } = buildController();
    await controller.findOne(1);
    expect(reservationsService.findOneDetail).toHaveBeenCalledWith(1);
    expect(responseService.success).toHaveBeenCalledWith(
      { id: 1, deposit: null },
      expect.any(String),
    );
  });

  it('cancel without a body keeps the old call and with a body forwards leftover_action', async () => {
    const { controller, reservationsService } = buildController();
    await controller.cancel(4);
    expect(reservationsService.cancel).toHaveBeenCalledWith(4, {});
    await controller.cancel(4, { leftover_action: 'refund' });
    expect(reservationsService.cancel).toHaveBeenLastCalledWith(4, { leftover_action: 'refund' });
  });

  it('deposit-link returns the new payment_path of the pending request', async () => {
    const { controller, reservationDeposits, responseService } = buildController();
    await controller.depositLink(7);
    expect(reservationDeposits.rotateLink).toHaveBeenCalledWith(7);
    expect(responseService.success).toHaveBeenCalledWith(
      { payment_path: '/pagar/abc', payment_request_id: 9 },
      expect.any(String),
    );
  });

  it('deposit-decision delegates the decision to the service', async () => {
    const { controller, reservationsService } = buildController();
    const dto = { action: 'retain' as const, request_id: 'r1' };
    await controller.depositDecision(7, dto);
    expect(reservationsService.decideDeposit).toHaveBeenCalledWith(7, dto);
  });

  it('deposit-link and deposit-decision require store:reservations:update', () => {
    for (const handler of [
      ReservationsController.prototype.depositLink,
      ReservationsController.prototype.depositDecision,
    ]) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual(['store:reservations:update']);
    }
  });

  it('prepay-link abre el cobro para reservar y devuelve la ruta de pago', async () => {
    const { controller, rentalPrepay, responseService } = buildController();
    await controller.prepayLink(7);
    expect(rentalPrepay.openLink).toHaveBeenCalledWith(7);
    expect(responseService.success).toHaveBeenCalledWith(
      { payment_path: '/pagar/pre', payment_request_id: 12, amount: 75000, expires_at: null },
      expect.any(String),
    );
  });

  it('prepay-link requiere store:reservations:update', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, ReservationsController.prototype.prepayLink)).toEqual([
      'store:reservations:update',
    ]);
  });
});
