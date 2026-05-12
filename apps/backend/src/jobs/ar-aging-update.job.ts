import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';

@Injectable()
export class ArAgingUpdateJob {
  private readonly logger = new Logger(ArAgingUpdateJob.name);

  constructor(private readonly prisma: GlobalPrismaService) {}

  /**
   * Runs daily at midnight to update overdue status on accounts receivable.
   * Recalculates days_overdue and marks open/partial AR as overdue.
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleAgingUpdate() {
    this.logger.log('Starting AR aging update...');

    try {
      const now = new Date();

      // 1. Find all open/partial AR that are past due date
      const overdue_records = await this.prisma.accounts_receivable.findMany({
        where: {
          status: { in: ['open', 'partial'] },
          due_date: { lt: now },
        },
        select: { id: true, due_date: true },
      });

      if (overdue_records.length === 0) {
        this.logger.debug('No overdue AR records found');
        return;
      }

      // 2. Update each record with days_overdue and status
      let updated = 0;
      for (const record of overdue_records) {
        const days_overdue = Math.floor(
          (now.getTime() - new Date(record.due_date).getTime()) /
            (1000 * 60 * 60 * 24),
        );

        await this.prisma.accounts_receivable.update({
          where: { id: record.id },
          data: {
            days_overdue,
            status: 'overdue',
            updated_at: now,
          },
        });
        updated++;
      }

      this.logger.log(
        `AR aging update complete: ${updated} records marked as overdue`,
      );

      // 3. Reset days_overdue for records that are current (not overdue)
      await this.prisma.accounts_receivable.updateMany({
        where: {
          status: { in: ['open', 'partial'] },
          due_date: { gte: now },
          days_overdue: { gt: 0 },
        },
        data: {
          days_overdue: 0,
          updated_at: now,
        },
      });
    } catch (error) {
      this.logger.error(
        `AR aging update failed: ${error.message}`,
        error.stack,
      );
    }
  }
}
