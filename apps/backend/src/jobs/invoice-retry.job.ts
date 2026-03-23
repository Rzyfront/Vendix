import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class InvoiceRetryJob {
  private readonly logger = new Logger(InvoiceRetryJob.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly event_emitter: EventEmitter2,
  ) {}

  /**
   * Runs every 5 minutes to process the invoice retry queue.
   * Picks pending items whose next_retry_at has passed and emits retry events.
   */
  @Cron('*/5 * * * *')
  async handleRetryQueue() {
    this.logger.log('Processing invoice retry queue...');

    try {
      const now = new Date();

      const pending_items = await this.prisma.invoice_retry_queue.findMany({
        where: {
          status: 'pending',
          next_retry_at: { lte: now },
        },
        include: {
          invoice: {
            select: {
              id: true,
              invoice_number: true,
              store_id: true,
              organization_id: true,
              status: true,
            },
          },
        },
        take: 20, // Process in batches
        orderBy: { next_retry_at: 'asc' },
      });

      if (pending_items.length === 0) {
        this.logger.debug('No pending retry items');
        return;
      }

      this.logger.log(`Found ${pending_items.length} invoice(s) to retry`);

      for (const item of pending_items) {
        try {
          // Mark as processing
          await this.prisma.invoice_retry_queue.update({
            where: { id: item.id },
            data: { status: 'processing', updated_at: now },
          });

          // Emit retry event — the invoice flow will handle the actual retry
          this.event_emitter.emit('invoice.retry', {
            retry_queue_id: item.id,
            invoice_id: item.invoice_id,
            invoice_number: item.invoice.invoice_number,
            store_id: item.invoice.store_id,
            organization_id: item.invoice.organization_id,
            attempt: item.attempts + 1,
            max_attempts: item.max_attempts,
          });

          this.logger.log(
            `Emitted retry event for invoice ${item.invoice.invoice_number} (attempt ${item.attempts + 1}/${item.max_attempts})`,
          );
        } catch (error) {
          this.logger.error(
            `Failed to process retry item ${item.id}: ${error.message}`,
          );

          // Mark back as pending so it can be retried
          await this.prisma.invoice_retry_queue.update({
            where: { id: item.id },
            data: { status: 'pending', updated_at: now },
          });
        }
      }
    } catch (error) {
      this.logger.error(`Invoice retry queue processing failed: ${error.message}`, error.stack);
    }
  }
}
