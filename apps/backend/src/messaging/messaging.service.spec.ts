import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { MessagingService } from './messaging.service';
import { ConsoleMessagingProvider } from './providers/console.provider';
import { MetaCloudMessagingProvider } from './providers/meta-cloud.provider';
import { SocialChannelEncryptionService } from '../domains/store/social-sales/social-channel-encryption.service';
import { SendResult } from './interfaces/messaging.interface';
import { SnsSmsMessagingProvider } from './providers/sns-sms.provider';
import { SesEmailMessagingProvider } from './providers/ses-email.provider';
import { SmsSpendService } from './spend/sms-spend.service';

const PLAIN_TOKEN = 'EAAG-plain-token';
const HOUR = 60 * 60 * 1000;

function createService(env: Record<string, string | undefined> = {}) {
  const config = {
    get: jest.fn(
      (key: string) =>
        ({
          SOCIAL_CHANNEL_ENCRYPTION_KEY: 'test-social-channel-key',
          MESSAGING_DRY_RUN: 'false',
          SNS_SMS_PRICE_TABLE: '{"57":0.0075}',
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
    store_users: {
      findFirst: jest.fn().mockResolvedValue({
        sms_consent: 'unknown',
        email_consent: 'unknown',
      }),
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
  const redis = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
  };
  const snsSms = new SnsSmsMessagingProvider(config, redis as never);
  jest.spyOn(snsSms, 'isOptedOut').mockResolvedValue(false);
  jest.spyOn(snsSms, 'send').mockResolvedValue({
    status: 'sent',
    provider: 'sns_sms',
    provider_message_id: 'sns-msg-1',
    retryable: false,
    cost_amount: 0.0075,
  });
  const sesEmail = {
    name: 'ses_email',
    send: jest.fn().mockResolvedValue({
      status: 'sent',
      provider: 'ses_email',
      provider_message_id: '<ses-1@email>',
      retryable: false,
    }),
  } as unknown as SesEmailMessagingProvider;
  const smsSpend = {
    reserve: jest.fn().mockResolvedValue({
      reserved: true,
      period_start: '2026-10-01',
      used: 1,
      limit: 10,
    }),
    release: jest.fn().mockResolvedValue(undefined),
  };
  const service = new MessagingService(
    prisma as never,
    config,
    encryption,
    metaCloud,
    consoleProvider,
    snsSms,
    sesEmail,
    smsSpend as unknown as SmsSpendService,
  );
  return {
    service,
    prisma,
    metaCloud,
    consoleProvider,
    snsSms,
    sesEmail,
    smsSpend,
  };
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

  describe('SMS (sns_sms)', () => {
    const smsRow = {
      id: 7,
      store_id: 10,
      channel_type: 'sms',
      provider: 'sns_sms',
      status: 'connected',
      metadata: { sender_id: 'Tienda' },
      store: { name: 'Tienda Centro' },
    };
    const sms = (overrides: Record<string, unknown> = {}) => ({
      store_id: 10,
      channel: 'sms' as const,
      to: '300 123 4567',
      body: 'Tu pedido está listo',
      customer_id: 33,
      idempotency_key: '83',
      ...overrides,
    });

    it('reserves the estimated cost, then publishes to the E.164 number with the channel settings', async () => {
      const { service, prisma, snsSms, smsSpend } = createService();
      prisma.social_channels.findFirst.mockResolvedValue(smsRow);

      const result = await service.send(sms());

      expect(prisma.social_channels.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            store_id: 10,
            channel_type: 'sms',
            provider: 'sns_sms',
            status: 'connected',
          },
        }),
      );
      expect(smsSpend.reserve).toHaveBeenCalledWith(
        expect.objectContaining({ id: 7, store_id: 10 }),
        0.0075,
      );
      expect(snsSms.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: '+573001234567' }),
        expect.objectContaining({ id: 7, settings: { sender_id: 'Tienda' } }),
      );
      expect(result).toMatchObject({ status: 'sent', provider: 'sns_sms' });
      expect(smsSpend.release).not.toHaveBeenCalled();
    });

    it('rejects with SPEND_LIMIT and never publishes when the cap is used up', async () => {
      const { service, prisma, snsSms, smsSpend } = createService();
      prisma.social_channels.findFirst.mockResolvedValue(smsRow);
      smsSpend.reserve.mockResolvedValue({
        reserved: false,
        period_start: '2026-10-01',
        used: 9.9975,
        limit: 10,
      });

      const result = await service.send(sms());

      expect(result).toMatchObject({
        status: 'failed',
        provider: 'sns_sms',
        error_code: 'SPEND_LIMIT',
        retryable: false,
      });
      expect(result.error_message).toContain('Monthly SMS spend limit reached');
      expect(snsSms.send).not.toHaveBeenCalled();
    });

    it('gives the reservation back when SNS rejected the SMS', async () => {
      const { service, prisma, snsSms, smsSpend } = createService();
      prisma.social_channels.findFirst.mockResolvedValue(smsRow);
      (snsSms.send as jest.Mock).mockResolvedValue({
        status: 'failed',
        provider: 'sns_sms',
        error_code: 'RATE_LIMITED',
        retryable: true,
      });

      await service.send(sms());

      expect(smsSpend.release).toHaveBeenCalledWith(7, 0.0075, '2026-10-01');
    });

    it('keeps the reservation on a timeout, when SNS may have sent it', async () => {
      const { service, prisma, snsSms, smsSpend } = createService();
      prisma.social_channels.findFirst.mockResolvedValue(smsRow);
      (snsSms.send as jest.Mock).mockResolvedValue({
        status: 'failed',
        provider: 'sns_sms',
        error_code: 'TIMEOUT',
        retryable: false,
      });

      await service.send(sms());

      expect(smsSpend.release).not.toHaveBeenCalled();
    });

    it('rejects an invalid number before reserving anything', async () => {
      const { service, smsSpend, snsSms } = createService();

      const result = await service.send(sms({ to: '12' }));

      expect(result).toMatchObject({
        status: 'failed',
        error_code: 'INVALID_RECIPIENT',
      });
      expect(smsSpend.reserve).not.toHaveBeenCalled();
      expect(snsSms.send).not.toHaveBeenCalled();
    });

    it('skips customers who opted out in the store or with STOP at SNS', async () => {
      const local = createService();
      local.prisma.social_channels.findFirst.mockResolvedValue(smsRow);
      local.prisma.store_users.findFirst.mockResolvedValue({
        sms_consent: 'opted_out',
        email_consent: 'unknown',
      });
      expect(await local.service.send(sms())).toMatchObject({
        error_code: 'OPTED_OUT',
      });
      expect(local.prisma.store_users.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { store_id: 10, user_id: 33 } }),
      );

      const carrier = createService();
      carrier.prisma.social_channels.findFirst.mockResolvedValue(smsRow);
      (carrier.snsSms.isOptedOut as jest.Mock).mockResolvedValue(true);
      expect(await carrier.service.send(sms())).toMatchObject({
        error_code: 'OPTED_OUT',
      });

      for (const { smsSpend, snsSms } of [local, carrier]) {
        expect(smsSpend.reserve).not.toHaveBeenCalled();
        expect(snsSms.send).not.toHaveBeenCalled();
      }
    });

    it('fails with CHANNEL_NOT_CONFIGURED when SMS is not enabled', async () => {
      const { service, prisma, smsSpend } = createService();
      prisma.social_channels.findFirst.mockResolvedValue(null);

      expect(await service.send(sms())).toMatchObject({
        status: 'failed',
        provider: 'sns_sms',
        error_code: 'CHANNEL_NOT_CONFIGURED',
      });
      expect(smsSpend.reserve).not.toHaveBeenCalled();
    });

    it('dry-run logs the SMS and never reserves spend nor calls SNS', async () => {
      const { service, prisma, smsSpend, snsSms } = createService({
        MESSAGING_DRY_RUN: 'true',
      });

      expect(await service.send(sms())).toMatchObject({
        status: 'sent',
        provider: 'console',
      });
      expect(prisma.social_channels.findFirst).not.toHaveBeenCalled();
      expect(smsSpend.reserve).not.toHaveBeenCalled();
      expect(snsSms.send).not.toHaveBeenCalled();
    });
  });

  describe('email (ses_email)', () => {
    const emailRow = {
      id: 8,
      store_id: 10,
      channel_type: 'email',
      provider: 'ses_email',
      status: 'connected',
      metadata: { from_name: 'Tienda Centro', reply_to: 'hola@tienda.co' },
      store: { name: 'Tienda Centro SAS' },
    };
    const email = {
      store_id: 10,
      channel: 'email' as const,
      to: 'cliente@example.com',
      body: 'Hola',
      customer_id: 33,
      idempotency_key: '90',
    };

    it('delivers through the email provider with the channel settings', async () => {
      const { service, prisma, sesEmail } = createService();
      prisma.social_channels.findFirst.mockResolvedValue(emailRow);

      expect(await service.send(email)).toMatchObject({
        status: 'sent',
        provider: 'ses_email',
      });
      expect(sesEmail.send).toHaveBeenCalledWith(
        email,
        expect.objectContaining({
          id: 8,
          settings: emailRow.metadata,
          store_name: 'Tienda Centro SAS',
          access_token: null,
        }),
      );
    });

    it('skips customers who opted out of email and stores without the channel', async () => {
      const optedOut = createService();
      optedOut.prisma.social_channels.findFirst.mockResolvedValue(emailRow);
      optedOut.prisma.store_users.findFirst.mockResolvedValue({
        sms_consent: 'unknown',
        email_consent: 'opted_out',
      });
      expect(await optedOut.service.send(email)).toMatchObject({
        error_code: 'OPTED_OUT',
      });

      const missing = createService();
      missing.prisma.social_channels.findFirst.mockResolvedValue(null);
      expect(await missing.service.send(email)).toMatchObject({
        error_code: 'CHANNEL_NOT_CONFIGURED',
        provider: 'ses_email',
      });

      expect(optedOut.sesEmail.send).not.toHaveBeenCalled();
      expect(missing.sesEmail.send).not.toHaveBeenCalled();
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
