import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import { RequestContextService } from '../../common/context/request-context.service';
import { MessagingService } from '../messaging.service';
import {
  MessagingMediaType,
  OutboundMessage,
  OutboundTemplate,
  SendResult,
} from '../interfaces/messaging.interface';
import { CRM_OUTBOUND_QUEUE, CrmOutboundJob } from './crm-outbound.constants';
import { CrmInboxEventsService } from '../events/crm-inbox-events.service';

const SENDABLE_CHANNELS = ['whatsapp', 'sms', 'email'] as const;

/**
 * Delivers outbound `crm_messages` rows (PLAN-CRM §5.0).
 *
 * The row is claimed (`queued → sending`, guarded) before the provider is
 * called and every later update is guarded by `status = 'sending'`, so a
 * re-delivered job never sends twice nor overwrites a status the webhook
 * already advanced. A job that finds the row still `sending` means a previous
 * attempt died after calling the provider (worker crash, lost DB update): the
 * message may be out and charged, so it ends `failed/UNKNOWN` without being
 * resent. Retryable failures put the row back to `queued` and re-throw so
 * BullMQ applies the exponential backoff; the last attempt marks it `failed`.
 *
 * The limiter is global to the worker (BullMQ OSS has no per-group limits);
 * campaigns pace each store by delaying their jobs (`CrmCampaignDispatcher`).
 * Campaign messages travel as marketing, so `MessagingService` re-checks the
 * customer's consent right before sending.
 */
@Processor(CRM_OUTBOUND_QUEUE, {
  concurrency: 5,
  limiter: { max: 20, duration: 1000 },
})
export class CrmOutboundProcessor extends WorkerHost {
  private readonly logger = new Logger(CrmOutboundProcessor.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly messaging: MessagingService,
    private readonly events: CrmInboxEventsService,
  ) {
    super();
  }

  async process(job: Job<CrmOutboundJob>): Promise<void> {
    const messageId = job.data.message_id;
    const message = await this.prisma.crm_messages.findUnique({
      where: { id: messageId },
      include: { conversation: true, campaign: { select: { status: true } } },
    });

    if (
      !message ||
      (message.status !== 'queued' && message.status !== 'sending') ||
      message.direction !== 'outbound' ||
      !SENDABLE_CHANNELS.includes(
        message.channel as (typeof SENDABLE_CHANNELS)[number],
      )
    ) {
      this.logger.warn(
        `Skipping crm-outbound job for message ${messageId}: ${message ? `${message.direction}/${message.channel}/${message.status}` : 'not found'}`,
      );
      return;
    }

    if (message.status === 'sending') {
      this.logger.warn(
        `crm-outbound message ${messageId} was left sending by an interrupted attempt; marking it failed without resending`,
      );
      const interrupted = await this.prisma.crm_messages.updateMany({
        where: { id: messageId, status: 'sending' },
        data: {
          status: 'failed',
          error_code: 'UNKNOWN',
          error_message:
            'The send was interrupted after reaching the provider; it may have been delivered and is not resent',
          failed_at: new Date(),
        },
      });
      if (interrupted.count > 0) await this.notify(message, 'failed');
      return;
    }

    if (message.campaign?.status === 'cancelled') {
      await this.prisma.crm_messages.updateMany({
        where: { id: messageId, status: 'queued' },
        data: {
          status: 'failed',
          error_code: 'CAMPAIGN_CANCELLED',
          error_message: 'La campaña se canceló antes del envío',
          failed_at: new Date(),
        },
      });
      return;
    }

    const claimed = await this.prisma.crm_messages.updateMany({
      where: { id: messageId, status: 'queued' },
      data: { status: 'sending' },
    });
    if (claimed.count === 0) {
      this.logger.warn(
        `Skipping crm-outbound job for message ${messageId}: already claimed`,
      );
      return;
    }

    const outbound = this.toOutbound(message);
    const result = await RequestContextService.runIsolated(
      { store_id: message.store_id, is_super_admin: false, is_owner: false },
      () => this.messaging.send(outbound),
    );

    if (result.status === 'sent') {
      const sent = await this.prisma.crm_messages.updateMany({
        where: { id: messageId, status: 'sending' },
        data: {
          status: 'sent',
          provider: result.provider,
          provider_message_id: result.provider_message_id ?? null,
          ...(result.cost_amount !== undefined
            ? { cost_amount: result.cost_amount }
            : {}),
          sent_at: new Date(),
          error_code: null,
          error_message: null,
        },
      });
      if (sent.count > 0) await this.notify(message, 'sent');
      return;
    }

    const errorMessage = this.errorMessage(result);
    const maxAttempts = job.opts.attempts ?? 1;
    const isLastAttempt = job.attemptsMade + 1 >= maxAttempts;

    if (result.retryable && !isLastAttempt) {
      await this.prisma.crm_messages.updateMany({
        where: { id: messageId, status: 'sending' },
        data: {
          status: 'queued',
          error_code: result.error_code ?? 'UNKNOWN',
          error_message: errorMessage,
        },
      });
      throw new Error(
        `crm-outbound ${messageId}: ${result.error_code} (retryable)`,
      );
    }

    const failed = await this.prisma.crm_messages.updateMany({
      where: { id: messageId, status: 'sending' },
      data: {
        status: 'failed',
        error_code: result.error_code ?? 'UNKNOWN',
        error_message: errorMessage,
        failed_at: new Date(),
      },
    });
    if (failed.count > 0) await this.notify(message, 'failed');
  }

