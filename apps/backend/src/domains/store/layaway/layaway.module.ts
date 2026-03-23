import { Module } from '@nestjs/common';
import { LayawayService } from './layaway.service';
import { LayawayController } from './layaway.controller';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [ResponseModule, PrismaModule, InventoryModule],
  controllers: [LayawayController],
  providers: [LayawayService],
  exports: [LayawayService],
})
export class LayawayModule {}
