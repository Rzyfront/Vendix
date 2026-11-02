import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes } from '@common/errors/error-codes';
import * as tz from '@common/utils/store-timezone.util';
import { BookingCheckinService } from './booking-checkin.service';

/** Apps · booking (Fase 4): the guest's access to the PMS online check-in. */
describe('BookingCheckinService', () => {
  const STORE_ID = 10;
  let prisma: { lodging_reservations: { findFirst: jest.Mock } };
  let precheckin: { ensureToken: jest.Mock };
  let service: BookingCheckinService;

  const reservation = (over: Record<string, unknown> = {}) => ({
    id: 7,
    status: 'confirmed',
    departure_date: new Date('2026-11-12T00:00:00.000Z'),
    precheckin_token: null,
    precheckin_completed_at: null,
    ...over,
  });

  beforeEach(() => {
    jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(STORE_ID);
    jest.spyOn(tz, 'resolveStoreTimezone').mockResolvedValue('America/Bogota');
    jest.spyOn(tz, 'localDateString').mockReturnValue('2026-11-10');
    prisma = { lodging_reservations: { findFirst: jest.fn() } };
    precheckin = { ensureToken: jest.fn().mockResolvedValue('new-token') };
    service = new BookingCheckinService(prisma as any, precheckin as any);
  });

  afterEach(() => jest.restoreAllMocks());

  it('only reads a reservation of the logged-in customer', async () => {
    prisma.lodging_reservations.findFirst.mockResolvedValue(null);
    await expect(service.forCustomer(7, 99)).rejects.toMatchObject({
      errorCode: ErrorCodes.LODGING_BOOKING_FIND_001.code,
    });
    expect(prisma.lodging_reservations.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 7, customer_id: 99 } }),
    );
    expect(precheckin.ensureToken).not.toHaveBeenCalled();
  });

  it('creates the PMS token on first use for a confirmed stay', async () => {
    prisma.lodging_reservations.findFirst.mockResolvedValue(reservation());
    await expect(service.forCustomer(7, 99)).resolves.toEqual({
      state: 'available',
      path: '/pre-registro/new-token',
      completed_at: null,
    });
    expect(precheckin.ensureToken).toHaveBeenCalledWith(7);
  });

  it('reuses the link the desk already shared', async () => {
    prisma.lodging_reservations.findFirst.mockResolvedValue(
      reservation({ precheckin_token: 'sent-token' }),
    );
    const view = await service.forCustomer(7, 99);
    expect(view.path).toBe('/pre-registro/sent-token');
    expect(precheckin.ensureToken).not.toHaveBeenCalled();
  });

  it('gives no link while the hold is unpaid, and creates no token', async () => {
    prisma.lodging_reservations.findFirst.mockResolvedValue(reservation({ status: 'tentative' }));
    await expect(service.forCustomer(7, 99)).resolves.toEqual({
      state: 'not_confirmed',
      path: null,
      completed_at: null,
    });
    expect(precheckin.ensureToken).not.toHaveBeenCalled();
  });
});
