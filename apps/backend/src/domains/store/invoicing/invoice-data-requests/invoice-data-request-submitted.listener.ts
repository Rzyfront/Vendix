import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { StoreContextRunner } from '../../../../common/context/store-context-runner.service';
import { InvoiceDataRequestsService } from './invoice-data-requests.service';
import { InvoiceDataRequestEvent } from './interfaces/invoice-data-request-events.interface';

/** Compatibility wake-up only. New submissions atomically create the durable saga;
 * its reconciler, not this in-memory event, owns recovery after restarts. */
@Injectable()
export class InvoiceDataRequestSubmittedListener {
  private readonly logger = new Logger(
    InvoiceDataRequestSubmittedListener.name,
  );

  constructor(
    private readonly context_runner: StoreContextRunner,
    private readonly service: InvoiceDataRequestsService,
  ) {}

  @OnEvent('invoice_data_request.submitted')
  async handleSubmitted(event: InvoiceDataRequestEvent): Promise<void> {
    try {
      await this.context_runner.runInStoreContext(event.store_id, () =>
        this.service.processRequest(event.request_id, event.store_id),
      );
    } catch (error) {
      this.logger.warn(
        `Holder-change wake-up requires retry/review for request #${event.request_id} (store #${event.store_id}).`,
      );
    }
  }
}
