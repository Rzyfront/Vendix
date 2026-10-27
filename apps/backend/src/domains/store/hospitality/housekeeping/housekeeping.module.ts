import { Module } from '@nestjs/common';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../../prisma/prisma.module';
import { HousekeepingController } from './housekeeping.controller';
import { HousekeepingService } from './housekeeping.service';
import { HousekeepingTasksService } from './housekeeping-tasks.service';
import { LodgingReservationsModule } from '../reservations/reservations.module';

@Module({
  // The board's "Fuera de servicio" reuses the availability of the sale.
  imports: [ResponseModule, PrismaModule, LodgingReservationsModule],
  controllers: [HousekeepingController],
  providers: [HousekeepingService, HousekeepingTasksService],
})
export class HousekeepingModule {}
