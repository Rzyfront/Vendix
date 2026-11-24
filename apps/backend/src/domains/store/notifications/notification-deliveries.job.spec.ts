// El correo real no participa: se inyecta un doble. Evita cargar el
// proveedor SES (nodemailer) solo por importar el tipo.
jest.mock('./notification-email.service', () => ({ NotificationEmailService: class {} }));

import {
  DELIVERY_ABANDONED_ERROR,
  DELIVERY_BACKOFF_MINUTES,
  DELIVERY_MAX_ATTEMPTS,
  NotificationDeliveriesJob,
  ClaimedDelivery,
} from './notification-deliveries.job';
import { NotificationRecipient } from './notification-recipients.service';

const NOW = new Date('2026-12-28T10:00:00Z');
const STORE_ID = 10;

function row(overrides: Partial<ClaimedDelivery> = {}): ClaimedDelivery {
  return {
    id: 1,
    store_id: STORE_ID,
    user_id: 5,
    type: 'crm_task_assigned' as ClaimedDelivery['type'],
    payload: { title: 'Tarea asignada', body: 'Llamar a Ana', url: '/admin/customers/tasks' },
    attempts: 1,
    ...overrides,
  };
}

function build(opts: {
  rows?: ClaimedDelivery[];
  recipient?: NotificationRecipient | null;
  emailPref?: boolean;
  storeEmail?: boolean;
  send?: jest.Mock;
  buried?: number;
} = {}) {
  const updateMany = jest.fn().mockImplementation(({ where }) =>
    Promise.resolve({ count: where.attempts ? opts.buried ?? 0 : 1 }),
  );
  const queryRaw = jest.fn().mockResolvedValueOnce(opts.rows ?? [row()]).mockResolvedValue([]);
  const prisma = {
    notification_deliveries: { updateMany },
    $queryRaw: queryRaw,
  } as any;
  const recipient =
    opts.recipient === undefined
      ? ({ user_id: 5, kind: 'staff', email: 'ana@tienda.co', first_name: 'Ana' } as NotificationRecipient)
      : opts.recipient;
  const classify = jest
    .fn()
    .mockResolvedValue(new Map(recipient ? [[recipient.user_id, recipient]] : []));
  const resolveForUsers = jest
    .fn()
    .mockResolvedValue(new Map([[5, { push: true, email: opts.emailPref ?? true }]]));
  const send = opts.send ?? jest.fn().mockResolvedValue({ success: true });
  const isStoreEmailEnabled = jest.fn().mockResolvedValue(opts.storeEmail ?? true);

  const job = new NotificationDeliveriesJob(
    prisma,
    { classify } as any,
    { resolveForUsers } as any,
    { send, isStoreEmailEnabled } as any,
  );
  return { job, updateMany, queryRaw, classify, send };
}

/** La escritura de cierre de la fila (excluye el entierro de abandonadas). */
function finishCall(updateMany: jest.Mock) {
  return updateMany.mock.calls.map((c) => c[0]).find((arg) => arg.where.id !== undefined);
}

describe('NotificationDeliveriesJob.dispatchBatch', () => {
  it('envía y marca sent', async () => {
    const { job, send, updateMany, classify } = build();
    const summary = await job.dispatchBatch(20, NOW);

    expect(classify).toHaveBeenCalledWith(STORE_ID, [5]);
    expect(send).toHaveBeenCalledWith({
      store_id: STORE_ID,
      to: 'ana@tienda.co',
      first_name: 'Ana',
      title: 'Tarea asignada',
      body: 'Llamar a Ana',
      url: '/admin/customers/tasks',
    });
    expect(finishCall(updateMany)).toEqual({
      where: { id: 1, status: 'pending' },
      data: { status: 'sent', sent_at: expect.any(Date), error: null },
    });
    expect(summary).toMatchObject({ claimed: 1, sent: 1, retried: 0, failed: 0 });
  });

  it('error del proveedor: reintenta con backoff', async () => {
    const { job, updateMany } = build({
      rows: [row({ attempts: 2 })],
      send: jest.fn().mockResolvedValue({ success: false, error: 'SES throttled' }),
    });
    const summary = await job.dispatchBatch(20, NOW);

    expect(finishCall(updateMany)).toEqual({
      where: { id: 1, status: 'pending' },
      data: {
        error: 'SES throttled',
        next_attempt_at: new Date(NOW.getTime() + DELIVERY_BACKOFF_MINUTES[1] * 60_000),
      },
    });
    expect(summary).toMatchObject({ retried: 1, failed: 0 });
  });

  it('último intento fallido: failed definitivo', async () => {
    const { job, updateMany } = build({
      rows: [row({ attempts: DELIVERY_MAX_ATTEMPTS })],
      send: jest.fn().mockRejectedValue(new Error('smtp down')),
    });
    const summary = await job.dispatchBatch(20, NOW);

    expect(finishCall(updateMany)).toEqual({
      where: { id: 1, status: 'pending' },
      data: { status: 'failed', error: 'smtp down' },
    });
    expect(summary).toMatchObject({ retried: 0, failed: 1 });
  });

  it.each([
    ['ya no es personal activo de la tienda', { recipient: null }, 'Recipient is no longer active staff of the store'],
    ['sin correo', { recipient: { user_id: 5, kind: 'staff', email: null, first_name: 'Ana' } }, 'Recipient has no e-mail'],
    ['apagó Correo', { emailPref: false }, 'E-mail preference is off'],
    ['maestro de tienda apagado', { storeEmail: false }, 'Store e-mail notifications are disabled'],
  ] as const)('%s: skipped sin enviar', async (_label, opts, reason) => {
    const { job, send, updateMany } = build(opts as Parameters<typeof build>[0]);
    const summary = await job.dispatchBatch(20, NOW);

    expect(send).not.toHaveBeenCalled();
    expect(finishCall(updateMany)).toEqual({
      where: { id: 1, status: 'pending' },
      data: { status: 'skipped', error: reason },
    });
    expect(summary.skipped).toBe(1);
  });

  it('entierra como failed las filas abandonadas en su último intento', async () => {
    const { job, updateMany } = build({ rows: [], buried: 2 });
    const summary = await job.dispatchBatch(20, NOW);

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        status: 'pending',
        channel: 'email',
        attempts: { gte: DELIVERY_MAX_ATTEMPTS },
        next_attempt_at: { lte: NOW },
      },
      data: { status: 'failed', error: DELIVERY_ABANDONED_ERROR },
    });
    expect(summary).toMatchObject({ claimed: 0, failed: 2 });
  });

  it('drain vacía la cola en lotes hasta que no queda nada', async () => {
    const { job, queryRaw } = build({ rows: [row(), row({ id: 2 })] });
    const processed = await job.drain();
    expect(processed).toBe(2);
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });
});
