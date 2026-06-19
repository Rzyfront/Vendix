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
      const now = new Date();
      const cutoff24h = new Date(now);
      cutoff24h.setHours(cutoff24h.getHours() - 24);
      const cutoff4h = new Date(now);
      cutoff4h.setHours(cutoff4h.getHours() - 4);

      // Find distinct stores with auto-finishable orders (unscoped query).
      // We match BOTH windows so a store with only restaurant-POS orders still
      // gets the tenant context and runs pass 2 inside
      // `autoFinishDeliveredOrders`:
      //   - Ecommerce/retail (24h): 'delivered' for >24h.
      //   - Restaurant-POS (4h): channel='pos' + kitchen tickets, in
      //     'processing'/'delivered' for >4h.
      const storesWithOrders = await this.globalPrisma.orders.findMany({
        where: {
          OR: [
            {
              state: 'delivered',
              updated_at: { lte: cutoff24h },
            },
            {
              channel: 'pos',
              kitchen_tickets: { some: {} },
              state: { in: ['processing', 'delivered'] },
              updated_at: { lte: cutoff4h },
            },
          ],
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
