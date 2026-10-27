import { Module } from '@nestjs/common';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../../prisma/prisma.module';
import { LodgingRatePlansController } from './rate-plans.controller';
import { LodgingRatePlansService } from './rate-plans.service';
import { LodgingSeasonsController } from './seasons.controller';
import { LodgingSeasonsService } from './seasons.service';

@Module({
  imports: [ResponseModule, PrismaModule],
  controllers: [LodgingRatePlansController, LodgingSeasonsController],
  providers: [LodgingRatePlansService, LodgingSeasonsService],
  exports: [LodgingRatePlansService],
})
export class LodgingRatesModule {}
