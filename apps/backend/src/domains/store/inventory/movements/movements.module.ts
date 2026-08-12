import { Module } from '@nestjs/common';
import { MovementsController } from './movements.controller';
import { MovementsService } from './movements.service';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../../prisma/prisma.module';
import { StockLevelManager } from '../shared/services/stock-level-manager.service';
import { InventoryTransactionsModule } from '../transactions/inventory-transactions.module';

/**
 * `StockLevelManager` se declara como proveedor LOCAL, no se importa
 * `InventoryModule`: ese módulo ya importa a éste, así que importarlo de vuelta
 * cerraría un ciclo. Es el mismo patrón que usa `StockLevelsModule` y el que
 * documenta `InventoryCostingModule` («the manager is re-declared as a local
 * provider in several feature modules»). Las dependencias de costeo llegan por
 * el módulo global; `InventoryTransactionsModule` aporta la traza.
 */
@Module({
  imports: [ResponseModule, PrismaModule, InventoryTransactionsModule],
  controllers: [MovementsController],
  providers: [MovementsService, StockLevelManager],
  exports: [MovementsService],
})
export class MovementsModule {}
