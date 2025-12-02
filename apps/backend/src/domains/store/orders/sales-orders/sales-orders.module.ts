import { Module } from '@nestjs/common';
import { SalesOrdersController } from './sales-orders.controller';
import { SalesOrdersService } from './sales-orders.service';
import { InventoryModule } from '../../inventory/inventory.module';
import { PrismaModule } from '../../../../prisma/prisma.module';

@Module({
  imports: [InventoryModule, PrismaModule],
  controllers: [SalesOrdersController],
  providers: [SalesOrdersService],
  exports: [SalesOrdersService],
})
export class SalesOrdersModule {}
