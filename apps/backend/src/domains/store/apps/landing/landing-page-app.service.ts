import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors/vendix-http.exception';
import { ErrorCodes } from '@common/errors/error-codes';
import {
  AppCustomDomainView,
  AppDomainService,
  appDomainState,
} from '../shared/app-domain.service';
import { buildAppSuffixHostname } from '../product-page/product-page-hostname';
import { sellableProductsWhere } from '../product-page/product-page.reader';
import {
  LandingPageConfig,
  parseLandingPageConfig,
} from './landing-page.reader';
import {
  PublishLandingPageDto,
  UpdateLandingPageConfigDto,
} from './landing-page.dto';

/**
 * The landing's own domain renders the landing the store already has
 * (`STORE_LANDING`), so the content, generator and editor of
 * "Landing de captación" are reused as they are.
 */
const APP_TYPE = 'STORE_LANDING';
/** Plan S5: `{tienda}-landing.vendix.online`. */
const APP_SUFFIX = 'landing';

/**
 * Apps · landing page (Fase 6): offer config, publish and unpublish.
 *
 * Tenant isolation: the store comes from the request context; every read
 * goes through `StorePrismaService` (auto-scoped) and filters by that store.
 * Domains follow S5 through `AppDomainService`, like the other apps.
 */
@Injectable()
export class LandingPageAppService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly domains: AppDomainService,
  ) {}

  async updateConfig(dto: UpdateLandingPageConfigDto): Promise<void> {
    const storeId = this.requireStoreId();
    const productId =
      dto.offer_mode === 'product' ? (dto.offer_product_id ?? null) : null;
    if (dto.offer_mode === 'product') {
      if (!productId) throw new VendixHttpException(ErrorCodes.STORE_APPS_012);
      const sold = await this.prisma.products.count({
        where: sellableProductsWhere(storeId, [productId]),
      });
      if (sold === 0) throw new VendixHttpException(ErrorCodes.STORE_APPS_002);
    }

    const row = await this.findRow(storeId);
    const config: LandingPageConfig = {
      ...parseLandingPageConfig(row?.config),
      offer_mode: dto.offer_mode,
      offer_title: dto.offer_title?.trim() || null,
      offer_description: dto.offer_description?.trim() || null,
      offer_product_id: productId,
    };

    if (row) {
      await this.prisma.store_apps.update({
        where: { id: row.id },
        data: { config: this.toJson(config), updated_at: new Date() },
      });
    } else {
      await this.prisma.store_apps.create({
        data: {
          store_id: storeId,
          kind: 'landing',
          status: 'draft',
          config: this.toJson(config),
        },
      });
    }

    if (row?.status === 'published' && row.domain_settings) {
      await this.domains.clearAppSeoCache(
        storeId,
        row.domain_settings.hostname,
        row.config,
      );
    }
  }

  async publish(dto: PublishLandingPageDto): Promise<void> {
    const storeId = this.requireStoreId();
    const content = await this.prisma.crm_landing_pages.findFirst({
      where: { store_id: storeId },
      select: { enabled: true, published_json: true },
    });
    if (!content?.enabled || !content.published_json) {
      throw new VendixHttpException(ErrorCodes.STORE_APPS_011);
    }
    // Validate the target before releasing anything, so a rejected republish
    // leaves the current publication untouched.
    if (dto.custom_domain_id) {
      await this.domains.findTakeableCustomDomain(storeId, dto.custom_domain_id);
    }

    let row = await this.findRow(storeId);
    if (!row) {
      // Publishing with no config shows an informative offer.
      await this.prisma.store_apps.create({
        data: {
          store_id: storeId,
          kind: 'landing',
          status: 'draft',
          config: this.toJson(parseLandingPageConfig(null)),
        },
      });
      row = await this.findRow(storeId);
    }
    if (!row) throw new VendixHttpException(ErrorCodes.STORE_APPS_001);
    const config = parseLandingPageConfig(row.config);

    // Apps F5: the subdomain is always the primary domain; a custom domain
    // is added as an alias and the existing aliases stay.
    const published = await this.domains.publishOnDomains(
      storeId,
      APP_TYPE,
      appDomainState(row, config),
      dto.custom_domain_id,
      (storeSlug, baseDomain, isTaken) =>
        buildAppSuffixHostname(storeSlug, APP_SUFFIX, baseDomain, isTaken),
    );
    config.custom_domain_previous_app_type = null;
    config.custom_domain_aliases = published.aliases;
    const domain = published.primary;

    await this.prisma.store_apps.update({
      where: { id: row.id },
      data: {
        status: 'published',
        published_at: new Date(),
        domain_settings_id: domain.id,
        config: this.toJson(config),
        updated_at: new Date(),
      },
    });
    await this.domains.clearSeoCache(domain.hostname);
  }

  /**
   * Takes the landing off its own domain. The landing itself, and wherever
   * "Landing de captación" serves it (`{tienda}-store`), is not touched.
   */
  async unpublish(): Promise<void> {
    const storeId = this.requireStoreId();
    const row = await this.findRow(storeId);
    // A backfilled row (published, no domain) has no own domain to take down.
    if (!row || row.status !== 'published' || !row.domain_settings) return;

    const config = parseLandingPageConfig(row.config);
    await this.domains.releaseAppDomains(
      storeId,
      APP_TYPE,
      appDomainState(row, config),
    );
    config.custom_domain_previous_app_type = null;
    config.custom_domain_aliases = [];

    await this.prisma.store_apps.update({
      where: { id: row.id },
      data: {
        status: 'disabled',
        config: this.toJson(config),
        updated_at: new Date(),
      },
    });
  }

  listCustomDomains(): Promise<AppCustomDomainView[]> {
    return this.domains.listCustomDomains(this.requireStoreId());
  }

  // ---------------------------------------------------------------------------

  private findRow(storeId: number) {
    return this.prisma.store_apps.findFirst({
      where: { store_id: storeId, kind: 'landing' },
      select: {
        id: true,
        status: true,
        config: true,
        domain_settings: {
          select: { id: true, hostname: true, ownership: true },
        },
      },
    });
  }

  private toJson(config: LandingPageConfig): Prisma.InputJsonValue {
    return config as unknown as Prisma.InputJsonValue;
  }

  private requireStoreId(): number {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.SYS_FORBIDDEN_001);
    }
    return storeId;
  }
}
