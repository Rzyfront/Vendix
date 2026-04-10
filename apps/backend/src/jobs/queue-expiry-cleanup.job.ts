import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';

@Injectable()
export class QueueExpiryCleanupJob {
  private readonly logger = new Logger(QueueExpiryCleanupJob.name);

  constructor(private readonly prisma: GlobalPrismaService) {}

  /**
   * Every hour: expire customer_queue entries that have passed their expires_at.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async handleExpiredQueueEntries() {
    this.logger.log('Checking for expired customer queue entries...');

    try {
      const result = await this.prisma.customer_queue.updateMany({
        where: {
          status: { in: ['waiting', 'selected'] },
          expires_at: { lt: new Date() },
        },
        data: {
          status: 'expired',
          updated_at: new Date(),
        },
      });

      if (result.count > 0) {
        this.logger.log(`Expired ${result.count} customer queue entries`);
      } else {
        this.logger.debug('No expired queue entries found');
      }
    } catch (error) {
      this.logger.error(`Queue expiry cleanup failed: ${error.message}`);
    }
  }
}
