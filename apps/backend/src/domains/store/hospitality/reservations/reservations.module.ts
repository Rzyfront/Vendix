import { Module } from '@nestjs/common';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../../prisma/prisma.module';
import { LodgingReservationsController } from './reservations.controller';
import { LodgingReservationsService } from './reservations.service';
import { LodgingAvailabilityService } from './lodging-availability.service';
import { LodgingRoomChangesService } from './room-changes.service';
import { LodgingNoShowJob } from './jobs/lodging-no-show.job';
import { LodgingRackController } from './rack/rack.controller';
import { LodgingRackService } from './rack/lodging-rack.service';
import { LodgingRatesModule } from '../rates/rates.module';

@Module({
  imports: [ResponseModule, PrismaModule, LodgingRatesModule],
  controllers: [LodgingReservationsController, LodgingRackController],
  providers: [
    LodgingReservationsService,
    LodgingAvailabilityService,
    LodgingRoomChangesService,
    LodgingNoShowJob,
    LodgingRackService,
  ],
  exports: [LodgingReservationsService, LodgingAvailabilityService],
})
export class LodgingReservationsModule {}
