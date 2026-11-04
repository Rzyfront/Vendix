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
import { readAppPage } from '../shared/app-page.contract';
import { APP_CATALOG } from '../apps.catalog';

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
    // Apps F2: the owner's page, only when saved (pre-F2 response otherwise).
    const page = readAppPage('store_home', row.config);
    const showsApps = !!page?.blocks.some(
      (block) => block.type === 'apps' && block.enabled,
    );
    return this.responseService.success({
      store_name: store?.name ?? branding.name,
      branding,
      footer: {
        text: config.footer_text ?? DEFAULT_STORE_HOME_FOOTER,
        site_url: `https://${DomainConfigService.getBaseDomain()}`,
      },
      ...(page ? { page } : {}),
      ...(showsApps ? { apps: await this.publishedApps(storeId) } : {}),
    });
  }

  /**
   * Public links of the store's published apps for the "Mis apps" block:
   * the online store when its domain is active and the store is open, then
   * every other published app with an active domain. Name and URL only.
   */
  private async publishedApps(
    storeId: number,
  ): Promise<{ kind: string; name: string; url: string }[]> {
    const [ecommerceDomain, settingsRow, rows] = await Promise.all([
      this.globalPrisma.domain_settings.findFirst({
        where: { store_id: storeId, app_type: 'STORE_ECOMMERCE', status: 'active' },
        orderBy: [{ is_primary: 'desc' }, { id: 'asc' }],
        select: { hostname: true },
      }),
      this.globalPrisma.store_settings.findUnique({
        where: { store_id: storeId },
        select: { settings: true },
      }),
      this.globalPrisma.store_apps.findMany({
        where: {
          store_id: storeId,
          status: 'published',
          kind: { notIn: ['store_home', 'ecommerce'] },
        },
        select: {
          kind: true,
          domain_settings: { select: { hostname: true, status: true } },
        },
      }),
    ]);
    const nameOf = (kind: string) =>
      APP_CATALOG.find((entry) => entry.key === kind)?.name ?? kind;
    const storeOpen =
      (settingsRow?.settings as { ecommerce?: { general?: { store_available?: boolean } } } | null)
        ?.ecommerce?.general?.store_available !== false;

    const apps: { kind: string; name: string; url: string }[] = [];
    if (ecommerceDomain && storeOpen) {
      apps.push({
        kind: 'ecommerce',
        name: nameOf('ecommerce'),
        url: `https://${ecommerceDomain.hostname}`,
      });
    }
    for (const kind of APP_CATALOG.map((entry) => entry.key)) {
      const app = rows.find((row) => row.kind === kind);
      if (app?.domain_settings?.status === 'active') {
        apps.push({ kind, name: nameOf(kind), url: `https://${app.domain_settings.hostname}` });
      }
    }
    return apps;
  }
}
