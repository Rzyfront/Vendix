import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import Redis from 'ioredis';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import { AuditService } from '../../common/audit/audit.service';
import { ErrorCodes, VendixHttpException } from '../../common/errors';

export const SMS_SPEND_LIMIT_REACHED_EVENT = 'crm.sms_spend_limit_reached';

/** One alert per store and month; it outlives the longest month. */
const LIMIT_NOTICE_TTL_SECONDS = 35 * 24 * 60 * 60;

export interface SmsSpendLimitReachedEvent {
  store_id: number;
  channel_id: number;
  period_start: string;
  limit: number | null;
  used: number;
  attempted_cost: number;
}

export type SpendReservation =
  | { reserved: true; period_start: string; used: number; limit: number }
  | {
      reserved: false;
      period_start: string;
      used: number;
      limit: number | null;
    };

export interface SpendSnapshot {
  period_start: string;
  limit: number | null;
  used: number;
  remaining: number | null;
}

interface SpendColumns {
  monthly_spend_limit: Prisma.Decimal | number | string | null;
  monthly_spend_used: Prisma.Decimal | number | string;
  spend_period_start: Date | null;
}

/**
 * Hard monthly SMS spend cap per store (PLAN-CRM §5.2, decision 3: Vendix
 * pays SNS, each store has a cap and sending stops when it runs out).
 *
 * The counter lives in `social_channels` (`sms`/`sns_sms` row). `reserve()` is
 * a single conditional `UPDATE … RETURNING`: Postgres locks the row and
 * re-checks the `WHERE` after any concurrent writer commits, so two sends can
 * never both fit in the last remaining budget. Nothing reads the counter and
 * writes it back in a second step.
 *
 * Months are UTC calendar months, like the AWS account `MonthlySpendLimit`.
 * The first reservation of a new month resets the counter in the same
 * statement. A channel without `monthly_spend_limit` cannot send.
 */
@Injectable()
export class SmsSpendService {
  private readonly logger = new Logger(SmsSpendService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
  ) {}

  /** `YYYY-MM-01` of the UTC month of `now`. */
  currentPeriod(now = new Date()): string {
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    return `${now.getUTCFullYear()}-${month}-01`;
  }

  async reserve(
    channel: { id: number; store_id: number },
    amount: number,
    now = new Date(),
  ): Promise<SpendReservation> {
    const period = this.currentPeriod(now);
    const cost = toAmount(amount);

    const rows = await this.prisma.$queryRaw<
      Array<{ used: string; limit: string }>
    >(Prisma.sql`
      UPDATE "social_channels"
      SET "monthly_spend_used" =
            (CASE WHEN "spend_period_start" = ${period}::date
                  THEN "monthly_spend_used" ELSE 0 END) + ${cost}::numeric,
          "spend_period_start" = ${period}::date,
          "updated_at" = NOW()
      WHERE "id" = ${channel.id}
        AND "store_id" = ${channel.store_id}
        AND "monthly_spend_limit" IS NOT NULL
        AND (CASE WHEN "spend_period_start" = ${period}::date
                  THEN "monthly_spend_used" ELSE 0 END) + ${cost}::numeric
            <= "monthly_spend_limit"
      RETURNING "monthly_spend_used"::text AS used,
                "monthly_spend_limit"::text AS "limit"
    `);

    if (rows.length > 0) {
      return {
        reserved: true,
        period_start: period,
        used: Number(rows[0].used),
        limit: Number(rows[0].limit),
      };
    }

    const row = await this.prisma.social_channels.findFirst({
      where: { id: channel.id, store_id: channel.store_id },
      select: {
        monthly_spend_limit: true,
        monthly_spend_used: true,
        spend_period_start: true,
      },
    });
    const snapshot = row
      ? this.snapshot(row, now)
      : { period_start: period, limit: null, used: 0, remaining: null };
    await this.onLimitReached({
      store_id: channel.store_id,
      channel_id: channel.id,
      period_start: period,
      limit: snapshot.limit,
      used: snapshot.used,
      attempted_cost: Number(cost),
    });
    return {
      reserved: false,
      period_start: period,
      used: snapshot.used,
      limit: snapshot.limit,
    };
  }

