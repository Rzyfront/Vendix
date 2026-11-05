import { AutoNoShowJob } from './auto-no-show.job';

describe('AutoNoShowJob.archiveStore', () => {
  const day = (offset: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + offset);
    return new Date(`${d.toISOString().slice(0, 10)}T00:00:00.000Z`);
  };

  function build(rows: any[]) {
    const prisma: any = {
      store_settings: {
        findFirst: jest.fn().mockResolvedValue({ settings: {}, stores: { timezone: 'UTC' } }),
      },
      bookings: { findMany: jest.fn().mockResolvedValue(rows) },
    };
    const reservations: any = { archiveToNoShow: jest.fn().mockResolvedValue(undefined) };
    const job = new AutoNoShowJob(prisma, reservations, {} as any);
    return { job, reservations, prisma };
  }
  const run = (job: AutoNoShowJob) => (job as any).archiveStore(1);

  it('archives a daytime booking from a past day (previous behavior)', async () => {
    const { job, reservations } = build([
      { id: 1, date: day(-3), end_date: null, start_time: '09:00', end_time: '10:00', status: 'pending' },
    ]);
    await expect(run(job)).resolves.toBe(1);
    expect(reservations.archiveToNoShow).toHaveBeenCalledWith(1);
  });

  it('uses end_date for an overnight booking: ended days ago is archived', async () => {
    const { job, reservations } = build([
      { id: 2, date: day(-3), end_date: day(-2), start_time: '22:00', end_time: '01:00', status: 'pending' },
    ]);
    await expect(run(job)).resolves.toBe(1);
    expect(reservations.archiveToNoShow).toHaveBeenCalledWith(2);
  });

  it('does not archive an overnight booking that ends today inside the grace window', async () => {
    // Started yesterday 23:00, ends today at the current minute: still inside the 2h grace.
    const now = new Date();
    const hh = String(now.getUTCHours()).padStart(2, '0');
    const mm = String(now.getUTCMinutes()).padStart(2, '0');
    const { job, reservations } = build([
      { id: 3, date: day(-1), end_date: day(0), start_time: '23:00', end_time: `${hh}:${mm}`, status: 'pending' },
    ]);
    await expect(run(job)).resolves.toBe(0);
    expect(reservations.archiveToNoShow).not.toHaveBeenCalled();
  });
});
