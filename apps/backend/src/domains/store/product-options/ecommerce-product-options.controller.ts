import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { Public } from '@common/decorators/public.decorator';
import { ResponseService } from '@common/responses/response.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';
import { ProductOptionsService } from './product-options.service';

/** Tienda en línea: adiciones aplicables a un producto, sin costos. */
@Controller('ecommerce/product-options')
export class EcommerceProductOptionsController {
  constructor(
    private readonly productOptions: ProductOptionsService,
    private readonly responseService: ResponseService,
  ) {}

  @Public()
  @Get(':productId')
  async forProduct(@Param('productId', ParseIntPipe) productId: number) {
    const store_id = RequestContextService.getStoreId();
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    const groups = await this.productOptions.applicableForProduct(store_id, productId, { withCost: false });
    return this.responseService.success(groups, 'Adiciones del producto obtenidas');
  }
}
