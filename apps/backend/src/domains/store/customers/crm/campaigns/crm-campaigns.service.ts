import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RequestContextService } from '@common/context/request-context.service';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { AuditService } from '../../../../../common/audit/audit.service';
import { ErrorCodes, VendixHttpException } from '../../../../../common/errors';
import { MessagingService } from '../../../../../messaging/messaging.service';
import { SmsSpendService } from '../../../../../messaging/spend/sms-spend.service';
import { maskAddress } from '../../../../../messaging/utils/mask-address.util';
import { resolveCrmViewer } from '../shared/crm-access';
import { CrmSegmentQueryService } from '../segments/crm-segment-query.service';
import {
  CampaignAudience,
  CampaignChannel,
  PROVIDER_BY_CAMPAIGN_CHANNEL,
  buildAudience,
  estimateCampaignCost,
  unknownPlaceholders,
} from './crm-campaign-audience';
import {
  CreateCrmCampaignDto,
  CrmCampaignContentDto,
  CrmCampaignRecipientsQueryDto,
  CrmCampaignsQueryDto,
} from './dto/crm-campaigns.dto';

/** Largest audience one campaign may have (`CRM_CAMPAIGN_MAX_RECIPIENTS`). */
export const DEFAULT_CAMPAIGN_MAX_RECIPIENTS = 5000;
/** Emitted when a campaign starts sending now; `CrmCampaignDispatcher` listens. */
export const CRM_CAMPAIGN_DISPATCH_EVENT = 'crm.campaign.dispatch';
/** Estimates are compared at the 4 decimals of the spend counter. */
const COST_TOLERANCE = 0.00005;

/** What a campaign sends; read from the DTO or from a saved campaign. */
export interface CampaignContent {
  segment_id: number;
  channel: CampaignChannel;
  template_name: string | null;
  template_language: string | null;
  template_variables: string[];
  body: string | null;
  subject: string | null;
}

export interface CampaignEstimate {
  segment_id: number;
  channel: CampaignChannel;
  segment_total: number;
  recipients: number;
  excluded_no_consent: number;
  excluded_no_address: number;
  excluded_duplicate: number;
  estimated_cost: number;
  currency: 'USD';
  /** SMS only: what is left of the store's monthly cap (`null` = no SMS channel or no cap). */
  spend_remaining: number | null;
  exceeds_spend_limit: boolean;
  max_recipients: number;
  exceeds_max_recipients: boolean;
  /** WhatsApp: the template was found APPROVED/MARKETING in the local cache. */
  template_verified: boolean | null;
}

export interface EvaluatedCampaign {
  estimate: CampaignEstimate;
  audience: CampaignAudience;
  store_name: string;
}

const CAMPAIGN_SELECT = {
  id: true,
  name: true,
  channel: true,
  segment_id: true,
  template_name: true,
  template_language: true,
  template_variables: true,
  body: true,
  subject: true,
  status: true,
  scheduled_at: true,
  started_at: true,
  finished_at: true,
  recipients_total: true,
  recipients_sent: true,
  recipients_failed: true,
  estimated_cost: true,
  created_by_user_id: true,
  created_at: true,
  updated_at: true,
  segment: { select: { id: true, name: true } },
} as const;

/**
 * Marketing campaigns over a saved segment (PLAN-CRM §4.7). A campaign is a
 * draft until someone with `store:crm_campaigns:send` confirms the current
 * cost estimate; then it is scheduled or starts sending. Delivery goes
 * through the `messaging/` layer: one `crm_messages` row per recipient on the
 * `crm-outbound` queue, so the SMS spend cap, opt-out checks, dry-run and
 * delivery/read statuses are the same as the inbox.
 */
