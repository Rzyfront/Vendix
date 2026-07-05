import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma, membership_status_enum } from '@prisma/client';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';
import { NotificationsService } from '../domains/store/notifications/notifications.service';

/**
 * Daily cron (06:00 UTC) that closes the membership retention loop with two
 * complementary passes over `memberships`:
 *
 *  1. **Pre-expiry notice** (`membership_expiring`): warn the store about
 *     `active` memberships whose `period_end` falls within the next
 *     `EXPIRING_WINDOW_DAYS`. Delivered in-app + SSE + web push through
 *     `NotificationsService.createAndBroadcast`.
 *
 *  2. **Post-expiry transition** (`membership_expired`): memberships still
 *     flagged `active` past their `period_end` are transitioned to
 *     `status='expired'` and a `membership_expired` notification is
 *     broadcast.
 *
 * Idempotency:
 *  - Pass 1 dedups per `(membership_id, period_end)` by checking for an existing
 *    `membership_expiring` notification with the same `data.membership_id`
 *    and `data.period_end`. A renewal moves `period_end` forward, so the next
 *    cycle emits a fresh notice.
 *  - Pass 2 is naturally idempotent: the `status='active'` filter excludes rows
 *    already transitioned to `expired`, so a membership is expired-notified once.
 *
 * The job never throws out of the cron handler — notification failures are
 * swallowed by `createAndBroadcast` (returns null) and per-row errors are logged
 * and skipped so one bad membership cannot abort the batch.
 */
@Injectable()
export class MembershipExpiryNotifierJob {
  private readonly logger = new Logger(MembershipExpiryNotifierJob.name);
  private isRunning = false;

  /** How many days ahead of `period_end` the pre-expiry notice fires. */
  private static readonly EXPIRING_WINDOW_DAYS = 3;

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron('0 6 * * *')
  async handleExpiryNotifications(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn(
        'MembershipExpiryNotifierJob already running, skipping',
      );
      return;
    }
    this.isRunning = true;
    try {
      const expiring = await this.runExpiringPass();
      const expired = await this.runExpiredPass();
      this.logger.log(
        `MEMBERSHIP_EXPIRY_BATCH expiring_notified=${expiring} expired_transitioned=${expired}`,
      );
    } catch (err: any) {
      this.logger.error(
        `Membership expiry notifier batch failed: ${err?.message ?? err}`,
        err?.stack,
      );
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Pass 1 — pre-expiry notice for `active` memberships expiring within the
   * window. Visible for tests. Returns the count of notifications emitted.
   */
  async runExpiringPass(): Promise<number> {
    const now = new Date();
    const windowEnd = new Date(
      now.getTime() +
        MembershipExpiryNotifierJob.EXPIRING_WINDOW_DAYS *
          24 *
          60 *
          60 *
          1000,
    );

    const candidates = await this.prisma.withoutScope().memberships.findMany(
      {
        where: {
          status: membership_status_enum.active,
          period_end: { gte: now, lte: windowEnd },
        },
        select: {
          id: true,
          store_id: true,
          customer_id: true,
          plan_id: true,
          period_end: true,
        },
        take: 500,
      },
    );

    let notified = 0;
    for (const m of candidates) {
      try {
        if (!m.period_end) continue;
        const periodEndIso = m.period_end.toISOString();

        // Dedup: one notice per membership per period_end.
        const existing = await this.prisma
          .withoutScope()
          .notifications.findFirst({
            where: {
              store_id: m.store_id,
              type: 'membership_expiring',
              AND: [
                { data: { path: ['membership_id'], equals: m.id } },
                { data: { path: ['period_end'], equals: periodEndIso } },
              ],
            },
            select: { id: true },
          });
        if (existing) continue;

        const result = await this.notifications.createAndBroadcast(
          m.store_id,
          'membership_expiring',
          'Membresía por vencer',
          `La membresía #${m.id} vence el ${periodEndIso.slice(0, 10)}.`,
          {
            membership_id: m.id,
            customer_id: m.customer_id,
            plan_id: m.plan_id,
            period_end: periodEndIso,
          } as Prisma.InputJsonValue,
        );
        if (result) notified++;
      } catch (perRowErr: any) {
        this.logger.error(
          `Membership expiring notice failed for membership ${m.id}: ${perRowErr?.message ?? perRowErr}`,
          perRowErr?.stack,
        );
      }
    }

    return notified;
  }

  /**
   * Pass 2 — transition `active` memberships past `period_end` to `expired` and
   * broadcast `membership_expired`. Visible for tests. Returns the count of
   * memberships transitioned.
   */
  async runExpiredPass(): Promise<number> {
    const now = new Date();

    const candidates = await this.prisma.withoutScope().memberships.findMany(
      {
        where: {
          status: membership_status_enum.active,
          period_end: { lt: now },
        },
        select: {
          id: true,
          store_id: true,
          customer_id: true,
          plan_id: true,
          period_end: true,
        },
        take: 500,
      },
    );

    let transitioned = 0;
    for (const m of candidates) {
      try {
        // Guard the transition on the still-active status so concurrent runs
        // (or a renewal that just fired) cannot double-transition.
        const updated = await this.prisma
          .withoutScope()
          .memberships.updateMany({
            where: { id: m.id, status: membership_status_enum.active },
            data: { status: membership_status_enum.expired },
          });
        if (updated.count === 0) continue;

        transitioned++;

        await this.notifications.createAndBroadcast(
          m.store_id,
          'membership_expired',
          'Membresía vencida',
          `La membresía #${m.id} venció el ${
            m.period_end ? m.period_end.toISOString().slice(0, 10) : 'N/D'
          }.`,
          {
            membership_id: m.id,
            customer_id: m.customer_id,
            plan_id: m.plan_id,
            period_end: m.period_end ? m.period_end.toISOString() : null,
          } as Prisma.InputJsonValue,
        );

        this.logger.log(
          `MEMBERSHIP_EXPIRED membership_id=${m.id} store_id=${m.store_id}`,
        );
      } catch (perRowErr: any) {
        this.logger.error(
          `Membership expired transition failed for membership ${m.id}: ${perRowErr?.message ?? perRowErr}`,
          perRowErr?.stack,
        );
      }
    }

    return transitioned;
  }
}
