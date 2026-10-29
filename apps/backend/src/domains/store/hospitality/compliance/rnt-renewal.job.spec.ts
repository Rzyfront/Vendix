import { LodgingRntRenewalJob } from './rnt-renewal.job';

/**
 * H4.3 — every March each hotel with an RNT gets one reminder in the bell to
 * renew it before March 31; never twice the same year, never when turned off.
 */
function build(options: { settings?: unknown; already?: boolean; stores?: number[] } = {}) {
  const settings = options.settings ?? { hospitality: { rnt_number: '12345' } };
  const unscoped = {
    stores: {
      findMany: jest.fn(async () => (options.stores ?? [10]).map((id) => ({ id }))),
    },
    store_settings: { findFirst: jest.fn(async () => ({ settings })) },
    notifications: { findFirst: jest.fn(async () => (options.already ? { id: 1 } : null)) },
  };
  const prisma = {
    withoutScope: () => unscoped,
    store_settings: {
      findFirst: jest.fn(async () => ({ settings: {}, stores: { timezone: 'America/Bogota' } })),
    },
  };
  const notifications = { createAndBroadcast: jest.fn(async () => ({ id: 99 })) };
  const runner = { runInStoreContext: jest.fn(async (_id: number, fn: () => unknown) => fn()) };
  const job = new LodgingRntRenewalJob(prisma as any, notifications as any, runner as any);
  return { job, unscoped, notifications };
}

const MARCH = new Date('2027-03-01T13:00:00Z');

describe('LodgingRntRenewalJob (H4.3)', () => {
  it('en marzo avisa a la campana del hotel que renueve el RNT antes del 31 de marzo', async () => {
    const { job, unscoped, notifications } = build();
    await expect(job.run(MARCH)).resolves.toBe(1);
    expect(unscoped.stores.findMany).toHaveBeenCalledWith({
      where: { is_active: true, industries: { has: 'hospitality' } },
      select: { id: true },
    });
    expect(notifications.createAndBroadcast).toHaveBeenCalledWith(
      10,
      'lodging_rnt_renewal',
      'Renueva el RNT del hotel',
      'Renueva el Registro Nacional de Turismo (RNT) 12345 antes del 31 de marzo de 2027. Si ya lo hiciste, ignora este aviso.',
      { kind: 'rnt_renewal', year: 2027, rnt_number: '12345', route: '/admin/settings/general/hoteleria' },
    );
  });

  it('una sola vez por año: si ya avisó este año no repite', async () => {
    const { job, unscoped, notifications } = build({ already: true });
    await expect(job.run(MARCH)).resolves.toBe(0);
    expect(unscoped.notifications.findFirst).toHaveBeenCalledWith({
      where: {
        store_id: 10,
        type: 'lodging_rnt_renewal',
        created_at: { gte: new Date(Date.UTC(2027, 0, 1)) },
      },
      select: { id: true },
    });
    expect(notifications.createAndBroadcast).not.toHaveBeenCalled();
  });

  it('fuera de marzo, sin RNT o con el recordatorio apagado no avisa', async () => {
    const april = build();
    await expect(april.job.run(new Date('2027-04-01T13:00:00Z'))).resolves.toBe(0);
    expect(april.notifications.createAndBroadcast).not.toHaveBeenCalled();

    const noRnt = build({ settings: { hospitality: { rnt_number: '' } } });
    await expect(noRnt.job.run(MARCH)).resolves.toBe(0);

    const off = build({ settings: { hospitality: { rnt_number: '12345', rnt_renewal_reminder: false } } });
    await expect(off.job.run(MARCH)).resolves.toBe(0);
    expect(off.notifications.createAndBroadcast).not.toHaveBeenCalled();
  });

  it('el primer día de marzo cuenta en la hora de la tienda, no en UTC', async () => {
    // 2027-03-01 03:00 UTC is still Feb 28 in Bogotá.
    const { job, notifications } = build();
    await expect(job.run(new Date('2027-03-01T03:00:00Z'))).resolves.toBe(0);
    expect(notifications.createAndBroadcast).not.toHaveBeenCalled();
  });

  it('una tienda que falla no detiene a las demás', async () => {
    const { job, unscoped, notifications } = build({ stores: [10, 11] });
    unscoped.store_settings.findFirst
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce({ settings: { hospitality: { rnt_number: '12345' } } });
    await expect(job.run(MARCH)).resolves.toBe(1);
    expect(notifications.createAndBroadcast).toHaveBeenCalledWith(11, 'lodging_rnt_renewal', expect.any(String), expect.any(String), expect.any(Object));
  });
});
