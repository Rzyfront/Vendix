import { Logger } from '@nestjs/common';
import { VendixHttpException } from '../../../common/errors';
import {
  MY_NOTIFICATIONS_ROUTE,
  MyNotificationsService,
  NOTIFICATION_TEST_COOLDOWN_MS,
  maskEmail,
} from './my-notifications.service';

const STORE = 10;
const USER = 2;
const T0 = 1_000_000;

function type(
  key: string,
  channels: { push: boolean; email: boolean },
  effective: { push: boolean; email: boolean },
) {
  return { type: key, label: key, description: key, channels, defaults: effective, effective };
}

function setup(
  options: {
    kind?: 'staff' | 'customer' | 'unknown';
    email?: string | null;
    push?: boolean;
    emailOn?: boolean;
    devices?: number;
    storeEmail?: boolean | Error;
    sendOk?: boolean;
  } = {},
) {
  const groups = [
    {
      key: 'crm',
      label: 'Clientes y CRM',
      types: [
        type(
          'crm_task_assigned',
          { push: true, email: true },
          { push: options.push ?? true, email: options.emailOn ?? false },
        ),
        type('crm_task_digest', { push: false, email: true }, { push: false, email: false }),
      ],
    },
  ];
  const global_prisma = {
    users: { findUnique: jest.fn(async (..._args: any[]) => ({ email: 'juan@correo.com' })) },
    push_subscriptions: { count: jest.fn(async (..._args: any[]) => options.devices ?? 1) },
  };
  const preferences = { getGroupedForUser: jest.fn(async (..._args: any[]) => groups) };
  const push_service = { sendToUser: jest.fn(async (..._args: any[]) => undefined) };
  const email_service = {
    isStoreEmailEnabled: jest.fn(async (..._args: any[]) => {
      if (options.storeEmail instanceof Error) throw options.storeEmail;
      return options.storeEmail ?? true;
    }),
    send: jest.fn(async (..._args: any[]) =>
      options.sendOk === false ? { success: false, error: 'SES down' } : { success: true },
    ),
  };
  const recipients = {
    classify: jest.fn(async (_store: number, ids: number[]) => {
      const kind = options.kind ?? 'staff';
      if (kind === 'unknown') return new Map();
      return new Map(
        ids.map((id) => [
          id,
          {
            user_id: id,
            kind,
            email: options.email === undefined ? 'juan@correo.com' : options.email,
            first_name: 'Juan',
          },
        ]),
      );
    }),
  };
  // Fake Redis `SET key value PX ttl NX`, on the clock passed as `value`.
  const expiries = new Map<string, number>();
  const redis = {
    set: jest.fn(async (key: string, value: string, _px: 'PX', ttl: number, _nx: 'NX') => {
      const now = Number(value);
      const until = expiries.get(key);
      if (until !== undefined && now < until) return null;
      expiries.set(key, now + ttl);
      return 'OK';
    }),
  };
  const service = new MyNotificationsService(
    global_prisma as any,
    preferences as any,
    push_service as any,
    email_service as any,
    recipients as any,
    redis as any,
  );
  return { service, global_prisma, preferences, push_service, email_service, recipients, groups, redis };
}

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('maskEmail', () => {
  it('shows the first letter and the domain only', () => {
    expect(maskEmail('juan@correo.com')).toBe('j***@correo.com');
    expect(maskEmail('  ')).toBeNull();
    expect(maskEmail(null)).toBeNull();
    expect(maskEmail('sin-arroba')).toBe('***');
  });
});

describe('MyNotificationsService.getView', () => {
  it('returns the grouped catalog, the store e-mail master and the masked e-mail', async () => {
    const { service, preferences, groups } = setup({ storeEmail: false });
    expect(await service.getView(STORE, USER)).toEqual({
      groups,
      store_email_enabled: false,
      user_email: 'j***@correo.com',
    });
    expect(preferences.getGroupedForUser).toHaveBeenCalledWith(STORE, USER);
  });

  it('an unreadable store master does not break the screen', async () => {
    const { service } = setup({ storeEmail: new Error('db') });
    expect((await service.getView(STORE, USER)).store_email_enabled).toBe(true);
  });
});

