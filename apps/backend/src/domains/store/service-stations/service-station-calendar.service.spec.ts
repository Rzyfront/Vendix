import { RequestContext, RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { ServiceStationCalendarService } from './service-station-calendar.service';

describe('ServiceStationCalendarService', () => {
  const context: RequestContext = { store_id: 17, is_super_admin: false, is_owner: false };
  let service: ServiceStationCalendarService;
  let prisma: Record<string, any>;
  let tx: Record<string, any>;

  beforeEach(() => {
    tx = {
      service_station_schedules: {
        deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    prisma = {
      service_stations: { findFirst: jest.fn().mockResolvedValue({ id: 5, time_zone: 'America/Bogota' }) },
      service_station_schedules: { findMany: jest.fn().mockResolvedValue([]) },
      service_station_exceptions: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 8 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    service = new ServiceStationCalendarService(prisma as unknown as StorePrismaService);
  });

  it('replaces weekly intervals atomically and stores wall-clock values in TIME columns', async () => {
    await RequestContextService.runIsolated(context, () => service.replaceSchedules(5, {
      schedules: [{ weekday: 1, start_time: '08:30', end_time: '12:00' }],
    }));
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
    expect(tx.service_station_schedules.deleteMany).toHaveBeenCalledWith({ where: { store_id: 17, station_id: 5 } });
    const [input] = tx.service_station_schedules.createMany.mock.calls[0];
    expect(input.data[0].start_time.toISOString()).toBe('1970-01-01T08:30:00.000Z');
  });

  it('rejects overlapping windows before writing', async () => {
    await expect(RequestContextService.runIsolated(context, () => service.replaceSchedules(5, {
      schedules: [
        { weekday: 2, start_time: '08:00', end_time: '10:00' },
        { weekday: 2, start_time: '09:30', end_time: '11:00' },
      ],
    }))).rejects.toThrow('Los horarios semanales no pueden superponerse.');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('does not delete an exception from another store or station', async () => {
    prisma.service_station_exceptions.deleteMany.mockResolvedValue({ count: 0 });
    await expect(RequestContextService.runIsolated(context, () => service.removeException(5, 44)))
      .rejects.toMatchObject({ errorCode: expect.any(String) });
    expect(prisma.service_station_exceptions.deleteMany).toHaveBeenCalledWith({
      where: { id: 44, store_id: 17, station_id: 5 },
    });
  });

  it('requires exception timestamps with explicit UTC Z and an increasing interval', async () => {
    await expect(RequestContextService.runIsolated(context, () => service.createException(5, {
      start_at: '2026-10-11T09:00:00', end_at: '2026-10-11T11:00:00',
    }))).rejects.toThrow();
    expect(prisma.service_station_exceptions.create).not.toHaveBeenCalled();
  });
});