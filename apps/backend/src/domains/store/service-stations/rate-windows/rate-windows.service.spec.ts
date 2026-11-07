import { NotFoundException } from '@nestjs/common';
import { RequestContext, RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RateWindowsService } from './rate-windows.service';

describe('RateWindowsService', () => {
  const context: RequestContext = { store_id: 10, is_super_admin: false, is_owner: false };
  let service: RateWindowsService;
  let prisma: Record<string, any>;
  let tx: Record<string, any>;

  beforeEach(() => {
    tx = {
      service_station_rate_windows: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    };
    prisma = {
      service_stations: { findFirst: jest.fn().mockResolvedValue({ id: 3 }) },
      service_station_rate_windows: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
    };
    service = new RateWindowsService(prisma as unknown as StorePrismaService);
  });

  const run = <T>(fn: () => Promise<T>) => RequestContextService.runIsolated(context, fn);

  it('replaces all windows inside one transaction', async () => {
    await run(() =>
      service.setRateWindows(3, {
        windows: [
          { weekday: 6, start_time: '20:00', end_time: '23:00', block_price: 100000 },
          { weekday: 6, start_time: '08:00', end_time: '12:00', block_price: 60000, is_active: false },
        ],
      }),
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.service_station_rate_windows.deleteMany).toHaveBeenCalledWith({ where: { store_id: 10, station_id: 3 } });
    expect(tx.service_station_rate_windows.createMany).toHaveBeenCalledWith({
      data: [
        { store_id: 10, station_id: 3, weekday: 6, block_order: 0, start_time: '08:00', end_time: '12:00', block_price: 60000, is_active: false },
        { store_id: 10, station_id: 3, weekday: 6, block_order: 1, start_time: '20:00', end_time: '23:00', block_price: 100000, is_active: true },
      ],
    });
  });

  it('accepts overnight windows', async () => {
    await expect(
      run(() => service.setRateWindows(3, { windows: [{ weekday: 5, start_time: '22:00', end_time: '04:00', block_price: 150000 }] })),
    ).resolves.toBeDefined();
    expect(tx.service_station_rate_windows.createMany).toHaveBeenCalled();
  });

  it('an empty set clears the windows without createMany', async () => {
    await run(() => service.setRateWindows(3, { windows: [] }));
    expect(tx.service_station_rate_windows.deleteMany).toHaveBeenCalled();
    expect(tx.service_station_rate_windows.createMany).not.toHaveBeenCalled();
  });

  it('rejects overlapping windows (including the overnight spill) without touching data', async () => {
    await expect(
      run(() =>
        service.setRateWindows(3, {
          windows: [
            { weekday: 5, start_time: '22:00', end_time: '04:00', block_price: 1 },
            { weekday: 6, start_time: '03:00', end_time: '05:00', block_price: 1 },
          ],
        }),
      ),
    ).rejects.toMatchObject({ message: expect.stringContaining('no pueden superponerse') });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('another store station is not found (no read, no write)', async () => {
    prisma.service_stations.findFirst.mockResolvedValue(null);
    await expect(run(() => service.setRateWindows(99, { windows: [] }))).rejects.toBeInstanceOf(NotFoundException);
    await expect(run(() => service.getRateWindows(99))).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.service_stations.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 99, store_id: 10 } }));
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
