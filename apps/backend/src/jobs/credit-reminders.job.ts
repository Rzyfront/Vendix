import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class CreditRemindersJob {
  private readonly logger = new Logger(CreditRemindersJob.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly event_emitter: EventEmitter2,
  ) {}

  @Cron('0 9 * * *') // Daily at 9 AM
  async handleReminders() {
    this.logger.log('Running credit reminders...');

    try {
      // Get stores with their reminder settings
      const stores_with_settings = await this.prisma.store_settings.findMany({
        select: { store_id: true, settings: true },
      });

      for (const store_setting of stores_with_settings) {
        const settings = store_setting.settings as any;
        const reminder_days = settings?.credit_reminder_days_before || 3;

        const target_date = new Date();
        target_date.setDate(target_date.getDate() + reminder_days);

        // Set to start and end of target day
        const start_of_day = new Date(target_date);
        start_of_day.setHours(0, 0, 0, 0);
        const end_of_day = new Date(target_date);
        end_of_day.setHours(23, 59, 59, 999);

        const upcoming = await this.prisma.credit_installments.findMany({
          where: {
            state: 'pending',
            due_date: { gte: start_of_day, lte: end_of_day },
            credits: {
              store_id: store_setting.store_id,
              state: { in: ['active', 'pending'] },
            },
          },
          include: {
            credits: {
              select: {
                id: true,
                credit_number: true,
                store_id: true,
                customer_id: true,
              },
            },
          },
        });

        for (const installment of upcoming) {
          this.event_emitter.emit('installment.reminder', {
            installment_id: installment.id,
            installment_number: installment.installment_number,
            credit_id: installment.credit_id,
            credit_number: installment.credits.credit_number,
            store_id: installment.credits.store_id,
            customer_id: installment.credits.customer_id,
            amount: Number(installment.installment_value),
            due_date: installment.due_date,
          });
        }

        if (upcoming.length > 0) {
          this.logger.log(`Sent ${upcoming.length} reminders for store ${store_setting.store_id}`);
        }
      }
    } catch (error) {
      this.logger.error('Error in reminders job', error);
    }
  }
}
