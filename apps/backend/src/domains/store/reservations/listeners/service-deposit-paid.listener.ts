import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { StoreContextRunner } from '@common/context/store-context-runner.service';
import type { PaymentRequestPaidEvent } from '../../payment-requests/payment-requests.service';
import { ReservationDepositsService } from '../reservation-deposits.service';

/**
 * A paid deposit request confirms its booking and allocation (S3, S15), or, when
 * the hold was already released, tries to take the slot back and otherwise
 * credits the customer's wallet. Idempotent: the ledger row is claimed once.
 */
@Injectable()
export class ServiceDepositPaidListener {
  private readonly logger = new Logger(ServiceDepositPaidListener.name);

  constructor(
    private readonly reservationDeposits: ReservationDepositsService,
    private readonly storeContextRunner: StoreContextRunner,
  ) {}

  @OnEvent('payment_request.paid')
  async onPaymentRequestPaid(event: PaymentRequestPaidEvent): Promise<void> {
    // Requests of other consumers are not ours.
    if (event.purpose !== 'service_deposit') return;
    try {
      await this.storeContextRunner.runInStoreContext(event.store_id, () =>
        this.reservationDeposits.settlePaidRequest(event),
      );
    } catch (err: unknown) {
      this.logger.error(
        `Deposit of payment request ${event.payment_request_id} not settled: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
