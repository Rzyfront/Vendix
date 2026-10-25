import { VendixHttpException } from '../../../common/errors';
import { ServiceAllocationCoordinator } from './service-allocation-coordinator.service';

describe('ServiceAllocationCoordinator.allocateBooking', () => {
  const STORE_ID = 1;
  const PROVIDER_ID = 7;
  const STATION_ID = 3;
  const BOOKING_ID = 100;

  // Future date (UTC midnight, 21 days ahead) so `startAt <= now` never trips.
  const target = new Date();
  target.setUTCDate(target.getUTCDate() + 21);
  const date = target.toISOString().slice(0, 10);
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();

  function build(options: { requiresStation?: boolean; legacyOverlapId?: number } = {}) {
    const { requiresStation = true, legacyOverlapId = BOOKING_ID } = options;
    const tx: any = {
      products: {
        findFirst: jest.fn().mockResolvedValue({
          id: 5,
          product_type: 'service',
          requires_station: requiresStation,
          booking_mode: 'provider_required',
          buffer_minutes: 0,
          service_duration_minutes: 60,
        }),
      },
      service_stations: { findFirst: jest.fn().mockResolvedValue({ id: STATION_ID }) },
      service_station_services: { findFirst: jest.fn().mockResolvedValue({ id: 1 }) },
      service_station_providers: { findFirst: jest.fn().mockResolvedValue({ id: 1 }) },
      provider_services: { findFirst: jest.fn().mockResolvedValue({ id: 1 }) },
      service_providers: { findFirst: jest.fn().mockResolvedValue({ id: PROVIDER_ID }) },
      product_variants: { findFirst: jest.fn() },
      service_station_schedules: {
        findMany: jest.fn().mockResolvedValue([{ start_time: '08:00', end_time: '18:00' }]),
      },
      service_station_exceptions: { findMany: jest.fn().mockResolvedValue([]) },
      store_settings: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      provider_schedules: {
        findMany: jest.fn().mockResolvedValue([{ start_time: '08:00', end_time: '18:00' }]),
      },
      provider_exceptions: { findFirst: jest.fn().mockResolvedValue(null) },
      service_allocations: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 900 }),
      },
      bookings: {
        // Emulates the DB: the legacy booking is only returned when it is not excluded.
        findFirst: jest.fn(({ where }: any) => {
          const excluded = where?.id?.not;
          return Promise.resolve(excluded === legacyOverlapId ? null : { id: legacyOverlapId });
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma: any = {
      store_settings: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const businessHours: any = {
      loadStoreWindows: jest
        .fn()
        .mockResolvedValue(new Map([[weekday, [{ start_time: '08:00', end_time: '18:00' }]]])),
    };
    const coordinator = new ServiceAllocationCoordinator(prisma, businessHours);
    return { coordinator, tx };
  }

  const baseInput = {
    storeId: STORE_ID,
    bookingId: BOOKING_ID,
    productId: 5,
    stationId: STATION_ID,
    providerId: PROVIDER_ID,
    date,
    startTime: '10:00',
    endTime: '11:00',
  };

  it('does not throw when excludeBookingId matches the overlapping legacy booking', async () => {
    const { coordinator, tx } = build();
    const result = await coordinator.allocateBooking(tx, { ...baseInput, excludeBookingId: BOOKING_ID });

    expect(result).toMatchObject({ id: 900, station_id: STATION_ID, provider_id: PROVIDER_ID });
    const where = tx.bookings.findFirst.mock.calls[0][0].where;
    expect(where.store_id).toBe(STORE_ID);
    expect(where.id).toEqual({ not: BOOKING_ID });
    expect(tx.bookings.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: BOOKING_ID, store_id: STORE_ID },
        data: { service_allocation_id: 900 },
      }),
    );
  });

  it('throws STATION_003 when the legacy overlap is not excluded', async () => {
    const { coordinator, tx } = build();
    const promise = coordinator.allocateBooking(tx, baseInput);

    await expect(promise).rejects.toBeInstanceOf(VendixHttpException);
    await expect(promise).rejects.toMatchObject({
      errorCode: 'STATION_003',
    });
    expect(tx.service_allocations.create).not.toHaveBeenCalled();
  });

  it('returns null when the product does not require a station', async () => {
    const { coordinator, tx } = build({ requiresStation: false });
    const result = await coordinator.allocateBooking(tx, baseInput);

    expect(result).toBeNull();
    expect(tx.service_stations.findFirst).not.toHaveBeenCalled();
    expect(tx.service_allocations.create).not.toHaveBeenCalled();
    expect(tx.bookings.findFirst).not.toHaveBeenCalled();
  });
});
