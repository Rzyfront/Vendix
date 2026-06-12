import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { StoreContextRunner } from '../../../../common/context/store-context-runner.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { InvoiceFlowService } from '../invoice-flow/invoice-flow.service';
import { InvoiceRetryQueueService } from './invoice-retry-queue.service';

export interface InvoiceRetryEvent {
  retry_queue_id: number;
  invoice_id: number;
  invoice_number: string;
  store_id: number;
  organization_id: number;
  attempt: number;
  max_attempts: number;
}

/**
 * Closes the DIAN retry loop. `InvoiceRetryJob` (cron) marks queue items as
 * 'processing' and emits `invoice.retry`; without this listener the items
 * stayed stuck in 'processing' forever.
 *
 * The cron runs outside an HTTP request, so there is no AsyncLocalStorage
 * tenant context. `StoreContextRunner.runInStoreContext()` establishes it from
 * the event's store_id (resolving the organization from the store row), which
 * lets the scoped `StorePrismaService` and `InvoiceFlowService.send()` operate
 * with normal tenant isolation — never `withoutScope()`.
 *
 * Re-transmission reuses `InvoiceFlowService.send()`, which is idempotent via
 * `FiscalTransmissionLedgerService.ensureInvoiceTransmission()` and re-checks
 * the fiscal gate / state machine on every attempt.
 *
 * The whole handler is wrapped in try/catch: a retry failure must never crash
 * the process — it only feeds the backoff via `markFailed()`.
 */
@Injectable()
export class InvoiceRetryListener {
  private readonly logger = new Logger(InvoiceRetryListener.name);

  constructor(
    private readonly context_runner: StoreContextRunner,
    private readonly prisma: StorePrismaService,
    private readonly invoice_flow: InvoiceFlowService,
    private readonly retry_queue: InvoiceRetryQueueService,
  ) {}

  @OnEvent('invoice.retry')
  async handleInvoiceRetry(event: InvoiceRetryEvent): Promise<void> {
    try {
      await this.context_runner.runInStoreContext(event.store_id, async () => {
        const invoice = await this.prisma.invoices.findFirst({
          where: { id: event.invoice_id },
          select: { id: true, status: true, invoice_number: true },
        });

        if (!invoice) {
          this.logger.warn(
            `Retry skipped: invoice #${event.invoice_id} not found for store #${event.store_id}`,
          );
          await this.retry_queue.markFailed(
            event.retry_queue_id,
            `Invoice #${event.invoice_id} not found in store #${event.store_id}`,
          );
          return;
        }

        // Already accepted (e.g. a manual resend succeeded between cron runs):
        // close the queue item without re-transmitting.
        if (invoice.status === 'accepted') {
          this.logger.log(
            `Invoice #${invoice.id} (${invoice.invoice_number}) already accepted; closing retry item #${event.retry_queue_id}`,
          );
          await this.retry_queue.markSuccess(event.retry_queue_id);
          return;
        }

        this.logger.log(
          `Retrying DIAN transmission for invoice #${invoice.id} (${invoice.invoice_number}), attempt ${event.attempt}/${event.max_attempts}`,
        );

        await this.invoice_flow.send(event.invoice_id);
        await this.retry_queue.markSuccess(event.retry_queue_id);

        this.logger.log(
          `Retry succeeded for invoice #${invoice.id} (${invoice.invoice_number})`,
        );
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error ?? 'unknown');
      this.logger.warn(
        `Retry attempt ${event.attempt}/${event.max_attempts} failed for invoice #${event.invoice_id}: ${message}`,
      );
      try {
        await this.retry_queue.markFailed(event.retry_queue_id, message);
      } catch (mark_error) {
        // Last line of defense: the listener must never bring the process down.
        this.logger.error(
          `Failed to mark retry item #${event.retry_queue_id} as failed: ${
            mark_error instanceof Error ? mark_error.message : mark_error
          }`,
        );
      }
    }
  }
}