@Injectable()
export class CrmCampaignsService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly segments: CrmSegmentQueryService,
    private readonly messaging: MessagingService,
    private readonly smsSpend: SmsSpendService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
  ) {}

  async estimate(dto: CrmCampaignContentDto): Promise<CampaignEstimate> {
    const content = this.contentFromDto(dto);
    return (await this.evaluate(content)).estimate;
  }

  async estimateSaved(id: number): Promise<CampaignEstimate> {
    const campaign = await this.findOrFail(id);
    return (await this.evaluate(this.contentFromCampaign(campaign))).estimate;
  }

  async create(dto: CreateCrmCampaignDto) {
    const viewer = resolveCrmViewer(ErrorCodes.CRM_CAMPAIGN_001);
    const scheduledAt = this.parseSchedule(dto.scheduled_at);
    const content = this.contentFromDto(dto);
    const { estimate } = await this.evaluate(content);

    const campaign = await this.prisma.crm_campaigns.create({
      data: {
        store_id: viewer.store_id,
        name: dto.name.trim(),
        channel: content.channel,
        segment_id: content.segment_id,
        template_name: content.template_name,
        template_language: content.template_language,
        template_variables: content.template_name
          ? (content.template_variables as Prisma.InputJsonValue)
          : Prisma.DbNull,
        body: content.body,
        subject: content.subject,
        status: 'draft',
        scheduled_at: scheduledAt,
        estimated_cost: estimate.estimated_cost,
        created_by_user_id: viewer.user_id,
      },
      select: CAMPAIGN_SELECT,
    });
    return { ...this.present(campaign), estimate };
  }

  /**
   * Confirms the estimate and starts (or schedules) the campaign. The
   * confirmed cost must equal the estimate recomputed now: if the segment,
   * consents or content changed since the owner looked, the send is refused.
   */
  async send(id: number, confirmedCost: number) {
    const viewer = resolveCrmViewer(ErrorCodes.CRM_CAMPAIGN_001);
    const campaign = await this.findOrFail(id);
    if (campaign.status !== 'draft') {
      throw new VendixHttpException(ErrorCodes.CRM_CAMPAIGN_002);
    }
    if (campaign.scheduled_at && campaign.scheduled_at.getTime() <= Date.now()) {
      throw new VendixHttpException(ErrorCodes.CRM_CAMPAIGN_007);
    }

    const content = this.contentFromCampaign(campaign);
    const { estimate } = await this.evaluate(content);
    if (Math.abs(estimate.estimated_cost - confirmedCost) > COST_TOLERANCE) {
      throw new VendixHttpException(ErrorCodes.CRM_CAMPAIGN_003, undefined, {
        estimated_cost: estimate.estimated_cost,
        confirmed_cost: confirmedCost,
      });
    }
    if (estimate.recipients === 0 || estimate.exceeds_max_recipients) {
      throw new VendixHttpException(ErrorCodes.CRM_CAMPAIGN_005, undefined, {
        recipients: estimate.recipients,
        max_recipients: estimate.max_recipients,
      });
    }
    if (estimate.exceeds_spend_limit) {
      throw new VendixHttpException(ErrorCodes.CRM_SMS_SPEND_LIMIT, undefined, {
        estimated_cost: estimate.estimated_cost,
        spend_remaining: estimate.spend_remaining,
      });
    }
    await this.assertChannelConnected(viewer.store_id, content.channel);

    const now = new Date();
    const scheduled = !!campaign.scheduled_at;
    const claimed = await this.prisma.crm_campaigns.updateMany({
      where: { id, status: 'draft' },
      data: scheduled
        ? { status: 'scheduled', estimated_cost: estimate.estimated_cost }
        : { status: 'sending', started_at: now, estimated_cost: estimate.estimated_cost },
    });
    if (claimed.count === 0) {
      throw new VendixHttpException(ErrorCodes.CRM_CAMPAIGN_002);
    }

    await this.audit.log({
      userId: viewer.user_id,
      storeId: viewer.store_id,
      action: 'CUSTOM',
      resource: 'crm_campaigns',
      resourceId: id,
      metadata: {
        reason: scheduled ? 'crm_campaign_scheduled' : 'crm_campaign_send',
        channel: content.channel,
        segment_id: content.segment_id,
        recipients: estimate.recipients,
        excluded_no_consent: estimate.excluded_no_consent,
        estimated_cost: estimate.estimated_cost,
        scheduled_at: campaign.scheduled_at?.toISOString() ?? null,
      },
    });

    if (!scheduled) this.events.emit(CRM_CAMPAIGN_DISPATCH_EVENT, { campaign_id: id });
    return this.get(id);
  }

  /** Messages still queued never leave: they are marked failed here. */
  async cancel(id: number) {
    const viewer = resolveCrmViewer(ErrorCodes.CRM_CAMPAIGN_001);
    await this.findOrFail(id);
    const cancelled = await this.prisma.crm_campaigns.updateMany({
      where: { id, status: { in: ['draft', 'scheduled', 'sending'] } },
      data: { status: 'cancelled', finished_at: new Date() },
    });
    if (cancelled.count === 0) {
      throw new VendixHttpException(ErrorCodes.CRM_CAMPAIGN_002);
    }
    const dropped = await this.prisma.crm_messages.updateMany({
      where: { campaign_id: id, status: 'queued' },
      data: {
        status: 'failed',
        error_code: 'CAMPAIGN_CANCELLED',
        error_message: 'La campaña se canceló antes del envío',
        failed_at: new Date(),
      },
    });
    await this.audit.log({
      userId: viewer.user_id,
      storeId: viewer.store_id,
      action: 'CUSTOM',
      resource: 'crm_campaigns',
      resourceId: id,
      metadata: { reason: 'crm_campaign_cancelled', dropped_messages: dropped.count },
    });
    return this.get(id);
  }

  async list(query: CrmCampaignsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const [rows, total] = await Promise.all([
      this.prisma.crm_campaigns.findMany({
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: CAMPAIGN_SELECT,
      }),
      this.prisma.crm_campaigns.count(),
    ]);
    return { data: rows.map((row) => this.present(row)), total, page, limit };
  }

  async get(id: number) {
    const campaign = await this.findOrFail(id);
    return { ...this.present(campaign), metrics: await this.metrics(campaign) };
  }

  /**
   * Delivery funnel of the campaign. `read` implies delivered and sent, so
   * each figure counts the messages that reached at least that state.
   * `opted_out` counts recipients who unsubscribed from the channel after
   * the campaign started.
   */
  async metrics(campaign: {
    id: number;
    channel: string;
    started_at: Date | null;
  }) {
    const grouped = await this.prisma.crm_messages.groupBy({
      by: ['status'],
      where: { campaign_id: campaign.id },
      _count: { _all: true },
    });
    const by = (status: string) =>
      grouped.find((row) => row.status === status)?._count._all ?? 0;
    const read = by('read');
    const delivered = by('delivered') + read;
    const sent = by('sent') + delivered;

    const failures = await this.prisma.crm_messages.groupBy({
      by: ['error_code'],
      where: { campaign_id: campaign.id, status: 'failed' },
      _count: { _all: true },
    });

    let optedOut = 0;
    if (campaign.started_at) {
      const recipients = await this.prisma.crm_messages.findMany({
        where: { campaign_id: campaign.id },
        select: { conversation: { select: { customer_id: true } } },
      });
      const ids = [
        ...new Set(
          recipients
            .map((row) => row.conversation.customer_id)
            .filter((value): value is number => value != null),
        ),
      ];
      const consent: Prisma.store_usersWhereInput =
        campaign.channel === 'whatsapp'
          ? { whatsapp_consent: 'opted_out' }
          : campaign.channel === 'sms'
            ? { sms_consent: 'opted_out' }
            : { email_consent: 'opted_out' };
      if (ids.length) {
        optedOut = await this.prisma.store_users.count({
          where: {
            user_id: { in: ids },
            ...consent,
            consent_updated_at: { gte: campaign.started_at },
          },
        });
      }
    }

    return {
      queued: by('queued'),
      sent,
      delivered,
      read,
      failed: by('failed'),
      opted_out: optedOut,
      failed_by_reason: Object.fromEntries(
        failures.map((row) => [row.error_code ?? 'UNKNOWN', row._count._all]),
      ),
    };
  }

  async recipients(id: number, query: CrmCampaignRecipientsQueryDto) {
    await this.findOrFail(id);
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const where: Prisma.crm_messagesWhereInput = {
      campaign_id: id,
      ...(query.status ? { status: query.status } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.crm_messages.findMany({
        where,
        orderBy: { id: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          status: true,
          error_code: true,
          sent_at: true,
          delivered_at: true,
          read_at: true,
          failed_at: true,
          cost_amount: true,
          conversation: {
            select: {
              id: true,
              contact_address: true,
              customer: { select: { id: true, first_name: true, last_name: true } },
            },
          },
        },
      }),
      this.prisma.crm_messages.count({ where }),
    ]);
    const reveal = this.segments.canReadContact();
    const data = rows.map(({ conversation, ...row }) => ({
      ...row,
      conversation_id: conversation.id,
      customer: conversation.customer,
      address: reveal ? conversation.contact_address : maskAddress(conversation.contact_address),
    }));
    return { data, total, page, limit };
  }

  /**
   * Validates the content for its channel, resolves the segment and the
   * audience under the current consents, and estimates the cost.
   */
  async evaluate(content: CampaignContent, now = new Date()): Promise<EvaluatedCampaign> {
    const storeId = RequestContextService.getContext()?.store_id;
    if (!storeId) throw new VendixHttpException(ErrorCodes.CRM_CAMPAIGN_001);
    const templateVerified = await this.validateContent(content);

    const saved = await this.prisma.crm_segments.findFirst({
      where: { id: content.segment_id },
      select: { filter: true },
    });
    if (!saved) throw new VendixHttpException(ErrorCodes.CRM_SEGMENT_002);
    const segment = await this.segments.resolve(saved.filter, now);

    const max = this.maxRecipients();
    const [rows, segmentTotal, store] = await Promise.all([
      this.segments.recipients(segment, max),
      this.segments.count(segment),
      this.prisma.withoutScope().stores.findUnique({
        where: { id: storeId },
        select: { name: true },
      }),
    ]);
    const storeName = store?.name ?? '';
    const audience = buildAudience(
      rows.slice(0, max),
      content.channel,
      this.config.get<string>('SNS_SMS_DEFAULT_COUNTRY_CODE') || '57',
    );
    const estimatedCost = estimateCampaignCost(
      audience.eligible,
      { channel: content.channel, body: content.body },
      storeName,
      {
        sms_price_table: this.config.get<string>('SNS_SMS_PRICE_TABLE'),
        whatsapp_price_table: this.config.get<string>('CRM_WHATSAPP_PRICE_TABLE'),
        email_price_usd: Number(this.config.get<string>('CRM_EMAIL_PRICE_USD')) || undefined,
      },
    );

    const spendRemaining =
      content.channel === 'sms' ? await this.smsRemaining(storeId, now) : null;

    return {
      audience,
      store_name: storeName,
      estimate: {
        segment_id: content.segment_id,
        channel: content.channel,
        segment_total: segmentTotal,
        recipients: audience.eligible.length,
        excluded_no_consent: audience.excluded_no_consent,
        excluded_no_address: audience.excluded_no_address,
        excluded_duplicate: audience.excluded_duplicate,
        estimated_cost: estimatedCost,
        currency: 'USD',
        spend_remaining: spendRemaining,
        exceeds_spend_limit:
          content.channel === 'sms' &&
          !this.messaging.isDryRun() &&
          (spendRemaining === null || estimatedCost > spendRemaining + COST_TOLERANCE),
        max_recipients: max,
        exceeds_max_recipients: rows.length > max,
        template_verified: content.channel === 'whatsapp' ? templateVerified : null,
      },
    };
  }

  maxRecipients(): number {
    const configured = Number(this.config.get<string>('CRM_CAMPAIGN_MAX_RECIPIENTS'));
    return Number.isInteger(configured) && configured > 0
      ? configured
      : DEFAULT_CAMPAIGN_MAX_RECIPIENTS;
  }

  contentFromCampaign(campaign: {
    segment_id: number | null;
    channel: string;
    template_name: string | null;
    template_language: string | null;
    template_variables: unknown;
    body: string | null;
    subject: string | null;
  }): CampaignContent {
    if (!campaign.segment_id) {
      // The segment was deleted after the draft was created.
      throw new VendixHttpException(ErrorCodes.CRM_SEGMENT_002);
    }
    return {
      segment_id: campaign.segment_id,
      channel: campaign.channel as CampaignChannel,
      template_name: campaign.template_name,
      template_language: campaign.template_language,
      template_variables: Array.isArray(campaign.template_variables)
        ? campaign.template_variables.map(String)
        : [],
      body: campaign.body,
      subject: campaign.subject,
    };
  }

  private contentFromDto(dto: CrmCampaignContentDto): CampaignContent {
    const isWhatsapp = dto.channel === 'whatsapp';
    return {
      segment_id: dto.segment_id,
      channel: dto.channel,
      template_name: isWhatsapp ? (dto.template?.name ?? null) : null,
      template_language: isWhatsapp ? (dto.template?.language ?? null) : null,
      template_variables: isWhatsapp ? (dto.template?.variables ?? []) : [],
      body: isWhatsapp ? null : dto.body?.trim() || null,
      subject: dto.channel === 'email' ? dto.subject?.trim() || null : null,
    };
  }

  /**
   * WhatsApp marketing is template-only; SMS needs a text; email a subject
   * and a text. Placeholders outside the closed catalog are rejected.
   * Returns whether a WhatsApp template was verified in the local cache.
   */
  private async validateContent(content: CampaignContent): Promise<boolean> {
    const invalid = (detail: string) =>
      new VendixHttpException(ErrorCodes.CRM_CAMPAIGN_004, detail);

    const texts = [content.body, content.subject, ...content.template_variables];
    const unknown = texts.flatMap((text) => unknownPlaceholders(text));
    if (unknown.length) {
      throw invalid(
        `Marcadores no permitidos: ${[...new Set(unknown)].join(', ')}. Usa {first_name}, {last_name} o {store_name}.`,
      );
    }

    if (content.channel === 'sms') {
      if (!content.body) throw invalid('Un SMS necesita texto.');
      if (content.body.length > 1000) throw invalid('El SMS no puede superar 1000 caracteres.');
      return false;
    }
    if (content.channel === 'email') {
      if (!content.subject || !content.body) {
        throw invalid('Un correo necesita asunto y texto.');
      }
      return false;
    }

    if (!content.template_name || !content.template_language) {
      throw invalid('Las campañas de WhatsApp solo se envían con una plantilla aprobada.');
    }
    const cached = await this.prisma.crm_message_templates.findMany({
      where: { name: content.template_name, language: content.template_language },
      select: { status: true, category: true, components: true },
    });
    if (!cached.length) return false;
    const usable = cached.find(
      (row) => row.status === 'APPROVED' && row.category === 'MARKETING',
    );
    if (!usable) {
      throw invalid('La plantilla debe estar aprobada en Meta y ser de categoría MARKETING.');
    }
    const expected = countTemplateVariables(usable.components);
    if (expected !== null && expected !== content.template_variables.length) {
      throw invalid(`La plantilla espera ${expected} variables.`);
    }
    return true;
  }

  /** In dry-run nothing is sent, so no real channel is needed (same as `MessagingService`). */
  private async assertChannelConnected(storeId: number, channel: CampaignChannel) {
    if (this.messaging.isDryRun()) return;
    const row = await this.prisma.social_channels.findFirst({
      where: {
        store_id: storeId,
        channel_type: channel,
        provider: PROVIDER_BY_CAMPAIGN_CHANNEL[channel],
        status: 'connected',
      },
      select: { id: true },
    });
    if (!row) throw new VendixHttpException(ErrorCodes.CRM_CAMPAIGN_006);
  }

  private async smsRemaining(storeId: number, now: Date): Promise<number | null> {
    const row = await this.prisma.social_channels.findFirst({
      where: { store_id: storeId, channel_type: 'sms', provider: 'sns_sms', status: 'connected' },
      select: { monthly_spend_limit: true, monthly_spend_used: true, spend_period_start: true },
    });
    return row ? this.smsSpend.snapshot(row, now).remaining : null;
  }

  private parseSchedule(value: string | undefined): Date | null {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
      throw new VendixHttpException(ErrorCodes.CRM_CAMPAIGN_007);
    }
    return date;
  }

  private async findOrFail(id: number) {
    const campaign = await this.prisma.crm_campaigns.findFirst({
      where: { id },
      select: CAMPAIGN_SELECT,
    });
    if (!campaign) throw new VendixHttpException(ErrorCodes.CRM_CAMPAIGN_001);
    return campaign;
  }

  private present<T extends { estimated_cost: Prisma.Decimal | null }>(campaign: T) {
    return {
      ...campaign,
      estimated_cost: campaign.estimated_cost === null ? null : Number(campaign.estimated_cost),
    };
  }
}

/** Highest `{{n}}` of the BODY component, or `null` when it cannot be read. */
function countTemplateVariables(components: unknown): number | null {
  if (!Array.isArray(components)) return null;
  const body = components.find(
    (item) => item && typeof item === 'object' && (item as { type?: string }).type === 'BODY',
  ) as { text?: unknown } | undefined;
  if (!body || typeof body.text !== 'string') return null;
  const indexes = [...body.text.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1]));
  return indexes.length ? Math.max(...indexes) : 0;
}

