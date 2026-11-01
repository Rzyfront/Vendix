import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProviderScheduleService } from './provider-schedule.service';

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
    const service = new ProviderScheduleService(prisma);
    return { service, prisma, tx };
  }

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
    ['end before start', [{ day_of_week: 1, block_order: 0, start_time: '18:00', end_time: '08:00' }]],
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
});
