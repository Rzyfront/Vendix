import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../common/context/request-context.service';
import { RemindersService, ReminderActor } from './reminders.service';
import { createFakeRemindersPrisma } from './testing/fake-reminders-prisma';

// Two stores, two users in store 1, and user 10 also working in store 2.
const ANA_S1: ReminderActor = { store_id: 1, user_id: 10 };
const BETO_S1: ReminderActor = { store_id: 1, user_id: 11 };
const ANA_S2: ReminderActor = { store_id: 2, user_id: 10 };
const CARLA_S2: ReminderActor = { store_id: 2, user_id: 20 };

const SEED = [
  { id: 1, store_id: 1, user_id: 10, title: 'Ana tienda 1' },
  { id: 2, store_id: 1, user_id: 11, title: 'Beto tienda 1' },
  { id: 3, store_id: 2, user_id: 20, title: 'Carla tienda 2' },
  { id: 4, store_id: 2, user_id: 10, title: 'Ana tienda 2' },
];

function setup(seed: Parameters<typeof createFakeRemindersPrisma>[0] = SEED) {
  const prisma = createFakeRemindersPrisma(seed);
  const service = new RemindersService(prisma as unknown as StorePrismaService);
  return { prisma, service };
}

async function expectNotFound(promise: Promise<unknown>) {
  await expect(promise).rejects.toMatchObject({ errorCode: 'REMINDER_001' });
  await promise.catch((error) => expect(error.getStatus()).toBe(404));
}

describe('RemindersService — isolation by store AND user (QUI-580)', () => {
  it('lists only the actor reminders: never another user of the same store nor another store', async () => {
    const { service } = setup();
    const titles = async (actor: ReminderActor) =>
      (await service.list(actor, { status: 'all' })).items.map((r) => r.title);

    expect(await titles(ANA_S1)).toEqual(['Ana tienda 1']);
    expect(await titles(BETO_S1)).toEqual(['Beto tienda 1']);
    expect(await titles(ANA_S2)).toEqual(['Ana tienda 2']);
    expect(await titles(CARLA_S2)).toEqual(['Carla tienda 2']);
  });

  it('answers 404 when reading a reminder of another user or another store', async () => {
    const { service } = setup();
    await expectNotFound(service.findOne(BETO_S1, 1)); // same store, other user
    await expectNotFound(service.findOne(CARLA_S2, 1)); // other store
    await expectNotFound(service.findOne(ANA_S2, 1)); // same user, other store
    await expect(service.findOne(ANA_S1, 1)).resolves.toMatchObject({ id: 1 });
  });

  it('cannot edit or complete a foreign reminder and leaves it untouched', async () => {
    const { service, prisma } = setup();
    await expectNotFound(service.update(BETO_S1, 1, { title: 'hackeado' }));
    await expectNotFound(service.update(CARLA_S2, 1, { status: 'done' }));
    expect(prisma.rows.find((r) => r.id === 1)).toMatchObject({
      title: 'Ana tienda 1',
      status: 'pending',
    });
    expect(prisma.user_reminders.updateMany).not.toHaveBeenCalled();
  });

  it('cannot delete a foreign reminder', async () => {
    const { service, prisma } = setup();
    await expectNotFound(service.remove(BETO_S1, 1));
    await expectNotFound(service.remove(CARLA_S2, 1));
    expect(prisma.rows.map((r) => r.id)).toEqual([1, 2, 3, 4]);
    await expect(service.remove(ANA_S1, 1)).resolves.toEqual({ id: 1, title: 'Ana tienda 1' });
    expect(prisma.rows.map((r) => r.id)).toEqual([2, 3, 4]);
  });

  it('binds every write to the actor store and user, also inside the update/delete where', async () => {
    const { service, prisma } = setup();
    const created = await service.create(BETO_S1, { title: '  Llamar al proveedor  ' });
    expect(prisma.rows.find((r) => r.id === created.id)).toMatchObject({
      store_id: 1,
      user_id: 11,
      title: 'Llamar al proveedor',
      source: 'manual',
    });
    await service.update(BETO_S1, created.id, { status: 'done' });
    expect(prisma.user_reminders.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: created.id, store_id: 1, user_id: 11 },
      }),
    );
    await service.remove(BETO_S1, created.id);
    expect(prisma.user_reminders.deleteMany).toHaveBeenCalledWith({
      where: { id: created.id, store_id: 1, user_id: 11 },
    });
  });

  it('takes the HTTP actor from the session context, not from the request', () => {
    const { service } = setup();
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValueOnce({ store_id: 1, user_id: 11 } as never)
      .mockReturnValueOnce({ store_id: 1 } as never);
    expect(service.actorFromRequest()).toEqual(BETO_S1);
    expect(() => service.actorFromRequest()).toThrow();
  });
});

