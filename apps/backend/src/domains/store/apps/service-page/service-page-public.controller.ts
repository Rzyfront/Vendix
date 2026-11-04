import { Controller, Get } from '@nestjs/common';
import { Public } from '@common/decorators/public.decorator';
import { ResponseService } from '@common/responses/response.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors/vendix-http.exception';
import { ErrorCodes } from '@common/errors/error-codes';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { readPublishedServicePage } from './service-page.reader';

/**
 * Public read of the store's service page, for the STORE_SERVICE_PAGE app.
 * Under `/ecommerce/` so the domain resolver middleware sets the store from
 * the hostname; the store never comes from the client. Returns only ids: the
 * page loads cards, prices and categories from the ecommerce catalog, and
 * books through the ecommerce reservations flow, both unchanged.
 */
@Controller('ecommerce/service-page')
export class ServicePagePublicController {
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
    const page = await readPublishedServicePage(this.globalPrisma, storeId);
    if (!page) {
      throw new VendixHttpException(ErrorCodes.STORE_APPS_001);
    }
    return this.responseService.success({
      service_ids: page.services.map((s) => s.id),
      featured_service_ids: page.featured_service_ids,
      product_ids: page.products.map((p) => p.id),
      // Apps F2: only when the owner saved a page (pre-F2 response otherwise).
      ...(page.page ? { page: page.page } : {}),
    });
  }
}
