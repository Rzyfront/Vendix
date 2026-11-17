import { UserReminderDueJob, REMINDER_DUE_LOOKBACK_MS } from './user-reminder-due.job';
import { createFakeRemindersPrisma, fakeTable } from './testing/fake-reminders-prisma';

const NOW = new Date('2026-11-14T22:00:00Z'); // 17:00 Bogota
const BITACORA = '/admin/dashboard?tab=bitacora';

/** Ana (user 10) may read products; Beto (user 11) holds no permission at all. */
function roleWith(userId: number, permissions: string[]) {
  return {
    user_id: userId,
    store_id: 1,
    roles: {
      name: 'staff',
      role_permissions: permissions.map((name) => ({
        granted: true,
        permissions: { name, status: 'active' },
      })),
    },
  };
}

function setup(seed: Record<string, any>[]) {
  const prisma = Object.assign(createFakeRemindersPrisma(seed), {
    users: fakeTable([
      { id: 10, email: 'ana@tienda.co', first_name: 'Ana' },
      { id: 11, email: 'beto@tienda.co', first_name: 'Beto' },
      { id: 20, email: null, first_name: 'Carla' },
    ]),
    stores: fakeTable([
      { id: 1, organization_id: 1, name: 'Tienda Uno' },
      { id: 2, organization_id: 2, name: 'Tienda Dos' },
    ]),
    domain_settings: fakeTable([
      { id: 1, store_id: 1, app_type: 'STORE_ADMIN', status: 'active', is_primary: true, hostname: 'admin.tienda.co' },
    ]),
    user_roles: fakeTable([roleWith(10, ['store:products:read']), roleWith(11, [])]),
  });
  const notifications = { sendToUser: jest.fn(async (..._args: unknown[]): Promise<unknown> => ({ id: 1 })) };
  const email = {
    sendEmail: jest.fn(async (..._args: unknown[]) => ({ success: true }) as { success: boolean; error?: string }),
  };
  const job = new UserReminderDueJob(prisma as any, notifications as any, email as any);
  return { job, prisma, notifications, email };
}

