jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn().mockResolvedValue(undefined),
}));

import { NotificationsPushService } from './notifications-push.service';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const webpush = require('web-push');

function build(subscriptions: Array<Record<string, unknown>>) {
  const findMany = jest.fn().mockResolvedValue(subscriptions);
  const prisma = { push_subscriptions: { findMany, delete: jest.fn() } } as any;
  const service = new NotificationsPushService(prisma);
  // VAPID listo sin depender de variables de entorno.
  (service as unknown as { vapid_configured: boolean }).vapid_configured = true;
  return { service, findMany };
}

describe('NotificationsPushService.sendToUser', () => {
  beforeEach(() => jest.clearAllMocks());

  it('solo usa las suscripciones del usuario en ESA tienda', async () => {
    const { service, findMany } = build([
      { id: 1, endpoint: 'https://push/a', p256dh: 'k', auth: 'a' },
    ]);

    await service.sendToUser(10, 5, 'crm_task_assigned', 'Tarea', 'Cuerpo', { url: '/x' });

    expect(findMany).toHaveBeenCalledWith({ where: { store_id: 10, user_id: 5 } });
    expect(webpush.sendNotification).toHaveBeenCalledTimes(1);
    expect(webpush.sendNotification).toHaveBeenCalledWith(
      { endpoint: 'https://push/a', keys: { p256dh: 'k', auth: 'a' } },
      JSON.stringify({ title: 'Tarea', body: 'Cuerpo', data: { url: '/x', type: 'crm_task_assigned' } }),
    );
  });

  it('sin suscripciones en esa tienda no envía nada', async () => {
    const { service } = build([]);
    await service.sendToUser(10, 5, 'crm_task_due', 'T', 'B');
    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });
});