  /**
   * Gives back a reservation SNS certainly did not use. Only within the same
   * month: a reservation of a closed month is already gone with the reset.
   */
  async release(
    channelId: number,
    amount: number,
    periodStart: string,
  ): Promise<void> {
    try {
      await this.prisma.$queryRaw(Prisma.sql`
        UPDATE "social_channels"
        SET "monthly_spend_used" =
              GREATEST("monthly_spend_used" - ${toAmount(amount)}::numeric, 0),
            "updated_at" = NOW()
        WHERE "id" = ${channelId}
          AND "spend_period_start" = ${periodStart}::date
        RETURNING "id"
      `);
    } catch (error) {
      // Keeping the reservation only makes the cap stricter; never fail the send flow.
      this.logger.error(
        `Could not release ${amount} USD of SMS spend on channel ${channelId}: ${(error as Error)?.message}`,
      );
    }
  }

  /**
   * Cheap pre-check before queueing an SMS, so the inbox answers with an
   * explicit error instead of a message that fails later. The worker still
   * reserves atomically: this check alone does not guard the cap.
   */
  async assertAvailable(storeId: number, now = new Date()): Promise<void> {
    const row = await this.prisma.social_channels.findFirst({
      where: {
        store_id: storeId,
        channel_type: 'sms',
        provider: 'sns_sms',
        status: 'connected',
      },
      select: {
        monthly_spend_limit: true,
        monthly_spend_used: true,
        spend_period_start: true,
      },
    });
    if (!row) return; // The worker reports CHANNEL_NOT_CONFIGURED.
    const snapshot = this.snapshot(row, now);
    if (snapshot.remaining === null || snapshot.remaining <= 0) {
      throw new VendixHttpException(ErrorCodes.CRM_SMS_SPEND_LIMIT);
    }
  }

  /** Spend of the current month; a counter of a past month reads as 0. */
  snapshot(row: SpendColumns, now = new Date()): SpendSnapshot {
    const period = this.currentPeriod(now);
    const samePeriod =
      !!row.spend_period_start &&
      row.spend_period_start.toISOString().slice(0, 10) === period;
    const used = samePeriod ? Number(row.monthly_spend_used) : 0;
    const limit =
      row.monthly_spend_limit === null ? null : Number(row.monthly_spend_limit);
    return {
      period_start: period,
      limit,
      used,
      remaining:
        limit === null ? null : Math.max(0, round4(limit - used)),
    };
  }

  /** After the owner changes the cap, the next exhaustion alerts again. */
  async resetLimitNotice(storeId: number, now = new Date()): Promise<void> {
    await this.redis
      .del(this.noticeKey(storeId, this.currentPeriod(now)))
      .catch(() => undefined);
  }

  /**
   * Every rejection is logged; the owner notification and the audit entry are
   * sent once per store and month so a campaign does not flood the bell.
   */
  private async onLimitReached(event: SmsSpendLimitReachedEvent) {
    this.logger.warn(
      `SMS spend limit reached for store ${event.store_id} (channel ${event.channel_id}): used ${event.used} of ${event.limit ?? 'no limit'} USD, attempted ${event.attempted_cost} USD`,
    );

    let first = true;
    try {
      const claimed = await this.redis.set(
        this.noticeKey(event.store_id, event.period_start),
        '1',
        'EX',
        LIMIT_NOTICE_TTL_SECONDS,
        'NX',
      );
      first = claimed === 'OK';
    } catch {
      // Without Redis, notifying twice beats not notifying at all.
      first = true;
    }
    if (!first) return;

    await this.audit.log({
      storeId: event.store_id,
      action: 'CUSTOM',
      resource: 'social_channels',
      resourceId: event.channel_id,
      metadata: {
        reason: 'crm_sms_spend_limit_reached',
        period_start: event.period_start,
        limit: event.limit,
        used: event.used,
        attempted_cost: event.attempted_cost,
      },
    });
    this.events.emit(SMS_SPEND_LIMIT_REACHED_EVENT, event);
  }

  private noticeKey(storeId: number, period: string): string {
    return `crm:sms:spend-limit-notice:${storeId}:${period}`;
  }
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/** Fixed 4-decimal string: exact in SQL `numeric`, no float noise. */
function toAmount(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid SMS spend amount: ${value}`);
  }
  return value.toFixed(4);
}
