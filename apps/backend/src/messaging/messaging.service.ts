import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';
import { SocialChannelEncryptionService } from '../domains/store/social-sales/social-channel-encryption.service';
import {
  MessagingErrorCode,
  OutboundMedia,
  OutboundMessage,
  OutboundTemplate,
  ResolvedChannel,
  SendResult,
} from './interfaces/messaging.interface';
import { ConsoleMessagingProvider } from './providers/console.provider';
import { MetaCloudMessagingProvider } from './providers/meta-cloud.provider';
import { maskAddress } from './utils/mask-address.util';

/** Same platform settings row the embedded signup and webhook read. */
const META_PLATFORM_SETTINGS_KEY = 'social_sales:meta_whatsapp';
const DEFAULT_GRAPH_VERSION = 'v23.0';
const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;

interface BaseSendInput {
  store_id: number;
  to: string;
  idempotency_key: string;
}

export interface SendTextInput extends BaseSendInput {
  body: string;
  /** Defaults to WhatsApp, the only live channel in this phase. */
  channel?: OutboundMessage['channel'];
  last_inbound_at?: Date | null;
}

export interface SendTemplateInput extends BaseSendInput {
  template: OutboundTemplate;
}

export interface SendMediaInput extends BaseSendInput {
  media: OutboundMedia;
  caption?: string;
  last_inbound_at?: Date | null;
}

/**
 * Outbound messaging entry point (PLAN-CRM §5.0).
 *
 * Resolves the store channel from `social_channels` (the single credential
 * source; `messaging_channels` is frozen and no longer read), decrypts the
 * token in memory and picks the provider. The plain token is only handed to
 * the provider; it is never logged, returned or persisted.
 *
 * CRM sends go through the `crm-outbound` queue (`CrmOutboundQueue`), which
 * calls `send()` from the worker and applies retries/backoff.
 */
@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly config: ConfigService,
    private readonly encryption: SocialChannelEncryptionService,
    private readonly metaCloud: MetaCloudMessagingProvider,
    private readonly consoleProvider: ConsoleMessagingProvider,
  ) {}

  sendText(input: SendTextInput): Promise<SendResult> {
    return this.send({
      store_id: input.store_id,
      channel: input.channel ?? 'whatsapp',
      to: input.to,
      body: input.body,
      last_inbound_at: input.last_inbound_at,
      idempotency_key: input.idempotency_key,
    });
  }

  sendTemplate(input: SendTemplateInput): Promise<SendResult> {
    return this.send({
      store_id: input.store_id,
      channel: 'whatsapp',
      to: input.to,
      template: input.template,
      idempotency_key: input.idempotency_key,
    });
  }

  sendMedia(input: SendMediaInput): Promise<SendResult> {
    return this.send({
      store_id: input.store_id,
      channel: 'whatsapp',
      to: input.to,
      body: input.caption,
      media: [input.media],
      last_inbound_at: input.last_inbound_at,
      idempotency_key: input.idempotency_key,
    });
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    try {
      if ((message.media?.length ?? 0) > 1) {
        return this.failure(
          'INVALID_REQUEST',
          'Only one attachment per message is supported',
        );
      }

      if (
        message.channel === 'whatsapp' &&
        !message.template &&
        !this.isWindowOpen(message.last_inbound_at)
      ) {
        return this.failure(
          'WINDOW_CLOSED',
          'The 24 h WhatsApp window is closed; only approved templates can be sent',
        );
      }

      if (this.isDryRun()) {
        return this.consoleProvider.send(message);
      }

      if (message.channel !== 'whatsapp') {
        return this.failure(
          'CHANNEL_NOT_CONFIGURED',
          `No provider for ${message.channel} yet`,
        );
      }

      const channel = await this.resolveWhatsappChannel(message.store_id);
      if (!channel) {
        return this.failure(
          'CHANNEL_NOT_CONFIGURED',
          'The store has no connected WhatsApp channel',
        );
      }

      const result = await this.metaCloud.send(message, channel);
      if (result.status === 'failed' && result.error_code === 'AUTH') {
        await this.markChannelError(channel.id, result);
      }
      return result;
    } catch (error) {
      this.logger.error(
        `Unexpected error sending ${message.channel} to ${maskAddress(message.to)} (store ${message.store_id}, message ${message.idempotency_key}): ${(error as Error)?.message}`,
      );
      return {
        ...this.failure('PROVIDER_ERROR', 'Unexpected error while sending'),
        retryable: true,
      };
    }
  }

  /**
   * `MESSAGING_DRY_RUN=true|false` wins; unset means dry-run everywhere except
   * production, so dev and test never send real messages by accident.
   */
  isDryRun(): boolean {
    const flag = this.config.get<string>('MESSAGING_DRY_RUN');
    if (flag === 'true') return true;
    if (flag === 'false') return false;
    return this.config.get<string>('NODE_ENV') !== 'production';
  }

  isWindowOpen(
    lastInboundAt: Date | null | undefined,
    now = new Date(),
  ): boolean {
    if (!lastInboundAt) return false;
    return (
      now.getTime() - new Date(lastInboundAt).getTime() < WHATSAPP_WINDOW_MS
    );
  }

  private async resolveWhatsappChannel(
    storeId: number,
  ): Promise<ResolvedChannel | null> {
    const row = await this.prisma.social_channels.findFirst({
      where: {
        store_id: storeId,
        channel_type: 'whatsapp',
        provider: 'meta_cloud',
        status: 'connected',
      },
    });
    return row ? this.toResolvedChannel(row) : null;
  }

  /**
   * Decrypts a `social_channels` row into provider credentials. Also used by
   * the inbound worker to download media with the channel token.
   */
  async toResolvedChannel(row: {
    id: number;
    store_id: number;
    channel_type: string;
    provider: string;
    phone_number_id: string | null;
    waba_id: string | null;
    access_token_encrypted: string | null;
  }): Promise<ResolvedChannel> {
    return {
      id: row.id,
      store_id: row.store_id,
      channel_type: row.channel_type,
      provider: row.provider,
      phone_number_id: row.phone_number_id,
      waba_id: row.waba_id,
      access_token: row.access_token_encrypted
        ? this.encryption.decrypt(row.access_token_encrypted)
        : null,
      graph_version: await this.resolveGraphVersion(),
    };
  }

  private async resolveGraphVersion(): Promise<string> {
    const row = await this.prisma.platform_settings.findUnique({
      where: { key: META_PLATFORM_SETTINGS_KEY },
    });
    const value = row?.value as Record<string, unknown> | null | undefined;
    const fromPlatform =
      value &&
      typeof value.graph_version === 'string' &&
      value.graph_version.trim()
        ? value.graph_version
        : null;
    return (
      fromPlatform ||
      this.config.get<string>('META_GRAPH_VERSION') ||
      DEFAULT_GRAPH_VERSION
    );
  }

  /** Meta rejected the token: stop using the channel until the owner reconnects it. */
  private async markChannelError(channelId: number, result: SendResult) {
    const reason =
      `[${result.provider_error_code ?? result.error_code}] ${result.error_message ?? ''}`.trim();
    await this.prisma.social_channels.updateMany({
      where: { id: channelId, status: 'connected' },
      data: { status: 'error', last_error: reason },
    });
    this.logger.warn(
      `WhatsApp channel ${channelId} marked as error: ${reason}`,
    );
  }

  private failure(code: MessagingErrorCode, message: string): SendResult {
    return {
      status: 'failed',
      provider: this.isDryRun() ? 'console' : 'meta_cloud',
      error_code: code,
      error_message: message,
      retryable: false,
    };
  }
}
