import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProviderScheduleService } from './provider-schedule.service';
import { BusinessHoursService } from '../business-hours/business-hours.service';

/**
 * QUI-968: saving a provider schedule must never answer 500.
 * Invalid payloads fail with a clear 400 while the stored schedule
 * stays intact; missing `block_order` values are auto-assigned per day.
 */
describe('ProviderScheduleService.upsertSchedule (QUI-968)', () => {
  function buildService(opts: {
    provider?: any;
    createManyError?: any;
  } = {}) {
    const tx = {
      service_providers: { update: jest.fn().mockResolvedValue({}) },
      provider_schedules: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        createMany: opts.createManyError
          ? jest.fn().mockRejectedValue(opts.createManyError)
          : jest.fn().mockResolvedValue({ count: 2 }),
        findMany: jest.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]),
      },
    };
    const prisma: any = {
      service_providers: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            'provider' in opts ? opts.provider : { id: 8, store_id: 10 },
          ),
      },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    const service = new ProviderScheduleService(prisma, {} as BusinessHoursService);
    return { service, prisma, tx };
  }

  it('Parte 1: saving an own schedule stops using the store hours, in the same transaction', async () => {
    const { service, tx } = buildService();
    const saved = await service.upsertSchedule(8, [
      { day_of_week: 1, block_order: 0, start_time: '08:00', end_time: '12:00' },
    ] as any);
    expect(tx.service_providers.update).toHaveBeenCalledWith({
      where: { id: 8 },
      data: expect.objectContaining({ uses_store_hours: false }),
    });
    expect(saved).toEqual([
      { id: 1, inherited: false },
      { id: 2, inherited: false },
    ]);
  });

  it('Parte 1: an invalid payload leaves the store-hours choice untouched', async () => {
    const { service, tx } = buildService();
    await expect(
      service.upsertSchedule(8, [{ day_of_week: 1, start_time: '9am', end_time: '12:00' }] as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.service_providers.update).not.toHaveBeenCalled();
  });

  it('saves a valid split-shift payload', async () => {
    const { service, tx } = buildService();
    const items = [
      { day_of_week: 1, block_order: 0, start_time: '08:00', end_time: '12:00' },
      { day_of_week: 1, block_order: 1, start_time: '14:00', end_time: '18:00' },
    ];

    await service.upsertSchedule(8, items as any);

    expect(tx.provider_schedules.deleteMany).toHaveBeenCalledWith({
      where: { provider_id: 8 },
    });
    expect(tx.provider_schedules.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ day_of_week: 1, block_order: 0 }),
        expect.objectContaining({ day_of_week: 1, block_order: 1 }),
      ],
    });
  });

  it('auto-assigns block_order per day when omitted', async () => {
    const { service, tx } = buildService();
    const items = [
      { day_of_week: 1, start_time: '08:00', end_time: '12:00' },
      { day_of_week: 1, start_time: '14:00', end_time: '18:00' },
      { day_of_week: 2, start_time: '08:00', end_time: '12:00' },
    ];

    await service.upsertSchedule(8, items as any);

    expect(tx.provider_schedules.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ day_of_week: 1, block_order: 0 }),
        expect.objectContaining({ day_of_week: 1, block_order: 1 }),
        expect.objectContaining({ day_of_week: 2, block_order: 0 }),
      ],
    });
  });

  it('skips taken orders when mixing explicit and missing block_order', async () => {
    const { service, tx } = buildService();
    const items = [
      { day_of_week: 1, block_order: 0, start_time: '08:00', end_time: '12:00' },
      { day_of_week: 1, start_time: '14:00', end_time: '18:00' },
    ];

    await service.upsertSchedule(8, items as any);

    expect(tx.provider_schedules.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ day_of_week: 1, block_order: 0 }),
        expect.objectContaining({ day_of_week: 1, block_order: 1 }),
      ],
    });
  });

  it.each([
    ['duplicated order', [{ day_of_week: 1, block_order: 0, start_time: '08:00', end_time: '12:00' }, { day_of_week: 1, block_order: 0, start_time: '14:00', end_time: '18:00' }]],
    ['overnight block overlapping the next day', [{ day_of_week: 5, block_order: 0, start_time: '20:00', end_time: '03:00' }, { day_of_week: 6, block_order: 0, start_time: '02:00', end_time: '10:00' }]],
    ['empty times', [{ day_of_week: 1, block_order: 0, start_time: '', end_time: '' }]],
    ['seconds format', [{ day_of_week: 1, block_order: 0, start_time: '08:00:00', end_time: '18:00:00' }]],
    ['garbage times', [{ day_of_week: 1, block_order: 0, start_time: 'NaN:NaN', end_time: '25:99' }]],
  ])('rejects with 400 on %s without touching the stored schedule', async (_label, items) => {
    const { service, tx, prisma } = buildService();

    await expect(service.upsertSchedule(8, items as any)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(tx.provider_schedules.deleteMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('maps a Prisma unique violation to 400 instead of 500', async () => {
    const p2002 = Object.assign(
      new Error('Unique constraint failed'),
      { code: 'P2002' },
    );
    const { service } = buildService({ createManyError: p2002 });
    const items = [
      { day_of_week: 1, block_order: 0, start_time: '08:00', end_time: '12:00' },
    ];

    await expect(service.upsertSchedule(8, items as any)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('throws 404 for an unknown provider', async () => {
    const { service } = buildService({ provider: null });

    await expect(service.upsertSchedule(999, [])).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('clears the schedule when items is empty', async () => {
    const { service, tx } = buildService();

    await service.upsertSchedule(8, []);

    expect(tx.provider_schedules.deleteMany).toHaveBeenCalled();
    expect(tx.provider_schedules.createMany).not.toHaveBeenCalled();
  });

  describe('overnight blocks (S21)', () => {
    it('accepts a block that ends the next day', async () => {
      const { service, tx } = buildService();
      await service.upsertSchedule(8, [
        { day_of_week: 5, block_order: 0, start_time: '20:00', end_time: '03:00' },
      ] as any);
      expect(tx.provider_schedules.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({ day_of_week: 5, start_time: '20:00', end_time: '03:00' })],
      });
    });

    it('accepts the next day starting when the spill ends', async () => {
      const { service, tx } = buildService();
      await service.upsertSchedule(8, [
        { day_of_week: 5, block_order: 0, start_time: '20:00', end_time: '03:00' },
        { day_of_week: 6, block_order: 0, start_time: '03:00', end_time: '10:00' },
      ] as any);
      expect(tx.provider_schedules.createMany).toHaveBeenCalled();
    });

    it('accepts 00:00-00:00 as 24 hours', async () => {
      const { service, tx } = buildService();
      await service.upsertSchedule(8, [
        { day_of_week: 6, block_order: 0, start_time: '00:00', end_time: '00:00' },
      ] as any);
      expect(tx.provider_schedules.createMany).toHaveBeenCalled();
    });

    it('rejects two blocks of the same day that overlap once one is overnight', async () => {
      const { service, tx } = buildService();
      await expect(
        service.upsertSchedule(8, [
          { day_of_week: 5, block_order: 0, start_time: '20:00', end_time: '03:00' },
          { day_of_week: 5, block_order: 1, start_time: '22:00', end_time: '23:00' },
        ] as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.provider_schedules.deleteMany).not.toHaveBeenCalled();
    });

    it('accepts a 17:00-04:00 night shift and consecutive 24 h days', async () => {
      const { service, tx } = buildService();
      await service.upsertSchedule(8, [
        { day_of_week: 1, block_order: 0, start_time: '17:00', end_time: '04:00' },
        { day_of_week: 2, block_order: 0, start_time: '04:00', end_time: '12:00' },
        { day_of_week: 3, block_order: 0, start_time: '00:00', end_time: '00:00' },
        { day_of_week: 4, block_order: 0, start_time: '00:00', end_time: '00:00' },
      ] as any);
      expect(tx.provider_schedules.createMany).toHaveBeenCalled();
    });

    it('rejects a zero-length block other than 00:00-00:00', async () => {
      const { service, tx } = buildService();
      await expect(
        service.upsertSchedule(8, [
          { day_of_week: 2, block_order: 0, start_time: '09:00', end_time: '09:00' },
        ] as any),
      ).rejects.toThrow('usa 00:00 a 00:00 para atender las 24 horas');
      expect(tx.provider_schedules.deleteMany).not.toHaveBeenCalled();
    });

    it('keeps accepting overlapping daytime blocks as before', async () => {
      const { service, tx } = buildService();
      await service.upsertSchedule(8, [
        { day_of_week: 1, block_order: 0, start_time: '08:00', end_time: '13:00' },
        { day_of_week: 1, block_order: 1, start_time: '12:00', end_time: '18:00' },
      ] as any);
      expect(tx.provider_schedules.createMany).toHaveBeenCalled();
    });
  });
});

describe('ProviderScheduleService.getSchedule (Parte 1)', () => {
  function build(usesStoreHours: boolean | undefined) {
    const own = [{ id: 1, provider_id: 8, day_of_week: 1, block_order: 0, start_time: '08:00', end_time: '12:00', is_active: true }];
    const prisma: any = {
      service_providers: {
        findFirst: jest.fn().mockResolvedValue({ id: 8, uses_store_hours: usesStoreHours }),
      },
      provider_schedules: { findMany: jest.fn().mockResolvedValue(own) },
    };
    const inherited = [
      { provider_id: 8, day_of_week: 5, block_order: 0, start_time: '17:00', end_time: '04:00', is_active: true, inherited: true },
    ];
    const hours = { loadProviderBlocks: jest.fn().mockResolvedValue(inherited) };
    return { service: new ProviderScheduleService(prisma, hours as unknown as BusinessHoursService), prisma, hours, inherited };
  }

  it('returns the store blocks marked inherited while the provider works the store hours', async () => {
    const { service, prisma, hours, inherited } = build(true);
    await expect(service.getSchedule(8)).resolves.toEqual(inherited);
    expect(hours.loadProviderBlocks).toHaveBeenCalledWith([8]);
    expect(prisma.provider_schedules.findMany).not.toHaveBeenCalled();
  });

  it('returns the own rows, marked not inherited, with an own schedule (unchanged rows)', async () => {
    const { service, hours } = build(false);
    await expect(service.getSchedule(8)).resolves.toEqual([
      { id: 1, provider_id: 8, day_of_week: 1, block_order: 0, start_time: '08:00', end_time: '12:00', is_active: true, inherited: false },
    ]);
    expect(hours.loadProviderBlocks).not.toHaveBeenCalled();
  });
});
