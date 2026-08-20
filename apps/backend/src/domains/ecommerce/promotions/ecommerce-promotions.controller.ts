import { Controller, Get, Header } from '@nestjs/common';
import {
  EcommercePromotionsService,
  StorefrontActivePromotion,
} from './ecommerce-promotions.service';
import { Public } from '@common/decorators/public.decorator';

@Controller('ecommerce/promotions')
export class EcommercePromotionsController {
  constructor(
    private readonly promotions_service: EcommercePromotionsService,
  ) {}

  /**
   * Public storefront list of the store's active auto-apply promotions.
   * store_id is resolved automatically from the domain by
   * DomainResolverMiddleware; no admin permission required.
   *
   * Every row is strictly typed (`StorefrontActivePromotion`): `scope` is a
   * closed union, `quantity_tiers` is always present (`[]` for flat promos)
   * and `promotion_type_label` arrives server-formatted, so the storefront
   * renders the copy verbatim without recomputing anything.
   */
  @Public()
  @Get('active')
  @Header('Cache-Control', 'no-store')
  async getActive(): Promise<{
    success: true;
    data: StorefrontActivePromotion[];
  }> {
    const data = await this.promotions_service.getActivePromotions();
    return { success: true, data };
  }
}
