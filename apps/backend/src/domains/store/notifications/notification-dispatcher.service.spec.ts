// El correo real no participa: se inyecta un doble. Evita cargar el
// proveedor SES (nodemailer) solo por importar el tipo.
jest.mock('./notification-email.service', () => ({ NotificationEmailService: class {} }));

import { NotificationDispatcher, NotifyInput } from './notification-dispatcher.service';
import { NotificationRecipient } from './notification-recipients.service';
import { NotificationChannelFlags } from './notification-catalog';

const STORE_ID = 10;

function staff(user_id: number, email: string | null = `u${user_id}@tienda.co`): NotificationRecipient {
  return { user_id, kind: 'staff', email, first_name: `U${user_id}` };
}

function build(opts: {
  recipients?: NotificationRecipient[];
  prefs?: Record<number, NotificationChannelFlags>;
  storeEmail?: boolean | Error;
  createManyCount?: number;
  createNotification?: jest.Mock;
} = {}) {
  let nextId = 100;
  const notificationsCreate =
    opts.createNotification ??
    jest.fn().mockImplementation(({ data }) =>
      Promise.resolve({ id: nextId++, ...data, created_at: new Date('2026-12-28T10:00:00Z') }),
    );
  const deliveriesCreateMany = jest
    .fn()
    .mockResolvedValue({ count: opts.createManyCount ?? 1 });
  const prisma = {
    notifications: { create: notificationsCreate },
    notification_deliveries: { createMany: deliveriesCreateMany },
  } as any;
  const sse = { pushToUser: jest.fn() } as any;
  const push = { sendToUser: jest.fn().mockResolvedValue(undefined) } as any;

  const recipientList = opts.recipients ?? [staff(1)];
  const classify = jest
    .fn()
    .mockResolvedValue(new Map(recipientList.map((r) => [r.user_id, r])));
  const resolveForUsers = jest.fn().mockImplementation((_s, ids: number[]) =>
    Promise.resolve(
      new Map(
        ids.map((id) => [id, opts.prefs?.[id] ?? { push: true, email: false }]),
      ),
    ),
  );
  const isStoreEmailEnabled = jest.fn().mockImplementation(() =>
    opts.storeEmail instanceof Error
      ? Promise.reject(opts.storeEmail)
      : Promise.resolve(opts.storeEmail ?? true),
  );

  const dispatcher = new NotificationDispatcher(
    prisma,
    sse,
    push,
    { resolveForUsers } as any,
    { classify } as any,
    { isStoreEmailEnabled } as any,
  );
  return {
    dispatcher,
    notificationsCreate,
    deliveriesCreateMany,
    sse,
    push,
    classify,
    resolveForUsers,
    isStoreEmailEnabled,
  };
}

const input = (overrides: Partial<NotifyInput> = {}): NotifyInput => ({
  store_id: STORE_ID,
  user_ids: [1],
  type: 'crm_task_assigned',
  title: 'Tarea asignada',
  body: 'Llamar a Ana',
  data: { url: '/admin/customers/tasks', task_id: 7 },
  ...overrides,
});