describe('MyNotificationsService.sendTest', () => {
  it('sends to the own devices of this store and the own e-mail when both are on', async () => {
    const { service, push_service, email_service, global_prisma } = setup({ emailOn: true });
    const result = await service.sendTest(STORE, USER, T0);
    expect(result).toEqual({
      push: { enabled: true, devices: 1 },
      email: { status: 'sent', to: 'j***@correo.com' },
    });
    expect(global_prisma.push_subscriptions.count).toHaveBeenCalledWith({
      where: { store_id: STORE, user_id: USER },
    });
    expect(push_service.sendToUser).toHaveBeenCalledWith(
      STORE,
      USER,
      'notification_test',
      'Aviso de prueba',
      'Así te llegarán los avisos de Vendix.',
      { url: MY_NOTIFICATIONS_ROUTE },
    );
    expect(email_service.send).toHaveBeenCalledWith({
      store_id: STORE,
      to: 'juan@correo.com',
      first_name: 'Juan',
      title: 'Aviso de prueba',
      body: 'Así te llegarán los avisos de Vendix.',
      url: MY_NOTIFICATIONS_ROUTE,
    });
  });

  it('with every e-mail off (default, D1) only the device gets it', async () => {
    const { service, email_service } = setup();
    const result = await service.sendTest(STORE, USER, T0);
    expect(result.email).toEqual({ status: 'off', to: 'j***@correo.com' });
    expect(email_service.send).not.toHaveBeenCalled();
  });

  it('device on but no device registered: says so and sends nothing', async () => {
    const { service, push_service } = setup({ devices: 0 });
    expect((await service.sendTest(STORE, USER, T0)).push).toEqual({ enabled: true, devices: 0 });
    expect(push_service.sendToUser).not.toHaveBeenCalled();
  });

  it('device off in every notice: no push', async () => {
    const { service, push_service, global_prisma } = setup({ push: false });
    expect((await service.sendTest(STORE, USER, T0)).push).toEqual({
      enabled: false,
      devices: 0,
    });
    expect(global_prisma.push_subscriptions.count).not.toHaveBeenCalled();
    expect(push_service.sendToUser).not.toHaveBeenCalled();
  });

  it.each([
    ['no_email', { emailOn: true, email: null }],
    ['store_disabled', { emailOn: true, storeEmail: false }],
    ['failed', { emailOn: true, sendOk: false }],
  ] as const)('reports e-mail status %s', async (status, options) => {
    const { service } = setup(options);
    expect((await service.sendTest(STORE, USER, T0)).email.status).toBe(status);
  });

  it('someone who is not staff of this store gets nothing', async () => {
    for (const kind of ['customer', 'unknown'] as const) {
      const { service, push_service, email_service } = setup({ kind, emailOn: true });
      expect(await service.sendTest(STORE, USER, T0)).toEqual({
        push: { enabled: false, devices: 0 },
        email: { status: 'off', to: null },
      });
      expect(push_service.sendToUser).not.toHaveBeenCalled();
      expect(email_service.send).not.toHaveBeenCalled();
    }
  });

  it('a second test within 30 s answers 429; after the cooldown it works again', async () => {
    const { service, push_service } = setup();
    await service.sendTest(STORE, USER, T0);
    const error = await service
      .sendTest(STORE, USER, T0 + NOTIFICATION_TEST_COOLDOWN_MS - 1)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VendixHttpException);
    expect((error as VendixHttpException).errorCode).toBe('NOTIFICATION_TEST_RATE_LIMITED');
    expect((error as VendixHttpException).getStatus()).toBe(429);

    await service.sendTest(STORE, USER, T0 + NOTIFICATION_TEST_COOLDOWN_MS);
    expect(push_service.sendToUser).toHaveBeenCalledTimes(2);
  });

  it('the cooldown lives in Redis, shared by every API replica', async () => {
    const { service, redis } = setup();
    await service.sendTest(STORE, USER, T0);
    expect(redis.set).toHaveBeenCalledWith(
      `notifications:test:${STORE}:${USER}`,
      String(T0),
      'PX',
      NOTIFICATION_TEST_COOLDOWN_MS,
      'NX',
    );
  });

  it('if Redis fails, the cooldown falls back to memory', async () => {
    const { service, redis, push_service } = setup();
    redis.set.mockRejectedValue(new Error('redis down'));
    await service.sendTest(STORE, USER, T0);
    await expect(service.sendTest(STORE, USER, T0 + 1)).rejects.toBeInstanceOf(VendixHttpException);
    await service.sendTest(STORE, USER, T0 + NOTIFICATION_TEST_COOLDOWN_MS);
    expect(push_service.sendToUser).toHaveBeenCalledTimes(2);
  });

  it('the cooldown is per store and user', async () => {
    const { service } = setup();
    await service.sendTest(STORE, USER, T0);
    await expect(service.sendTest(STORE, USER + 1, T0)).resolves.toBeDefined();
    await expect(service.sendTest(STORE + 1, USER, T0)).resolves.toBeDefined();
  });
});
