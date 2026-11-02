import { Controller, Get } from '@nestjs/common';
import { Public } from '@common/decorators/public.decorator';
import { ResponseService } from '@common/responses/response.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors/vendix-http.exception';
import { ErrorCodes } from '@common/errors/error-codes';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { readPublishedProductPage } from './product-page.reader';

/**
 * Public read of the store's product page, for the STORE_PRODUCT_PAGE app.
 * Under `/ecommerce/` so the domain resolver middleware sets the store from
 * the hostname; the store never comes from the client. Only published pages
 * and products still sold online are returned.
 */
@Controller('ecommerce/product-page')
export class ProductPagePublicController {
  constructor(
    private readonly globalPrisma: GlobalPrismaService,
    private readonly responseService: ResponseService,
  ) {}

  @Public()
  @Get()
  async get() {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.SYS_FORBIDDEN_001);
    }
    const page = await readPublishedProductPage(this.globalPrisma, storeId);
    if (!page) {
      throw new VendixHttpException(ErrorCodes.STORE_APPS_001);
    }
    return this.responseService.success({
      product: {
        id: page.product.id,
        slug: page.product.slug,
        name: page.product.name,
      },
      complement_product_ids: page.complements.map((c) => c.id),
    });
  }
}
