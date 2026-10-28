import { Module } from '@nestjs/common';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../../prisma/prisma.module';
import { LodgingCancellationPoliciesController } from './cancellation-policies.controller';
import { LodgingCancellationPoliciesService } from './cancellation-policies.service';
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
    LodgingCancellationPoliciesController,
  ],
  providers: [
    LodgingRatePlansService,
    LodgingSeasonsService,
    LodgingRestrictionsService,
    LodgingCancellationPoliciesService,
  ],
  exports: [LodgingRatePlansService],
})
export class LodgingRatesModule {}
