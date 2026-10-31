import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { MessagingService } from './messaging.service';
import { ConsoleMessagingProvider } from './providers/console.provider';
import { MetaCloudMessagingProvider } from './providers/meta-cloud.provider';
import { SocialChannelEncryptionService } from '../domains/store/social-sales/social-channel-encryption.service';
import { SendResult } from './interfaces/messaging.interface';

const PLAIN_TOKEN = 'EAAG-plain-token';
const HOUR = 60 * 60 * 1000;

function createService(env: Record<string, string | undefined> = {}) {
  const config = {
    get: jest.fn(
      (key: string) =>
        ({
          SOCIAL_CHANNEL_ENCRYPTION_KEY: 'test-social-channel-key',
          MESSAGING_DRY_RUN: 'false',
          ...env,
        })[key],
    ),
  } as unknown as ConfigService;
  const encryption = new SocialChannelEncryptionService(config);
  const channelRow = {
    id: 5,
    store_id: 10,
    channel_type: 'whatsapp',
    provider: 'meta_cloud',
    status: 'connected',
    phone_number_id: '1234567890',
    waba_id: 'waba-1',
    access_token_encrypted: encryption.encrypt(PLAIN_TOKEN),
  };
  const prisma = {
    social_channels: {
      findFirst: jest.fn().mockResolvedValue(channelRow),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    platform_settings: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ value: { graph_version: 'v24.0' } }),
    },
  };
  const metaSent: SendResult = {
    status: 'sent',
    provider: 'meta_cloud',
    provider_message_id: 'wamid.1',
    retryable: false,
  };
  const metaCloud = {
    name: 'meta_cloud',
    send: jest.fn().mockResolvedValue(metaSent),
  } as unknown as MetaCloudMessagingProvider;
  const consoleProvider = new ConsoleMessagingProvider();
  const service = new MessagingService(
    prisma as never,
    config,
    encryption,
    metaCloud,
    consoleProvider,
  );
  return { service, prisma, metaCloud, consoleProvider };
}

