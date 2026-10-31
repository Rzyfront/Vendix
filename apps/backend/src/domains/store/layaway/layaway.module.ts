import { Module } from '@nestjs/common';
import { LayawayService } from './layaway.service';
import { LayawayController } from './layaway.controller';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { InventoryModule } from '../inventory/inventory.module';
import { CashRegistersModule } from '../cash-registers/cash-registers.module';

@Module({
  imports: [ResponseModule, PrismaModule, InventoryModule, CashRegistersModule],
  controllers: [LayawayController],
  providers: [LayawayService],
  exports: [LayawayService],
})
export class LayawayModule {}
