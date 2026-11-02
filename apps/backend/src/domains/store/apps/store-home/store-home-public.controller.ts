import { Controller, Get } from '@nestjs/common';
import { Public } from '@common/decorators/public.decorator';
import { ResponseService } from '@common/responses/response.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors/vendix-http.exception';
import { ErrorCodes } from '@common/errors/error-codes';
import { DomainConfigService } from '@common/config/domain.config';
import { S3Service } from '@common/services/s3.service';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import {
  DEFAULT_STORE_HOME_FOOTER,
  parseStoreHomeConfig,
  resolveStoreHomeBranding,
} from './store-home.reader';

/**
 * Public read of the store home, for the STORE_HOME app. Under `/ecommerce/`
 * so the domain resolver middleware sets the store from the hostname; the
 * store never comes from the client. Returns only the brand and the footer:
 * no products, prices or cart.
 */
@Controller('ecommerce/store-home')
export class StoreHomePublicController {
  constructor(
    private readonly globalPrisma: GlobalPrismaService,
    private readonly s3: S3Service,
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

    const store = await this.globalPrisma.stores.findUnique({
      where: { id: storeId },
      select: { name: true, organization_id: true },
    });
    const [storeSettings, orgSettings] = await Promise.all([
      this.globalPrisma.store_settings.findUnique({
        where: { store_id: storeId },
        select: { settings: true },
      }),
      store?.organization_id
        ? this.globalPrisma.organization_settings.findUnique({
            where: { organization_id: store.organization_id },
            select: { settings: true },
          })
        : null,
    ]);
    const branding = resolveStoreHomeBranding(
      (storeSettings?.settings as any)?.branding,
      (orgSettings?.settings as any)?.branding,
    );
    if (branding.logo_url) {
      branding.logo_url = (await this.s3.signUrl(branding.logo_url)) ?? null;
    }

    const config = parseStoreHomeConfig(row.config);
    return this.responseService.success({
      store_name: store?.name ?? branding.name,
      branding,
      footer: {
        text: config.footer_text ?? DEFAULT_STORE_HOME_FOOTER,
        site_url: `https://${DomainConfigService.getBaseDomain()}`,
      },
    });
  }
}
