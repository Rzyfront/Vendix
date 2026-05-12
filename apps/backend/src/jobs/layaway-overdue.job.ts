import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class LayawayOverdueJob {
  private readonly logger = new Logger(LayawayOverdueJob.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Runs every hour to detect overdue layaway installments.
   * Marks pending installments past due_date as 'overdue'.
   * If all installments of a plan are overdue, marks the plan as 'overdue'.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async handleOverdueDetection() {
    this.logger.log('Starting layaway overdue detection...');

    try {
      const now = new Date();

      // 1. Find pending installments that are past due
      const overdue_installments =
        await this.prisma.layaway_installments.findMany({
          where: {
            state: 'pending',
            due_date: { lt: now },
            layaway_plan: { state: { in: ['active'] } },
          },
          include: {
            layaway_plan: {
              select: { id: true, store_id: true, plan_number: true },
            },
          },
        });

      if (overdue_installments.length === 0) {
        this.logger.debug('No overdue installments found');
        return;
      }

      // 2. Mark installments as overdue
      await this.prisma.layaway_installments.updateMany({
        where: {
          id: { in: overdue_installments.map((i) => i.id) },
        },
        data: { state: 'overdue', updated_at: now },
      });

      this.logger.log(
        `Marked ${overdue_installments.length} installments as overdue`,
      );

      // 3. Check if plans should be marked overdue
      const plan_ids = [
        ...new Set(overdue_installments.map((i) => i.layaway_plan_id)),
      ];

      for (const plan_id of plan_ids) {
        const pending_count = await this.prisma.layaway_installments.count({
          where: { layaway_plan_id: plan_id, state: 'pending' },
        });

        // If no pending installments left (all are paid, overdue, or cancelled), mark plan as overdue
        if (pending_count === 0) {
          const overdue_count = await this.prisma.layaway_installments.count({
            where: { layaway_plan_id: plan_id, state: 'overdue' },
          });

          if (overdue_count > 0) {
            await this.prisma.layaway_plans.update({
              where: { id: plan_id },
              data: { state: 'overdue', updated_at: now },
            });

            const plan = overdue_installments.find(
              (i) => i.layaway_plan_id === plan_id,
            )?.layaway_plan;
            if (plan) {
              this.eventEmitter.emit('layaway.overdue', {
                store_id: plan.store_id,
                plan_id: plan.id,
                plan_number: plan.plan_number,
                overdue_count,
              });
            }
          }
        }
      }
    } catch (error) {
      this.logger.error(
        `Layaway overdue detection failed: ${error.message}`,
        error.stack,
      );
    }
  }
}
