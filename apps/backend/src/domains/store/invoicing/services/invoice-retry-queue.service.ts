import { Injectable, Logger } from '@nestjs/common';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';

/**
 * Backoff intervals for retry attempts (in minutes).
 * Attempt 1: 5 min, Attempt 2: 30 min, Attempt 3: 120 min (2h)
 */
const BACKOFF_MINUTES = [5, 30, 120];

@Injectable()
export class InvoiceRetryQueueService {
  private readonly logger = new Logger(InvoiceRetryQueueService.name);

  constructor(private readonly prisma: GlobalPrismaService) {}

  /**
   * Enqueue a failed invoice for retry with exponential backoff.
   */
  async enqueue(
    invoice_id: number,
    org_id: number,
    store_id: number,
    error: string,
  ): Promise<void> {
    try {
      // Check if already in queue and pending
      const existing = await this.prisma.invoice_retry_queue.findFirst({
        where: {
          invoice_id,
          status: { in: ['pending', 'processing'] },
        },
      });

      if (existing) {
        this.logger.debug(
          `Invoice ${invoice_id} already in retry queue (status: ${existing.status})`,
        );
        return;
      }

      const next_retry_at = new Date();
      next_retry_at.setMinutes(next_retry_at.getMinutes() + BACKOFF_MINUTES[0]);

      await this.prisma.invoice_retry_queue.create({
        data: {
          org_id,
          store_id,
          invoice_id,
          attempts: 0,
          max_attempts: 3,
          last_error: error,
          next_retry_at,
          status: 'pending',
        },
      });

      this.logger.log(
        `Invoice ${invoice_id} enqueued for retry. Next attempt at ${next_retry_at.toISOString()}`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to enqueue invoice ${invoice_id}: ${err.message}`,
      );
    }
  }

  /**
   * Mark a retry as successful and remove from queue.
   */
  async markSuccess(retry_queue_id: number): Promise<void> {
    await this.prisma.invoice_retry_queue.update({
      where: { id: retry_queue_id },
      data: { status: 'completed', updated_at: new Date() },
    });
  }

  /**
   * Mark a retry as failed. If max attempts reached, mark as failed permanently.
   * Otherwise, schedule next retry with exponential backoff.
   */
  async markFailed(retry_queue_id: number, error: string): Promise<void> {
    const item = await this.prisma.invoice_retry_queue.findUnique({
      where: { id: retry_queue_id },
    });

    if (!item) return;

    const new_attempts = item.attempts + 1;

    if (new_attempts >= item.max_attempts) {
      await this.prisma.invoice_retry_queue.update({
        where: { id: retry_queue_id },
        data: {
          status: 'failed',
          attempts: new_attempts,
          last_error: error,
          updated_at: new Date(),
        },
      });

      this.logger.warn(
        `Invoice ${item.invoice_id} exhausted all ${item.max_attempts} retry attempts`,
      );
      return;
    }

    // Calculate next retry with exponential backoff
    const backoff_index = Math.min(new_attempts, BACKOFF_MINUTES.length - 1);
    const next_retry_at = new Date();
    next_retry_at.setMinutes(
      next_retry_at.getMinutes() + BACKOFF_MINUTES[backoff_index],
    );

    await this.prisma.invoice_retry_queue.update({
      where: { id: retry_queue_id },
      data: {
        status: 'pending',
        attempts: new_attempts,
        last_error: error,
        next_retry_at,
        updated_at: new Date(),
      },
    });

    this.logger.log(
      `Invoice ${item.invoice_id} retry ${new_attempts}/${item.max_attempts} failed. Next attempt at ${next_retry_at.toISOString()}`,
    );
  }

  /**
   * Get queue statistics for monitoring.
   */
  async getQueueStats(): Promise<{
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    total: number;
  }> {
    const [pending, processing, completed, failed] = await Promise.all([
      this.prisma.invoice_retry_queue.count({ where: { status: 'pending' } }),
      this.prisma.invoice_retry_queue.count({
        where: { status: 'processing' },
      }),
      this.prisma.invoice_retry_queue.count({ where: { status: 'completed' } }),
      this.prisma.invoice_retry_queue.count({ where: { status: 'failed' } }),
    ]);

    return {
      pending,
      processing,
      completed,
      failed,
      total: pending + processing + completed + failed,
    };
  }
}
