import { Module, OnModuleInit } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AIToolRegistry } from '../../../../ai-engine/tools/ai-tool-registry';
import { createReturnTools } from '../../../../ai-engine/tools/domains/returns.tools';
import { ReturnOrdersController } from './return-orders.controller';
import { ReturnOrdersService } from './return-orders.service';
import { InventoryModule } from '../../inventory/inventory.module';

@Module({
  imports: [PrismaModule, InventoryModule],
  controllers: [ReturnOrdersController],
  providers: [ReturnOrdersService],
  exports: [ReturnOrdersService],
})
export class ReturnOrdersModule implements OnModuleInit {
  constructor(
    private readonly toolRegistry: AIToolRegistry,
    private readonly returnOrdersService: ReturnOrdersService,
  ) {}

  /**
   * O-29: devoluciones vía `ReturnOrdersService` (dueño del ciclo
   * draft→processed/cancelled y del movimiento de stock al procesar).
   * Registro descentralizado en el módulo dueño, no en `AIEngineModule`
   * (ciclo DI).
   */
  onModuleInit(): void {
    this.toolRegistry.registerMany(
      createReturnTools({
        returnOrdersService: this.returnOrdersService,
      }),
    );
  }
}
