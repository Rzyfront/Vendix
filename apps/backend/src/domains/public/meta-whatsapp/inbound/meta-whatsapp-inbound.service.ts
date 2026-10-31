import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { MessagingService } from '../../../../messaging/messaging.service';
import { ResolvedChannel } from '../../../../messaging/interfaces/messaging.interface';
import { mapMetaErrorCode } from '../../../../messaging/providers/meta-cloud.provider';
import {
  maskAddress,
  toE164,
} from '../../../../messaging/utils/mask-address.util';
import { S3Service } from '../../../../common/services/s3.service';
import { S3PathHelper } from '../../../../common/helpers/s3-path.helper';

const PROVIDER = 'meta_cloud';
const MEDIA_TYPES = ['image', 'video', 'audio', 'document', 'sticker'] as const;
const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
const MEDIA_TIMEOUT_MS = 20_000;

/** Forward-only lifecycle: `queued < sent < delivered < read`; `failed` is terminal. */
const STATUS_PREDECESSORS: Record<string, string[]> = {
  sent: ['queued'],
  delivered: ['queued', 'sent'],
  read: ['queued', 'sent', 'delivered'],
  failed: ['queued', 'sent'],
};
const STATUS_TIMESTAMP: Record<string, string> = {
  sent: 'sent_at',
  delivered: 'delivered_at',
  read: 'read_at',
  failed: 'failed_at',
};

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/amr': 'amr',
  'application/pdf': 'pdf',
};

export interface InboundProcessOptions {
  /** Last BullMQ attempt: keep what can be kept instead of throwing. */
  isLastAttempt: boolean;
  /** Ask for a retry when a status arrives before its outbound row has a wamid. */
  allowStatusRetry: boolean;
}

export interface InboundOutcome {
  status: 'processed' | 'ignored' | 'skipped' | 'retry';
  messages_created: number;
  statuses_applied: number;
  statuses_missing: number;
}

interface StoredMedia {
  type: string;
  media_id: string;
  mime?: string;
  filename?: string;
  s3_key?: string;
  error?: string;
}

type WhatsappChannelRow = {
  id: number;
  store_id: number;
  channel_type: string;
  provider: string;
  phone_number_id: string | null;
  waba_id: string | null;
  access_token_encrypted: string | null;
};

/**
 * Processes a stored Meta webhook event (PLAN-CRM §5.1.4-5.1.7).
 *
 * - Each `changes[].value` is attributed to the channel that owns its
 *   `metadata.phone_number_id`, never to the store guessed at ingest time.
 * - Inbound messages are idempotent by `(provider, provider_message_id)`:
 *   a re-delivered `wamid` never creates a second row nor bumps unread.
 * - Statuses only move forward; the update is guarded in SQL so a late
 *   event cannot regress a `read` or revive a `failed` message.
 * - The sender is linked to a store customer only when exactly one
 *   `store_users` customer of that store has the same phone; otherwise the
 *   conversation stays unlinked for a human to resolve.
 * - Media is copied to S3 and the message stores the key; consumers sign it
 *   on read (presigned URLs expire, see vendix-s3-storage).
 */
@Injectable()
export class MetaWhatsappInboundService {
  private readonly logger = new Logger(MetaWhatsappInboundService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly messaging: MessagingService,
    private readonly s3: S3Service,
    private readonly s3Path: S3PathHelper,
  ) {}

  async processEvent(
    eventId: number,
    options: InboundProcessOptions,
  ): Promise<InboundOutcome> {
    const outcome: InboundOutcome = {
      status: 'processed',
      messages_created: 0,
      statuses_applied: 0,
      statuses_missing: 0,
    };

    const event = await this.prisma.social_webhook_events.findUnique({
      where: { id: eventId },
    });
    if (
      !event ||
      event.provider !== PROVIDER ||
      ['processed', 'ignored'].includes(event.processing_status)
    ) {
      return { ...outcome, status: 'skipped' };
    }

    const values = this.extractValues(event.payload);
    let matchedChannel = false;

    for (const value of values) {
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!phoneNumberId) continue;
      // `phone_number_id` is not unique and a disconnected row keeps it, so
      // only the store that currently holds the number may receive it. A
      // channel in `error` (token rejected) still owns its number.
      const channel = await this.prisma.social_channels.findFirst({
        where: {
          provider: PROVIDER,
          channel_type: 'whatsapp',
          phone_number_id: String(phoneNumberId),
          status: { in: ['connected', 'error'] },
        },
        orderBy: [
          { connected_at: { sort: 'desc', nulls: 'last' } },
          { id: 'desc' },
        ],
      });
      if (!channel) continue;
      matchedChannel = true;

      await RequestContextService.runIsolated(
        { store_id: channel.store_id, is_super_admin: false, is_owner: false },
        async () => {
          for (const message of this.asArray(value.messages)) {
            const created = await this.handleMessage(
              event.id,
              channel,
              message,
              options,
            );
            if (created) outcome.messages_created++;
          }
          for (const status of this.asArray(value.statuses)) {
            const applied = await this.handleStatus(channel.store_id, status);
            if (applied === 'missing') outcome.statuses_missing++;
            if (applied === 'applied') outcome.statuses_applied++;
          }
        },
      );
    }

