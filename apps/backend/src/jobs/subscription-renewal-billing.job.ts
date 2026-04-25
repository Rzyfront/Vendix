import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';
import { SubscriptionBillingService } from '../domains/store/subscriptions/services/subscription-billing.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class SubscriptionRenewalBillingJob {
  private readonly logger = new Logger(SubscriptionRenewalBillingJob.name);
  private isRunning = false;

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly billingService: SubscriptionBillingService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @Cron('0 2 * * *')
  async handleRenewalBilling(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Subscription renewal billing already running, skipping');
      return;
    }

    this.isRunning = true;

    try {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

      const subscriptions = await this.prisma.store_subscriptions.findMany({
        where: {
          next_billing_at: { lte: tomorrow },
          state: { in: ['active', 'grace_soft', 'grace_hard'] },
        },
        select: { id: true, store_id: true },
        take: 20,
      });

      if (subscriptions.length === 0) {
        return;
      }

      this.logger.log(
        `Found ${subscriptions.length} subscriptions due for billing`,
      );

      for (const sub of subscriptions) {
        try {
          const invoice = await this.billingService.issueInvoice(sub.id);

          if (invoice) {
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
          }

          this.logger.log(`Issued invoice for subscription ${sub.id}`);
        } catch (error) {
          this.logger.error(
            `Failed to bill subscription ${sub.id}: ${error.message}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `Subscription renewal billing failed: ${error.message}`,
      );
    } finally {
      this.isRunning = false;
    }
  }
}
