import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { SubscriptionFiscalService } from './subscription-fiscal.service';

@Injectable()
export class SubscriptionFiscalListener {
  private readonly logger = new Logger(SubscriptionFiscalListener.name);

  constructor(private readonly fiscalService: SubscriptionFiscalService) {}

  @OnEvent('subscription.payment.succeeded')
  async onSubscriptionPaymentSucceeded(payload: {
    invoiceId?: number;
    paymentId?: number;
    source?: string;
  }): Promise<void> {
    if (!payload?.invoiceId) return;

    try {
      await this.fiscalService.issueForInvoice(payload.invoiceId, {
        source: payload.source ?? 'payment_succeeded',
      });
    } catch (error) {
      this.logger.warn(
        `Non-blocking subscription fiscal issue failed invoice=${payload.invoiceId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
