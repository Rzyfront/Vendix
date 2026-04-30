import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';
import { SubscriptionBillingService } from '../domains/store/subscriptions/services/subscription-billing.service';
import { SubscriptionPaymentService } from '../domains/store/subscriptions/services/subscription-payment.service';
import { SubscriptionGateConfig } from '../domains/store/subscriptions/config/subscription-gate.config';
import { EventEmitter2 } from '@nestjs/event-emitter';

// Retry schedule for failed SaaS subscription charges. Hours: 1h, 4h, 24h, 72h.
// MUST stay aligned with SubscriptionPaymentRetryJob — both files share the
// same constants at module-local scope so a change here does not silently
// drift from the processor.
export const BACKOFF_DELAYS = [
  60 * 60 * 1000, // 1h
  4 * 60 * 60 * 1000, // 4h
  24 * 60 * 60 * 1000, // 24h
  72 * 60 * 60 * 1000, // 72h
];
export const MAX_ATTEMPTS = 4;

@Injectable()
export class SubscriptionRenewalBillingJob {
  private readonly logger = new Logger(SubscriptionRenewalBillingJob.name);
  private isRunning = false;

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly billingService: SubscriptionBillingService,
    private readonly paymentService: SubscriptionPaymentService,
    private readonly eventEmitter: EventEmitter2,
    private readonly config: ConfigService,
    private readonly gateConfig: SubscriptionGateConfig,
    @InjectQueue('subscription-payment-retry')
    private readonly retryQueue: Queue,
  ) {}

  @Cron('0 2 * * *')
  async handleRenewalBilling(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn(
        'Subscription renewal billing already running, skipping',
      );
      return;
    }

    this.isRunning = true;

    try {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

      const subscriptions = await this.prisma.store_subscriptions.findMany({
        where: {
          next_billing_at: { lte: tomorrow },
          state: { in: ['active', 'grace_soft', 'grace_hard'] },
          // RNC-39: defensive — never bill subscriptions without a plan.
          plan_id: { not: null },
        },
        select: { id: true, store_id: true, scheduled_cancel_at: true },
        take: 20,
      });

      if (subscriptions.length === 0) {
        return;
      }

      this.logger.log(
        `Found ${subscriptions.length} subscriptions due for billing`,
      );

      const retryEnabled =
        this.config.get<string>('SUBSCRIPTION_RETRY_QUEUE_ENABLED') === 'true';

      for (const sub of subscriptions) {
        try {
          if (this.gateConfig.isCronDryRun()) {
            this.logger.log({
              msg: 'DRY_RUN_SKIP',
              job: 'subscription-renewal-billing',
              wouldProcess: {
                subscriptionId: sub.id,
                hasScheduledCancel: !!sub.scheduled_cancel_at,
              },
            });
            continue;
          }

          // Scheduled cancellation check — if the user requested cancellation
          // at end of cycle and the period has ended, transition to cancelled
          // and do NOT emit an invoice.
          if (
            sub.scheduled_cancel_at &&
            new Date(sub.scheduled_cancel_at) <= new Date()
          ) {
            this.logger.log(
              `Subscription ${sub.id}: scheduled cancellation reached, transitioning to cancelled`,
            );

            await this.prisma.store_subscriptions.update({
              where: { id: sub.id },
              data: {
                state: 'cancelled',
                cancelled_at: new Date(),
                scheduled_cancel_at: null,
                auto_renew: false,
                updated_at: new Date(),
              },
            });

            await this.prisma.subscription_events.create({
              data: {
                store_subscription_id: sub.id,
                type: 'state_transition',
                from_state: 'active',
                to_state: 'cancelled',
                payload: {
                  reason: 'scheduled_cancel_executed',
                  scheduled_cancel_at: sub.scheduled_cancel_at.toISOString(),
                } as any,
                triggered_by_job: 'subscription-renewal-billing',
              },
            });

            this.eventEmitter.emit('subscription.state.changed', {
              storeId: sub.store_id,
              fromState: 'active',
              toState: 'cancelled',
              reason: 'scheduled_cancel_executed',
              triggeredByJob: 'subscription-renewal-billing',
            });

            continue;
          }

          const invoice = await this.billingService.issueInvoice(sub.id);

          if (!invoice) {
            // Free-plan / zero-price skip — no charge needed.
            this.logger.log(
              `Subscription ${sub.id}: no invoice issued (zero-price or skipped)`,
            );
            continue;
          }

          await this.prisma.store_subscriptions.update({
            where: { id: sub.id },
            data: { next_billing_at: invoice.period_end },
          });

          this.eventEmitter.emit('subscription.invoice.issued', {
            subscriptionId: sub.id,
            storeId: sub.store_id,
            invoiceId: invoice.id,
            total: invoice.total.toString(),
          });

          this.logger.log(
            `Issued invoice ${invoice.id} for subscription ${sub.id}`,
          );

          // Attempt the immediate first charge inline. If the gateway accepts,
          // we are done. If it rejects (state='failed') or throws, we hand off
          // to the BullMQ retry queue with exponential backoff.
          await this.attemptCharge(
            invoice.id,
            sub.id,
            sub.store_id,
            retryEnabled,
          );
        } catch (error: any) {
          this.logger.error(
            `Failed to bill subscription ${sub.id}: ${error?.message ?? error}`,
          );
        }
      }
    } catch (error: any) {
      this.logger.error(
        `Subscription renewal billing failed: ${error?.message ?? error}`,
      );
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Charge the freshly issued invoice. On failure, hand off to the retry
   * queue (when feature flag is enabled) with exponential backoff. When the
   * flag is off we fall back to the legacy log-and-skip behaviour so a bad
   * rollout cannot stall renewals.
   */
  private async attemptCharge(
    invoiceId: number,
    subscriptionId: number,
    storeId: number,
    retryEnabled: boolean,
  ): Promise<void> {
    try {
      const result = await this.paymentService.chargeInvoice(invoiceId);

      if (result.state === 'succeeded') {
        this.logger.log(
          `Charge succeeded for invoice ${invoiceId} (subscription ${subscriptionId})`,
        );
        return;
      }

      if (result.state === 'failed') {
        await this.handleChargeFailure(
          invoiceId,
          subscriptionId,
          storeId,
          retryEnabled,
          `Gateway returned failed state (payment ${result.id})`,
        );
        return;
      }

      // Pending / unknown — leave it to the state engine + retry queue if
      // configured. Treat as failure so the retry queue picks it up.
      await this.handleChargeFailure(
        invoiceId,
        subscriptionId,
        storeId,
        retryEnabled,
        `Charge ended in non-terminal state '${result.state}'`,
      );
    } catch (error: any) {
      await this.handleChargeFailure(
        invoiceId,
        subscriptionId,
        storeId,
        retryEnabled,
        error?.message ?? 'Unknown charge error',
      );
    }
  }

  private async handleChargeFailure(
    invoiceId: number,
    subscriptionId: number,
    storeId: number,
    retryEnabled: boolean,
    reason: string,
  ): Promise<void> {
    if (!retryEnabled) {
      this.logger.error(
        `Charge failed for invoice ${invoiceId} (subscription ${subscriptionId}): ${reason}. ` +
          `Retry queue disabled (SUBSCRIPTION_RETRY_QUEUE_ENABLED!=true) — skipping retry.`,
      );
      return;
    }

    this.logger.warn(
      `Charge failed for invoice ${invoiceId} (subscription ${subscriptionId}): ${reason}. ` +
        `Enqueuing retry job (max ${MAX_ATTEMPTS} attempts).`,
    );

    try {
      await this.retryQueue.add(
        'retry',
        {
          invoiceId,
          subscriptionId,
          storeId,
          attempt: 1,
        },
        {
          delay: BACKOFF_DELAYS[0],
          attempts: MAX_ATTEMPTS,
          backoff: { type: 'exponential', delay: 60 * 60 * 1000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 100 },
        },
      );
    } catch (enqueueError: any) {
      this.logger.error(
        `Failed to enqueue retry for invoice ${invoiceId}: ${enqueueError?.message ?? enqueueError}`,
      );
    }
  }
}
