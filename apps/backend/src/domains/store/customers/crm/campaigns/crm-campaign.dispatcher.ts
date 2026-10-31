import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import Redis from 'ioredis';
import { GlobalPrismaService } from '../../../../../prisma/services/global-prisma.service';
import { RequestContextService } from '../../../../../common/context/request-context.service';
import { REDIS_CLIENT } from '../../../../../common/redis/redis.module';
import { AuditService } from '../../../../../common/audit/audit.service';
import { CrmOutboundQueue } from '../../../../../messaging/queue/crm-outbound.queue';
import {
  CampaignChannel,
  CampaignRecipient,
  PROVIDER_BY_CAMPAIGN_CHANNEL,
  renderPlaceholders,
} from './crm-campaign-audience';
import {
  CRM_CAMPAIGN_DISPATCH_EVENT,
  CampaignContent,
  CrmCampaignsService,
} from './crm-campaigns.service';
import { CrmUnsubscribeService } from './crm-unsubscribe.service';

/** Messages per second one store's campaign hands to the outbound queue. */
export const DEFAULT_CAMPAIGN_RATE_PER_STORE = 10;
/**
 * A scheduled campaign is re-estimated when it starts; it only goes out if
 * the new cost stays within this margin of the cost the owner confirmed.
 */
export const CAMPAIGN_COST_DRIFT = 0.1;
const LOCK_TTL_SECONDS = 15 * 60;
const BATCH = 20;

/**
 * Turns confirmed campaigns into outbound messages (PLAN-CRM §4.7).
 *
 * - Starts scheduled campaigns when their time comes.
 * - Materializes a sending campaign once: re-reads the segment and the
 *   consents (an opt-out since the estimate is excluded), creates one
 *   `crm_messages` row per recipient and enqueues it on `crm-outbound`,
 *   spaced to `CRM_OUTBOUND_RATE_PER_STORE` messages per second.
 * - Closes the campaign when no message is left queued.
 *
 * Materializing is idempotent: a crash halfway re-runs and skips recipients
 * that already have their message, and the queue dedupes by message id.
 * Runs without a request context, so every write names its store; the
 * segment is evaluated inside an isolated context of the campaign's store.
 */
@Injectable()
export class CrmCampaignDispatcher {
  private readonly logger = new Logger(CrmCampaignDispatcher.name);
  private running = false;

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly campaigns: CrmCampaignsService,
    private readonly outbound: CrmOutboundQueue,
    private readonly unsubscribe: CrmUnsubscribeService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @OnEvent(CRM_CAMPAIGN_DISPATCH_EVENT, { async: true })
  async onDispatch(event: { campaign_id: number }): Promise<void> {
    try {
      await this.dispatch(event.campaign_id, new Date());
    } catch (error) {
      // The cron picks it up again on its next run.
      this.logger.error(
        `Campaign ${event.campaign_id} dispatch failed: ${(error as Error)?.message}`,
      );
    }
  }

