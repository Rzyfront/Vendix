import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors/vendix-http.exception';
import { ErrorCodes } from '@common/errors/error-codes';
import {
  AppCustomDomainView,
  AppDomainRef,
  AppDomainService,
} from '../shared/app-domain.service';
import { buildProductPageHostname } from './product-page-hostname';
import {
  MAX_COMPLEMENTS,
  ProductPageConfig,
  parseProductPageConfig,
  sellableProductsWhere,
} from './product-page.reader';
import {
  PublishProductPageDto,
  UpdateProductPageConfigDto,
} from './product-page.dto';

const APP_TYPE = 'STORE_PRODUCT_PAGE';

/**
 * Apps · product page (plan S3/S5, Fase 2): config, publish and unpublish.
 *
 * Tenant isolation: the store comes from the request context; every store
 * read goes through `StorePrismaService` (auto-scoped).
 *
 * Domains follow S5 through `AppDomainService`: publishing creates and
 * activates `{store}-{product}.{base}` (or takes over a custom domain the
 * owner picks); unpublishing disables it without deleting it, so
 * republishing reuses the same hostname.
 */
@Injectable()
export class ProductPageAppService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly domains: AppDomainService,
  ) {}

  async updateConfig(dto: UpdateProductPageConfigDto): Promise<void> {
    const storeId = this.requireStoreId();
    const complementIds = [...new Set(dto.complement_product_ids ?? [])].filter(
      (id) => id !== dto.product_id,
    );
    if (complementIds.length > MAX_COMPLEMENTS) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        `At most ${MAX_COMPLEMENTS} complements`,
      );
    }
    await this.assertSellable(storeId, [dto.product_id, ...complementIds]);

    const row = await this.findRow(storeId);
    const current = parseProductPageConfig(row?.config);
    // The Vendix hostname is built from the featured product; a custom domain
    // is not, so only the former locks the product while published.
    const onVendixHostname =
      row?.status === 'published' &&
      row.domain_settings?.ownership === 'vendix_subdomain';
    if (onVendixHostname && current.product_id !== dto.product_id) {
      throw new VendixHttpException(ErrorCodes.STORE_APPS_004);
    }

    const config: ProductPageConfig = {
      ...current,
      product_id: dto.product_id,
      complement_product_ids: complementIds,
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
          kind: 'product_page',
          status: 'draft',
          config: this.toJson(config),
        },
      });
    }

    if (row?.status === 'published' && row.domain_settings) {
      await this.domains.clearSeoCache(row.domain_settings.hostname);
    }
  }

  async publish(dto: PublishProductPageDto): Promise<void> {
    const storeId = this.requireStoreId();
    const row = await this.findRow(storeId);
    const config = parseProductPageConfig(row?.config);
    if (!row || config.product_id === null) {
      throw new VendixHttpException(ErrorCodes.STORE_APPS_003);
    }
    const product = await this.assertSellable(storeId, [config.product_id]);
    // Validate the target before releasing anything, so a rejected republish
    // leaves the current publication untouched.
    if (dto.custom_domain_id) {
      await this.domains.findTakeableCustomDomain(storeId, dto.custom_domain_id);
    }

    // Republishing an already published page on a different domain first
    // releases the current one, so a store never serves two product pages.
    if (row.status === 'published') {
      await this.releaseDomain(row.domain_settings, config);
      config.custom_domain_previous_app_type = null;
    }

    const domain = dto.custom_domain_id
      ? await this.takeOverCustomDomain(storeId, dto.custom_domain_id, config)
      : await this.activateVendixHostname(storeId, product[0].slug);

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

    const config = parseProductPageConfig(row.config);
    await this.releaseDomain(row.domain_settings, config);
    config.custom_domain_previous_app_type = null;

    await this.prisma.store_apps.update({
      where: { id: row.id },
      data: {
        status: 'disabled',
        config: this.toJson(config),
        updated_at: new Date(),
      },
    });
  }

  /** Custom domains of the store the owner can publish the page on (S5.2). */
  async listCustomDomains(): Promise<AppCustomDomainView[]> {
    return this.domains.listCustomDomains(this.requireStoreId());
  }

  // ---------------------------------------------------------------------------

  /**
   * Activates `{store}-{product}.{base}`. The hostname always follows the
   * current featured product; going back to a product reuses its hostname.
   */
  private activateVendixHostname(storeId: number, productSlug: string) {
    return this.domains.activateVendixHostname(
      storeId,
      APP_TYPE,
      (storeSlug, baseDomain, isTaken) =>
        buildProductPageHostname(storeSlug, productSlug, baseDomain, isTaken),
    );
  }

  private async takeOverCustomDomain(
    storeId: number,
    domainId: number,
    config: ProductPageConfig,
  ): Promise<{ id: number; hostname: string }> {
    const { domain, previousAppType } = await this.domains.takeOverCustomDomain(
      storeId,
      domainId,
      APP_TYPE,
    );
    config.custom_domain_previous_app_type = previousAppType;
    return domain;
  }

  private releaseDomain(
    domain: AppDomainRef | null,
    config: ProductPageConfig,
  ): Promise<void> {
    return this.domains.releaseDomain(
      domain,
      config.custom_domain_previous_app_type,
    );
  }

  /** Returns the rows in input order; throws if any id is not sellable. */
  private async assertSellable(storeId: number, ids: number[]) {
    const rows = await this.prisma.products.findMany({
      where: sellableProductsWhere(storeId, ids),
      select: { id: true, slug: true },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const ordered = ids.map((id) => byId.get(id));
    if (ordered.some((row) => !row)) {
      throw new VendixHttpException(ErrorCodes.STORE_APPS_002);
    }
    return ordered as { id: number; slug: string }[];
  }

  private findRow(storeId: number) {
    return this.prisma.store_apps.findFirst({
      where: { store_id: storeId, kind: 'product_page' },
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

  private toJson(config: ProductPageConfig): Prisma.InputJsonValue {
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
