import { Module } from '@nestjs/common';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../../prisma/prisma.module';
import { LodgingReservationsController } from './reservations.controller';
import { LodgingReservationsService } from './reservations.service';
import { LodgingAvailabilityService } from './lodging-availability.service';
import { LodgingNoShowJob } from './jobs/lodging-no-show.job';

@Module({
  imports: [ResponseModule, PrismaModule],
  controllers: [LodgingReservationsController],
  providers: [LodgingReservationsService, LodgingAvailabilityService, LodgingNoShowJob],
  exports: [LodgingReservationsService, LodgingAvailabilityService],
})
export class LodgingReservationsModule {}
