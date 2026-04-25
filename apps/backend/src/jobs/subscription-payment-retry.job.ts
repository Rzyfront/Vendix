import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';
import { SubscriptionStateService } from '../domains/store/subscriptions/services/subscription-state.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

export interface SubscriptionPaymentRetryData {
  invoiceId: number;
  attempt: number;
  subscriptionId: number;
}

const BACKOFF_DELAYS = [60 * 60 * 1000, 4 * 60 * 60 * 1000, 24 * 60 * 60 * 1000, 72 * 60 * 60 * 1000];
const MAX_ATTEMPTS = 4;

@Processor('subscription-payment-retry')
export class SubscriptionPaymentRetryJob extends WorkerHost {
  private readonly logger = new Logger(SubscriptionPaymentRetryJob.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly stateService: SubscriptionStateService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    super();
  }

  async process(job: Job<SubscriptionPaymentRetryData>): Promise<any> {
    const { invoiceId, attempt, subscriptionId } = job.data;
    const currentAttempt = job.attemptsMade + 1;

    this.logger.log(
      `Processing payment retry for invoice ${invoiceId}, attempt ${currentAttempt}`,
    );

    try {
      const invoice = await this.prisma.subscription_invoices.findUnique({
        where: { id: invoiceId },
        include: {
          store_subscription: {
            select: { store_id: true, state: true },
          },
        },
      });

      if (!invoice || invoice.state === 'paid' || invoice.state === 'void') {
        this.logger.log(`Invoice ${invoiceId} already resolved, skipping`);
        return { skipped: true, reason: 'already_resolved' };
      }

      const payment = await this.prisma.subscription_payments.create({
        data: {
          invoice_id: invoiceId,
          state: 'pending',
          amount: invoice.total,
          currency: invoice.currency,
          metadata: { attempt: currentAttempt, job_id: job.id },
        },
      });

      this.eventEmitter.emit('subscription.payment.attempt', {
        invoiceId,
        paymentId: payment.id,
        subscriptionId,
        storeId: invoice.store_subscription.store_id,
        attempt: currentAttempt,
        amount: invoice.total.toString(),
      });

      return { paymentId: payment.id, attempt: currentAttempt };
    } catch (error) {
      this.logger.error(
        `Payment retry failed for invoice ${invoiceId}: ${error.message}`,
      );

      if (currentAttempt >= MAX_ATTEMPTS) {
        try {
          const sub = await this.prisma.store_subscriptions.findUnique({
            where: { id: subscriptionId },
            select: { store_id: true },
          });

          if (sub) {
            await this.stateService.transition(sub.store_id, 'grace_hard', {
              reason: `Payment failed after ${MAX_ATTEMPTS} attempts`,
              triggeredByJob: 'subscription-payment-retry',
              payload: { invoiceId, finalAttempt: currentAttempt },
            });
          }
        } catch (transitionError) {
          this.logger.error(
            `Failed to transition subscription to grace_hard: ${transitionError.message}`,
          );
        }
      }

      throw error;
    }
  }
}
