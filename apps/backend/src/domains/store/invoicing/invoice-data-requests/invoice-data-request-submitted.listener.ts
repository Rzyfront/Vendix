import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { StoreContextRunner } from '../../../../common/context/store-context-runner.service';
import { InvoiceDataRequestsService } from './invoice-data-requests.service';
import { InvoiceDataRequestEvent } from './interfaces/invoice-data-request-events.interface';

/**
 * Automatically converts a CF (consumidor final) sale into a nominative
 * invoice as soon as the customer submits their billing data through the
 * public post-sale link (`invoice_data_request.submitted`).
 *
 * The public submit endpoint runs without an authenticated tenant context, so
 * `StoreContextRunner.runInStoreContext()` establishes AsyncLocalStorage
 * context from the event's store_id (resolving the organization from the
 * store row). This lets the scoped `StorePrismaService`, `InvoicingService`
 * and `CreditNotesService` operate with normal tenant isolation — never
 * `withoutScope()`. There is no user in this context, so created documents
 * carry `created_by_user_id: null`, like other automatic flows.
 *
 * The whole handler is wrapped in try/catch: a processing failure must never
 * crash the process nor break the public submit response. On failure,
 * `processRequest()` already marked the request as 'failed', and the admin
 * process endpoint remains available as manual reprocessing.
 */
@Injectable()
export class InvoiceDataRequestSubmittedListener {
  private readonly logger = new Logger(InvoiceDataRequestSubmittedListener.name);

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
      const message =
        error instanceof Error ? error.message : String(error ?? 'unknown');
      this.logger.warn(
        `Automatic nominative conversion failed for invoice data request #${event.request_id} (store #${event.store_id}): ${message}. The request stays 'failed'; use the admin process endpoint to retry.`,
      );
    }
  }
}
