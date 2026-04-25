import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class SubscriptionReminderDispatchJob {
  private readonly logger = new Logger(SubscriptionReminderDispatchJob.name);
  private isRunning = false;

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @Cron('0 * * * *')
  async handleReminderDispatch(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Subscription reminder dispatch already running, skipping');
      return;
    }

    this.isRunning = true;

    try {
      await this.processGraceSoft();
      await this.processGraceHard();
      await this.processSuspended();
    } catch (error) {
      this.logger.error(
        `Subscription reminder dispatch failed: ${error.message}`,
      );
    } finally {
      this.isRunning = false;
    }
  }

  private async processGraceSoft(): Promise<void> {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const subscriptions = await this.prisma.store_subscriptions.findMany({
      where: { state: 'grace_soft' },
      select: { id: true, store_id: true },
      take: 100,
    });

    for (const sub of subscriptions) {
      try {
        const lastReminder = await this.prisma.subscription_events.findFirst({
          where: {
            store_subscription_id: sub.id,
            type: 'state_transition',
            payload: { path: ['reason'], string_contains: 'reminder' },
            created_at: { gte: oneDayAgo },
          },
        });

        if (lastReminder) continue;

        this.eventEmitter.emit('subscription.reminder', {
          subscriptionId: sub.id,
          storeId: sub.store_id,
          state: 'grace_soft',
          severity: 'warning',
          timestamp: now,
        });
      } catch (error) {
        this.logger.error(
          `Failed grace_soft reminder for sub ${sub.id}: ${error.message}`,
        );
      }
    }
  }

  private async processGraceHard(): Promise<void> {
    const now = new Date();
    const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000);

    const subscriptions = await this.prisma.store_subscriptions.findMany({
      where: { state: 'grace_hard' },
      select: { id: true, store_id: true },
      take: 100,
    });

    for (const sub of subscriptions) {
      try {
        const lastReminder = await this.prisma.subscription_events.findFirst({
          where: {
            store_subscription_id: sub.id,
            type: 'state_transition',
            payload: { path: ['reason'], string_contains: 'reminder' },
            created_at: { gte: twelveHoursAgo },
          },
        });

        if (lastReminder) continue;

        this.eventEmitter.emit('subscription.reminder', {
          subscriptionId: sub.id,
          storeId: sub.store_id,
          state: 'grace_hard',
          severity: 'critical',
          timestamp: now,
        });
      } catch (error) {
        this.logger.error(
          `Failed grace_hard reminder for sub ${sub.id}: ${error.message}`,
        );
      }
    }
  }

  private async processSuspended(): Promise<void> {
    const now = new Date();
    const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000);

    const subscriptions = await this.prisma.store_subscriptions.findMany({
      where: { state: 'suspended' },
      select: { id: true, store_id: true },
      take: 100,
    });

    for (const sub of subscriptions) {
      try {
        const lastReminder = await this.prisma.subscription_events.findFirst({
          where: {
            store_subscription_id: sub.id,
            type: 'state_transition',
            payload: { path: ['reason'], string_contains: 'reminder' },
            created_at: { gte: twelveHoursAgo },
          },
        });

        if (lastReminder) continue;

        this.eventEmitter.emit('subscription.reminder', {
          subscriptionId: sub.id,
          storeId: sub.store_id,
          state: 'suspended',
          severity: 'critical',
          timestamp: now,
        });
      } catch (error) {
        this.logger.error(
          `Failed suspended reminder for sub ${sub.id}: ${error.message}`,
        );
      }
    }
  }
}
