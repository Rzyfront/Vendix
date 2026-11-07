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

  const dayOf = (offset: number) => {
    const d = new Date(`${date}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + offset);
    return d;
  };
  const prevWeekday = (weekday + 6) % 7;
  const addDay = (d: string) => new Date(new Date(`${d}T00:00:00.000Z`).getTime() + 86_400_000).toISOString().slice(0, 10);

  function build(options: {
    requiresStation?: boolean;
    legacyOverlapId?: number;
    legacyRows?: any[];
    duration?: number;
    station?: Record<string, unknown>;
    daily?: { start_time: string; end_time: string };
    dailyWeekday?: number;
    storeDaily?: { start_time: string; end_time: string } | null;
    stationRows?: any[];
  } = {}) {
    const { requiresStation = true, legacyOverlapId = BOOKING_ID, duration = 60 } = options;
    const dailyWeekday = options.dailyWeekday ?? weekday;
    const daily = options.daily ?? { start_time: '08:00', end_time: '18:00' };
    const tx: any = {
      products: {
        findFirst: jest.fn().mockResolvedValue({
          id: 5,
          product_type: 'service',
          requires_station: requiresStation,
          booking_mode: 'provider_required',
          buffer_minutes: 0,
          service_duration_minutes: duration,
        }),
      },
      service_stations: { findFirst: jest.fn().mockResolvedValue({ id: STATION_ID, ...options.station }), findMany: jest.fn().mockResolvedValue([]) },
      service_station_services: { findFirst: jest.fn().mockResolvedValue({ id: 1 }) },
      service_station_providers: { findFirst: jest.fn().mockResolvedValue({ id: 1 }) },
      provider_services: { findFirst: jest.fn().mockResolvedValue({ id: 1 }) },
      service_providers: { findFirst: jest.fn().mockResolvedValue({ id: PROVIDER_ID }) },
      product_variants: { findFirst: jest.fn() },
      service_station_schedules: {
        findMany: jest.fn().mockResolvedValue(options.stationRows ?? [{ weekday: dailyWeekday, ...daily }]),
      },
      service_station_exceptions: { findMany: jest.fn().mockResolvedValue([]) },
      store_settings: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      provider_schedules: {
        findMany: jest.fn().mockResolvedValue([{ day_of_week: dailyWeekday, ...daily }]),
      },
      provider_exceptions: { findMany: jest.fn().mockResolvedValue([]) },
      service_allocations: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 900 }),
      },
      bookings: {
        // Emulates the DB: the legacy booking is only returned when it is not excluded.
        findMany: jest.fn(({ where }: any) => {
          const excluded = where?.id?.not;
          if (excluded === legacyOverlapId) return Promise.resolve([]);
          return Promise.resolve(options.legacyRows ?? [{ date: dayOf(0), end_date: null, start_time: '10:00', end_time: '11:00' }]);
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
        .mockResolvedValue(
          options.storeDaily === null
            ? new Map()
            : new Map([[dailyWeekday, [options.storeDaily ?? daily]]]),
        ),
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
    const where = tx.bookings.findMany.mock.calls[0][0].where;
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
    expect(tx.bookings.findMany).not.toHaveBeenCalled();
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

    describe('estación preferida del proveedor (S10, D3)', () => {
      const withPreferred = (preferredId: number | null) => {
        const ctx = build();
        ctx.tx.service_providers.findFirst.mockResolvedValue({ id: PROVIDER_ID, default_station_id: preferredId });
        return ctx;
      };

      it('usa la estación preferida del proveedor antes que la asignación automática, con los mismos filtros', async () => {
        const { coordinator, tx } = withPreferred(8);
        tx.service_stations.findFirst.mockResolvedValue({ id: 8 });
        tx.service_stations.findMany.mockResolvedValue([station(4, 0)]);
        const result = await coordinator.allocateBooking(tx, { ...baseInput, stationId: undefined, excludeBookingId: BOOKING_ID });

        expect(result).toMatchObject({ id: 900, station_id: 8, provider_id: PROVIDER_ID });
        expect(tx.service_stations.findMany).not.toHaveBeenCalled();
        const where = tx.service_stations.findFirst.mock.calls[0][0].where;
        expect(where).toMatchObject({
          id: 8,
          store_id: STORE_ID,
          status: 'active',
          capacity: 1,
          service_station_services_station_fkey: { some: { product_id: 5 } },
          service_station_providers_station_fkey: { some: { provider_id: PROVIDER_ID } },
          service_allocations_station_fkey: { none: expect.objectContaining({ start_at: expect.any(Object), end_at: expect.any(Object) }) },
        });
        expect(tx.service_allocations.create).toHaveBeenCalledWith({ data: expect.objectContaining({ station_id: 8 }), select: { id: true } });
      });

      it('cae a la asignación automática cuando la preferida no sirve (no presta el servicio u ocupada)', async () => {
        const { coordinator, tx } = withPreferred(8);
        tx.service_stations.findFirst.mockResolvedValueOnce(null);
        tx.service_stations.findMany.mockResolvedValue([station(4, 0)]);
        const result = await coordinator.allocateBooking(tx, { ...baseInput, stationId: undefined, excludeBookingId: BOOKING_ID });

        expect(result).toMatchObject({ id: 900, station_id: 4 });
        expect(tx.service_stations.findMany).toHaveBeenCalledTimes(1);
      });

      it('sin estación preferida el comportamiento no cambia', async () => {
        const { coordinator, tx } = withPreferred(null);
        tx.service_stations.findMany.mockResolvedValue([station(4, 0)]);
        const result = await coordinator.allocateBooking(tx, { ...baseInput, stationId: undefined, excludeBookingId: BOOKING_ID });

        expect(result).toMatchObject({ station_id: 4 });
        // Only the later station load uses findFirst; no preference probe.
        expect(tx.service_stations.findFirst).toHaveBeenCalledTimes(1);
      });

      it('con estación indicada la preferida del proveedor se ignora', async () => {
        const { coordinator, tx } = withPreferred(8);
        const result = await coordinator.allocateBooking(tx, { ...baseInput, excludeBookingId: BOOKING_ID });
        expect(result).toMatchObject({ station_id: STATION_ID });
      });
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

  describe('horarios nocturnos (S21)', () => {
    const overnight = { start_time: '20:00', end_time: '03:00' };
    const noLegacy = { legacyRows: [] };

    it('allocates 23:00-01:00 as one interval that crosses midnight', async () => {
      const { coordinator, tx } = build({ ...noLegacy, daily: overnight, duration: 120 });
      const result = await coordinator.allocateBooking(tx, { ...baseInput, startTime: '23:00', endTime: '01:00' });

      expect(result).toMatchObject({ id: 900, end_time: '01:00', end_date: addDay(date), is_open_ended: false });
      const data = tx.service_allocations.create.mock.calls[0][0].data;
      expect(data.end_at.getTime() - data.start_at.getTime()).toBe(120 * 60_000);
    });

    it('accepts a 01:00 start covered by the previous weekday overnight block', async () => {
      const { coordinator, tx } = build({ ...noLegacy, daily: overnight, dailyWeekday: prevWeekday });
      const result = await coordinator.allocateBooking(tx, { ...baseInput, startTime: '01:00', endTime: '02:00' });

      expect(result).toMatchObject({ id: 900, end_date: null });
    });

    it('rejects a booking that runs past the overnight block close with STATION_016', async () => {
      const { coordinator, tx } = build({ ...noLegacy, daily: overnight });
      await expect(
        coordinator.allocateBooking(tx, { ...baseInput, startTime: '23:00', endTime: '04:00', endDate: addDay(date) }),
      ).rejects.toMatchObject({ errorCode: 'STATION_009' });
      await expect(
        coordinator.allocateBooking(tx, { ...baseInput, startTime: '02:30', endTime: '03:30' }),
      ).rejects.toMatchObject({ errorCode: 'STATION_016' });
      expect(tx.service_allocations.create).not.toHaveBeenCalled();
    });

    describe('el horario propio de la estación manda (S8, D2)', () => {
      const stationNight = { start_time: '22:00', end_time: '02:00' };
      const storeCloses2359 = { start_time: '08:00', end_time: '23:59' };

      it('allows 22:00-01:00 on a station with its own overnight schedule although the store closes 23:59', async () => {
        const { coordinator, tx } = build({ ...noLegacy, daily: stationNight, storeDaily: storeCloses2359, duration: 180 });
        const result = await coordinator.allocateBooking(tx, { ...baseInput, startTime: '22:00', endTime: '01:00' });

        expect(result).toMatchObject({ id: 900, end_time: '01:00', end_date: addDay(date) });
        expect(tx.service_allocations.create).toHaveBeenCalledTimes(1);
      });

      it('a station with its own schedule is bookable at night even when the store never configured hours (legacy 08-18 does not apply)', async () => {
        const { coordinator, tx } = build({ ...noLegacy, daily: stationNight, storeDaily: null, duration: 180 });
        const result = await coordinator.allocateBooking(tx, { ...baseInput, startTime: '22:00', endTime: '01:00' });

        expect(result).toMatchObject({ id: 900, end_time: '01:00', end_date: addDay(date) });
        expect(tx.service_allocations.create).toHaveBeenCalledTimes(1);
      });

      it('a station without its own schedule is out of hours: STATION_016, never STATION_002', async () => {
        const { coordinator, tx } = build({ ...noLegacy, daily: stationNight, storeDaily: storeCloses2359, duration: 180, stationRows: [] });
        await expect(
          coordinator.allocateBooking(tx, { ...baseInput, startTime: '22:00', endTime: '01:00' }),
        ).rejects.toMatchObject({ errorCode: 'STATION_016' });
        expect(tx.service_allocations.create).not.toHaveBeenCalled();
      });

      it('outside the station schedule answers STATION_016', async () => {
        const { coordinator, tx } = build({ ...noLegacy, daily: stationNight, storeDaily: storeCloses2359, duration: 60 });
        await expect(
          coordinator.allocateBooking(tx, { ...baseInput, startTime: '12:00', endTime: '13:00' }),
        ).rejects.toMatchObject({ errorCode: 'STATION_016' });
      });

      it('a station exception inside the booking answers STATION_016', async () => {
        const { coordinator, tx } = build({ ...noLegacy });
        tx.service_station_exceptions.findMany.mockResolvedValue([{ id: 1 }]);
        await expect(coordinator.allocateBooking(tx, baseInput)).rejects.toMatchObject({ errorCode: 'STATION_016' });
      });

      it('a real overlap still answers STATION_002', async () => {
        const { coordinator, tx } = build({ ...noLegacy });
        tx.service_allocations.findMany.mockResolvedValue([{ station_id: STATION_ID, provider_id: null }]);
        await expect(coordinator.allocateBooking(tx, baseInput)).rejects.toMatchObject({ errorCode: 'STATION_002' });
      });

      it('a normal daytime booking is unchanged', async () => {
        const { coordinator, tx } = build({ ...noLegacy });
        await expect(coordinator.allocateBooking(tx, baseInput)).resolves.toMatchObject({ id: 900, end_date: null });
      });
    });

    it('keeps rejecting a daytime booking that exceeds the window', async () => {
      const { coordinator, tx } = build(noLegacy);
      await expect(
        coordinator.allocateBooking(tx, { ...baseInput, startTime: '17:30', endTime: '18:30' }),
      ).rejects.toMatchObject({ errorCode: 'STATION_016' });
    });

    it('free duration mode accepts multiples of the rental block only', async () => {
      const station = { booking_duration_mode: 'free', rental_block_minutes: 30 };
      const ok = build({ ...noLegacy, station });
      await expect(ok.coordinator.allocateBooking(ok.tx, { ...baseInput, startTime: '10:00', endTime: '11:30' })).resolves.toMatchObject({ id: 900 });
      const bad = build({ ...noLegacy, station });
      await expect(bad.coordinator.allocateBooking(bad.tx, { ...baseInput, startTime: '10:00', endTime: '10:45' })).rejects.toMatchObject({ errorCode: 'STATION_009' });
    });

    it('open-ended booking ends after open_end_block_minutes', async () => {
      const { coordinator, tx } = build({ ...noLegacy, station: { open_end_block_minutes: 120 } });
      const result = await coordinator.allocateBooking(tx, { ...baseInput, endTime: undefined, isOpenEnded: true });

      expect(result).toMatchObject({ end_time: '12:00', end_date: null, is_open_ended: true });
      expect(tx.bookings.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { service_allocation_id: 900, end_time: '12:00', end_date: null, is_open_ended: true } }),
      );
    });

    it('open-ended booking is capped at the station close, also across midnight', async () => {
      const day = build({ ...noLegacy, station: { open_end_block_minutes: 360 } });
      await expect(day.coordinator.allocateBooking(day.tx, { ...baseInput, startTime: '17:00', endTime: undefined, isOpenEnded: true }))
        .resolves.toMatchObject({ end_time: '18:00', end_date: null });
      const night = build({ ...noLegacy, daily: overnight, station: { open_end_block_minutes: 360 } });
      await expect(night.coordinator.allocateBooking(night.tx, { ...baseInput, startTime: '23:00', endTime: undefined, isOpenEnded: true }))
        .resolves.toMatchObject({ end_time: '03:00', end_date: addDay(date), is_open_ended: true });
    });

    it('a legacy overnight booking from the previous day blocks the provider with STATION_003', async () => {
      const { coordinator, tx } = build({
        daily: overnight,
        dailyWeekday: prevWeekday,
        legacyRows: [{ date: dayOf(-1), end_date: null, start_time: '22:00', end_time: '02:00' }],
      });
      await expect(coordinator.allocateBooking(tx, { ...baseInput, startTime: '01:00', endTime: '02:00' })).rejects.toMatchObject({ errorCode: 'STATION_003' });
    });
  });
});
