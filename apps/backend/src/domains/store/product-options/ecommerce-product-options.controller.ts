import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { Public } from '@common/decorators/public.decorator';
import { ResponseService } from '@common/responses/response.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { industryAllowsKey } from '../../../common/access/module-industries';
import { ProductOptionsService } from './product-options.service';

/** Tienda en línea: adiciones aplicables a un producto, sin costos. */
@Controller('ecommerce/product-options')
export class EcommerceProductOptionsController {
  constructor(
    private readonly productOptions: ProductOptionsService,
    private readonly responseService: ResponseService,
    private readonly globalPrisma: GlobalPrismaService,
  ) {}

  @Public()
  @Get(':productId')
  async forProduct(@Param('productId', ParseIntPipe) productId: number) {
    const store_id = RequestContextService.getStoreId();
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    // QUI-1001: Adiciones are restaurant-only. Other industries get no groups;
    // the stored groups stay untouched (hiding never deletes data).
    const store = await this.globalPrisma.stores.findUnique({
      where: { id: store_id },
      select: { industries: true },
    });
    if (store && !industryAllowsKey('products_option_groups', store.industries)) {
      return this.responseService.success([], 'Adiciones del producto obtenidas');
    }
    const groups = await this.productOptions.applicableForProduct(store_id, productId, { withCost: false });
    return this.responseService.success(groups, 'Adiciones del producto obtenidas');
  }
}
