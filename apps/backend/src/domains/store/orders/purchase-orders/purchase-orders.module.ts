import { Module } from '@nestjs/common';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { PurchaseOrdersService } from './purchase-orders.service';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../../prisma/prisma.module';
import { InventoryModule } from '../../inventory/inventory.module';
import { S3Module } from '@common/services/s3.module';

@Module({
  imports: [ResponseModule, PrismaModule, InventoryModule, S3Module],
  controllers: [PurchaseOrdersController],
  providers: [PurchaseOrdersService],
  exports: [PurchaseOrdersService],
})
export class PurchaseOrdersModule {}
