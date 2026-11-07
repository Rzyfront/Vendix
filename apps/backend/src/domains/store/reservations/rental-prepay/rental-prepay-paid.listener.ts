import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { StoreContextRunner } from '@common/context/store-context-runner.service';
import type { PaymentRequestPaidEvent } from '../../payment-requests/payment-requests.service';
import { RentalPrepayService, bookingIdFromRentalPurpose } from './rental-prepay.service';

/**
 * A paid "cobro para reservar" request registers the sale payment on the
 * booking's order and confirms the held slot (S1, S3, S15). Requests of other
 * consumers (the deposit, payment links) are not ours.
 */
@Injectable()
export class RentalPrepayPaidListener {
  private readonly logger = new Logger(RentalPrepayPaidListener.name);

  constructor(
    private readonly rentalPrepay: RentalPrepayService,
    private readonly storeContextRunner: StoreContextRunner,
  ) {}

  @OnEvent('payment_request.paid')
  async onPaymentRequestPaid(event: PaymentRequestPaidEvent): Promise<void> {
    if (bookingIdFromRentalPurpose(event.purpose) == null) return;
    try {
      await this.storeContextRunner.runInStoreContext(event.store_id, () =>
        this.rentalPrepay.settlePaidRequest(event),
      );
    } catch (err: unknown) {
      this.logger.error(
        `Rental prepay of payment request ${event.payment_request_id} not settled: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
