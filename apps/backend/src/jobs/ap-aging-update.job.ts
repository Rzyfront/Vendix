import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';

@Injectable()
export class ApAgingUpdateJob {
  private readonly logger = new Logger(ApAgingUpdateJob.name);

  constructor(private readonly prisma: GlobalPrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async handleAgingUpdate() {
    this.logger.log('Starting AP aging update...');

    try {
      const now = new Date();

      const overdue_records = await this.prisma.accounts_payable.findMany({
        where: {
          status: { in: ['open', 'partial'] },
          due_date: { lt: now },
        },
        select: { id: true, due_date: true },
      });

      if (overdue_records.length === 0) {
        this.logger.debug('No overdue AP records found');
        return;
      }

      let updated = 0;
      for (const record of overdue_records) {
        const days_overdue = Math.floor(
          (now.getTime() - new Date(record.due_date).getTime()) / (1000 * 60 * 60 * 24),
        );

        await this.prisma.accounts_payable.update({
          where: { id: record.id },
          data: { days_overdue, status: 'overdue', updated_at: now },
        });
        updated++;
      }

      this.logger.log(`AP aging update complete: ${updated} records marked as overdue`);

      await this.prisma.accounts_payable.updateMany({
        where: {
          status: { in: ['open', 'partial'] },
          due_date: { gte: now },
          days_overdue: { gt: 0 },
        },
        data: { days_overdue: 0, updated_at: now },
      });
    } catch (error) {
      this.logger.error(`AP aging update failed: ${error.message}`, error.stack);
    }
  }
}