describe('UserReminderDueJob (QUI-580)', () => {
  it('notifies only the owner (store and user) of each due reminder', async () => {
    const { job, notifications } = setup([
      { id: 1, store_id: 1, user_id: 10, title: 'Ana', remind_at: new Date('2026-11-14T21:59:00Z') },
      { id: 2, store_id: 1, user_id: 11, title: 'Beto', remind_at: new Date('2026-11-14T22:00:00Z'), link_label: 'Coca-Cola 1.5L' },
      { id: 3, store_id: 2, user_id: 20, title: 'Carla', remind_at: new Date('2026-11-14T20:00:00Z') },
    ]);
    expect(await job.notifyDue(NOW)).toBe(3);
    const calls = notifications.sendToUser.mock.calls.map((c) => c.slice(0, 5));
    expect(calls).toEqual(
      expect.arrayContaining([
        [1, 10, 'reminder_due', 'Recordatorio', 'Ana'],
        [1, 11, 'reminder_due', 'Recordatorio', 'Beto · Coca-Cola 1.5L'],
        [2, 20, 'reminder_due', 'Recordatorio', 'Carla'],
      ]),
    );
    expect(notifications.sendToUser.mock.calls[0][5]).toMatchObject({
      kind: 'user_reminder',
      url: BITACORA,
    });
  });

  it('notifies once: a second run (or the other process) sends nothing', async () => {
    const { job, prisma, notifications } = setup([
      { id: 1, store_id: 1, user_id: 10, title: 'Ana', remind_at: new Date('2026-11-14T21:00:00Z') },
    ]);
    await job.notifyDue(NOW);
    expect(await job.notifyDue(new Date(NOW.getTime() + 60_000))).toBe(0);
    expect(notifications.sendToUser).toHaveBeenCalledTimes(1);
    expect(prisma.rows[0].notified_at).toEqual(NOW);
  });

  it('skips done, future, undated and too old reminders', async () => {
    const { job, notifications, email } = setup([
      { id: 1, store_id: 1, user_id: 10, title: 'hecho', status: 'done', remind_at: new Date('2026-11-14T21:00:00Z') },
      { id: 2, store_id: 1, user_id: 10, title: 'futuro', remind_at: new Date('2026-11-14T22:01:00Z') },
      { id: 3, store_id: 1, user_id: 10, title: 'sin fecha' },
      { id: 4, store_id: 1, user_id: 10, title: 'viejo', remind_at: new Date(NOW.getTime() - REMINDER_DUE_LOOKBACK_MS - 1) },
    ]);
    expect(await job.notifyDue(NOW)).toBe(0);
    expect(notifications.sendToUser).not.toHaveBeenCalled();
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('a claim lost to another process does not notify', async () => {
    const { job, prisma, notifications, email } = setup([
      { id: 1, store_id: 1, user_id: 10, title: 'Ana', remind_at: new Date('2026-11-14T21:00:00Z') },
    ]);
    prisma.user_reminders.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await job.notifyDue(NOW)).toBe(0);
    expect(notifications.sendToUser).not.toHaveBeenCalled();
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('a failed send releases the claim, so the next run retries and notifies (and e-mails) once', async () => {
    const { job, prisma, notifications, email } = setup([
      { id: 1, store_id: 1, user_id: 10, title: 'Ana', remind_at: new Date('2026-11-14T21:00:00Z') },
    ]);
    notifications.sendToUser.mockResolvedValueOnce(null);
    expect(await job.notifyDue(NOW)).toBe(0);
    expect(prisma.rows[0].notified_at).toBeNull();
    expect(email.sendEmail).not.toHaveBeenCalled();

    const next = new Date(NOW.getTime() + 60_000);
    expect(await job.notifyDue(next)).toBe(1);
    expect(await job.notifyDue(new Date(next.getTime() + 60_000))).toBe(0);
    expect(notifications.sendToUser).toHaveBeenCalledTimes(2);
    expect(notifications.sendToUser.mock.calls[1].slice(0, 2)).toEqual([1, 10]);
    expect(prisma.rows[0].notified_at).toEqual(next);
    expect(email.sendEmail).toHaveBeenCalledTimes(1);
  });

  describe('e-mail and destination of the notice (QUI-580 a)', () => {
    it('e-mails the owner once, and both the notice and the e-mail open the linked record', async () => {
      const { job, notifications, email } = setup([
        {
          id: 1,
          store_id: 1,
          user_id: 10,
          title: 'Revisar stock',
          note: 'Pedir 20 <cajas>',
          remind_at: new Date('2026-11-14T21:00:00Z'),
          link_type: 'product',
          link_id: 501,
          link_label: 'Coca-Cola 1.5L',
        },
      ]);

      expect(await job.notifyDue(NOW)).toBe(1);
      expect(await job.notifyDue(new Date(NOW.getTime() + 60_000))).toBe(0);

      expect(notifications.sendToUser.mock.calls[0][5]).toMatchObject({
        kind: 'user_reminder',
        reminder_id: 1,
        url: '/admin/products/501',
      });
      expect(email.sendEmail).toHaveBeenCalledTimes(1);
      const [to, subject, html, text] = email.sendEmail.mock.calls[0] as string[];
      expect(to).toBe('ana@tienda.co');
      expect(subject).toBe('Recordatorio: Revisar stock');
      expect(html).toContain('Hola Ana');
      expect(html).toContain('Tienda Uno');
      expect(html).toContain('14/11/2026');
      expect(html).toContain('Pedir 20 &lt;cajas&gt;');
      expect(html).not.toContain('<cajas>');
      expect(html).toContain('Producto: Coca-Cola 1.5L');
      expect(html).toContain('href="https://admin.tienda.co/admin/products/501"');
      expect(text).toContain('https://admin.tienda.co/admin/products/501');
    });

    it('opens the Bitácora when there is no link, the user may not read it or the record is gone', async () => {
      const { job, notifications, email } = setup([
        { id: 1, store_id: 1, user_id: 10, title: 'Sin vínculo', remind_at: new Date('2026-11-14T21:00:00Z') },
        { id: 2, store_id: 1, user_id: 11, title: 'Sin permiso', remind_at: new Date('2026-11-14T21:01:00Z'), link_type: 'product', link_id: 501, link_label: 'Coca-Cola 1.5L' },
        { id: 3, store_id: 1, user_id: 10, title: 'Borrado', remind_at: new Date('2026-11-14T21:02:00Z'), link_type: 'product', link_id: 999, link_label: 'Producto borrado' },
      ]);

      expect(await job.notifyDue(NOW)).toBe(3);

      const urls = notifications.sendToUser.mock.calls.map((c) => [c[4], (c[5] as { url: string }).url]);
      expect(urls).toEqual([
        ['Sin vínculo', BITACORA],
        ['Sin permiso · Coca-Cola 1.5L', BITACORA],
        ['Borrado · Producto borrado', BITACORA],
      ]);
      expect(email.sendEmail).toHaveBeenCalledTimes(3);
      for (const call of email.sendEmail.mock.calls) {
        expect(call[2]).toContain(`href="https://admin.tienda.co${BITACORA}"`);
        expect(call[2]).not.toContain('/admin/products/');
      }
      expect(email.sendEmail.mock.calls[1][2]).toContain('Coca-Cola 1.5L (no disponible)');
    });

    it('a failed e-mail is not retried and never repeats the in-app notice', async () => {
      const { job, prisma, notifications, email } = setup([
        { id: 1, store_id: 1, user_id: 10, title: 'Ana', remind_at: new Date('2026-11-14T21:00:00Z') },
      ]);
      email.sendEmail.mockResolvedValueOnce({ success: false, error: 'smtp down' });

      expect(await job.notifyDue(NOW)).toBe(1);
      expect(await job.notifyDue(new Date(NOW.getTime() + 60_000))).toBe(0);

      expect(notifications.sendToUser).toHaveBeenCalledTimes(1);
      expect(email.sendEmail).toHaveBeenCalledTimes(1);
      expect(prisma.rows[0].notified_at).toEqual(NOW);
    });

    it('without an e-mail address only the in-app notice goes out', async () => {
      const { job, notifications, email } = setup([
        { id: 1, store_id: 2, user_id: 20, title: 'Carla', remind_at: new Date('2026-11-14T21:00:00Z') },
      ]);
      expect(await job.notifyDue(NOW)).toBe(1);
      expect(notifications.sendToUser).toHaveBeenCalledTimes(1);
      expect(email.sendEmail).not.toHaveBeenCalled();
    });
  });
});
