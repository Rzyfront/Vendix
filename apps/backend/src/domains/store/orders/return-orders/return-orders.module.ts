import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { ReturnOrdersController } from './return-orders.controller';
import { ReturnOrdersService } from './return-orders.service';
import { InventoryModule } from '../../inventory/inventory.module';

@Module({
  imports: [PrismaModule, InventoryModule],
  controllers: [ReturnOrdersController],
  providers: [ReturnOrdersService],
  exports: [ReturnOrdersService],
})
export class ReturnOrdersModule {}
