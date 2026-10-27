import { Module } from '@nestjs/common';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../../prisma/prisma.module';
import { LodgingRatePlansController } from './rate-plans.controller';
import { LodgingRatePlansService } from './rate-plans.service';

@Module({
  imports: [ResponseModule, PrismaModule],
  controllers: [LodgingRatePlansController],
  providers: [LodgingRatePlansService],
  exports: [LodgingRatePlansService],
})
export class LodgingRatesModule {}
