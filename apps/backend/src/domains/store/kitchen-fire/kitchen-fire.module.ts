import { Module, OnModuleInit } from '@nestjs/common';
import { AIToolRegistry } from '../../../ai-engine/tools/ai-tool-registry';
import { createKitchenTools } from '../../../ai-engine/tools/domains/kitchen.tools';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { InventoryModule } from '../inventory/inventory.module';
import { StockValidatorService } from '../inventory/shared/services/stock-validator.service';
import { RecipesModule } from '../recipes/recipes.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { KdsModule } from '../kds/kds.module';
import { OrderHistoryModule } from '../orders/order-history/order-history.module';
import { AccountingModule } from '../accounting/accounting.module';
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
 *   - KdsModule:          KdsSessionsService — QUI-760 imputa el consumo a
 *     la sesión abierta desde los handlers de gestión de ticket.
 *   - OrderHistoryModule: OrderHistoryService — registra `kitchen_fired` en
 *     `order_events` dentro del tx del fire/resend.
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
    KdsModule,
    OrderHistoryModule,
    AccountingModule,
  ],
  controllers: [KitchenFireController],
  providers: [KitchenFireService],
  exports: [KitchenFireService],
})
export class KitchenFireModule implements OnModuleInit {
  constructor(
    private readonly toolRegistry: AIToolRegistry,
    private readonly kitchenFireService: KitchenFireService,
    private readonly stockValidator: StockValidatorService,
  ) {}

  /**
   * K-1/K-2/K-4/K-5 — kitchen tools. Registro descentralizado en el módulo
   * dueño (no en `AIEngineModule`, para no reintroducir el ciclo DI).
   * `StockValidatorService` ya lo exporta `InventoryModule`, importado aquí.
   */
  onModuleInit(): void {
    this.toolRegistry.registerMany(
      createKitchenTools({
        kitchenFireService: this.kitchenFireService,
        stockValidator: this.stockValidator,
      }),
    );
  }
}