describe('MessagingService', () => {
  let logSpies: jest.SpyInstance[];

  beforeEach(() => {
    logSpies = (['log', 'warn', 'error', 'debug'] as const).map((level) =>
      jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined),
    );
  });

  afterEach(() => jest.restoreAllMocks());

  function loggedText(): string {
    return logSpies
      .flatMap((spy) => spy.mock.calls.flat())
      .map((arg) => String(arg))
      .join('\n');
  }

  it('sendText resolves the connected WhatsApp channel and decrypts its token only in memory', async () => {
    const { service, prisma, metaCloud } = createService();

    const result = await service.sendText({
      store_id: 10,
      to: '+573001234567',
      body: 'Hola',
      last_inbound_at: new Date(Date.now() - HOUR),
      idempotency_key: '77',
    });

    expect(result).toMatchObject({
      status: 'sent',
      provider_message_id: 'wamid.1',
    });
    expect(prisma.social_channels.findFirst).toHaveBeenCalledWith({
      where: {
        store_id: 10,
        channel_type: 'whatsapp',
        provider: 'meta_cloud',
        status: 'connected',
      },
    });
    const [sentMessage, channel] = (metaCloud.send as jest.Mock).mock.calls[0];
    expect(sentMessage).toMatchObject({ channel: 'whatsapp', body: 'Hola' });
    expect(channel).toMatchObject({
      id: 5,
      store_id: 10,
      phone_number_id: '1234567890',
      access_token: PLAIN_TOKEN,
      graph_version: 'v24.0',
    });
    expect(loggedText()).not.toContain(PLAIN_TOKEN);
  });

  it('rejects free-form WhatsApp text outside the 24 h window without calling Meta', async () => {
    const { service, metaCloud } = createService();

    for (const last_inbound_at of [new Date(Date.now() - 25 * HOUR), null]) {
      const result = await service.sendText({
        store_id: 10,
        to: '+573001234567',
        body: 'Hola',
        last_inbound_at,
        idempotency_key: '77',
      });
      expect(result).toMatchObject({
        status: 'failed',
        error_code: 'WINDOW_CLOSED',
        retryable: false,
      });
    }
    expect(metaCloud.send).not.toHaveBeenCalled();
  });

  it('sendTemplate is allowed outside the window', async () => {
    const { service, metaCloud } = createService();

    const result = await service.sendTemplate({
      store_id: 10,
      to: '+573001234567',
      template: { name: 'order_ready', language: 'es_CO', variables: ['Ana'] },
      idempotency_key: '78',
    });

    expect(result.status).toBe('sent');
    expect((metaCloud.send as jest.Mock).mock.calls[0][0].template).toEqual({
      name: 'order_ready',
      language: 'es_CO',
      variables: ['Ana'],
    });
  });

  it('sendMedia sends one attachment inside the window and rejects several', async () => {
    const { service, metaCloud } = createService();
    const base = {
      store_id: 10,
      to: '+573001234567',
      last_inbound_at: new Date(),
      idempotency_key: '79',
    };

    await expect(
      service.sendMedia({
        ...base,
        media: { type: 'image', url: 'https://cdn.test/a.png' },
        caption: 'Foto',
      }),
    ).resolves.toMatchObject({ status: 'sent' });
    expect((metaCloud.send as jest.Mock).mock.calls[0][0]).toMatchObject({
      body: 'Foto',
      media: [{ type: 'image', url: 'https://cdn.test/a.png' }],
    });

    await expect(
      service.send({
        ...base,
        channel: 'whatsapp',
        media: [
          { type: 'image', url: 'https://cdn.test/a.png' },
          { type: 'image', url: 'https://cdn.test/b.png' },
        ],
      }),
    ).resolves.toMatchObject({
      status: 'failed',
      error_code: 'INVALID_REQUEST',
    });
  });

  it('fails with CHANNEL_NOT_CONFIGURED when the store has no connected channel', async () => {
    const { service, prisma, metaCloud } = createService();
    prisma.social_channels.findFirst.mockResolvedValue(null);

    const result = await service.sendTemplate({
      store_id: 10,
      to: '+573001234567',
      template: { name: 't', language: 'es', variables: [] },
      idempotency_key: '80',
    });

    expect(result).toMatchObject({
      status: 'failed',
      error_code: 'CHANNEL_NOT_CONFIGURED',
      retryable: false,
    });
    expect(metaCloud.send).not.toHaveBeenCalled();
  });

  it('marks the channel as error when Meta rejects the token', async () => {
    const { service, prisma, metaCloud } = createService();
    (metaCloud.send as jest.Mock).mockResolvedValue({
      status: 'failed',
      provider: 'meta_cloud',
      error_code: 'AUTH',
      provider_error_code: '190',
      error_message: 'Error validating access token',
      retryable: false,
    });

    await service.sendTemplate({
      store_id: 10,
      to: '+573001234567',
      template: { name: 't', language: 'es', variables: [] },
      idempotency_key: '81',
    });

    expect(prisma.social_channels.updateMany).toHaveBeenCalledWith({
      where: { id: 5, status: 'connected' },
      data: {
        status: 'error',
        last_error: '[190] Error validating access token',
      },
    });
  });

  it('MESSAGING_DRY_RUN=true routes to the console provider and never reads credentials', async () => {
    const { service, prisma, metaCloud } = createService({
      MESSAGING_DRY_RUN: 'true',
    });

    const result = await service.sendTemplate({
      store_id: 10,
      to: '+573001234567',
      template: { name: 't', language: 'es', variables: [] },
      idempotency_key: '82',
    });

    expect(result).toMatchObject({ status: 'sent', provider: 'console' });
    expect(result.provider_message_id).toMatch(/^console_/);
    expect(metaCloud.send).not.toHaveBeenCalled();
    expect(prisma.social_channels.findFirst).not.toHaveBeenCalled();
  });

  it('defaults to dry-run outside production when MESSAGING_DRY_RUN is unset', async () => {
    const devService = createService({
      MESSAGING_DRY_RUN: undefined,
      NODE_ENV: 'development',
    });
    const prodService = createService({
      MESSAGING_DRY_RUN: undefined,
      NODE_ENV: 'production',
    });

    expect(devService.service.isDryRun()).toBe(true);
    expect(prodService.service.isDryRun()).toBe(false);
  });

  it('returns CHANNEL_NOT_CONFIGURED for SMS and email until their providers ship', async () => {
    const { service } = createService();

    const result = await service.send({
      store_id: 10,
      channel: 'sms',
      to: '+573001234567',
      body: 'Hola',
      idempotency_key: '83',
    });

    expect(result).toMatchObject({
      status: 'failed',
      error_code: 'CHANNEL_NOT_CONFIGURED',
    });
  });

  it('turns an unexpected exception into a retryable failure', async () => {
    const { service, prisma } = createService();
    prisma.social_channels.findFirst.mockRejectedValue(new Error('db down'));

    const result = await service.sendTemplate({
      store_id: 10,
      to: '+573001234567',
      template: { name: 't', language: 'es', variables: [] },
      idempotency_key: '84',
    });

    expect(result).toMatchObject({
      status: 'failed',
      error_code: 'PROVIDER_ERROR',
      retryable: true,
    });
  });
});
