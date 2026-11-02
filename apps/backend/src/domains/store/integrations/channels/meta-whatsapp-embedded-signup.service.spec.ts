import { ConfigService } from '@nestjs/config';
import { RequestContextService } from '@common/context/request-context.service';
import { MetaWhatsappEmbeddedSignupService } from './meta-whatsapp-embedded-signup.service';
import { ChannelEncryptionService } from './channel-encryption.service';

const configValues: Record<string, string> = {
  META_APP_ID: '123',
  META_APP_SECRET: 'app-secret',
  META_WHATSAPP_CONFIG_ID: 'config-123',
  META_WHATSAPP_VERIFY_TOKEN: 'verify-token',
  META_GRAPH_VERSION: 'v23.0',
  META_WHATSAPP_APP_REVIEW_STATUS: 'approved',
  SOCIAL_CHANNEL_ENCRYPTION_KEY: 'test-social-channel-encryption-key',
};

function createService(overrides?: {
  config?: Record<string, string | undefined>;
  findFirst?: jest.Mock;
  create?: jest.Mock;
  updateMany?: jest.Mock;
  platformFindUnique?: jest.Mock;
}) {
  const config = {
    get: jest.fn(
      (key: string) =>
        ({
          ...configValues,
          ...(overrides?.config ?? {}),
        })[key],
    ),
  } as any as ConfigService;
  const encryption = new ChannelEncryptionService(config);
  const prisma = {
    social_channels: {
      findFirst: overrides?.findFirst ?? jest.fn(),
      create: overrides?.create ?? jest.fn(),
      updateMany: overrides?.updateMany ?? jest.fn(),
    },
  } as any;
  const globalPrisma = {
    platform_settings: {
      findUnique:
        overrides?.platformFindUnique ?? jest.fn().mockResolvedValue(null),
    },
  } as any;

  return {
    service: new MetaWhatsappEmbeddedSignupService(
      prisma,
      globalPrisma,
      config,
      encryption,
    ),
    prisma,
    encryption,
  };
}

type FetchRoute = (url: string, init?: RequestInit) => unknown;

/** Routes fake Graph responses by URL; every call is recorded. */
function mockGraph(routes: Record<string, FetchRoute | unknown>) {
  return jest
    .spyOn(global, 'fetch')
    .mockImplementation(async (input: any, init?: any) => {
      const url = String(input);
      const key = Object.keys(routes).find((k) => url.includes(k));
      if (!key) throw new Error(`unexpected fetch ${url}`);
      const route = routes[key];
      const out = typeof route === 'function' ? route(url, init) : route;
      const { status = 200, body } = out as { status?: number; body: unknown };
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
      } as unknown as Response;
    });
}

const tokenOk = {
  body: { access_token: 'plain-meta-token', token_type: 'bearer' },
};
const subscribeOk = { body: { success: true } };
const registerOk = { body: { success: true } };
const ctx = {
  store_id: 10,
  organization_id: 20,
  is_super_admin: false,
  is_owner: false,
};
const run = <T>(fn: () => Promise<T>) => RequestContextService.run(ctx, fn);
const fullDto = {
  code: 'oauth-code',
  waba_id: 'waba-1',
  phone_number_id: 'phone-1',
  display_phone_number: '+57 300 000 0000',
};

function registerCall(fetchMock: jest.SpyInstance) {
  const call = fetchMock.mock.calls.find(([u]) =>
    String(u).endsWith('/phone-1/register'),
  );
  return call as [string, RequestInit] | undefined;
}

