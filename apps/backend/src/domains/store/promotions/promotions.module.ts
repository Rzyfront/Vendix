import { Module, OnModuleInit } from '@nestjs/common';
import { PromotionsController } from './promotions.controller';
import { PromotionsService } from './promotions.service';
import { PromotionEngineService } from './promotion-engine/promotion-engine.service';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
// The marketing tool family covers promotions + coupons; this module owns the
// registration and imports the coupons side (which does not import back).
import { CouponsModule } from '../coupons/coupons.module';
import { CouponsService } from '../coupons/coupons.service';
import { AIToolRegistry } from '../../../ai-engine/tools/ai-tool-registry';
import { createMarketingTools } from '../../../ai-engine/tools/domains/marketing.tools';

@Module({
  imports: [ResponseModule, PrismaModule, CouponsModule],
  controllers: [PromotionsController],
  providers: [PromotionsService, PromotionEngineService],
  exports: [PromotionsService, PromotionEngineService],
})
export class PromotionsModule implements OnModuleInit {
  constructor(
    private readonly toolRegistry: AIToolRegistry,
    private readonly promotions: PromotionsService,
    private readonly coupons: CouponsService,
  ) {}

  onModuleInit(): void {
    this.toolRegistry.registerMany(
      createMarketingTools({
        promotionsService: this.promotions,
        couponsService: this.coupons,
      }),
    );
  }
}
