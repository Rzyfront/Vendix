import { ReservationsController } from './reservations.controller';
import { BookingConfirmationService } from './booking-confirmation.service';
import { AppointmentQueueService } from './appointment-queue/appointment-queue.service';
import { RequestContextService } from '@common/context/request-context.service';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';

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

  it('getQueue without a day lets the service resolve the store day', async () => {
    const { controller, appointmentQueueService } = buildController();
    const storeIdSpy = jest
      .spyOn(RequestContextService, 'getStoreId')
      .mockReturnValue(1);
    try {
      await controller.getQueue(undefined);
      expect(appointmentQueueService.computeQueueForStore).toHaveBeenCalledWith(
        1,
        undefined,
      );
    } finally {
      storeIdSpy.mockRestore();
    }
  });

  it('GET /:id still delegates to findOne', async () => {
    const { controller, reservationsService, responseService } = buildController();
    await controller.findOne(7);
    expect(reservationsService.findOne).toHaveBeenCalledWith(7);
    expect(responseService.success).toHaveBeenCalledWith(
      { id: 1 },
      expect.any(String),
    );
  });
});

describe('ReservationsController — route order (QUI-966 S10)', () => {
  // Nest registers routes in method declaration order: a static GET path
  // declared after `@Get(':id')` (ParseIntPipe) is shadowed and answers 400.
  function getRoutesInOrder(): string[] {
    const proto = ReservationsController.prototype as any;
    return Object.getOwnPropertyNames(proto)
      .filter((name) => name !== 'constructor')
      .filter(
        (name) =>
          Reflect.getMetadata(METHOD_METADATA, proto[name]) ===
          RequestMethod.GET,
      )
      .map((name) => Reflect.getMetadata(PATH_METADATA, proto[name]));
  }

  it('declares GET queue before GET :id', () => {
    const routes = getRoutesInOrder();
    expect(routes).toContain('queue');
    expect(routes.indexOf('queue')).toBeLessThan(routes.indexOf(':id'));
  });

  it('declares no single-segment static GET path after GET :id', () => {
    const routes = getRoutesInOrder();
    const after = routes.slice(routes.indexOf(':id') + 1);
    expect(after.filter((p) => !p.includes('/') && !p.startsWith(':'))).toEqual(
      [],
    );
  });
});