  private notify(
    message: {
      id: number;
      store_id: number;
      conversation_id: number;
      conversation: { assigned_user_id: number | null };
    },
    status: 'sent' | 'failed',
  ): Promise<void> {
    return this.events.publish({
      type: 'crm.message',
      store_id: message.store_id,
      conversation_id: message.conversation_id,
      assigned_user_id: message.conversation.assigned_user_id,
      message_id: message.id,
      status,
      direction: 'outbound',
    });
  }

  private toOutbound(message: {
    id: number;
    store_id: number;
    channel: string;
    body: string | null;
    subject?: string | null;
    campaign_id?: number | null;
    template_name: string | null;
    template_language: string | null;
    template_variables: unknown;
    media: unknown;
    conversation: {
      contact_address: string;
      last_inbound_at: Date | null;
      customer_id: number | null;
    };
  }): OutboundMessage {
    const outbound: OutboundMessage = {
      store_id: message.store_id,
      channel: message.channel as OutboundMessage['channel'],
      to: message.conversation.contact_address,
      customer_id: message.conversation.customer_id,
      idempotency_key: String(message.id),
    };
    if (message.body) outbound.body = message.body;
    if (message.subject) outbound.subject = message.subject;
    if (message.campaign_id) outbound.marketing = true;
    if (message.channel === 'whatsapp') {
      outbound.last_inbound_at = message.conversation.last_inbound_at;
    }

    if (message.template_name) {
      outbound.template = this.toTemplate(
        message.template_name,
        message.template_language,
        message.template_variables,
      );
    }

    const media = Array.isArray(message.media) ? message.media : [];
    const sendable = media.filter(
      (
        item,
      ): item is { type: MessagingMediaType; url: string; filename?: string } =>
        !!item && typeof item.url === 'string' && typeof item.type === 'string',
    );
    if (sendable.length) {
      outbound.media = sendable.map(({ type, url, filename }) => ({
        type,
        url,
        ...(filename ? { filename } : {}),
      }));
    }
    return outbound;
  }

  /** `template_variables` is either `string[]` or `{ variables, header_media }`. */
  private toTemplate(
    name: string,
    language: string | null,
    stored: unknown,
  ): OutboundTemplate {
    const template: OutboundTemplate = {
      name,
      language: language || 'es',
      variables: [],
    };
    if (Array.isArray(stored)) {
      template.variables = stored.map(String);
    } else if (stored && typeof stored === 'object') {
      const value = stored as {
        variables?: unknown;
        header_media?: OutboundTemplate['header_media'];
      };
      if (Array.isArray(value.variables))
        template.variables = value.variables.map(String);
      if (value.header_media?.url) template.header_media = value.header_media;
    }
    return template;
  }

  private errorMessage(result: SendResult): string {
    const prefix = result.provider_error_code
      ? `[${result.provider_error_code}] `
      : '';
    return `${prefix}${result.error_message ?? ''}`.trim();
  }
}
