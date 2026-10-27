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
import { LodgingAllotmentsController } from './allotments/allotments.controller';
import { LodgingAllotmentsService } from './allotments/allotments.service';
import { LodgingGuestsController } from './guests/guests.controller';
import { LodgingGuestsService } from './guests/guests.service';
import { LodgingCheckInService } from './check-in/check-in.service';

@Module({
  imports: [ResponseModule, PrismaModule, LodgingRatesModule],
  controllers: [
    LodgingReservationsController,
    LodgingRackController,
    LodgingAllotmentsController,
    LodgingGuestsController,
  ],
  providers: [
    LodgingReservationsService,
    LodgingAvailabilityService,
    LodgingRoomChangesService,
    LodgingNoShowJob,
    LodgingRackService,
    LodgingAllotmentsService,
    LodgingGuestsService,
    LodgingCheckInService,
  ],
  exports: [LodgingReservationsService, LodgingAvailabilityService],
})
export class LodgingReservationsModule {}
