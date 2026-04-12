import { Global, Module, OnModuleInit } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AIEngineService } from './ai-engine.service';
import { AILoggingService } from './ai-logging.service';
import { AIQueueModule } from './queue/ai-queue.module';
import { AIStreamController } from './ai-stream.controller';
import { AIAgentService } from './ai-agent.service';
import { AIToolRegistry } from './tools/ai-tool-registry';
import { salesTools } from './tools/domains/sales.tools';
import { createInventoryTools } from './tools/domains/inventory.tools';
import { accountingTools } from './tools/domains/accounting.tools';
import { customerTools } from './tools/domains/customers.tools';
import { searchTools } from './tools/domains/search.tools';
import { EmbeddingModule } from './embeddings/embedding.module';
import { InventoryModule } from '../domains/store/inventory/inventory.module';
import { StockLevelsService } from '../domains/store/inventory/stock-levels/stock-levels.service';
import { InventoryIntegrationService } from '../domains/store/inventory/shared/services/inventory-integration.service';
import { InventoryAdjustmentsService } from '../domains/store/inventory/adjustments/inventory-adjustments.service';
import { MovementsService } from '../domains/store/inventory/movements/movements.service';
import { LocationsService } from '../domains/store/inventory/locations/locations.service';

@Global()
@Module({
  imports: [PrismaModule, AIQueueModule, EmbeddingModule, InventoryModule],
  controllers: [AIStreamController],
  providers: [AIEngineService, AILoggingService, AIAgentService, AIToolRegistry],
  exports: [AIEngineService, AILoggingService, AIAgentService, AIToolRegistry, AIQueueModule, EmbeddingModule],
})
export class AIEngineModule implements OnModuleInit {
  constructor(
    private readonly toolRegistry: AIToolRegistry,
    private readonly stockLevelsService: StockLevelsService,
    private readonly inventoryIntegrationService: InventoryIntegrationService,
    private readonly adjustmentsService: InventoryAdjustmentsService,
    private readonly movementsService: MovementsService,
    private readonly locationsService: LocationsService,
  ) {}

  onModuleInit() {
    const allTools = [
      ...salesTools,
      ...createInventoryTools({
        stockLevelsService: this.stockLevelsService,
        inventoryIntegrationService: this.inventoryIntegrationService,
        adjustmentsService: this.adjustmentsService,
        movementsService: this.movementsService,
        locationsService: this.locationsService,
      }),
      ...accountingTools,
      ...customerTools,
      ...searchTools,
    ];
    for (const tool of allTools) {
      this.toolRegistry.register(tool);
    }
  }
}
