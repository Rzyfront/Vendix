import { BusinessHoursService } from './business-hours.service';
import { BadRequestException } from '@nestjs/common';

describe('BusinessHoursService', () => {
  function buildService(initialRows: any[] = []) {
    const prisma: any = {
      store_business_hours: {
        // Honor the `where.is_active` filter that loadStoreHours /
        // loadStoreWindows apply, so mocks return the same rows the real
        // query would (otherwise we accidentally count deactivated rows).
        findMany: jest.fn().mockImplementation(({ where }: any = {}) =>
          Promise.resolve(
            initialRows.filter((r) =>
              where?.is_active === true ? r.is_active === true : true,
            ),
          ),
        ),
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
      // loadStoreHoursFromPosSettings / loadStoreWindowsFromPosSettings
      // read from store_settings first; if absent, fall back to the
      // legacy store_business_hours table. Tests below don't exercise the
      // POS path so we mock it to return null and let the fallback run.
      store_settings: {
        findUnique: jest.fn().mockResolvedValue(null),
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

  it('upsertAll accepts a block that ends the next day (S21)', async () => {
    const { service, prisma } = buildService();
    await service.upsertAll(1, {
      items: [
        { day_of_week: 5, start_time: '18:00', end_time: '03:00', is_active: true },
      ],
    } as any);
    expect(prisma.store_business_hours.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ day_of_week: 5, start_time: '18:00', end_time: '03:00' }),
      ],
    });
  });

  it('upsertAll accepts 00:00-00:00 as 24 hours', async () => {
    const { service } = buildService();
    await expect(
      service.upsertAll(1, {
        items: [
          { day_of_week: 6, start_time: '00:00', end_time: '00:00', is_active: true },
        ],
      } as any),
    ).resolves.toBeDefined();
  });

  it('upsertAll rejects a day that overlaps the previous day overnight spill', async () => {
    const { service } = buildService();
    await expect(
      service.upsertAll(1, {
        items: [
          { day_of_week: 5, start_time: '20:00', end_time: '03:00', is_active: true },
          { day_of_week: 6, start_time: '02:00', end_time: '10:00', is_active: true },
        ],
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('upsertAll still accepts a plain daytime block', async () => {
    const { service } = buildService();
    await expect(
      service.upsertAll(1, {
        items: [
          { day_of_week: 1, start_time: '09:00', end_time: '18:00', is_active: true },
        ],
      } as any),
    ).resolves.toBeDefined();
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
    expect(map.get(1)).toEqual([{ start_time: '09:00', end_time: '18:00' }]);
    expect(map.get(0)).toBeUndefined();
  });

  describe('POS settings JSON reader (S21)', () => {
    const withPos = (business_hours: any) => {
      const built = buildService();
      built.prisma.store_settings.findUnique.mockResolvedValue({
        settings: { pos: { business_hours } },
      });
      return built.service;
    };

    it('keeps an overnight block instead of dropping it', async () => {
      const service = withPos({
        friday: { is_active: true, open: '20:00', close: '03:00' },
      });
      const windows = await service.loadStoreWindows(1);
      expect(windows.get(5)).toEqual([{ start_time: '20:00', end_time: '03:00' }]);
      const hours = await service.loadStoreHours(1);
      expect(hours.get(5)).toEqual([{ start_time: '20:00', end_time: '03:00' }]);
    });

    it('reads 24:00 as 00:00', async () => {
      const service = withPos({
        monday: { is_active: true, open: '09:00', close: '24:00' },
      });
      const windows = await service.loadStoreWindows(1);
      expect(windows.get(1)).toEqual([{ start_time: '09:00', end_time: '00:00' }]);
    });

    it('collapses daytime split blocks to the outer envelope (previous behavior)', async () => {
      const service = withPos({
        monday: {
          is_active: true,
          blocks: [
            { open: '09:00', close: '12:00' },
            { open: '14:00', close: '18:00' },
          ],
        },
      });
      const hours = await service.loadStoreHours(1);
      expect(hours.get(1)).toEqual([{ start_time: '09:00', end_time: '18:00' }]);
      const windows = await service.loadStoreWindows(1);
      expect(windows.get(1)).toHaveLength(2);
    });

    it('still skips inactive days and malformed blocks', async () => {
      const service = withPos({
        monday: { is_active: false, open: '09:00', close: '18:00' },
        tuesday: { is_active: true, open: '9', close: '18:00' },
      });
      const windows = await service.loadStoreWindows(1);
      expect(windows.size).toBe(0);
    });
  });
});