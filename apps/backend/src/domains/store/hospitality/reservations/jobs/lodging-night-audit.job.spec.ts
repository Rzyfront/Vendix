import { LodgingNightAuditJob } from './lodging-night-audit.job';

/**
 * H3.4 — the night audit visits only stores with an open folio, runs each in
 * its store context, cuts off by the store's time zone and `night_audit_time`,
 * and a failing store or folio never stops the rest.
 */
describe('LodgingNightAuditJob', () => {
  const folio = (id: number) => ({ id, status: 'open', reservation_id: id * 10, order_id: id * 100 });

  const build = (
    hospitality: Record<string, string> | undefined,
    options: { stores?: number[]; timezone?: string } = {},
  ) => {
    const storeFindMany = jest.fn(async () => (options.stores ?? [5]).map((store_id) => ({ store_id })));
    const folioFindMany = jest.fn(async () => [folio(1), folio(2)]);
    const prisma = {
      withoutScope: () => ({ lodging_folios: { findMany: storeFindMany } }),
      lodging_folios: { findMany: folioFindMany },
      store_settings: {
        findFirst: jest.fn(async () => ({
          settings: hospitality ? { hospitality } : {},
          stores: { timezone: options.timezone ?? 'America/Bogota' },
        })),
      },
    };
    const folios = { postNightsThrough: jest.fn(async (..._args: unknown[]): Promise<number> => 1) };
    const runner = {
      runInStoreContext: jest.fn(async (_id: number, fn: () => Promise<number>) => fn()),
    };
    const job = new LodgingNightAuditJob(prisma as any, folios as any, runner as any);
    return { job, storeFindMany, folioFindMany, folios, runner };
  };

  it('visita solo tiendas con folio abierto y corre cada una en su contexto', async () => {
    const { job, storeFindMany, folioFindMany, runner, folios } = build(undefined, { stores: [5, 6] });
    const total = await job.run(new Date('2026-11-11T08:00:00Z'));

    expect(storeFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'open' } }));
    expect(runner.runInStoreContext).toHaveBeenCalledWith(5, expect.any(Function));
    expect(runner.runInStoreContext).toHaveBeenCalledWith(6, expect.any(Function));
    expect(folioFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'open', reservation: { status: 'checked_in' } } }),
    );
    expect(folios.postNightsThrough).toHaveBeenCalledTimes(4);
    expect(total).toBe(4);
  });

  it('antes de la hora de corte (01:30 Bogotá, corte 02:00) postea hasta antier (cota exclusiva = ayer)', async () => {
    const { job, folios } = build({ night_audit_time: '02:00' });
    await job.run(new Date('2026-11-11T06:30:00Z'));
    expect(folios.postNightsThrough).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), '2026-11-10', false);
  });

  it('después de la hora de corte (02:30 Bogotá) postea hasta ayer (cota exclusiva = hoy)', async () => {
    const { job, folios } = build({ night_audit_time: '02:00' });
    await job.run(new Date('2026-11-11T07:30:00Z'));
    expect(folios.postNightsThrough).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), '2026-11-11', false);
  });

  it('usa la zona horaria de la tienda, no UTC (00:30 UTC = 19:30 Bogotá del día anterior)', async () => {
    const { job, folios } = build({ night_audit_time: '02:00' });
    await job.run(new Date('2026-11-11T00:30:00Z'));
    expect(folios.postNightsThrough).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), '2026-11-10', false);
  });

  it('un folio con error no detiene los demás', async () => {
    const { job, folios } = build(undefined);
    folios.postNightsThrough.mockRejectedValueOnce(new Error('boom'));
    const total = await job.run(new Date('2026-11-11T08:00:00Z'));
    expect(folios.postNightsThrough).toHaveBeenCalledTimes(2);
    expect(total).toBe(1);
  });

  it('una tienda con error no detiene a las demás', async () => {
    const { job, runner, folios } = build(undefined, { stores: [5, 6] });
    runner.runInStoreContext.mockRejectedValueOnce(new Error('boom'));
    const total = await job.run(new Date('2026-11-11T08:00:00Z'));
    expect(folios.postNightsThrough).toHaveBeenCalledTimes(2);
    expect(total).toBe(2);
  });
});
