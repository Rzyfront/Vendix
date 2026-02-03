import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OrderFlowService } from '../domains/store/orders/order-flow/order-flow.service';

@Injectable()
export class OrderAutoFinishJob {
  private readonly logger = new Logger(OrderAutoFinishJob.name);

  constructor(private readonly orderFlowService: OrderFlowService) {}

  /**
   * Run every hour to check for orders that should be auto-finished
   * Orders in 'delivered' state for more than 24 hours will be moved to 'finished'
   */
  @Cron(CronExpression.EVERY_HOUR)
  async handleAutoFinish() {
    this.logger.log('Starting auto-finish job for delivered orders...');

    try {
      const finishedCount = await this.orderFlowService.autoFinishDeliveredOrders();

      if (finishedCount > 0) {
        this.logger.log(`Auto-finish job completed: ${finishedCount} orders finished`);
      } else {
        this.logger.debug('Auto-finish job completed: no orders to finish');
      }
    } catch (error) {
      this.logger.error(`Auto-finish job failed: ${error.message}`, error.stack);
    }
  }
}
