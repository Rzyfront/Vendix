import { ConfigService } from '@nestjs/config';
import { ForbiddenException } from '@nestjs/common';
import { MetaWhatsappWebhookService } from './meta-whatsapp-webhook.service';
import { SocialChannelEncryptionService } from '../../store/social-sales/social-channel-encryption.service';

function createService() {
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'META_WHATSAPP_VERIFY_TOKEN') return 'verify-token';
      if (key === 'SOCIAL_CHANNEL_ENCRYPTION_KEY') return 'test-key';
      return undefined;
    }),
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

  return {
    service: new MetaWhatsappWebhookService(prisma, config, encryption),
    prisma,
  };
}

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
});