    if (!matchedChannel) {
      await this.settle(
        eventId,
        'ignored',
        'No WhatsApp channel for phone_number_id',
      );
      return { ...outcome, status: 'ignored' };
    }

    if (outcome.statuses_missing > 0 && options.allowStatusRetry) {
      return { ...outcome, status: 'retry' };
    }

    await this.settle(
      eventId,
      'processed',
      outcome.statuses_missing > 0
        ? `${outcome.statuses_missing} status(es) without a matching message`
        : null,
    );
    return outcome;
  }

  async markFailed(eventId: number, error: string): Promise<void> {
    await this.prisma.social_webhook_events.update({
      where: { id: eventId },
      data: { processing_status: 'failed', error: error.slice(0, 2000) },
    });
  }

  private async handleMessage(
    eventId: number,
    channel: WhatsappChannelRow,
    message: any,
    options: InboundProcessOptions,
  ): Promise<boolean> {
    const wamid = typeof message?.id === 'string' ? message.id : null;
    const contact = toE164(message?.from);
    if (!wamid || !contact || message.type === 'reaction') return false;

    const existing = await this.prisma.crm_messages.findUnique({
      where: {
        provider_provider_message_id: {
          provider: PROVIDER,
          provider_message_id: wamid,
        },
      },
    });
    if (existing) return false;

    const sentAt = this.toDate(message.timestamp);
    const media = await this.collectMedia(channel, message, options);
    const conversation = await this.findOrCreateConversation(channel, contact);

    try {
      await this.prisma.crm_messages.create({
        data: {
          store_id: channel.store_id,
          conversation_id: conversation.id,
          direction: 'inbound',
          channel: 'whatsapp',
          status: 'received',
          body: this.extractBody(message),
          media: media
            ? (media as unknown as Prisma.InputJsonValue)
            : undefined,
          provider: PROVIDER,
          provider_message_id: wamid,
          webhook_event_id: eventId,
          sent_at: sentAt,
          created_at: sentAt,
        },
      });
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002') return false;
      throw error;
    }

    const latest = (current: Date | null | undefined) =>
      current && current > sentAt ? current : sentAt;
    await this.prisma.crm_conversations.update({
      where: { id: conversation.id },
      data: {
        last_message_at: latest(conversation.last_message_at),
        last_inbound_at: latest(conversation.last_inbound_at),
        unread_count: { increment: 1 },
        status: 'open',
        closed_at: null,
        social_channel_id: channel.id,
      },
    });

    if (conversation.customer_id) {
      await this.prisma.store_users.updateMany({
        where: {
          store_id: channel.store_id,
          user_id: conversation.customer_id,
        },
        data: { crm_last_contact_at: sentAt },
      });
    }
    return true;
  }

  private async findOrCreateConversation(
    channel: WhatsappChannelRow,
    contact: string,
  ) {
    const where = {
      store_id_channel_contact_address: {
        store_id: channel.store_id,
        channel: 'whatsapp' as const,
        contact_address: contact,
      },
    };
    const existing = await this.prisma.crm_conversations.findUnique({ where });
    if (existing) {
      if (existing.customer_id) return existing;
      const customerId = await this.findCustomerByPhone(
        channel.store_id,
        contact,
      );
      if (!customerId) return existing;
      await this.prisma.crm_conversations.update({
        where: { id: existing.id },
        data: { customer_id: customerId },
      });
      return { ...existing, customer_id: customerId };
    }

    const customerId = await this.findCustomerByPhone(
      channel.store_id,
      contact,
    );
    try {
      return await this.prisma.crm_conversations.create({
        data: {
          store_id: channel.store_id,
          social_channel_id: channel.id,
          channel: 'whatsapp',
          contact_address: contact,
          customer_id: customerId,
          status: 'open',
        },
      });
    } catch (error) {
      if ((error as { code?: string })?.code !== 'P2002') throw error;
      const raced = await this.prisma.crm_conversations.findUnique({ where });
      if (!raced) throw error;
      return raced;
    }
  }

  /**
   * Customer of this store whose phone matches the sender. Compares digits
   * only, and accepts a stored national number (`3001234567`) when the
   * sender adds a 1-3 digit country code (`57`). Returns null unless exactly
   * one customer matches: a shared phone is never guessed.
   *
   * The expression matches the expression index agreed for `users.phone`
   * (DECISIONES §2); the scan is bounded by `store_users.store_id`.
   */
  private async findCustomerByPhone(
    storeId: number,
    contact: string,
  ): Promise<number | null> {
    const digits = contact.replace(/\D/g, '');
    const rows = await this.prisma.$queryRaw<Array<{ user_id: number }>>(
      Prisma.sql`
        SELECT DISTINCT su.user_id
        FROM store_users su
        JOIN users u ON u.id = su.user_id
        CROSS JOIN LATERAL (
          SELECT regexp_replace(u.phone, '\\D', '', 'g') AS phone_digits
        ) p
        WHERE su.store_id = ${storeId}::int
          AND u.phone IS NOT NULL
          AND (
            p.phone_digits = ${digits}::text
            OR (
              length(p.phone_digits) >= 8
              AND length(${digits}::text) - length(p.phone_digits) BETWEEN 1 AND 3
              AND right(${digits}::text, length(p.phone_digits)) = p.phone_digits
            )
          )
        LIMIT 2
      `,
    );
    if (rows.length !== 1) {
      if (rows.length > 1) {
        this.logger.warn(
          `Several customers of store ${storeId} share ${maskAddress(contact)}; conversation left unlinked`,
        );
      }
      return null;
    }
    return Number(rows[0].user_id);
  }

  private async handleStatus(
    storeId: number,
    status: any,
  ): Promise<'applied' | 'unchanged' | 'missing' | 'ignored'> {
    const target = status?.status;
    const wamid = status?.id;
    if (!STATUS_PREDECESSORS[target] || typeof wamid !== 'string') {
      return 'ignored';
    }

    const message = await this.prisma.crm_messages.findUnique({
      where: {
        provider_provider_message_id: {
          provider: PROVIDER,
          provider_message_id: wamid,
        },
      },
    });
    if (!message) return 'missing';
    if (message.store_id !== storeId) {
      this.logger.warn(
        `Status for message ${message.id} arrived through a channel of another store (${storeId}); ignored`,
      );
      return 'ignored';
    }

    const predecessors = STATUS_PREDECESSORS[target];
    if (!predecessors.includes(message.status)) return 'unchanged';

    const data: Record<string, unknown> = {
      status: target,
      [STATUS_TIMESTAMP[target]]: this.toDate(status.timestamp),
    };
    if (target === 'failed') {
      const error = status.errors?.[0];
      const metaCode = typeof error?.code === 'number' ? error.code : undefined;
      data.error_code = mapMetaErrorCode(metaCode).code;
      const detail =
        error?.error_data?.details ||
        error?.message ||
        error?.title ||
        'Delivery failed';
      data.error_message =
        metaCode !== undefined ? `[${metaCode}] ${detail}` : detail;
    }

    const result = await this.prisma.crm_messages.updateMany({
      where: { id: message.id, status: { in: predecessors as never } },
      data,
    });
    return result.count > 0 ? 'applied' : 'unchanged';
  }

  private async collectMedia(
    channel: WhatsappChannelRow,
    message: any,
    options: InboundProcessOptions,
  ): Promise<StoredMedia[] | null> {
    const type = MEDIA_TYPES.find((candidate) => candidate === message?.type);
    const payload = type ? message[type] : null;
    if (!type || !payload?.id) return null;

    const media: StoredMedia = {
      type,
      media_id: String(payload.id),
      ...(payload.mime_type ? { mime: payload.mime_type } : {}),
      ...(payload.filename ? { filename: payload.filename } : {}),
    };

    try {
      const resolved = await this.messaging.toResolvedChannel(channel);
      media.s3_key = await this.copyMediaToS3(
        channel.store_id,
        resolved,
        media,
      );
    } catch (error) {
      const reason = (error as Error)?.message ?? 'unknown';
      if (!options.isLastAttempt) {
        throw new Error(`Could not store media ${media.media_id}: ${reason}`);
      }
      this.logger.warn(
        `Keeping message without media ${media.media_id} (store ${channel.store_id}): ${reason}`,
      );
      media.error = 'download_failed';
    }
    return [media];
  }

  private async copyMediaToS3(
    storeId: number,
    channel: ResolvedChannel,
    media: StoredMedia,
  ): Promise<string> {
    if (!channel.access_token) throw new Error('channel has no access token');
    const headers = { Authorization: `Bearer ${channel.access_token}` };

    const infoResponse = await this.fetchWithTimeout(
      `https://graph.facebook.com/${channel.graph_version}/${media.media_id}`,
      { headers },
    );
    if (!infoResponse.ok) {
      throw new Error(`media lookup answered HTTP ${infoResponse.status}`);
    }
    const info = (await infoResponse.json()) as {
      url?: string;
      mime_type?: string;
      file_size?: number;
    };
    if (!info.url) throw new Error('media lookup returned no url');
    if ((info.file_size ?? 0) > MAX_MEDIA_BYTES) {
      throw new Error(`media is larger than ${MAX_MEDIA_BYTES} bytes`);
    }

    const fileResponse = await this.fetchWithTimeout(info.url, { headers });
    if (!fileResponse.ok) {
      throw new Error(`media download answered HTTP ${fileResponse.status}`);
    }
    const buffer = Buffer.from(await fileResponse.arrayBuffer());
    if (buffer.length > MAX_MEDIA_BYTES) {
      throw new Error(`media is larger than ${MAX_MEDIA_BYTES} bytes`);
    }

    const mime = info.mime_type || media.mime || 'application/octet-stream';
    media.mime = mime;
    const extension = EXTENSIONS[mime.split(';')[0].trim()] ?? 'bin';
    const key = `${await this.storeBasePath(storeId)}/crm/whatsapp-media/${media.media_id}.${extension}`;
    return this.s3.uploadFile(buffer, key, mime);
  }

  private async storeBasePath(storeId: number): Promise<string> {
    const store = await this.prisma.stores.findUnique({
      where: { id: storeId },
      select: {
        id: true,
        slug: true,
        organizations: { select: { id: true, slug: true } },
      },
    });
    if (!store?.organizations) throw new Error(`store ${storeId} not found`);
    return this.s3Path.buildStorePath(store.organizations, {
      id: store.id,
      slug: store.slug,
    });
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MEDIA_TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  private extractBody(message: any): string | null {
    switch (message?.type) {
      case 'text':
        return message.text?.body ?? null;
      case 'button':
        return message.button?.text ?? null;
      case 'interactive':
        return (
          message.interactive?.button_reply?.title ??
          message.interactive?.list_reply?.title ??
          null
        );
      case 'location': {
        const { latitude, longitude, name } = message.location ?? {};
        return `[location] ${latitude},${longitude}${name ? ` ${name}` : ''}`;
      }
      default: {
        const type = MEDIA_TYPES.find(
          (candidate) => candidate === message?.type,
        );
        if (type) return message[type]?.caption ?? null;
        return `[${message?.type ?? 'unknown'}]`;
      }
    }
  }

  private extractValues(payload: unknown): any[] {
    const entries = this.asArray((payload as { entry?: unknown })?.entry);
    return entries.flatMap((entry: any) =>
      this.asArray(entry?.changes)
        .filter((change: any) => change?.field === 'messages' && change.value)
        .map((change: any) => change.value),
    );
  }

  private async settle(
    eventId: number,
    status: 'processed' | 'ignored',
    error: string | null,
  ) {
    await this.prisma.social_webhook_events.update({
      where: { id: eventId },
      data: { processing_status: status, processed_at: new Date(), error },
    });
  }

  private toDate(timestamp: unknown): Date {
    const seconds = Number(timestamp);
    return Number.isFinite(seconds) && seconds > 0
      ? new Date(seconds * 1000)
      : new Date();
  }

  private asArray(value: unknown): any[] {
    return Array.isArray(value) ? value : [];
  }
}