describe('RemindersService — behaviour', () => {
  afterEach(() => jest.useRealTimers());

  it('reads a wall clock without offset in the store timezone (America/Bogota)', () => {
    const { service } = setup([]);
    expect(service.parseRemindAt('2026-11-15T09:00', 'America/Bogota')?.toISOString()).toBe(
      '2026-11-15T14:00:00.000Z',
    );
    expect(service.parseRemindAt('2026-11-15', 'America/Bogota')?.toISOString()).toBe(
      '2026-11-15T13:00:00.000Z',
    );
    expect(service.parseRemindAt('2026-11-15T14:00:00Z', 'America/Bogota')?.toISOString()).toBe(
      '2026-11-15T14:00:00.000Z',
    );
    expect(() => service.parseRemindAt('el viernes', 'America/Bogota')).toThrow();
    expect(() => service.parseRemindAt('2026-13-01T09:00', 'America/Bogota')).toThrow();
  });

  it('orders overdue, today, upcoming, no date and hides done unless asked', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-14T15:00:00Z') }); // 10:00 Bogota
    const { service } = setup([
      { id: 1, store_id: 1, user_id: 10, title: 'sin fecha' },
      { id: 2, store_id: 1, user_id: 10, title: 'próximo', remind_at: new Date('2026-11-15T14:00:00Z') },
      { id: 3, store_id: 1, user_id: 10, title: 'hoy', remind_at: new Date('2026-11-14T22:00:00Z') },
      { id: 4, store_id: 1, user_id: 10, title: 'vencido', remind_at: new Date('2026-11-14T13:00:00Z') },
      { id: 5, store_id: 1, user_id: 10, title: 'hecho', status: 'done' },
    ]);
    const pending = await service.list(ANA_S1);
    expect(pending.items.map((r) => [r.title, r.bucket])).toEqual([
      ['vencido', 'overdue'],
      ['hoy', 'today'],
      ['próximo', 'upcoming'],
      ['sin fecha', 'no_date'],
    ]);
    expect(pending.timezone).toBe('America/Bogota');
    const all = await service.list(ANA_S1, { status: 'all' });
    expect(all.items.at(-1)).toMatchObject({ title: 'hecho', bucket: 'done' });
    const today = await service.list(ANA_S1, { due: 'today' });
    expect(today.items.map((r) => r.title)).toEqual(['hoy']);
  });

  it('links a store product with its name and URL, and rejects a product the store does not have', async () => {
    const { service } = setup([]);
    const linked = await service.create(ANA_S1, {
      title: 'Revisar stock',
      link_type: 'product',
      link_id: 501,
    });
    expect(linked.link).toEqual({
      type: 'product',
      id: 501,
      label: 'Coca-Cola 1.5L',
      url: '/admin/products/501',
    });
    await expect(
      service.create(ANA_S1, { title: 'x', link_type: 'product', link_id: 999 }),
    ).rejects.toMatchObject({ errorCode: 'REMINDER_LINK_001' });
  });

  it('re-arms the due notification when the date changes and stamps completion', async () => {
    const { service, prisma } = setup([
      {
        id: 1,
        store_id: 1,
        user_id: 10,
        title: 'a',
        remind_at: new Date('2026-11-14T14:00:00Z'),
        notified_at: new Date('2026-11-14T14:00:00Z'),
      },
    ]);
    await service.update(ANA_S1, 1, { remind_at: '2026-11-16T09:00' });
    expect(prisma.rows[0].notified_at).toBeNull();
    expect(prisma.rows[0].remind_at.toISOString()).toBe('2026-11-16T14:00:00.000Z');
    const done = await service.update(ANA_S1, 1, { status: 'done' });
    expect(done.status).toBe('done');
    expect(done.completed_at).toBeInstanceOf(Date);
    const reopened = await service.update(ANA_S1, 1, { status: 'pending' });
    expect(reopened.completed_at).toBeNull();
  });

  it('keeps minute precision: re-sending the same minute does not re-arm a sent notice', async () => {
    const sentAt = new Date('2026-11-14T22:00:30Z');
    const { service, prisma } = setup([
      {
        id: 1,
        store_id: 1,
        user_id: 10,
        title: 'a',
        remind_at: new Date('2026-11-14T22:00:30Z'),
        notified_at: sentAt,
      },
    ]);
    // Vex may send seconds; they are dropped.
    expect(service.parseRemindAt('2026-11-20T12:00:30', 'America/Bogota')?.toISOString()).toBe(
      '2026-11-20T17:00:00.000Z',
    );
    expect(service.parseRemindAt('2026-11-20T17:00:30.500Z', 'America/Bogota')?.toISOString()).toBe(
      '2026-11-20T17:00:00.000Z',
    );
    // The modal re-sends `YYYY-MM-DDTHH:mm` (17:00 Bogota) while editing only the title.
    await service.update(ANA_S1, 1, { title: 'b', remind_at: '2026-11-14T17:00' });
    expect(prisma.rows[0].title).toBe('b');
    expect(prisma.rows[0].notified_at).toEqual(sentAt);
    // A different minute still re-arms it.
    await service.update(ANA_S1, 1, { remind_at: '2026-11-14T17:01' });
    expect(prisma.rows[0].notified_at).toBeNull();
  });
});
