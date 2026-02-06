import { Module } from '@nestjs/common';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { PurchaseOrdersService } from './purchase-orders.service';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../../prisma/prisma.module';
import { InventoryModule } from '../../inventory/inventory.module';

@Module({
  imports: [ResponseModule, PrismaModule, InventoryModule],
  controllers: [PurchaseOrdersController],
  providers: [PurchaseOrdersService],
  exports: [PurchaseOrdersService],
})
export class PurchaseOrdersModule {}
