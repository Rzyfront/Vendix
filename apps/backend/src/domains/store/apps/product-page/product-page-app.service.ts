import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { DomainConfigService } from '@common/config/domain.config';
import { VendixHttpException } from '@common/errors/vendix-http.exception';
import { ErrorCodes } from '@common/errors/error-codes';
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
/** Custom domains that serve these apps are never taken over by the page. */
const PROTECTED_APP_TYPES = ['STORE_ECOMMERCE', 'STORE_ADMIN'];
const CUSTOM_OWNERSHIPS = ['custom_domain', 'custom_subdomain'] as const;

export interface ProductPageCustomDomainView {
  id: number;
  hostname: string;
  status: string;
  app_type: string;
}

/**
 * Apps · product page (plan S3/S5, Fase 2): config, publish and unpublish.
 *
 * Tenant isolation: the store comes from the request context; every store
 * read goes through `StorePrismaService` (auto-scoped). The only global read
 * is the hostname collision check, which must see every store's domains.
 *
 * Domains follow S5: publishing creates and activates
 * `{store}-{product}.{base}` (or takes over a custom domain the owner picks);
 * unpublishing disables it without deleting it, so republishing reuses the
 * same hostname. Each transition emits the same `domain.*` events the domains
 * module emits, which clear the resolver and CORS caches.
 */
