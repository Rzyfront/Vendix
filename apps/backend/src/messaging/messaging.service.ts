import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';
import { SocialChannelEncryptionService } from '../domains/store/social-sales/social-channel-encryption.service';
import {
  MessagingErrorCode,
  MessagingProviderName,
  OutboundMedia,
  OutboundMessage,
  OutboundTemplate,
  ResolvedChannel,
  SendResult,
} from './interfaces/messaging.interface';
import { ConsoleMessagingProvider } from './providers/console.provider';
import { MetaCloudMessagingProvider } from './providers/meta-cloud.provider';
import { SnsSmsMessagingProvider } from './providers/sns-sms.provider';
import { SesEmailMessagingProvider } from './providers/ses-email.provider';
import { SmsSpendService } from './spend/sms-spend.service';
import { maskAddress } from './utils/mask-address.util';

/** Same platform settings row the embedded signup and webhook read. */
const META_PLATFORM_SETTINGS_KEY = 'social_sales:meta_whatsapp';
const DEFAULT_GRAPH_VERSION = 'v23.0';
const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;

/** SMS failures where SNS certainly did not take the message. */
const SPEND_KEPT_ON = new Set<MessagingErrorCode>(['TIMEOUT', 'UNKNOWN']);

interface BaseSendInput {
  store_id: number;
  to: string;
  idempotency_key: string;
}

export interface SendTextInput extends BaseSendInput {
  body: string;
  /** Defaults to WhatsApp. */
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
    private readonly snsSms: SnsSmsMessagingProvider,
    private readonly sesEmail: SesEmailMessagingProvider,
    private readonly smsSpend: SmsSpendService,
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

      if (message.marketing && !(await this.allowsMarketing(message))) {
        return this.failure(
          'OPTED_OUT',
          message.channel === 'whatsapp'
            ? 'The customer did not opt in to WhatsApp marketing from this store'
            : `The customer opted out of ${message.channel} from this store`,
        );
      }

      if (this.isDryRun()) {
        return this.consoleProvider.send(message);
      }

      if (message.channel === 'sms') return await this.sendSms(message);
      if (message.channel === 'email') return await this.sendEmail(message);
      if (message.channel !== 'whatsapp') {
        return this.failure(
          'CHANNEL_NOT_CONFIGURED',
          `No provider for ${message.channel as string}`,
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

  /**
   * SMS by Amazon SNS with the store's hard monthly cap: the estimated cost
   * is reserved atomically before publishing and given back when SNS
   * certainly rejected the message (PLAN-CRM §5.2).
   */
  private async sendSms(message: OutboundMessage): Promise<SendResult> {
    const quote = this.snsSms.quote(message);
    if (!('cost' in quote)) return quote;

    if (await this.customerOptedOut(message, 'sms_consent')) {
      return this.failure(
        'OPTED_OUT',
        'The customer opted out of SMS from this store',
        'sns_sms',
      );
    }
    const channel = await this.resolveSettingsChannel(
      message.store_id,
      'sms',
      'sns_sms',
    );
    if (!channel) {
      return this.failure(
        'CHANNEL_NOT_CONFIGURED',
        'The store has no active SMS channel',
        'sns_sms',
      );
    }
    if (await this.snsSms.isOptedOut(quote.to)) {
      return this.failure(
        'OPTED_OUT',
        'The number replied STOP to SMS',
        'sns_sms',
      );
    }

    const reservation = await this.smsSpend.reserve(channel, quote.cost);
    if (!reservation.reserved) {
      return this.failure(
        'SPEND_LIMIT',
        `Monthly SMS spend limit reached (${reservation.used} of ${reservation.limit ?? 0} USD used, this SMS needs ${quote.cost} USD)`,
        'sns_sms',
      );
    }

    const result = await this.snsSms.send({ ...message, to: quote.to }, channel);
    if (
      result.status === 'failed' &&
      !SPEND_KEPT_ON.has(result.error_code ?? 'UNKNOWN')
    ) {
      await this.smsSpend.release(
        channel,
        quote.cost,
        reservation.period_start,
      );
    }
    return result;
  }

  private async sendEmail(message: OutboundMessage): Promise<SendResult> {
    if (await this.customerOptedOut(message, 'email_consent')) {
      return this.failure(
        'OPTED_OUT',
        'The customer opted out of email from this store',
        'ses_email',
      );
    }
    const channel = await this.resolveSettingsChannel(
      message.store_id,
      'email',
      'ses_email',
    );
    if (!channel) {
      return this.failure(
        'CHANNEL_NOT_CONFIGURED',
        'The store has no active email channel',
        'ses_email',
      );
    }
    return this.sesEmail.send(message, channel);
  }

  /**
   * Consent read at send time (PLAN-CRM §6): an opt-out after the campaign
   * was built still stops the message. WhatsApp marketing needs `opted_in`;
   * SMS and email only need the customer not to have opted out. A campaign
   * message without a store customer is never marketing-eligible.
   */
  private async allowsMarketing(message: OutboundMessage): Promise<boolean> {
    if (!message.customer_id) return false;
    const link = await this.prisma.store_users.findFirst({
      where: { store_id: message.store_id, user_id: message.customer_id },
      select: { whatsapp_consent: true, sms_consent: true, email_consent: true },
    });
    if (!link) return false;
    if (message.channel === 'whatsapp') return link.whatsapp_consent === 'opted_in';
    const consent = message.channel === 'sms' ? link.sms_consent : link.email_consent;
    return consent !== 'opted_out';
  }

  private async customerOptedOut(
    message: OutboundMessage,
    field: 'sms_consent' | 'email_consent',
  ): Promise<boolean> {
    if (!message.customer_id) return false;
    const link = await this.prisma.store_users.findFirst({
      where: { store_id: message.store_id, user_id: message.customer_id },
      select: { sms_consent: true, email_consent: true },
    });
    return link?.[field] === 'opted_out';
  }

  /** SMS and email channels carry settings, not credentials. */
  private async resolveSettingsChannel(
    storeId: number,
    channelType: 'sms' | 'email',
    provider: 'sns_sms' | 'ses_email',
  ): Promise<ResolvedChannel | null> {
    const row = await this.prisma.social_channels.findFirst({
      where: {
        store_id: storeId,
        channel_type: channelType,
        provider,
        status: 'connected',
      },
      include: { store: { select: { name: true } } },
    });
    if (!row) return null;
    const metadata = row.metadata;
    return {
      id: row.id,
      store_id: row.store_id,
      channel_type: row.channel_type,
      provider: row.provider,
      phone_number_id: null,
      waba_id: null,
      access_token: null,
      graph_version: '',
      settings:
        metadata && typeof metadata === 'object' && !Array.isArray(metadata)
          ? (metadata as Record<string, unknown>)
          : {},
      store_name: row.store?.name ?? undefined,
    };
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

  private failure(
    code: MessagingErrorCode,
    message: string,
    provider: MessagingProviderName = 'meta_cloud',
  ): SendResult {
    return {
      status: 'failed',
      provider: this.isDryRun() ? 'console' : provider,
      error_code: code,
      error_message: message,
      retryable: false,
    };
  }
}
