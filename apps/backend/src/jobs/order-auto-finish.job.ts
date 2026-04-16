import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OrderFlowService } from '../domains/store/orders/order-flow/order-flow.service';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';
import { StoreContextRunner } from '@common/context/store-context-runner.service';

@Injectable()
export class OrderAutoFinishJob {
  private readonly logger = new Logger(OrderAutoFinishJob.name);

  constructor(
    private readonly orderFlowService: OrderFlowService,
    private readonly globalPrisma: GlobalPrismaService,
    private readonly storeContextRunner: StoreContextRunner,
  ) {}

  /**
   * Run every hour to check for orders that should be auto-finished.
   * Orders in 'delivered' state for more than 24 hours will be moved to 'finished'.
   * Iterates per-store to provide the required multi-tenant context.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async handleAutoFinish() {
    this.logger.log('Starting auto-finish job for delivered orders...');

    try {
      const cutoffDate = new Date();
      cutoffDate.setHours(cutoffDate.getHours() - 24);

      // Find distinct stores with deliverable orders (unscoped query)
      const storesWithOrders = await this.globalPrisma.orders.findMany({
        where: {
          state: 'delivered',
          updated_at: { lte: cutoffDate },
        },
        select: { store_id: true },
        distinct: ['store_id'],
      });

      if (storesWithOrders.length === 0) {
        this.logger.debug('Auto-finish job completed: no orders to finish');
        return;
      }

      let totalFinished = 0;

      // Process each store in its own tenant context
      for (const { store_id } of storesWithOrders) {
        try {
          const count = await this.storeContextRunner.runInStoreContext(
            store_id,
            () => this.orderFlowService.autoFinishDeliveredOrders(),
          );
          totalFinished += count;
        } catch (error) {
          this.logger.error(
            `Auto-finish failed for store #${store_id}: ${error.message}`,
            error.stack,
          );
        }
      }

      if (totalFinished > 0) {
        this.logger.log(
          `Auto-finish job completed: ${totalFinished} orders finished across ${storesWithOrders.length} stores`,
        );
      } else {
        this.logger.debug('Auto-finish job completed: no orders to finish');
      }
    } catch (error) {
      this.logger.error(
        `Auto-finish job failed: ${error.message}`,
        error.stack,
      );
    }
  }
}
