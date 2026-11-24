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
        update: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({}),
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

  /** Mocks `store_settings.settings` so reads and writes go through the JSON. */
  function withSettings(settings: any, initialRows: any[] = []) {
    const built = buildService(initialRows);
    built.prisma.store_settings.findUnique.mockResolvedValue(settings ? { settings } : null);
    return built;
  }
  const writtenPos = (prisma: any) => {
    const call = prisma.store_settings.update.mock.calls[0]?.[0] ?? prisma.store_settings.create.mock.calls[0]?.[0];
    return (call.data.settings as any).pos;
  };

  it('getAllForStore returns 7 entries, falling back to the legacy table without POS hours', async () => {
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
      is_24h: false,
      blocks: [],
    });
    expect(result[1]).toEqual({
      day_of_week: 1,
      start_time: '09:00',
      end_time: '18:00',
      is_active: true,
      is_24h: false,
      blocks: [{ start_time: '09:00', end_time: '18:00' }],
    });
  });

  it('getAllForStore reads the same POS hours the booking uses (one source)', async () => {
    const { service } = withSettings(
      {
        pos: {
          business_hours: {
            monday: { open: '17:00', close: '04:00' },
            tuesday: { open: '00:00', close: '00:00' },
            sunday: { open: 'closed', close: 'closed' },
          },
        },
      },
      // The legacy table disagrees: it must be ignored when POS hours exist.
      [{ day_of_week: 1, start_time: '08:00', end_time: '12:00', is_active: true, store_id: 1 }],
    );
    const result = await service.getAllForStore(1);
    expect(result[1]).toMatchObject({ start_time: '17:00', end_time: '04:00', is_active: true, is_24h: false });
    expect(result[2]).toMatchObject({ start_time: '00:00', end_time: '00:00', is_active: true, is_24h: true });
    expect(result[0]).toMatchObject({ is_active: false, blocks: [] });
  });

  it('upsertAll writes pos.business_hours, keeps other days and settings, and never touches the legacy table', async () => {
    const { service, prisma } = withSettings({
      general: { timezone: 'America/Bogota' },
      pos: {
        enable_schedule_validation: true,
        business_hours: {
          monday: { open: '09:00', close: '19:00' },
          friday: { open: '09:00', close: '20:00' },
        },
      },
    });
    await service.upsertAll(1, {
      items: [
        { day_of_week: 1, start_time: '17:00', end_time: '04:00', is_active: true },
        { day_of_week: 0, start_time: '09:00', end_time: '12:00', is_active: false },
      ],
    } as any);
    const call = prisma.store_settings.update.mock.calls[0][0];
    expect(call.where).toEqual({ store_id: 1 });
    expect(call.data.settings.general).toEqual({ timezone: 'America/Bogota' });
    const pos = writtenPos(prisma);
    expect(pos.enable_schedule_validation).toBe(true);
    expect(pos.business_hours.monday).toEqual({ open: '17:00', close: '04:00' });
    expect(pos.business_hours.sunday).toEqual({ open: 'closed', close: 'closed' });
    expect(pos.business_hours.friday).toEqual({ open: '09:00', close: '20:00' });
    expect(pos.schedule_mode).toBe('continuous');
    expect(prisma.store_business_hours.createMany).not.toHaveBeenCalled();
    expect(prisma.store_business_hours.deleteMany).not.toHaveBeenCalled();
  });

  it('upsertAll copies the legacy table days first so a store without POS hours loses none', async () => {
    const { service, prisma } = withSettings({ general: {} }, [
      { day_of_week: 3, start_time: '10:00', end_time: '16:00', is_active: true, store_id: 1 },
    ]);
    await service.upsertAll(1, {
      items: [{ day_of_week: 1, start_time: '09:00', end_time: '18:00', is_active: true }],
    } as any);
    const pos = writtenPos(prisma);
    expect(pos.business_hours.wednesday).toEqual({ open: '10:00', close: '16:00' });
    expect(pos.business_hours.monday).toEqual({ open: '09:00', close: '18:00' });
    expect(pos.business_hours.sunday).toEqual({ open: 'closed', close: 'closed' });
  });

  it('upsertAll with a split shift switches to custom mode and gives every day its blocks', async () => {
    const { service, prisma } = withSettings({
      pos: {
        schedule_mode: 'continuous',
        business_hours: {
          tuesday: { open: '09:00', close: '19:00' },
          sunday: { open: 'closed', close: 'closed' },
        },
      },
    });
    await service.upsertAll(1, {
      items: [
        {
          day_of_week: 1,
          start_time: '08:00',
          end_time: '18:00',
          is_active: true,
          blocks: [
            { start_time: '14:00', end_time: '18:00' },
            { start_time: '08:00', end_time: '12:00' },
          ],
        },
      ],
    } as any);
    const pos = writtenPos(prisma);
    expect(pos.schedule_mode).toBe('custom');
    expect(pos.business_hours.monday).toEqual({
      open: '08:00',
      close: '18:00',
      blocks: [
        { open: '08:00', close: '12:00' },
        { open: '14:00', close: '18:00' },
      ],
    });
    expect(pos.business_hours.tuesday.blocks).toEqual([{ open: '09:00', close: '19:00' }]);
    expect(pos.business_hours.sunday).toEqual({ open: 'closed', close: 'closed', blocks: [] });
  });

  it('upsertAll creates the settings row with defaults when the store has none', async () => {
    const { service, prisma } = buildService();
    await service.upsertAll(1, {
      items: [{ day_of_week: 6, start_time: '00:00', end_time: '00:00', is_active: true }],
    } as any);
    expect(prisma.store_settings.update).not.toHaveBeenCalled();
    const call = prisma.store_settings.create.mock.calls[0][0];
    expect(call.data.store_id).toBe(1);
    expect(call.data.settings.pos.business_hours.saturday).toEqual({ open: '00:00', close: '00:00' });
  });

  it('upsertAll accepts a block that ends the next day (S21)', async () => {
    const { service, prisma } = buildService();
    await service.upsertAll(1, {
      items: [
        { day_of_week: 5, start_time: '18:00', end_time: '03:00', is_active: true },
      ],
    } as any);
    expect(writtenPos(prisma).business_hours.friday).toEqual({ open: '18:00', close: '03:00' });
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

  it('upsertAll rejects a zero-length block other than 00:00-00:00', async () => {
    const { service, prisma } = buildService();
    await expect(
      service.upsertAll(1, {
        items: [{ day_of_week: 2, start_time: '09:00', end_time: '09:00', is_active: true }],
      } as any),
    ).rejects.toThrow('usa 00:00 a 00:00');
    expect(prisma.store_settings.update).not.toHaveBeenCalled();
    expect(prisma.store_settings.create).not.toHaveBeenCalled();
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

  it('upsertAll rejects a sent day that overlaps the SAVED previous day overnight spill', async () => {
    const { service, prisma } = withSettings({
      pos: { business_hours: { monday: { open: '17:00', close: '04:00' } } },
    });
    await expect(
      service.upsertAll(1, {
        items: [{ day_of_week: 2, start_time: '03:00', end_time: '12:00', is_active: true }],
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.store_settings.update).not.toHaveBeenCalled();
  });

  it('upsertAll rejects a sent overnight block that spills over the SAVED next day', async () => {
    const { service, prisma } = withSettings({
      pos: { business_hours: { tuesday: { open: '02:00', close: '10:00' } } },
    });
    await expect(
      service.upsertAll(1, {
        items: [{ day_of_week: 1, start_time: '20:00', end_time: '03:00', is_active: true }],
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.store_settings.update).not.toHaveBeenCalled();
  });

  it('upsertAll does not block an edit because of an old problem among days not sent', async () => {
    const { service, prisma } = withSettings({
      pos: {
        business_hours: {
          friday: { open: '20:00', close: '03:00' },
          saturday: { open: '02:00', close: '10:00' },
        },
      },
    });
    await service.upsertAll(1, {
      items: [{ day_of_week: 1, start_time: '09:00', end_time: '17:00', is_active: true }],
    } as any);
    expect(writtenPos(prisma).business_hours.monday).toEqual({ open: '09:00', close: '17:00' });
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


  describe('loadProviderBlocks — one reader of the provider week (Parte 1)', () => {
    function build(opts: { providers: any[]; schedules?: any[]; businessHours?: any }) {
      const prisma: any = {
        service_providers: { findMany: jest.fn().mockResolvedValue(opts.providers) },
        provider_schedules: {
          findMany: jest.fn(({ where }: any) =>
            Promise.resolve(
              (opts.schedules ?? []).filter(
                (r) => where.provider_id.in.includes(r.provider_id) && r.is_active === where.is_active,
              ),
            ),
          ),
        },
        store_settings: {
          findUnique: jest.fn().mockResolvedValue(
            opts.businessHours ? { settings: { pos: { business_hours: opts.businessHours } } } : null,
          ),
        },
        store_business_hours: { findMany: jest.fn().mockResolvedValue([]) },
      };
      return { service: new BusinessHoursService(prisma), prisma };
    }
    const nightWeek = {
      friday: { open: '17:00', close: '04:00' },
      saturday: { open: '00:00', close: '00:00' },
      sunday: 'closed',
    };

    it('gives the store blocks, marked inherited, to a provider that works the store hours', async () => {
      const { service, prisma } = build({
        providers: [{ id: 5, store_id: 1, uses_store_hours: true }],
        schedules: [{ provider_id: 5, day_of_week: 1, block_order: 0, start_time: '08:00', end_time: '12:00', is_active: true }],
        businessHours: nightWeek,
      });
      const blocks = await service.loadProviderBlocks([5]);
      expect(blocks).toEqual([
        { provider_id: 5, day_of_week: 5, block_order: 0, start_time: '17:00', end_time: '04:00', is_active: true, inherited: true },
        { provider_id: 5, day_of_week: 6, block_order: 0, start_time: '00:00', end_time: '00:00', is_active: true, inherited: true },
      ]);
      // The saved own rows stay untouched and unread.
      expect(prisma.provider_schedules.findMany).not.toHaveBeenCalled();
    });

    it('keeps the own active rows of a provider with its own schedule (unchanged)', async () => {
      const { service, prisma } = build({
        providers: [{ id: 6, store_id: 1, uses_store_hours: false }],
        schedules: [
          { provider_id: 6, day_of_week: 1, block_order: 0, start_time: '08:00', end_time: '12:00', is_active: true },
          { provider_id: 6, day_of_week: 2, block_order: 0, start_time: '08:00', end_time: '12:00', is_active: false },
        ],
        businessHours: nightWeek,
      });
      const blocks = await service.loadProviderBlocks([6]);
      expect(blocks).toEqual([
        { provider_id: 6, day_of_week: 1, block_order: 0, start_time: '08:00', end_time: '12:00', is_active: true, inherited: false },
      ]);
      expect(prisma.store_settings.findUnique).not.toHaveBeenCalled();
    });

    it('mixes both kinds in one call and reads the store hours once per store', async () => {
      const { service, prisma } = build({
        providers: [
          { id: 5, store_id: 1, uses_store_hours: true },
          { id: 7, store_id: 1, uses_store_hours: true },
          { id: 6, store_id: 1, uses_store_hours: false },
        ],
        schedules: [{ provider_id: 6, day_of_week: 1, block_order: 0, start_time: '08:00', end_time: '12:00', is_active: true }],
        businessHours: { friday: { open: '17:00', close: '04:00' } },
      });
      const blocks = await service.loadProviderBlocks([5, 6, 7, 5]);
      expect(blocks.map((b) => [b.provider_id, b.day_of_week, b.inherited])).toEqual([
        [6, 1, false],
        [5, 5, true],
        [7, 5, true],
      ]);
      expect(prisma.store_settings.findUnique).toHaveBeenCalledTimes(1);
    });

    it('reads the store hours live: a new store week reaches the inheriting provider', async () => {
      const { service, prisma } = build({
        providers: [{ id: 5, store_id: 1, uses_store_hours: true }],
        businessHours: { monday: { open: '09:00', close: '12:00' } },
      });
      expect((await service.loadProviderBlocks([5])).map((b) => b.day_of_week)).toEqual([1]);
      prisma.store_settings.findUnique.mockResolvedValue({
        settings: { pos: { business_hours: { tuesday: { open: '17:00', close: '04:00' } } } },
      });
      expect(await service.loadProviderBlocks([5])).toEqual([
        expect.objectContaining({ day_of_week: 2, start_time: '17:00', end_time: '04:00', inherited: true }),
      ]);
    });

    it('falls back to the own rows when the provider row is not returned (another store)', async () => {
      const { service, prisma } = build({ providers: [], schedules: [] });
      await expect(service.loadProviderBlocks([99])).resolves.toEqual([]);
      expect(prisma.provider_schedules.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { provider_id: { in: [99] }, is_active: true } }),
      );
      expect(prisma.store_settings.findUnique).not.toHaveBeenCalled();
    });

    it('does not query anything for an empty list', async () => {
      const { service, prisma } = build({ providers: [] });
      await expect(service.loadProviderBlocks([])).resolves.toEqual([]);
      expect(prisma.service_providers.findMany).not.toHaveBeenCalled();
    });
  });
});