  @Cron('* * * * *')
  async handle(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.run(new Date());
    } catch (error) {
      this.logger.error(`CRM campaign dispatcher failed: ${(error as Error)?.message}`);
    } finally {
      this.running = false;
    }
  }

  async run(now: Date): Promise<void> {
    const due = await this.prisma.crm_campaigns.findMany({
      where: { status: 'scheduled', scheduled_at: { lte: now } },
      select: { id: true },
      orderBy: { scheduled_at: 'asc' },
      take: BATCH,
    });
    for (const { id } of due) {
      await this.prisma.crm_campaigns.updateMany({
        where: { id, status: 'scheduled' },
        data: { status: 'sending', started_at: now },
      });
    }

    const pending = await this.prisma.crm_campaigns.findMany({
      where: { status: 'sending', recipients_total: 0 },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: BATCH,
    });
    for (const { id } of pending) {
      try {
        await this.dispatch(id, now);
      } catch (error) {
        this.logger.error(`Campaign ${id} dispatch failed: ${(error as Error)?.message}`);
      }
    }

    const active = await this.prisma.crm_campaigns.findMany({
      where: { status: 'sending', recipients_total: { gt: 0 } },
      select: { id: true },
      take: BATCH * 5,
    });
    for (const { id } of active) await this.refresh(id, now);
  }

  /** Returns how many messages were enqueued. */
  async dispatch(campaignId: number, now: Date): Promise<number> {
    const lockKey = `crm:campaign:dispatch:${campaignId}`;
    const locked = await this.redis.set(lockKey, '1', 'EX', LOCK_TTL_SECONDS, 'NX');
    if (locked !== 'OK') return 0;
    try {
      return await this.materialize(campaignId, now);
    } finally {
      await this.redis.del(lockKey).catch(() => undefined);
    }
  }

  /** Recounts the funnel and closes the campaign once nothing is queued. */
  async refresh(campaignId: number, now: Date): Promise<void> {
    const grouped = await this.prisma.crm_messages.groupBy({
      by: ['status'],
      where: { campaign_id: campaignId },
      _count: { _all: true },
    });
    const count = (statuses: string[]) =>
      grouped
        .filter((row) => statuses.includes(row.status))
        .reduce((sum, row) => sum + row._count._all, 0);
    const queued = count(['queued']);
    const sent = count(['sent', 'delivered', 'read']);
    const failed = count(['failed']);

    const data: Prisma.crm_campaignsUpdateManyMutationInput = {
      recipients_sent: sent,
      recipients_failed: failed,
    };
    if (queued === 0) {
      data.status = sent === 0 && failed > 0 ? 'failed' : 'sent';
      data.finished_at = now;
    }
    await this.prisma.crm_campaigns.updateMany({
      where: { id: campaignId, status: 'sending' },
      data,
    });
  }

  private async materialize(campaignId: number, now: Date): Promise<number> {
    const campaign = await this.prisma.crm_campaigns.findUnique({
      where: { id: campaignId },
    });
    if (!campaign || campaign.status !== 'sending' || campaign.recipients_total > 0) {
      return 0;
    }

    const context = {
      store_id: campaign.store_id,
      user_id: campaign.created_by_user_id ?? undefined,
      is_super_admin: false,
      is_owner: false,
    };
    let content: CampaignContent;
    let evaluated: Awaited<ReturnType<CrmCampaignsService['evaluate']>>;
    try {
      content = this.campaigns.contentFromCampaign(campaign);
      evaluated = await RequestContextService.runIsolated(context, () =>
        this.campaigns.evaluate(content, now),
      );
    } catch (error) {
      await this.fail(campaign, 'crm_campaign_invalid', (error as Error)?.message);
      return 0;
    }

    const { estimate, audience, store_name } = evaluated;
    if (estimate.exceeds_max_recipients) {
      await this.fail(campaign, 'crm_campaign_too_many_recipients');
      return 0;
    }
    const confirmed = Number(campaign.estimated_cost ?? 0);
    if (estimate.estimated_cost > confirmed * (1 + CAMPAIGN_COST_DRIFT) + 0.0001) {
      await this.fail(campaign, 'crm_campaign_cost_drift', undefined, {
        confirmed_cost: confirmed,
        estimated_cost: estimate.estimated_cost,
      });
      return 0;
    }
    if (audience.eligible.length === 0) {
      await this.prisma.crm_campaigns.updateMany({
        where: { id: campaignId, status: 'sending' },
        data: { status: 'sent', finished_at: now },
      });
      return 0;
    }

    const channel = content.channel;
    const messageIds: number[] = [];
    for (const recipient of audience.eligible) {
      const id = await this.messageFor(campaign, content, channel, recipient, store_name, now);
      if (id) messageIds.push(id);
    }

    const updated = await this.prisma.crm_campaigns.updateMany({
      where: { id: campaignId, status: 'sending' },
      data: { recipients_total: audience.eligible.length },
    });
    if (updated.count === 0) {
      // Cancelled while materializing: nothing created here may leave.
      await this.prisma.crm_messages.updateMany({
        where: { campaign_id: campaignId, status: 'queued' },
        data: {
          status: 'failed',
          error_code: 'CAMPAIGN_CANCELLED',
          error_message: 'La campaña se canceló antes del envío',
          failed_at: now,
        },
      });
      return 0;
    }

    const rate = this.ratePerStore();
    for (const [index, id] of messageIds.entries()) {
      await this.outbound.enqueue(id, { delayMs: Math.floor(index / rate) * 1000 });
    }

    await this.audit.log({
      userId: campaign.created_by_user_id ?? undefined,
      storeId: campaign.store_id,
      action: 'CUSTOM',
      resource: 'crm_campaigns',
      resourceId: campaignId,
      metadata: {
        reason: 'crm_campaign_dispatched',
        recipients: audience.eligible.length,
        excluded_no_consent: audience.excluded_no_consent,
        excluded_no_address: audience.excluded_no_address,
        excluded_duplicate: audience.excluded_duplicate,
        estimated_cost: estimate.estimated_cost,
      },
    });
    return messageIds.length;
  }

  /**
   * The recipient's conversation (reused, or created closed so a campaign
   * never floods the inbox; a reply reopens it) and its queued message.
   * Returns the id of a message still to enqueue.
   */
  private async messageFor(
    campaign: {
      id: number;
      store_id: number;
      created_by_user_id: number | null;
    },
    content: CampaignContent,
    channel: CampaignChannel,
    recipient: CampaignRecipient,
    storeName: string,
    now: Date,
  ): Promise<number | null> {
    const conversation = await this.prisma.crm_conversations.upsert({
      where: {
        store_id_channel_contact_address: {
          store_id: campaign.store_id,
          channel,
          contact_address: recipient.address,
        },
      },
      create: {
        store_id: campaign.store_id,
        customer_id: recipient.customer_id,
        channel,
        contact_address: recipient.address,
        status: 'closed',
        closed_at: now,
      },
      update: {},
      select: { id: true },
    });

    const existing = await this.prisma.crm_messages.findFirst({
      where: { campaign_id: campaign.id, conversation_id: conversation.id },
      select: { id: true, status: true },
    });
    if (existing) return existing.status === 'queued' ? existing.id : null;

    const render = (text: string | null) =>
      text === null ? null : renderPlaceholders(text, recipient, storeName);
    const body =
      channel === 'email'
        ? this.unsubscribe.appendFooter(render(content.body) ?? '', {
            store_id: campaign.store_id,
            customer_id: recipient.customer_id,
            channel: 'email',
          })
        : render(content.body);

    const message = await this.prisma.crm_messages.create({
      data: {
        store_id: campaign.store_id,
        conversation_id: conversation.id,
        direction: 'outbound',
        channel,
        status: 'queued',
        body,
        template_name: content.template_name,
        template_language: content.template_language,
        template_variables: content.template_name
          ? (content.template_variables.map((value) =>
              renderPlaceholders(value, recipient, storeName),
            ) as Prisma.InputJsonValue)
          : Prisma.DbNull,
        subject: channel === 'email' ? render(content.subject) : null,
        provider: PROVIDER_BY_CAMPAIGN_CHANNEL[channel],
        sent_by_user_id: campaign.created_by_user_id,
        campaign_id: campaign.id,
      },
      select: { id: true },
    });
    return message.id;
  }

  private ratePerStore(): number {
    const configured = Number(this.config.get<string>('CRM_OUTBOUND_RATE_PER_STORE'));
    return Number.isFinite(configured) && configured > 0
      ? configured
      : DEFAULT_CAMPAIGN_RATE_PER_STORE;
  }

  private async fail(
    campaign: { id: number; store_id: number; created_by_user_id: number | null },
    reason: string,
    detail?: string,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    this.logger.warn(`Campaign ${campaign.id} not sent: ${reason}${detail ? ` (${detail})` : ''}`);
    await this.prisma.crm_campaigns.updateMany({
      where: { id: campaign.id, status: 'sending' },
      data: { status: 'failed', finished_at: new Date() },
    });
    await this.audit.log({
      userId: campaign.created_by_user_id ?? undefined,
      storeId: campaign.store_id,
      action: 'CUSTOM',
      resource: 'crm_campaigns',
      resourceId: campaign.id,
      metadata: { reason, detail: detail ?? null, ...extra },
    });
  }
}
