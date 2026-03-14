import { Module } from '@nestjs/common';
import { PromotionsController } from './promotions.controller';
import { PromotionsService } from './promotions.service';
import { PromotionEngineService } from './promotion-engine/promotion-engine.service';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';

@Module({
  imports: [ResponseModule, PrismaModule],
  controllers: [PromotionsController],
  providers: [PromotionsService, PromotionEngineService],
  exports: [PromotionsService, PromotionEngineService],
})
export class PromotionsModule {}
