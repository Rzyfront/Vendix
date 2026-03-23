import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class CreditOverdueCheckJob {
  private readonly logger = new Logger(CreditOverdueCheckJob.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly event_emitter: EventEmitter2,
  ) {}

  @Cron('0 8 * * *') // Daily at 8 AM
  async handleOverdueCheck() {
    this.logger.log('Running credit overdue check...');
    const now = new Date();

    try {
      // Find pending/partial installments past due date
      const overdue_installments = await this.prisma.credit_installments.findMany({
        where: {
          state: { in: ['pending', 'partial'] },
          due_date: { lt: now },
        },
        include: {
          credits: {
            select: {
              id: true,
              store_id: true,
              credit_number: true,
              customer_id: true,
              state: true,
            },
          },
        },
      });

      for (const installment of overdue_installments) {
        // Mark installment as overdue
        await this.prisma.credit_installments.update({
          where: { id: installment.id },
          data: { state: 'overdue' },
        });

        // Emit overdue event for notifications
        this.event_emitter.emit('installment.overdue', {
          installment_id: installment.id,
          installment_number: installment.installment_number,
          credit_id: installment.credit_id,
          credit_number: installment.credits.credit_number,
          store_id: installment.credits.store_id,
          customer_id: installment.credits.customer_id,
          amount: Number(installment.remaining_balance),
          due_date: installment.due_date,
        });

        // Update credit state to overdue if not already
        if (installment.credits.state !== 'overdue' && installment.credits.state !== 'defaulted') {
          await this.prisma.credits.update({
            where: { id: installment.credits.id },
            data: { state: 'overdue' },
          });
        }
      }

      // Check for defaulted credits (configurable days per store)
      const stores_with_settings = await this.prisma.store_settings.findMany({
        select: { store_id: true, settings: true },
      });

      for (const store_setting of stores_with_settings) {
        const settings = store_setting.settings as any;
        const defaulted_days = settings?.credit_defaulted_days || 60;

        const default_threshold = new Date();
        default_threshold.setDate(default_threshold.getDate() - defaulted_days);

        // Find overdue credits where oldest overdue installment is past threshold
        const defaultable_credits = await this.prisma.credits.findMany({
          where: {
            store_id: store_setting.store_id,
            state: 'overdue',
            installments: {
              some: {
                state: 'overdue',
                due_date: { lt: default_threshold },
              },
            },
          },
        });

        for (const credit of defaultable_credits) {
          await this.prisma.credits.update({
            where: { id: credit.id },
            data: { state: 'defaulted' },
          });
          this.logger.warn(`Credit ${credit.credit_number} marked as defaulted`);
        }
      }

      this.logger.log(`Overdue check complete. Processed ${overdue_installments.length} installments.`);
    } catch (error) {
      this.logger.error('Error in overdue check job', error);
    }
  }
}
