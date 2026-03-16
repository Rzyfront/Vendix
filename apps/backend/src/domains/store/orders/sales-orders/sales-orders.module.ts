import { Module } from '@nestjs/common';
import { SalesOrdersController } from './sales-orders.controller';
import { SalesOrdersService } from './sales-orders.service';
import { InventoryModule } from '../../inventory/inventory.module';
import { PrismaModule } from '../../../../prisma/prisma.module';
import { S3Module } from '@common/services/s3.module';

@Module({
  imports: [InventoryModule, PrismaModule, S3Module],
  controllers: [SalesOrdersController],
  providers: [SalesOrdersService],
  exports: [SalesOrdersService],
})
export class SalesOrdersModule {}
