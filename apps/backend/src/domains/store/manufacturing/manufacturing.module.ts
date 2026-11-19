import { Module } from '@nestjs/common';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { S3Module } from '@common/services/s3.module';
import { InventoryModule } from '../inventory/inventory.module';
import { RecipesModule } from '../recipes/recipes.module';
import { ProductionOrdersModule } from '../production/production.module';
import { FormulasController } from './formulas/formulas.controller';
import { FormulasService } from './formulas/formulas.service';
import { ManufacturingOrdersController } from './orders/manufacturing-orders.controller';
import { ManufacturingOrdersService } from './orders/manufacturing-orders.service';
import { OrderSequenceService } from './orders/order-sequence.service';
import { ManufacturingPlantsController } from './plants/manufacturing-plants.controller';
import { ManufacturingPlantsService } from './plants/manufacturing-plants.service';
import { ManufacturingSettingsController } from './settings/manufacturing-settings.controller';
import { ManufacturingSettingsService } from './settings/manufacturing-settings.service';

/**
 * Módulo de Manufactura ("un motor, dos pieles"): reutiliza RecipesService y
 * ProductionOrdersService; solo agrega fórmulas, órdenes con consecutivo,
 * líneas planificado/consumido, costo real, lote, configuración y plantas (QUI-1013).
 */
@Module({
  imports: [
    ResponseModule,
    PrismaModule,
    S3Module,
    InventoryModule,
    RecipesModule,
    ProductionOrdersModule,
  ],
  controllers: [
    FormulasController,
    ManufacturingOrdersController,
    ManufacturingSettingsController,
    ManufacturingPlantsController,
  ],
  providers: [
    FormulasService,
    ManufacturingOrdersService,
    ManufacturingSettingsService,
    OrderSequenceService,
    ManufacturingPlantsService,
  ],
  exports: [FormulasService, ManufacturingOrdersService],
})
export class ManufacturingModule {}
