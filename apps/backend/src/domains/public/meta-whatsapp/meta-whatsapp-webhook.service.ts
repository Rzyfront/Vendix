import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { SocialChannelEncryptionService } from '../../store/social-sales/social-channel-encryption.service';

const PLATFORM_SETTINGS_KEY = 'social_sales:meta_whatsapp';

@Injectable()
export class MetaWhatsappWebhookService {
  private readonly logger = new Logger(MetaWhatsappWebhookService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly configService: ConfigService,
    private readonly encryption: SocialChannelEncryptionService,
  ) {}

  async verify(
    mode?: string,
    token?: string,
    challenge?: string,
  ): Promise<string> {
    const expectedToken = await this.getVerifyToken();

    if (mode === 'subscribe' && expectedToken && token === expectedToken) {
      return challenge || '';
    }

    throw new ForbiddenException('Token de verificación inválido');
  }

  async ingest(payload: any, rawBody?: string, signature?: string) {
    await this.validateSignature(rawBody, signature);

    const eventMeta = this.extractEventMeta(payload);
    const channel = await this.findChannel(eventMeta);

    const event = await this.prisma.social_webhook_events.create({
      data: {
        store_id: channel?.store_id ?? null,
        social_channel_id: channel?.id ?? null,
        provider: 'meta_cloud',
        event_type: eventMeta.event_type,
        provider_message_id: eventMeta.provider_message_id,
        payload,
        processing_status: 'received',
      },
    });

    return {
      received: true,
      event_id: event.id,
      matched_channel: Boolean(channel),
    };
  }

  private async validateSignature(rawBody?: string, signature?: string) {
    const appSecret = await this.getAppSecret();
    if (!appSecret) return;

    if (!rawBody || !signature) {
      throw new ForbiddenException('Firma Meta requerida');
    }

    const expected = `sha256=${createHmac('sha256', appSecret)
      .update(rawBody, 'utf8')
      .digest('hex')}`;

    const receivedBuffer = Buffer.from(signature, 'utf8');
    const expectedBuffer = Buffer.from(expected, 'utf8');

    if (
      receivedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(receivedBuffer, expectedBuffer)
    ) {
      throw new ForbiddenException('Firma Meta inválida');
    }
  }

  private async findChannel(eventMeta: {
    phone_number_id?: string | null;
    waba_id?: string | null;
  }) {
    if (!eventMeta.phone_number_id && !eventMeta.waba_id) return null;
    const orFilters: Record<string, string>[] = [];
    if (eventMeta.phone_number_id) {
      orFilters.push({ phone_number_id: eventMeta.phone_number_id });
    }
    if (eventMeta.waba_id) {
      orFilters.push({ waba_id: eventMeta.waba_id });
    }

    return this.prisma.social_channels.findFirst({
      where: {
        provider: 'meta_cloud',
        channel_type: 'whatsapp',
        OR: orFilters,
      },
    });
  }

  private extractEventMeta(payload: any) {
    const firstEntry = payload?.entry?.[0];
    const firstChange = firstEntry?.changes?.[0];
    const value = firstChange?.value ?? {};
    const firstMessage = value.messages?.[0];
    const firstStatus = value.statuses?.[0];
    const phone_number_id = value.metadata?.phone_number_id ?? null;
    const waba_id = firstEntry?.id ?? null;

    const event_type = firstMessage
      ? `message.${firstMessage.type || 'unknown'}`
      : firstStatus
        ? `status.${firstStatus.status || 'unknown'}`
        : firstChange?.field || 'unknown';

    return {
      event_type,
      provider_message_id: firstMessage?.id || firstStatus?.id || null,
      phone_number_id,
      waba_id,
    };
  }

  private async getVerifyToken(): Promise<string | null> {
    const value = await this.getPlatformValue();
    const platformToken = this.resolveSecret(
      this.stringOrNull(value?.verify_token),
      this.stringOrNull(value?.verify_token_encrypted),
    );
    return (
      platformToken ||
      this.configService.get<string>('META_WHATSAPP_VERIFY_TOKEN') ||
      null
    );
  }

  private async getAppSecret(): Promise<string | null> {
    const value = await this.getPlatformValue();
    const platformSecret = this.resolveSecret(
      this.stringOrNull(value?.app_secret),
      this.stringOrNull(value?.app_secret_encrypted),
    );
    return (
      platformSecret ||
      this.configService.get<string>('META_APP_SECRET') ||
      null
    );
  }

  private async getPlatformValue(): Promise<Record<string, any> | null> {
    const row = await this.prisma.platform_settings.findUnique({
      where: { key: PLATFORM_SETTINGS_KEY },
    });
    if (
      !row?.value ||
      typeof row.value !== 'object' ||
      Array.isArray(row.value)
    ) {
      return null;
    }
    return row.value as Record<string, any>;
  }

  private stringOrNull(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value : null;
  }

  private resolveSecret(
    plainValue?: string | null,
    encryptedValue?: string | null,
  ): string | null {
    if (encryptedValue) return this.encryption.decrypt(encryptedValue);
    return plainValue || null;
  }
}
