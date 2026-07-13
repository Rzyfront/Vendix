import { Module } from '@nestjs/common';
import { EcommercePromotionsController } from './ecommerce-promotions.controller';
import { EcommercePromotionsService } from './ecommerce-promotions.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { PromotionsModule } from '../../store/promotions/promotions.module';

/**
 * Public storefront promotions module. Reuses PromotionEngineService
 * (exported by PromotionsModule) for badge formatting instead of duplicating
 * it, per the shared-service ownership rule.
 */
@Module({
  imports: [PrismaModule, PromotionsModule],
  controllers: [EcommercePromotionsController],
  providers: [EcommercePromotionsService],
  exports: [EcommercePromotionsService],
})
export class EcommercePromotionsModule {}
