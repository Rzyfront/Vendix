import { Controller, Get } from '@nestjs/common';
import { Public } from '@common/decorators/public.decorator';
import { ResponseService } from '@common/responses/response.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors/vendix-http.exception';
import { ErrorCodes } from '@common/errors/error-codes';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { selectStoreHomeApps } from './store-home.reader';
import { StoreHomeViewService } from './store-home-view.service';
import { readAppPage } from '../shared/app-page.contract';

/**
 * Public read of the store home, for the STORE_HOME app. Under `/ecommerce/`
 * so the domain resolver middleware sets the store (from the hostname, or the
 * `x-store-id` the storefront sends, like every `/ecommerce/*` read). Returns
 * only public data — the brand and the footer: no products, prices or cart.
 */
@Controller('ecommerce/store-home')
export class StoreHomePublicController {
  constructor(
    private readonly globalPrisma: GlobalPrismaService,
    private readonly view: StoreHomeViewService,
    private readonly responseService: ResponseService,
  ) {}

  @Public()
  @Get()
  async get() {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.SYS_FORBIDDEN_001);
    }
    const row = await this.globalPrisma.store_apps.findFirst({
      where: { store_id: storeId, kind: 'store_home', status: 'published' },
      select: { config: true },
    });
    if (!row) {
      throw new VendixHttpException(ErrorCodes.STORE_APPS_001);
    }

    const { apps, ...data } = await this.view.read(storeId, row.config);
    // Apps F2: the owner's page, only when saved (pre-F2 response otherwise).
    const page = readAppPage('store_home', row.config);
    const appsBlock = page?.blocks.find((block) => block.type === 'apps' && block.enabled);
    return this.responseService.success({
      ...data,
      ...(page ? { page } : {}),
      // F6-B: the owner's choice and order of apps (`kinds`), else all of them.
      ...(appsBlock ? { apps: selectStoreHomeApps(apps, appsBlock.props['kinds']) } : {}),
    });
  }
}
