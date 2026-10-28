import { LodgingNoShowJob } from './lodging-no-show.job';

/**
 * H1.2 — the no-show job visits only stores with a confirmed arrival due and
 * computes the cutoff in the store's time zone with its configured time.
 */
describe('LodgingNoShowJob', () => {
  const build = (hospitality: Record<string, string> | undefined) => {
    const findMany = jest.fn(async () => [{ store_id: 5 }]);
    const prisma = {
      withoutScope: () => ({ lodging_reservations: { findMany } }),
      store_settings: {
        findFirst: jest.fn(async () => ({
          settings: hospitality ? { hospitality } : {},
          stores: { timezone: 'America/Bogota' },
        })),
      },
    };
    const reservations = { autoNoShow: jest.fn(async () => 2) };
    const runner = {
      runInStoreContext: jest.fn(async (_id: number, fn: () => Promise<number>) => fn()),
    };
    const job = new LodgingNoShowJob(prisma as any, reservations as any, runner as any);
    return { job, findMany, reservations, runner };
  };

  it('antes de la hora límite (07:30 Bogotá, límite 08:00) vence solo lo de antier', async () => {
    const { job, reservations, runner, findMany } = build({ no_show_time: '08:00' });
    const total = await job.run(new Date('2026-11-11T12:30:00Z'));

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'confirmed' }) }),
    );
    expect(runner.runInStoreContext).toHaveBeenCalledWith(5, expect.any(Function));
    expect(reservations.autoNoShow).toHaveBeenCalledWith('2026-11-10');
    expect(total).toBe(2);
  });

  it('después de la hora límite (08:30 Bogotá) vence también la llegada de ayer', async () => {
    const { job, reservations } = build({ no_show_time: '08:00' });
    await job.run(new Date('2026-11-11T13:30:00Z'));
    expect(reservations.autoNoShow).toHaveBeenCalledWith('2026-11-11');
  });

  it('sin ajuste usa 06:00 y el fallo de una tienda no detiene el job', async () => {
    const { job, reservations } = build(undefined);
    await job.run(new Date('2026-11-11T11:00:00Z')); // 06:00 Bogotá
    expect(reservations.autoNoShow).toHaveBeenCalledWith('2026-11-11');

    reservations.autoNoShow.mockRejectedValueOnce(new Error('boom'));
    await expect(job.run(new Date('2026-11-11T11:00:00Z'))).resolves.toBe(0);
  });
});
