import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors/vendix-http.exception';
import { ErrorCodeEntry, ErrorCodes } from '@common/errors/error-codes';
import {
  AppCustomDomainView,
  AppDomainService,
  appDomainState,
} from '../shared/app-domain.service';
import { buildAppSuffixHostname } from '../product-page/product-page-hostname';
import {
  ServicePageConfig,
  onlineServicesWhere,
  parseServicePageConfig,
  secondaryProductsWhere,
} from './service-page.reader';
import {
  PublishServicePageDto,
  UpdateServicePageConfigDto,
} from './service-page.dto';

const APP_TYPE = 'STORE_SERVICE_PAGE';
/** Plan S5: `{tienda}-service.vendix.online`. */
const APP_SUFFIX = 'service';

/**
 * Apps · service page (plan S5, Fase 3): config, publish and unpublish.
 *
 * Tenant isolation: the store comes from the request context; every read
 * goes through `StorePrismaService` (auto-scoped) and filters by that store.
 * Domains follow S5 through `AppDomainService`, like the product page.
 */
@Injectable()
export class ServicePageAppService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly domains: AppDomainService,
  ) {}

  async updateConfig(dto: UpdateServicePageConfigDto): Promise<void> {
    const storeId = this.requireStoreId();
    const featured = [...new Set(dto.featured_service_ids ?? [])];
    const products = [...new Set(dto.product_ids ?? [])];

    await this.assertAll(
      onlineServicesWhere(storeId, featured),
      featured,
      ErrorCodes.STORE_APPS_006,
    );
    await this.assertAll(
      secondaryProductsWhere(storeId, products),
      products,
      ErrorCodes.STORE_APPS_002,
    );

    const row = await this.findRow(storeId);
    const config: ServicePageConfig = {
      ...parseServicePageConfig(row?.config),
      featured_service_ids: featured,
      product_ids: products,
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
          kind: 'service_page',
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

  async publish(dto: PublishServicePageDto): Promise<void> {
    const storeId = this.requireStoreId();
    const services = await this.prisma.products.count({
      where: onlineServicesWhere(storeId),
    });
    if (services === 0) {
      throw new VendixHttpException(ErrorCodes.STORE_APPS_007);
    }
    // Validate the target before releasing anything, so a rejected republish
    // leaves the current publication untouched.
    if (dto.custom_domain_id) {
      await this.domains.findTakeableCustomDomain(storeId, dto.custom_domain_id);
    }

    let row = await this.findRow(storeId);
    if (!row) {
      // Publishing with no config lists every online service by name.
      await this.prisma.store_apps.create({
        data: {
          store_id: storeId,
          kind: 'service_page',
          status: 'draft',
          config: this.toJson(parseServicePageConfig(null)),
        },
      });
      row = await this.findRow(storeId);
    }
    if (!row) throw new VendixHttpException(ErrorCodes.STORE_APPS_001);
    const config = parseServicePageConfig(row.config);

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

  async unpublish(): Promise<void> {
    const storeId = this.requireStoreId();
    const row = await this.findRow(storeId);
    if (!row || row.status !== 'published') return;

    const config = parseServicePageConfig(row.config);
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

  /** Throws `error` unless every id matches `where` in this store. */
  private async assertAll(
    where: Prisma.productsWhereInput,
    ids: number[],
    error: ErrorCodeEntry,
  ): Promise<void> {
    if (ids.length === 0) return;
    const found = await this.prisma.products.count({ where });
    if (found !== ids.length) throw new VendixHttpException(error);
  }

  private findRow(storeId: number) {
    return this.prisma.store_apps.findFirst({
      where: { store_id: storeId, kind: 'service_page' },
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

  private toJson(config: ServicePageConfig): Prisma.InputJsonValue {
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
