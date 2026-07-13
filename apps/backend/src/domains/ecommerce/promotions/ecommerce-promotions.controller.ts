import { Controller, Get, Header } from '@nestjs/common';
import { EcommercePromotionsService } from './ecommerce-promotions.service';
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
   */
  @Public()
  @Get('active')
  @Header('Cache-Control', 'no-store')
  async getActive() {
    const data = await this.promotions_service.getActivePromotions();
    return { success: true, data };
  }
}
