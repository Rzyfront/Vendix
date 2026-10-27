import { Module } from '@nestjs/common';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../../prisma/prisma.module';
import { LodgingRatePlansController } from './rate-plans.controller';
import { LodgingRatePlansService } from './rate-plans.service';
import { LodgingRestrictionsController } from './restrictions.controller';
import { LodgingRestrictionsService } from './restrictions.service';
import { LodgingSeasonsController } from './seasons.controller';
import { LodgingSeasonsService } from './seasons.service';

@Module({
  imports: [ResponseModule, PrismaModule],
  controllers: [
    LodgingRatePlansController,
    LodgingSeasonsController,
    LodgingRestrictionsController,
  ],
  providers: [LodgingRatePlansService, LodgingSeasonsService, LodgingRestrictionsService],
  exports: [LodgingRatePlansService],
})
export class LodgingRatesModule {}
