import { Module } from '@nestjs/common';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../../prisma/prisma.module';
import { OrderFlowModule } from '../../orders/order-flow/order-flow.module';
import { OrderHistoryModule } from '../../orders/order-history/order-history.module';
import { CashRegistersModule } from '../../cash-registers/cash-registers.module';
import { SettingsModule } from '../../settings/settings.module';
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
import { LodgingFrontDeskController } from './front-desk/front-desk.controller';
import { LodgingFrontDeskService } from './front-desk/lodging-front-desk.service';
import { LodgingFolioController } from './folio/folio.controller';
import { LodgingFolioService } from './folio/folio.service';
import { LodgingNightAuditJob } from './jobs/lodging-night-audit.job';

@Module({
  imports: [
    ResponseModule,
    PrismaModule,
    LodgingRatesModule,
    // H3.4 — the folio reuses the order totals rule, order history and the
    // cash register gate of every sale.
    OrderFlowModule,
    OrderHistoryModule,
    CashRegistersModule,
    SettingsModule,
  ],
  controllers: [
    LodgingReservationsController,
    LodgingRackController,
    LodgingAllotmentsController,
    LodgingGuestsController,
    LodgingFrontDeskController,
    LodgingFolioController,
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
    LodgingFrontDeskService,
    LodgingFolioService,
    LodgingNightAuditJob,
  ],
  exports: [LodgingReservationsService, LodgingAvailabilityService],
})
export class LodgingReservationsModule {}
