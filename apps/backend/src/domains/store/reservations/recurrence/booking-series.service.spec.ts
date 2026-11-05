import { ConflictException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { BookingSeriesService } from './booking-series.service';
import { CreateBookingSeriesDto } from './create-booking-series.dto';

jest.mock('@common/utils/store-timezone.util', () => ({
  ...jest.requireActual('@common/utils/store-timezone.util'),
  resolveStoreTimezone: jest.fn().mockResolvedValue('America/Bogota'),
}));

(RequestContextService.getContext as jest.Mock) = jest
  .fn()
  .mockReturnValue({ user_id: 7, store_id: 1, organization_id: 1 });

const baseDto = (over: Partial<CreateBookingSeriesDto> = {}): CreateBookingSeriesDto =>
  ({
    product_id: 10,
    customer_id: 5,
    frequency: 'weekly',
    interval_count: 1,
    start_date: '2026-11-02',
    start_time: '10:00',
    end_time: '12:00',
    occurrences: 3,
    ...over,
  }) as CreateBookingSeriesDto;

function build(opts: { station?: any; requiresStation?: boolean; pickStation?: jest.Mock } = {}) {
  const prisma: any = {
    products: {
      findFirst: jest.fn().mockResolvedValue({
        id: 10,
        requires_station: opts.requiresStation ?? false,
      }),
    },
    service_stations: {
      findFirst: jest.fn().mockResolvedValue(
        opts.station ?? { id: 3, booking_prepay_mode: 'none', deposit_policy: 'none' },
      ),
      findMany: jest.fn().mockResolvedValue([]),
    },
    booking_series: {
      create: jest.fn().mockResolvedValue({ id: 99 }),
      findFirst: jest.fn(),
    },
    bookings: {
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  let n = 0;
  const reservations: any = {
    create: jest.fn(async (d: any) => {
      n += 1;
      return { id: 100 + n, booking_number: `BK-${n}`, date: d.date };
    }),
    cancel: jest.fn().mockResolvedValue({}),
  };
  const availability: any = { isSlotAvailable: jest.fn().mockResolvedValue(true) };
  const coordinator: any = { pickStation: opts.pickStation ?? jest.fn().mockResolvedValue(3) };
  const service = new BookingSeriesService(prisma, reservations, availability, coordinator);
  return { service, prisma, reservations, availability, coordinator };
}

describe('BookingSeriesService', () => {
  describe('DTO', () => {
    it('rejects more than 26 occurrences', async () => {
      const dto = plainToInstance(CreateBookingSeriesDto, { ...baseDto(), occurrences: 27 });
      const errors = await validate(dto);
      expect(errors.map((e) => e.property)).toContain('occurrences');
    });
  });

  describe('preview', () => {
    it('computes weekly dates with interval 2', async () => {
      const { service } = build();
      const rows = await service.preview(baseDto({ interval_count: 2 }));
      expect(rows.map((r) => r.date)).toEqual(['2026-11-02', '2026-11-16', '2026-11-30']);
      expect(rows.every((r) => r.status === 'ok')).toBe(true);
      expect(rows.map((r) => r.index)).toEqual([0, 1, 2]);
    });

    it('keeps the next day as end_date for an overnight occurrence', async () => {
      const { service } = build();
      const rows = await service.preview(
        baseDto({ frequency: 'daily', start_time: '22:00', end_time: '02:00', occurrences: 2 }),
      );
      expect(rows[0]).toMatchObject({ date: '2026-11-02', end_date: '2026-11-03' });
      expect(rows[1]).toMatchObject({ date: '2026-11-03', end_date: '2026-11-04' });
    });

    it('reports a station conflict through the coordinator', async () => {
      const pickStation = jest.fn().mockResolvedValueOnce(3).mockResolvedValueOnce(null).mockResolvedValueOnce(3);
      const { service } = build({ requiresStation: true, pickStation });
      const rows = await service.preview(baseDto());
      expect(rows.map((r) => r.status)).toEqual(['ok', 'conflict', 'ok']);
      expect(rows[1]).toMatchObject({ code: 'STATION_002' });
    });

    it('reports a provider conflict through the availability service', async () => {
      const { service, availability } = build();
      availability.isSlotAvailable
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      const rows = await service.preview(baseDto({ provider_id: 4 }));
      expect(rows[1]).toMatchObject({ status: 'conflict', code: 'STATION_003' });
    });
  });

  describe('create', () => {
    it.each([
      ['booking_prepay_mode full', { booking_prepay_mode: 'full', deposit_policy: 'none' }],
      ['deposit_policy required', { booking_prepay_mode: 'none', deposit_policy: 'required' }],
    ])('refuses a series on a station with %s (A18)', async (_n, station) => {
      const { service, prisma, reservations } = build({ station: { id: 3, ...station }, requiresStation: true });
      await expect(service.create(baseDto({ station_id: 3 }))).rejects.toMatchObject({
        errorCode: ErrorCodes.STATION_BOOKING_001.code,
      });
      expect(prisma.booking_series.create).not.toHaveBeenCalled();
      expect(reservations.create).not.toHaveBeenCalled();
    });

    it('creates every date and tags series_id / series_index', async () => {
      const { service, prisma, reservations } = build();
      const res = await service.create(baseDto());
      expect(res.series_id).toBe(99);
      expect(res.created).toEqual([
        { index: 0, booking_id: 101, booking_number: 'BK-1', date: '2026-11-02' },
        { index: 1, booking_id: 102, booking_number: 'BK-2', date: '2026-11-09' },
        { index: 2, booking_id: 103, booking_number: 'BK-3', date: '2026-11-16' },
      ]);
      expect(res.conflicts).toEqual([]);
      expect(reservations.create).toHaveBeenCalledTimes(3);
      expect(reservations.create.mock.calls[0][0]).toMatchObject({
        product_id: 10,
        customer_id: 5,
        date: '2026-11-02',
        start_time: '10:00',
        end_time: '12:00',
      });
      expect(prisma.bookings.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 102 }, data: { series_id: 99, series_index: 1 } }),
      );
    });

    it('with skip_conflicts creates the free dates and reports the colliding ones', async () => {
      const { service, reservations } = build();
      reservations.create
        .mockResolvedValueOnce({ id: 101, booking_number: 'BK-1', date: '2026-11-02' })
        .mockRejectedValueOnce(new VendixHttpException(ErrorCodes.STATION_002))
        .mockRejectedValueOnce(new ConflictException('El horario solicitado no esta disponible'));
      const res = await service.create(baseDto());
      expect(res.created).toHaveLength(1);
      expect(res.conflicts).toEqual([
        expect.objectContaining({ index: 1, date: '2026-11-09', code: 'STATION_002' }),
        expect.objectContaining({ index: 2, date: '2026-11-16', code: 'CONFLICT' }),
      ]);
    });

    it('with skip_conflicts=false stops at the first conflict', async () => {
      const { service, reservations } = build();
      reservations.create
        .mockResolvedValueOnce({ id: 101, booking_number: 'BK-1', date: '2026-11-02' })
        .mockRejectedValueOnce(new VendixHttpException(ErrorCodes.STATION_008));
      const res = await service.create(baseDto({ skip_conflicts: false }));
      expect(reservations.create).toHaveBeenCalledTimes(2);
      expect(res.created).toHaveLength(1);
      expect(res.conflicts).toEqual([expect.objectContaining({ index: 1, code: 'STATION_008' })]);
    });

    it('rethrows an error that is not a conflict', async () => {
      const { service, reservations } = build();
      reservations.create.mockRejectedValueOnce(new Error('boom'));
      await expect(service.create(baseDto())).rejects.toThrow('boom');
    });
  });

  describe('cancelFrom', () => {
    it('cancels only index >= from and skips already closed ones', async () => {
      const { service, prisma, reservations } = build();
      prisma.booking_series.findFirst.mockResolvedValue({ id: 99 });
      prisma.bookings.findMany.mockResolvedValue([
        { id: 101, series_index: 0, status: 'pending' },
        { id: 102, series_index: 1, status: 'confirmed' },
        { id: 103, series_index: 2, status: 'cancelled' },
        { id: 104, series_index: 3, status: 'pending' },
      ]);
      const res = await service.cancelFrom(99, 1);
      expect(reservations.cancel.mock.calls.map((c: any[]) => c[0])).toEqual([102, 104]);
      expect(res).toEqual([
        { index: 1, booking_id: 102, result: 'cancelled' },
        { index: 2, booking_id: 103, result: 'skipped', status: 'cancelled' },
        { index: 3, booking_id: 104, result: 'cancelled' },
      ]);
    });
  });
});