describe('NotificationDispatcher.notify', () => {
  it('sin fila de preferencia (default): campana + SSE + dispositivo, sin correo', async () => {
    const { dispatcher, notificationsCreate, sse, push, deliveriesCreateMany } = build();

    const [result] = await dispatcher.notify(input());

    expect(notificationsCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        store_id: STORE_ID,
        type: 'crm_task_assigned',
        data: { url: '/admin/customers/tasks', task_id: 7, target_user_id: 1 },
      }),
    });
    expect(sse.pushToUser).toHaveBeenCalledWith(STORE_ID, 1, expect.objectContaining({ id: 100 }));
    expect(push.sendToUser).toHaveBeenCalledWith(
      STORE_ID,
      1,
      'crm_task_assigned',
      'Tarea asignada',
      'Llamar a Ana',
      { url: '/admin/customers/tasks', task_id: 7 },
    );
    expect(deliveriesCreateMany).not.toHaveBeenCalled();
    expect(result).toMatchObject({ user_id: 1, status: 'delivered', push: true, email: 'off' });
  });

  it('Dispositivo apagado: campana sí, push no', async () => {
    const { dispatcher, notificationsCreate, sse, push } = build({
      prefs: { 1: { push: false, email: false } },
    });
    const [result] = await dispatcher.notify(input());
    expect(notificationsCreate).toHaveBeenCalledTimes(1);
    expect(sse.pushToUser).toHaveBeenCalledTimes(1);
    expect(push.sendToUser).not.toHaveBeenCalled();
    expect(result.push).toBe(false);
  });

  it('Correo encendido: encola la entrega con la ruta del aviso', async () => {
    const { dispatcher, deliveriesCreateMany } = build({
      prefs: { 1: { push: true, email: true } },
    });
    const [result] = await dispatcher.notify(input({ dedupe_key: 'crm_task:7:assigned' }));

    expect(deliveriesCreateMany).toHaveBeenCalledWith({
      data: [
        {
          store_id: STORE_ID,
          notification_id: 100,
          user_id: 1,
          channel: 'email',
          type: 'crm_task_assigned',
          dedupe_key: 'crm_task:7:assigned',
          payload: { title: 'Tarea asignada', body: 'Llamar a Ana', url: '/admin/customers/tasks' },
        },
      ],
      skipDuplicates: true,
    });
    expect(result.email).toBe('queued');
  });

  it('sin dedupe_key usa la fila de la campana como clave', async () => {
    const { dispatcher, deliveriesCreateMany } = build({ prefs: { 1: { push: true, email: true } } });
    await dispatcher.notify(input());
    expect(deliveriesCreateMany.mock.calls[0][0].data[0].dedupe_key).toBe('notification:100');
  });

  it('idempotencia: la misma dedupe_key no encola dos veces', async () => {
    const { dispatcher } = build({ prefs: { 1: { push: true, email: true } }, createManyCount: 0 });
    const [result] = await dispatcher.notify(input({ dedupe_key: 'crm_task:7:assigned' }));
    expect(result.email).toBe('duplicate');
  });

  it('maestro de correo de la tienda apagado: no encola', async () => {
    const { dispatcher, deliveriesCreateMany } = build({
      prefs: { 1: { push: true, email: true } },
      storeEmail: false,
    });
    const [result] = await dispatcher.notify(input());
    expect(deliveriesCreateMany).not.toHaveBeenCalled();
    expect(result.email).toBe('store_disabled');
  });

  it('maestro ilegible: no encola (conservador) y no lanza', async () => {
    const { dispatcher, deliveriesCreateMany } = build({
      prefs: { 1: { push: true, email: true } },
      storeEmail: new Error('db down'),
    });
    const [result] = await dispatcher.notify(input());
    expect(deliveriesCreateMany).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'delivered', email: 'store_disabled' });
  });

  it('nadie pidió correo: ni siquiera lee el maestro', async () => {
    const { dispatcher, isStoreEmailEnabled } = build();
    await dispatcher.notify(input());
    expect(isStoreEmailEnabled).not.toHaveBeenCalled();
  });

  it('sin dirección de correo: no encola', async () => {
    const { dispatcher, deliveriesCreateMany } = build({
      recipients: [staff(1, null)],
      prefs: { 1: { push: true, email: true } },
    });
    const [result] = await dispatcher.notify(input());
    expect(deliveriesCreateMany).not.toHaveBeenCalled();
    expect(result.email).toBe('no_email');
  });

  it('tipo sin canal de correo (difusión) nunca encola', async () => {
    const { dispatcher, deliveriesCreateMany } = build({ prefs: { 1: { push: true, email: true } } });
    const [result] = await dispatcher.notify(input({ type: 'new_order' }));
    expect(deliveriesCreateMany).not.toHaveBeenCalled();
    expect(result.email).toBe('not_supported');
  });

  it('cliente de la tienda (puente legado): campana y dispositivo, nunca correo', async () => {
    const { dispatcher, deliveriesCreateMany, push, classify } = build({
      recipients: [{ user_id: 3, kind: 'customer', email: 'c@x.co', first_name: 'C' }],
      prefs: { 3: { push: true, email: true } },
    });
    const [result] = await dispatcher.notify(
      input({ user_ids: [3], allow_store_customers: true }),
    );
    expect(classify).toHaveBeenCalledWith(STORE_ID, [3], { allow_store_customers: true });
    expect(push.sendToUser).toHaveBeenCalled();
    expect(deliveriesCreateMany).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'delivered', email: 'not_supported' });
  });

  it('usuario de otra tienda, dado de baja o cliente final: nada de nada', async () => {
    const { dispatcher, notificationsCreate, sse, push, resolveForUsers } = build({
      recipients: [],
    });
    const results = await dispatcher.notify(input({ user_ids: [7, 8] }));
    expect(results).toEqual([
      expect.objectContaining({ user_id: 7, status: 'skipped', reason: 'not_store_member' }),
      expect.objectContaining({ user_id: 8, status: 'skipped', reason: 'not_store_member' }),
    ]);
    expect(notificationsCreate).not.toHaveBeenCalled();
    expect(sse.pushToUser).not.toHaveBeenCalled();
    expect(push.sendToUser).not.toHaveBeenCalled();
    expect(resolveForUsers).not.toHaveBeenCalled();
  });

  it('nunca lanza: un error de campana queda como failed para ese destinatario', async () => {
    const { dispatcher } = build({
      recipients: [staff(1), staff(2)],
      createNotification: jest
        .fn()
        .mockRejectedValueOnce(new Error('insert failed'))
        .mockResolvedValueOnce({ id: 5, type: 'crm_task_assigned', title: 't', body: 'b', data: {}, created_at: new Date() }),
    });
    const results = await dispatcher.notify(input({ user_ids: [1, 2] }));
    expect(results.map((r) => [r.user_id, r.status])).toEqual([
      [1, 'failed'],
      [2, 'delivered'],
    ]);
  });

  it('nunca lanza: si falla la clasificación devuelve failed para todos', async () => {
    const { dispatcher, classify } = build();
    classify.mockRejectedValueOnce(new Error('db down'));
    await expect(dispatcher.notify(input({ user_ids: [1, 2] }))).resolves.toEqual([
      expect.objectContaining({ user_id: 1, status: 'failed', reason: 'error' }),
      expect.objectContaining({ user_id: 2, status: 'failed', reason: 'error' }),
    ]);
  });
});
