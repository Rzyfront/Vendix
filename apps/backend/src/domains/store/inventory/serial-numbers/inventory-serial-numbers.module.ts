import { Module } from '@nestjs/common';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../../prisma/prisma.module';
import { InventorySerialNumbersService } from './inventory-serial-numbers.service';
import { SerialNumberEnforcementService } from './serial-number-enforcement.service';
import { InventorySerialNumbersController } from './inventory-serial-numbers.controller';

@Module({
  imports: [ResponseModule, PrismaModule],
  controllers: [InventorySerialNumbersController],
  providers: [InventorySerialNumbersService, SerialNumberEnforcementService],
  exports: [InventorySerialNumbersService, SerialNumberEnforcementService],
})
export class InventorySerialNumbersModule {}