describe('MetaWhatsappEmbeddedSignupService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reports missing platform configuration in readiness', async () => {
    const { service } = createService({
      config: {
        META_APP_ID: undefined,
        META_APP_SECRET: undefined,
        META_WHATSAPP_CONFIG_ID: undefined,
      },
    });

    const readiness = await service.getReadiness();

    expect(readiness.status).toBe('missing_env');
    expect(readiness.missing_envs).toEqual(
      expect.arrayContaining([
        'META_APP_ID',
        'META_APP_SECRET',
        'META_WHATSAPP_CONFIG_ID',
      ]),
    );
  });

  it('registers the number with a random 6 digit PIN stored encrypted', async () => {
    const create = jest.fn();
    const findFirst = jest.fn().mockResolvedValue(null);
    const { service, encryption } = createService({ create, findFirst });
    const fetchMock = mockGraph({
      'oauth/access_token': tokenOk,
      '/waba-1/subscribed_apps': subscribeOk,
      '/phone-1/register': registerOk,
    });

    await run(() => service.completeEmbeddedSignup(fullDto));

    const call = registerCall(fetchMock);
    expect(call).toBeDefined();
    const [url, init] = call!;
    expect(url).toBe('https://graph.facebook.com/v23.0/phone-1/register');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer plain-meta-token',
    );
    const sent = JSON.parse(String(init.body));
    expect(sent.messaging_product).toBe('whatsapp');
    expect(sent.pin).toMatch(/^\d{6}$/);

    const data = create.mock.calls[0][0].data;
    expect(data.status).toBe('connected');
    expect(data.last_error).toBeNull();
    expect(data.access_token_encrypted).not.toContain('plain-meta-token');
    expect(data.metadata.registration.status).toBe('registered');
    expect(data.metadata.registration.pin_encrypted).not.toContain(sent.pin);
    expect(encryption.decrypt(data.metadata.registration.pin_encrypted)).toBe(
      sent.pin,
    );
    expect(data.metadata.embedded_signup).toBeDefined();
  });

  it('keeps the channel with status error and a readable last_error when register fails', async () => {
    const create = jest.fn();
    const { service } = createService({
      create,
      findFirst: jest.fn().mockResolvedValue(null),
    });
    mockGraph({
      'oauth/access_token': tokenOk,
      '/waba-1/subscribed_apps': subscribeOk,
      '/phone-1/register': {
        status: 400,
        body: {
          error: { code: 133016, message: 'Too many register requests' },
        },
      },
    });

    await run(() => service.completeEmbeddedSignup(fullDto));

    const data = create.mock.calls[0][0].data;
    expect(data.status).toBe('error');
    expect(data.last_error).toContain('133016');
    expect(data.last_error).toContain('No se pudo registrar el número');
    expect(data.access_token_encrypted).toBeTruthy();
    expect(data.waba_id).toBe('waba-1');
    expect(data.phone_number_id).toBe('phone-1');
    expect(data.metadata.registration.status).toBe('failed');
    expect(data.metadata.registration.pin_encrypted).toBeTruthy();
  });

  it('treats an HTTP 200 without success true as a failed registration', async () => {
    const create = jest.fn();
    const { service } = createService({
      create,
      findFirst: jest.fn().mockResolvedValue(null),
    });
    mockGraph({
      'oauth/access_token': tokenOk,
      '/waba-1/subscribed_apps': subscribeOk,
      '/phone-1/register': { body: { success: false } },
    });

    await run(() => service.completeEmbeddedSignup(fullDto));

    expect(create.mock.calls[0][0].data.status).toBe('error');
  });

  it('does not throw when the register request itself fails', async () => {
    const create = jest.fn();
    const { service } = createService({
      create,
      findFirst: jest.fn().mockResolvedValue(null),
    });
    mockGraph({
      'oauth/access_token': tokenOk,
      '/waba-1/subscribed_apps': subscribeOk,
      '/phone-1/register': () => {
        throw new Error('socket hang up');
      },
    });

    await run(() => service.completeEmbeddedSignup(fullDto));

    const data = create.mock.calls[0][0].data;
    expect(data.status).toBe('error');
    expect(data.metadata.registration.status).toBe('failed');
  });

  it('merges previous metadata and reuses the stored PIN on reconnect', async () => {
    const updateMany = jest.fn();
    const first = createService();
    const pin_encrypted = first.encryption.encrypt('123456');
    const existing = {
      id: 5,
      metadata: {
        keep_me: true,
        registration: { pin_encrypted, status: 'failed' },
      },
    };
    const { service } = createService({
      updateMany,
      findFirst: jest.fn().mockResolvedValue(existing),
    });
    const fetchMock = mockGraph({
      'oauth/access_token': tokenOk,
      '/waba-1/subscribed_apps': subscribeOk,
      '/phone-1/register': registerOk,
    });

    await run(() => service.completeEmbeddedSignup(fullDto));

    expect(JSON.parse(String(registerCall(fetchMock)![1].body)).pin).toBe(
      '123456',
    );
    const data = updateMany.mock.calls[0][0].data;
    expect(data.metadata.keep_me).toBe(true);
    expect(data.metadata.registration.status).toBe('registered');
  });

  it('resolves a missing phone_number_id from the WABA phone numbers', async () => {
    const create = jest.fn();
    const { service } = createService({
      create,
      findFirst: jest.fn().mockResolvedValue(null),
    });
    const fetchMock = mockGraph({
      'oauth/access_token': tokenOk,
      '/waba-1/phone_numbers': {
        body: { data: [{ id: 'phone-1' }, { id: 'phone-2' }] },
      },
      '/waba-1/subscribed_apps': subscribeOk,
      '/phone-1/register': registerOk,
    });

    await run(() =>
      service.completeEmbeddedSignup({ code: 'c', waba_id: 'waba-1' }),
    );

    expect(create.mock.calls[0][0].data.phone_number_id).toBe('phone-1');
    expect(registerCall(fetchMock)).toBeDefined();
    expect(
      create.mock.calls[0][0].data.metadata.embedded_signup.note,
    ).toContain('2');
  });

  it('resolves a missing waba_id through debug_token granular scopes', async () => {
    const create = jest.fn();
    const { service } = createService({
      create,
      findFirst: jest.fn().mockResolvedValue(null),
    });
    mockGraph({
      'oauth/access_token': tokenOk,
      '/debug_token': {
        body: {
          data: {
            granular_scopes: [
              { scope: 'business_management', target_ids: ['x'] },
              { scope: 'whatsapp_business_management', target_ids: ['waba-1'] },
            ],
          },
        },
      },
      '/waba-1/phone_numbers': { body: { data: [{ id: 'phone-1' }] } },
      '/waba-1/subscribed_apps': subscribeOk,
      '/phone-1/register': registerOk,
    });

    await run(() => service.completeEmbeddedSignup({ code: 'c' }));

    const data = create.mock.calls[0][0].data;
    expect(data.waba_id).toBe('waba-1');
    expect(data.phone_number_id).toBe('phone-1');
  });

  it('rejects with a clear message and saves nothing when ids cannot be resolved', async () => {
    const create = jest.fn();
    const updateMany = jest.fn();
    const { service } = createService({
      create,
      updateMany,
      findFirst: jest.fn().mockResolvedValue(null),
    });
    mockGraph({
      'oauth/access_token': tokenOk,
      '/debug_token': { body: { data: { granular_scopes: [] } } },
    });

    await expect(
      run(() => service.completeEmbeddedSignup({ code: 'c' })),
    ).rejects.toThrow(/número|cuenta/i);
    expect(create).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('never exposes the encrypted PIN in the channel payload', async () => {
    const findFirst = jest.fn().mockResolvedValue({
      id: 1,
      status: 'connected',
      metadata: {
        registration: {
          pin_encrypted: 'secret',
          status: 'registered',
          registered_at: 'x',
        },
      },
    });
    const { service } = createService({ findFirst });

    const result: any = await service.getWhatsappChannel();

    expect(JSON.stringify(result)).not.toContain('pin_encrypted');
    expect(result.registration_status).toBe('registered');
  });

  describe('retryWhatsappRegistration', () => {
    function channelWith(encryption: ChannelEncryptionService, extra = {}) {
      return {
        id: 3,
        status: 'connected',
        phone_number_id: 'phone-1',
        waba_id: 'waba-1',
        access_token_encrypted: encryption.encrypt('plain-meta-token'),
        metadata: { webhook_subscription: { status: 'subscribed' } },
        ...extra,
      };
    }

    it('registers a connected channel that was never registered', async () => {
      const updateMany = jest.fn();
      const base = createService();
      const channel = channelWith(base.encryption);
      const { service } = createService({
        updateMany,
        findFirst: jest.fn().mockResolvedValue(channel),
      });
      const fetchMock = mockGraph({ '/phone-1/register': registerOk });

      const result: any = await run(() => service.retryWhatsappRegistration());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, init] = registerCall(fetchMock)!;
      expect(JSON.parse(String(init.body)).pin).toMatch(/^\d{6}$/);
      const data = updateMany.mock.calls[0][0].data;
      expect(data.status).toBe('connected');
      expect(data.metadata.registration.status).toBe('registered');
      expect(data.metadata.webhook_subscription.status).toBe('subscribed');
      expect(result).toBeDefined();
    });

    it('stores the failure as status error with the Meta code', async () => {
      const updateMany = jest.fn();
      const base = createService();
      const { service } = createService({
        updateMany,
        findFirst: jest.fn().mockResolvedValue(channelWith(base.encryption)),
      });
      mockGraph({
        '/phone-1/register': {
          status: 400,
          body: { error: { code: 133016, message: 'limit' } },
        },
      });

      await run(() => service.retryWhatsappRegistration());

      const data = updateMany.mock.calls[0][0].data;
      expect(data.status).toBe('error');
      expect(data.last_error).toContain('133016');
    });

    it('does not call Meta again when the number is already registered', async () => {
      const base = createService();
      const channel = channelWith(base.encryption, {
        metadata: {
          registration: { status: 'registered', pin_encrypted: 'x' },
        },
      });
      const { service } = createService({
        findFirst: jest.fn().mockResolvedValue(channel),
      });
      const fetchMock = jest.spyOn(global, 'fetch');

      await run(() => service.retryWhatsappRegistration());

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects when there is no usable channel', async () => {
      const { service } = createService({
        findFirst: jest.fn().mockResolvedValue(null),
      });

      await expect(
        run(() => service.retryWhatsappRegistration()),
      ).rejects.toThrow(/WhatsApp/);
    });
  });
});
