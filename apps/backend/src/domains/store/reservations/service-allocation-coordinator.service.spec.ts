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
      service_stations: { findFirst: jest.fn().mockResolvedValue({ id: STATION_ID }), findMany: jest.fn().mockResolvedValue([]) },
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

  describe('asignación automática de estación', () => {
    const station = (id: number, openSessions: number) => ({ id, _count: { service_sessions_station_fkey: openSessions } });

    it('pickStation filtra elegibles y desempata por menos atenciones abiertas y luego id', async () => {
      const { coordinator, tx } = build();
      tx.service_stations.findMany.mockResolvedValue([station(9, 1), station(6, 0), station(4, 1), station(5, 0)]);
      const startAt = new Date('2030-01-01T10:00:00Z');
      const endAt = new Date('2030-01-01T11:00:00Z');

      await expect(coordinator.pickStation(tx, { storeId: STORE_ID, productId: 5, providerId: PROVIDER_ID, startAt, endAt })).resolves.toBe(5);

      const where = tx.service_stations.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({
        store_id: STORE_ID,
        status: 'active',
        capacity: 1,
        service_station_services_station_fkey: { some: { product_id: 5 } },
        service_station_providers_station_fkey: { some: { provider_id: PROVIDER_ID } },
        service_allocations_station_fkey: {
          none: expect.objectContaining({
            state: { in: ['held', 'payment_pending', 'confirmed', 'in_service'] },
            start_at: { lt: endAt },
            end_at: { gt: startAt },
          }),
        },
      });
    });

    it('pickStation devuelve null si no hay estación elegible', async () => {
      const { coordinator, tx } = build();
      await expect(
        coordinator.pickStation(tx, { storeId: STORE_ID, productId: 5, startAt: new Date(), endAt: new Date(Date.now() + 3600_000) }),
      ).resolves.toBeNull();
      expect(tx.service_stations.findMany.mock.calls[0][0].where.service_station_providers_station_fkey).toBeUndefined();
    });

    it('pickStation de un walk-in descarta estaciones con atención abierta o pausada y las ya intentadas', async () => {
      const { coordinator, tx } = build();
      tx.service_stations.findMany.mockResolvedValue([station(6, 0)]);
      await coordinator.pickStation(tx, {
        storeId: STORE_ID, productId: 5, startAt: new Date(), endAt: new Date(Date.now() + 3600_000), requireIdle: true, excludeStationIds: [4],
      });

      const where = tx.service_stations.findMany.mock.calls[0][0].where;
      expect(where.service_sessions_station_fkey).toEqual({ none: { status: { in: ['open', 'paused'] } } });
      expect(where.id).toEqual({ notIn: [4] });
    });

    it('pickStation de una reserva no descarta estaciones ocupadas ahora', async () => {
      const { coordinator, tx } = build();
      await expect(coordinator.allocateBooking(tx, { ...baseInput, stationId: undefined })).rejects.toMatchObject({ errorCode: 'STATION_012' });
      const where = tx.service_stations.findMany.mock.calls[0][0].where;
      expect(where.service_sessions_station_fkey).toBeUndefined();
      expect(where.id).toBeUndefined();
    });

    it('una reserva sin estación usa la estación asignada automáticamente', async () => {
      const { coordinator, tx } = build();
      tx.service_stations.findMany.mockResolvedValue([station(8, 0)]);
      const result = await coordinator.allocateBooking(tx, { ...baseInput, stationId: undefined, excludeBookingId: BOOKING_ID });

      expect(result).toMatchObject({ id: 900, station_id: 8 });
      expect(tx.service_stations.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 8 }) }));
      expect(tx.service_allocations.create).toHaveBeenCalledWith({ data: expect.objectContaining({ station_id: 8 }), select: { id: true } });
    });

    it('una reserva sin estación y sin ninguna elegible mantiene STATION_012', async () => {
      const { coordinator, tx } = build();
      await expect(coordinator.allocateBooking(tx, { ...baseInput, stationId: undefined })).rejects.toMatchObject({ errorCode: 'STATION_012' });
      expect(tx.service_allocations.create).not.toHaveBeenCalled();
    });

    it('con estación indicada no consulta la asignación automática', async () => {
      const { coordinator, tx } = build();
      await coordinator.allocateBooking(tx, { ...baseInput, excludeBookingId: BOOKING_ID });
      expect(tx.service_stations.findMany).not.toHaveBeenCalled();
    });
  });
});
