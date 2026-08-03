import { Module, OnModuleInit } from '@nestjs/common';
import { ResponseModule } from '@common/responses/response.module';
import { AIToolRegistry } from '../../../ai-engine/tools/ai-tool-registry';
import { createInventoryTools } from '../../../ai-engine/tools/domains/inventory.tools';
import { createInventoryWriteTools } from '../../../ai-engine/tools/domains/writes.tools';
import { StockLevelsService } from './stock-levels/stock-levels.service';
import { InventoryAdjustmentsService } from './adjustments/inventory-adjustments.service';
import { MovementsService } from './movements/movements.service';
import { LocationsService } from './locations/locations.service';
import { LocationsModule } from './locations/locations.module';
import { StockLevelsModule } from './stock-levels/stock-levels.module';
import { MovementsModule } from './movements/movements.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { InventoryAdjustmentsModule } from './adjustments/inventory-adjustments.module';
import { InventoryController } from './inventory.controller';
import { InventoryValidationService } from './services/inventory-validation.service';
import { InventoryIntegrationService } from './shared/services/inventory-integration.service';
import { StockLevelManager } from './shared/services/stock-level-manager.service';
import { StockValidatorService } from './shared/services/stock-validator.service';
import { InventoryBatchesService } from './batches/inventory-batches.service';
import { InventorySerialNumbersModule } from './serial-numbers/inventory-serial-numbers.module';
import { InventoryTransactionsService } from './transactions/inventory-transactions.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { PrismaModule } from '../../../prisma/prisma.module';

@Module({
  imports: [
    ResponseModule,
    LocationsModule,
    StockLevelsModule,
    MovementsModule,
    SuppliersModule,
    InventoryAdjustmentsModule,
    InventorySerialNumbersModule,
    PrismaModule,
  ],
  controllers: [InventoryController],
  providers: [
    StorePrismaService,
    InventoryValidationService,
    InventoryIntegrationService,
    StockLevelManager,
    StockValidatorService,
    InventoryBatchesService,
    InventoryTransactionsService,
  ],
  exports: [
    LocationsModule,
    StockLevelsModule,
    MovementsModule,
    SuppliersModule,
    InventoryAdjustmentsModule,
    InventorySerialNumbersModule,
    InventoryValidationService,
    InventoryIntegrationService,
    StockLevelManager,
    StockValidatorService,
    InventoryBatchesService,
    InventoryTransactionsService,
  ],
})
export class InventoryModule implements OnModuleInit {
  constructor(
    private readonly toolRegistry: AIToolRegistry,
    private readonly stockLevelsService: StockLevelsService,
    private readonly inventoryIntegrationService: InventoryIntegrationService,
    private readonly adjustmentsService: InventoryAdjustmentsService,
    private readonly movementsService: MovementsService,
    private readonly locationsService: LocationsService,
    private readonly prisma: StorePrismaService,
  ) {}

  /**
   * Registers the inventory tool family. It lives here, not in
   * `AIEngineModule`, because that module is `@Global()` and importing one
   * domain module per tool family into it is a dependency cycle generator.
   * `AIToolRegistry` is exported globally, so this direction needs no import
   * at all — the dependency now points from the domain to the engine.
   */
  onModuleInit(): void {
    this.toolRegistry.registerMany(
      createInventoryTools({
        stockLevelsService: this.stockLevelsService,
        inventoryIntegrationService: this.inventoryIntegrationService,
        adjustmentsService: this.adjustmentsService,
        movementsService: this.movementsService,
        locationsService: this.locationsService,
      }),
    );

    // `adjust_stock`: la única escritura de inventario que Vexi puede ejecutar,
    // y vive aquí porque este módulo ya es dueño de `InventoryAdjustmentsService`
    // (que a su vez encapsula el costeo y el evento `inventory.adjusted`).
    this.toolRegistry.registerMany(
      createInventoryWriteTools({
        adjustmentsService: this.adjustmentsService,
        prisma: this.prisma,
      }),
    );
  }
}