@Injectable()
export class ProductPageAppService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly globalPrisma: GlobalPrismaService,
    private readonly events: EventEmitter2,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
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
      await this.clearSeoCache(row.domain_settings.hostname);
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
      await this.findTakeableCustomDomain(storeId, dto.custom_domain_id);
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
    await this.clearSeoCache(domain.hostname);
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
  async listCustomDomains(): Promise<ProductPageCustomDomainView[]> {
    const storeId = this.requireStoreId();
    const rows = await this.prisma.domain_settings.findMany({
      where: {
        store_id: storeId,
        ownership: { in: [...CUSTOM_OWNERSHIPS] },
        app_type: { notIn: PROTECTED_APP_TYPES as any },
        status: { not: 'disabled' },
      },
      select: { id: true, hostname: true, status: true, app_type: true },
      orderBy: { hostname: 'asc' },
    });
    return rows.map((row) => ({ ...row, app_type: String(row.app_type) }));
  }

  // ---------------------------------------------------------------------------

  /**
   * Activates `{store}-{product}.{base}`. The hostname always follows the
   * current featured product; reactivation reuses this store's existing row
   * for that hostname (S5.4) instead of creating a new one.
   */
  private async activateVendixHostname(
    storeId: number,
    productSlug: string,
  ): Promise<{ id: number; hostname: string }> {
    const store = await this.prisma.stores.findUnique({
      where: { id: storeId },
      select: { slug: true, organization_id: true },
    });
    const baseDomain = DomainConfigService.getBaseDomain();
    const taken = new Set(
      (
        await this.globalPrisma.domain_settings.findMany({
          where: { hostname: { endsWith: `.${baseDomain}` } },
          select: { hostname: true },
        })
      ).map((d) => d.hostname.toLowerCase()),
    );
    // This store's own earlier product page subdomains are not "taken": going
    // back to a product reuses its hostname instead of burning `-2`.
    const own = new Map(
      (
        await this.prisma.domain_settings.findMany({
          where: {
            store_id: storeId,
            app_type: APP_TYPE,
            ownership: 'vendix_subdomain',
          },
          select: { id: true, hostname: true },
        })
      ).map((d) => [d.hostname.toLowerCase(), d.id]),
    );
    const hostname = buildProductPageHostname(
      store?.slug ?? '',
      productSlug,
      baseDomain,
      (candidate) => taken.has(candidate) && !own.has(candidate),
    );
    if (!hostname) {
      throw new VendixHttpException(ErrorCodes.STORE_APPS_005);
    }
    const reusable = own.get(hostname);
    if (reusable !== undefined) {
      return this.setDomainStatus(reusable, 'active');
    }

    const created = await this.prisma.domain_settings.create({
      data: {
        hostname,
        store_id: storeId,
        organization_id: store?.organization_id ?? null,
        app_type: APP_TYPE,
        // `store`, not `ecommerce`: the ecommerce, tables and product links
        // look up the store's ecommerce domain by `domain_type = 'ecommerce'`,
        // and the product page must never be picked as the online store.
        domain_type: 'store',
        is_primary: false,
        ownership: 'vendix_subdomain',
        status: 'active',
        ssl_status: 'issued',
        config: {},
      },
      select: { id: true, hostname: true, organization_id: true, store_id: true },
    });
    this.events.emit('domain.activated', {
      domainId: created.id,
      hostname: created.hostname,
      organization_id: created.organization_id,
      store_id: created.store_id,
    });
    return created;
  }

  private async takeOverCustomDomain(
    storeId: number,
    domainId: number,
    config: ProductPageConfig,
  ): Promise<{ id: number; hostname: string }> {
    const domain = await this.findTakeableCustomDomain(storeId, domainId);

    config.custom_domain_previous_app_type =
      String(domain.app_type) === APP_TYPE ? null : String(domain.app_type);
    await this.prisma.domain_settings.update({
      where: { id: domain.id },
      data: { app_type: APP_TYPE, updated_at: new Date() },
    });
    this.events.emit(
      domain.status === 'active' ? 'domain.activated' : 'domain.updated',
      { domainId: domain.id, hostname: domain.hostname, store_id: storeId },
    );
    return domain;
  }

  /** A custom domain of this store that is not the online store or the admin. */
  private async findTakeableCustomDomain(storeId: number, domainId: number) {
    const domain = await this.prisma.domain_settings.findFirst({
      where: {
        id: domainId,
        store_id: storeId,
        ownership: { in: [...CUSTOM_OWNERSHIPS] },
        status: { not: 'disabled' },
      },
      select: { id: true, hostname: true, app_type: true, status: true },
    });
    if (!domain || PROTECTED_APP_TYPES.includes(String(domain.app_type))) {
      throw new VendixHttpException(ErrorCodes.STORE_APPS_005);
    }
    return domain;
  }

  /**
   * Gives the page's domain back: a Vendix subdomain is disabled (kept for
   * republishing), a custom domain recovers the app it served before.
   */
  private async releaseDomain(
    domain: { id: number; hostname: string; ownership: string } | null,
    config: ProductPageConfig,
  ): Promise<void> {
    if (!domain) return;
    if (domain.ownership === 'vendix_subdomain') {
      await this.setDomainStatus(domain.id, 'disabled');
    } else if (config.custom_domain_previous_app_type) {
      await this.prisma.domain_settings.update({
        where: { id: domain.id },
        data: {
          app_type: config.custom_domain_previous_app_type as any,
          updated_at: new Date(),
        },
      });
      this.events.emit('domain.updated', {
        domainId: domain.id,
        hostname: domain.hostname,
      });
    }
    await this.clearSeoCache(domain.hostname);
  }

  private async setDomainStatus(
    id: number,
    status: 'active' | 'disabled',
  ): Promise<{ id: number; hostname: string }> {
    const updated = await this.prisma.domain_settings.update({
      where: { id },
      data: { status, updated_at: new Date() },
      select: { id: true, hostname: true, organization_id: true, store_id: true },
    });
    this.events.emit(
      status === 'active' ? 'domain.activated' : 'domain.disabled',
      {
        domainId: updated.id,
        hostname: updated.hostname,
        organization_id: updated.organization_id,
        store_id: updated.store_id,
      },
    );
    return updated;
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

  /** The sitemap and robots of the page's host are cached for an hour. */
  private async clearSeoCache(hostname: string): Promise<void> {
    const host = hostname.toLowerCase();
    await Promise.all([
      this.cache.del(`seo:sitemap:${host}`),
      this.cache.del(`seo:robots:${host}`),
    ]);
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
