import { Module } from '@nestjs/common';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { InventoryModule } from '../inventory/inventory.module';
import { RecipesModule } from '../recipes/recipes.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { KitchenFireController } from './kitchen-fire.controller';
import { KitchenFireService } from './kitchen-fire.service';

/**
 * KitchenFireModule — Restaurant Suite Fase D + F
 *
 * Fase D: the seam that moves inventory consume + COGS recognition from
 * "at payment" to "at fire-to-kitchen".
 * Fase F: extends the controller with a real-time SSE stream (KDS) and
 * ticket lifecycle mutations (start/ready/delivered/cancel).
 *
 * Depends on:
 *   - InventoryModule:    StockLevelManager (consumption movement + FIFO)
 *   - RecipesModule:      RecipesService.explodeBom (BOM with merma/yield)
 *   - NotificationsModule: NotificationsSseService (per-store Subject)
 *     — reused for the KDS `kitchen:{store_id}` event channel.
 *
 * Exports KitchenFireService for other domains that want to peek at
 * kitchen tickets.
 */
@Module({
  imports: [
    ResponseModule,
    PrismaModule,
    InventoryModule,
    RecipesModule,
    NotificationsModule,
  ],
  controllers: [KitchenFireController],
  providers: [KitchenFireService],
  exports: [KitchenFireService],
})
export class KitchenFireModule {}
