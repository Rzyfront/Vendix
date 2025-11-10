import { Module } from '@nestjs/common';
import { SalesOrdersController } from './sales-orders.controller';
import { SalesOrdersService } from './sales-orders.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { InventoryModule } from '../../inventory/inventory.module';

@Module({
  imports: [PrismaModule, InventoryModule],
  controllers: [SalesOrdersController],
  providers: [SalesOrdersService],
  exports: [SalesOrdersService],
})
export class SalesOrdersModule {}
