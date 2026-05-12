import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';
import { SubscriptionStateService } from '../domains/store/subscriptions/services/subscription-state.service';

/**
 * RNC-40: Cleans up draft subscriptions that were abandoned before checkout
 * completion. Runs every 6 hours. Subscriptions older than 24h in `draft`
 * state are transitioned to `cancelled` via the state service.
 */
@Injectable()
export class SubscriptionDraftCleanupJob {
  private readonly logger = new Logger(SubscriptionDraftCleanupJob.name);
  private isRunning = false;

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly stateService: SubscriptionStateService,
  ) {}

  @Cron('0 */6 * * *')
  async handleDraftCleanup(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Draft cleanup job already running, skipping');
      return;
    }
    this.isRunning = true;
    try {
      await this.runOnce();
    } catch (err: any) {
      this.logger.error(
        `Draft cleanup batch failed: ${err?.message ?? err}`,
        err?.stack,
      );
    } finally {
      this.isRunning = false;
    }
  }

  async runOnce(): Promise<number> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const drafts = await this.prisma
      .withoutScope()
      .store_subscriptions.findMany({
        where: {
          state: 'draft',
          created_at: { lt: cutoff },
        },
        select: { id: true, store_id: true },
        take: 200,
      });

    let cleaned = 0;
    for (const sub of drafts) {
      try {
        await this.stateService.transition(sub.store_id, 'cancelled', {
          reason: 'Draft abandoned — no checkout completed within 24h',
          triggeredByJob: 'subscription-draft-cleanup',
        });
        cleaned++;
        this.logger.log(
          `Draft cleanup: sub ${sub.id} (store ${sub.store_id}) → cancelled`,
        );
      } catch (err: any) {
        this.logger.error(
          `Draft cleanup failed for sub ${sub.id}: ${err?.message ?? err}`,
        );
      }
    }
    return cleaned;
  }
}
