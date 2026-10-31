import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { AuditService } from '../../../../common/audit/audit.service';
import { SmsSpendService } from '../../../../messaging/spend/sms-spend.service';
import { UpdateSmsChannelDto } from './dto/update-sms-channel.dto';
import { UpdateEmailChannelDto } from './dto/update-email-channel.dto';

type ChannelKind = 'sms' | 'email';

const PROVIDER_BY_KIND: Record<ChannelKind, string> = {
  sms: 'sns_sms',
  email: 'ses_email',
};

const CHANNEL_SELECT = {
  id: true,
  channel_type: true,
  provider: true,
  status: true,
  metadata: true,
  connected_at: true,
  disconnected_at: true,
  monthly_spend_limit: true,
  monthly_spend_used: true,
  spend_period_start: true,
  updated_at: true,
} as const;

type ChannelRow = Prisma.social_channelsGetPayload<{
  select: typeof CHANNEL_SELECT;
}>;

/**
 * SMS and email channels of the store (PLAN-CRM §4.2). They carry settings,
 * not credentials: SMS goes through the platform SNS account with a hard
 * monthly cap per store, email through the platform SES sender.
 *
 * `enabled` maps to `status` `connected`/`disconnected`, the status
 * `MessagingService` resolves. Spend counters are never written here: only
 * `SmsSpendService` touches them, atomically.
 */
@Injectable()
export class MessagingChannelsService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly audit: AuditService,
    private readonly smsSpend: SmsSpendService,
  ) {}

  async updateSms(dto: UpdateSmsChannelDto) {
    const existing = await this.find('sms');
    const previousMetadata = this.asRecord(existing?.metadata);
    const previous = {
      enabled: existing ? existing.status === 'connected' : null,
      sender_id: previousMetadata.sender_id ?? null,
      monthly_spend_limit:
        existing?.monthly_spend_limit == null
          ? null
          : Number(existing.monthly_spend_limit),
    };
    const metadata = { ...previousMetadata, sender_id: dto.sender_id ?? null };

    const saved = await this.save('sms', existing, dto.enabled, {
      metadata,
      monthly_spend_limit: new Prisma.Decimal(dto.monthly_spend_limit),
    });
    if (previous.monthly_spend_limit !== dto.monthly_spend_limit) {
      await this.smsSpend.resetLimitNotice(saved.store_id);
    }
    await this.logChange(saved.id, existing, previous, {
      enabled: dto.enabled,
      sender_id: metadata.sender_id,
      monthly_spend_limit: dto.monthly_spend_limit,
    });
    return this.toView(saved);
  }

  async updateEmail(dto: UpdateEmailChannelDto) {
    const existing = await this.find('email');
    const previousMetadata = this.asRecord(existing?.metadata);
    const previous = {
      enabled: existing ? existing.status === 'connected' : null,
      from_name: previousMetadata.from_name ?? null,
      reply_to: previousMetadata.reply_to ?? null,
    };
    const metadata = {
      ...previousMetadata,
      from_name: dto.from_name ?? null,
      reply_to: dto.reply_to ?? null,
    };

    const saved = await this.save('email', existing, dto.enabled, {
      metadata,
    });
    await this.logChange(saved.id, existing, previous, {
      enabled: dto.enabled,
      from_name: metadata.from_name,
      reply_to: metadata.reply_to,
    });
    return this.toView(saved);
  }

  private find(kind: ChannelKind): Promise<ChannelRow | null> {
    return this.prisma.social_channels.findFirst({
      where: { channel_type: kind, provider: PROVIDER_BY_KIND[kind] },
      select: CHANNEL_SELECT,
    });
  }

  private async save(
    kind: ChannelKind,
    existing: ChannelRow | null,
    enabled: boolean,
    data: {
      metadata: Record<string, unknown>;
      monthly_spend_limit?: Prisma.Decimal;
    },
  ): Promise<ChannelRow & { store_id: number }> {
    const store_id = this.requireStoreId();
    const now = new Date();
    const wasEnabled = existing?.status === 'connected';
    const values = {
      status: enabled ? 'connected' : 'disconnected',
      metadata: data.metadata as Prisma.InputJsonValue,
      ...(data.monthly_spend_limit !== undefined
        ? { monthly_spend_limit: data.monthly_spend_limit }
        : {}),
      ...(enabled && !wasEnabled ? { connected_at: now } : {}),
      ...(!enabled && wasEnabled ? { disconnected_at: now } : {}),
      last_error: null,
    };

    if (existing) {
      await this.prisma.social_channels.updateMany({
        where: {
          id: existing.id,
          channel_type: kind,
          provider: PROVIDER_BY_KIND[kind],
        },
        data: values,
      });
    } else {
      try {
        await this.prisma.social_channels.create({
          data: {
            ...values,
            store_id,
            channel_type: kind,
            provider: PROVIDER_BY_KIND[kind],
          },
        });
      } catch (error) {
        // A concurrent request created it first: update that row instead.
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          error.code !== 'P2002'
        ) {
          throw error;
        }
        await this.prisma.social_channels.updateMany({
          where: { channel_type: kind, provider: PROVIDER_BY_KIND[kind] },
          data: values,
        });
      }
    }

    const saved = await this.find(kind);
    if (!saved) throw new Error(`The ${kind} channel was not saved`);
    return { ...saved, store_id };
  }

  private toView(row: ChannelRow) {
    const metadata = this.asRecord(row.metadata);
    const base = {
      id: row.id,
      channel_type: row.channel_type,
      provider: row.provider,
      status: row.status,
      enabled: row.status === 'connected',
      connected_at: row.connected_at,
      disconnected_at: row.disconnected_at,
      updated_at: row.updated_at,
    };
    if (row.channel_type === 'sms') {
      return {
        ...base,
        sender_id: metadata.sender_id ?? null,
        spend: { currency: 'USD', ...this.smsSpend.snapshot(row) },
      };
    }
    return {
      ...base,
      from_name: metadata.from_name ?? null,
      reply_to: metadata.reply_to ?? null,
    };
  }

  private async logChange(
    channelId: number,
    existing: ChannelRow | null,
    oldValues: Record<string, unknown>,
    newValues: Record<string, unknown>,
  ) {
    await this.audit.log({
      userId: RequestContextService.getUserId(),
      storeId: this.requireStoreId(),
      action: existing ? 'UPDATE' : 'CREATE',
      resource: 'social_channels',
      resourceId: channelId,
      oldValues: existing ? oldValues : undefined,
      newValues,
      metadata: { reason: 'crm_channel_settings' },
    });
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private requireStoreId(): number {
    const store_id = RequestContextService.getStoreId();
    if (!store_id) {
      throw new ForbiddenException('Se requiere contexto de tienda');
    }
    return store_id;
  }
}
