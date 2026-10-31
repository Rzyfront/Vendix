import { ConfigService } from '@nestjs/config';
import { ForbiddenException } from '@nestjs/common';
import { MetaWhatsappWebhookService } from './meta-whatsapp-webhook.service';
import { createHmac } from 'crypto';
import { SocialChannelEncryptionService } from '../../store/social-sales/social-channel-encryption.service';
import { CrmInboundQueue } from './inbound/crm-inbound.queue';

function createService(env: Record<string, string> = {}) {
  const values: Record<string, string> = {
    META_WHATSAPP_VERIFY_TOKEN: 'verify-token',
    SOCIAL_CHANNEL_ENCRYPTION_KEY: 'test-key',
    ...env,
  };
  const config = {
    get: jest.fn((key: string) => values[key]),
  } as any as ConfigService;
  const prisma = {
    platform_settings: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    social_channels: {
      findFirst: jest.fn().mockResolvedValue({
        id: 5,
        store_id: 10,
      }),
    },
    social_webhook_events: {
      create: jest.fn().mockResolvedValue({ id: 99 }),
    },
  } as any;
  const encryption = new SocialChannelEncryptionService(config);
  const inboundQueue = {
    enqueue: jest.fn().mockResolvedValue(undefined),
  } as unknown as CrmInboundQueue;

  return {
    service: new MetaWhatsappWebhookService(
      prisma,
      config,
      encryption,
      inboundQueue,
    ),
    prisma,
    inboundQueue,
  };
}

const SIGNED_PAYLOAD = {
  object: 'whatsapp_business_account',
  entry: [{ id: 'waba-1', changes: [{ field: 'messages', value: {} }] }],
};

describe('MetaWhatsappWebhookService', () => {
  it('returns hub challenge only when verify token matches', async () => {
    const { service } = createService();

    await expect(
      service.verify('subscribe', 'verify-token', 'challenge-123'),
    ).resolves.toBe('challenge-123');
    await expect(
      service.verify('subscribe', 'wrong-token', 'challenge-123'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('stores raw WhatsApp webhook payload without requiring JWT', async () => {
    const { service, prisma } = createService();
    const payload = {
      entry: [
        {
          id: 'waba-1',
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: 'phone-1' },
                messages: [{ id: 'wamid.1', type: 'text' }],
              },
            },
          ],
        },
      ],
    };

    const result = await service.ingest(payload);

    expect(result).toEqual({
      received: true,
      event_id: 99,
      matched_channel: true,
      queued: true,
    });
    expect(prisma.social_webhook_events.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          store_id: 10,
          social_channel_id: 5,
          event_type: 'message.text',
          provider_message_id: 'wamid.1',
          payload,
          processing_status: 'received',
        }),
      }),
    );
  });

  it('enqueues the stored event in crm-inbound', async () => {
    const { service, inboundQueue } = createService();

    await service.ingest({ entry: [] });

    expect(inboundQueue.enqueue).toHaveBeenCalledWith(99);
  });

  it('rejects unsigned events in production when no app secret is configured', async () => {
    const { service, prisma, inboundQueue } = createService({
      NODE_ENV: 'production',
    });

    await expect(service.ingest(SIGNED_PAYLOAD)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.social_webhook_events.create).not.toHaveBeenCalled();
    expect(inboundQueue.enqueue).not.toHaveBeenCalled();
  });

  it('accepts a valid signature and rejects a forged one in production', async () => {
    const { service } = createService({
      NODE_ENV: 'production',
      META_APP_SECRET: 'app-secret',
    });
    const raw = JSON.stringify(SIGNED_PAYLOAD);
    const signature = `sha256=${createHmac('sha256', 'app-secret').update(raw).digest('hex')}`;

    await expect(
      service.ingest(SIGNED_PAYLOAD, raw, signature),
    ).resolves.toMatchObject({ received: true });
    await expect(
      service.ingest(SIGNED_PAYLOAD, raw, `sha256=${'0'.repeat(64)}`),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.ingest(SIGNED_PAYLOAD, raw)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
