import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class LayawayRemindersJob {
  private readonly logger = new Logger(LayawayRemindersJob.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Runs daily at 9AM to send payment reminders for upcoming installments.
   * Finds pending installments due within the next 3 days that haven't been reminded yet.
   */
  @Cron('0 9 * * *')
  async handlePaymentReminders() {
    this.logger.log('Starting layaway payment reminders...');

    try {
      const now = new Date();
      const three_days_from_now = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

      // Find pending installments due in the next 3 days without a reminder
      const upcoming_installments = await this.prisma.layaway_installments.findMany({
        where: {
          state: 'pending',
          due_date: {
            gte: now,
            lte: three_days_from_now,
          },
          reminder_sent_at: null,
          layaway_plan: { state: { in: ['active'] } },
        },
        include: {
          layaway_plan: {
            select: { id: true, store_id: true, plan_number: true },
          },
        },
      });

      if (upcoming_installments.length === 0) {
        this.logger.debug('No upcoming installments to remind');
        return;
      }

      for (const installment of upcoming_installments) {
        const plan = installment.layaway_plan;

        this.eventEmitter.emit('layaway.payment_reminder', {
          store_id: plan.store_id,
          plan_id: plan.id,
          plan_number: plan.plan_number,
          due_date: installment.due_date.toISOString().split('T')[0],
          amount: Number(installment.amount),
        });

        // Mark as reminded
        await this.prisma.layaway_installments.update({
          where: { id: installment.id },
          data: { reminder_sent_at: now, updated_at: now },
        });
      }

      this.logger.log(`Sent ${upcoming_installments.length} payment reminders`);
    } catch (error) {
      this.logger.error(`Layaway payment reminders failed: ${error.message}`, error.stack);
    }
  }
}
