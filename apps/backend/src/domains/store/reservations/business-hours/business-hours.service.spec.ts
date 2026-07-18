import { BusinessHoursService } from './business-hours.service';
import { BadRequestException } from '@nestjs/common';

describe('BusinessHoursService', () => {
  function buildService(initialRows: any[] = []) {
    const prisma: any = {
      store_business_hours: {
        findMany: jest.fn().mockResolvedValue(initialRows),
        findFirst: jest
          .fn()
          .mockImplementation(({ where }: any) =>
            Promise.resolve(
              initialRows.find(
                (r) =>
                  r.store_id === where.store_id &&
                  r.day_of_week === where.day_of_week,
              ) ?? null,
            ),
          ),
        deleteMany: jest.fn().mockResolvedValue({ count: initialRows.length }),
        createMany: jest.fn().mockResolvedValue({ count: initialRows.length }),
      },
      $transaction: jest.fn(async (cb: any) => {
        // Eagerly evaluate the callback with a passthrough tx.
        const tx = {
          store_business_hours: {
            deleteMany: prisma.store_business_hours.deleteMany,
            createMany: prisma.store_business_hours.createMany,
          },
        };
        return cb(tx);
      }),
    };

    return {
      service: new BusinessHoursService(prisma),
      prisma,
    };
  }

  it('getAllForStore returns 7 entries with nulls for missing days', async () => {
    const { service } = buildService([
      {
        day_of_week: 1,
        start_time: '09:00',
        end_time: '18:00',
        is_active: true,
        store_id: 1,
      },
    ]);
    const result = await service.getAllForStore(1);
    expect(result).toHaveLength(7);
    expect(result[0]).toEqual({
      day_of_week: 0,
      start_time: null,
      end_time: null,
      is_active: false,
    });
    expect(result[1]).toEqual({
      day_of_week: 1,
      start_time: '09:00',
      end_time: '18:00',
      is_active: true,
    });
  });

  it('upsertAll rejects invalid HH:mm windows where end <= start', async () => {
    const { service } = buildService();
    await expect(
      service.upsertAll(1, {
        items: [
          { day_of_week: 1, start_time: '18:00', end_time: '09:00', is_active: true },
        ],
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('upsertAll rejects duplicate day_of_week in the same payload', async () => {
    const { service } = buildService();
    await expect(
      service.upsertAll(1, {
        items: [
          { day_of_week: 1, start_time: '09:00', end_time: '18:00', is_active: true },
          { day_of_week: 1, start_time: '10:00', end_time: '12:00', is_active: true },
        ],
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('loadStoreHours returns a Map keyed by day_of_week with only active rows', async () => {
    const rows = [
      { day_of_week: 0, start_time: '10:00', end_time: '14:00', is_active: false },
      { day_of_week: 1, start_time: '09:00', end_time: '18:00', is_active: true },
    ];
    const { service } = buildService(rows);
    const map = await service.loadStoreHours(1);
    expect(map.size).toBe(1);
    expect(map.get(1)).toEqual({ start_time: '09:00', end_time: '18:00' });
    expect(map.get(0)).toBeUndefined();
  });
});