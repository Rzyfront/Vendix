import { Module } from '@nestjs/common';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ProductOptionsService } from './product-options.service';
import { OptionPricingService } from './option-pricing.service';
import { ProductOptionsController } from './product-options.controller';
import { EcommerceProductOptionsController } from './ecommerce-product-options.controller';

/** Adiciones de producto. Inerte mientras `product_options.enabled` sea false. */
@Module({
  imports: [ResponseModule, PrismaModule],
  controllers: [ProductOptionsController, EcommerceProductOptionsController],
  providers: [ProductOptionsService, OptionPricingService],
  exports: [ProductOptionsService, OptionPricingService],
})
export class ProductOptionsModule {}
