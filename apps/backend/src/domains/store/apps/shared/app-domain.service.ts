import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { DomainConfigService } from '@common/config/domain.config';
import { VendixHttpException } from '@common/errors/vendix-http.exception';
import { ErrorCodes } from '@common/errors/error-codes';

/** `app_type` values an app publishes on (plan S1/S5). */
export type PublishedAppType =
  | 'STORE_HOME'
  | 'STORE_PRODUCT_PAGE'
  | 'STORE_SERVICE_PAGE'
  | 'STORE_BOOKING';

/**
 * `app_type` values the store's primary `{tienda}-store` domain may carry
 * while the store home is off (`STORE_LANDING`) or on (`STORE_HOME`).
 */
const STORE_HOME_DOMAIN_APP_TYPES = ['STORE_LANDING', 'STORE_HOME'];

/** Custom domains that serve these apps are never taken over by an app. */
const PROTECTED_APP_TYPES = ['STORE_ECOMMERCE', 'STORE_ADMIN'];
const CUSTOM_OWNERSHIPS = ['custom_domain', 'custom_subdomain'] as const;

export interface AppCustomDomainView {
  id: number;
  hostname: string;
  status: string;
  app_type: string;
}

export interface AppDomainRef {
  id: number;
  hostname: string;
  ownership: string;
}

/**
 * Domain lifecycle shared by the Apps that publish on their own domain
 * (product page, service page, booking; plan S5).
 *
 * Tenant isolation: every store read goes through `StorePrismaService`
 * (auto-scoped) and filters by the `storeId` the caller took from the request
 * context. The only global read is the hostname collision check, which must
 * see every store's domains.
 *
 * Publishing creates and activates a Vendix subdomain (or takes over a custom
 * domain the owner picks); releasing disables the subdomain without deleting
 * it, so republishing reuses the same hostname, and gives a custom domain its
 * previous `app_type` back. Each transition emits the same `domain.*` events
 * the domains module emits, which clear the resolver and CORS caches.
 */
@Injectable()
export class AppDomainService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly globalPrisma: GlobalPrismaService,
    private readonly events: EventEmitter2,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  /** Custom domains of the store an app can be published on (S5.2). */
  async listCustomDomains(storeId: number): Promise<AppCustomDomainView[]> {
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

  /**
   * Activates a Vendix subdomain for the app. `buildHostname` receives the
   * store slug, the base domain and an `isTaken` check that ignores this
   * store's own earlier subdomains of the same app, so reactivation reuses
   * the existing row (S5.4) instead of burning `-2`.
   */
  async activateVendixHostname(
    storeId: number,
    appType: PublishedAppType,
    buildHostname: (
      storeSlug: string,
      baseDomain: string,
      isTaken: (hostname: string) => boolean,
    ) => string | null,
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
    const own = new Map<string, number>(
      (
        await this.prisma.domain_settings.findMany({
          where: {
            store_id: storeId,
            app_type: appType,
            ownership: 'vendix_subdomain',
          },
          select: { id: true, hostname: true },
        })
      ).map((d) => [d.hostname.toLowerCase(), d.id] as [string, number]),
    );
    const hostname = buildHostname(
      store?.slug ?? '',
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
        app_type: appType,
        // `store`, not `ecommerce`: the ecommerce, tables and product links
        // look up the store's ecommerce domain by `domain_type = 'ecommerce'`,
        // and an app domain must never be picked as the online store.
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

  /**
   * Points one of the store's custom domains to the app. Returns the domain
   * and the `app_type` it had before (`null` when it already served this
   * app), which the caller keeps to give it back on release.
   */
  async takeOverCustomDomain(
    storeId: number,
    domainId: number,
    appType: PublishedAppType,
  ): Promise<{ domain: { id: number; hostname: string }; previousAppType: string | null }> {
    const domain = await this.findTakeableCustomDomain(storeId, domainId);
    const previousAppType =
      String(domain.app_type) === appType ? null : String(domain.app_type);
    await this.prisma.domain_settings.update({
      where: { id: domain.id },
      data: { app_type: appType, updated_at: new Date() },
    });
    this.events.emit(
      domain.status === 'active' ? 'domain.activated' : 'domain.updated',
      { domainId: domain.id, hostname: domain.hostname, store_id: storeId },
    );
    return { domain, previousAppType };
  }

  /** A custom domain of this store that is not the online store or the admin. */
  async findTakeableCustomDomain(storeId: number, domainId: number) {
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
   * Gives the app's domain back: a Vendix subdomain is disabled (kept for
   * republishing), a custom domain recovers the app it served before.
   */
  async releaseDomain(
    domain: AppDomainRef | null,
    previousAppType: string | null | undefined,
  ): Promise<void> {
    if (!domain) return;
    if (domain.ownership === 'vendix_subdomain') {
      await this.setDomainStatus(domain.id, 'disabled');
    } else if (previousAppType) {
      await this.setAppType(domain, previousAppType);
    }
    await this.clearSeoCache(domain.hostname);
  }

  /**
   * The store's primary `{tienda}-store` domain (Fase 5, store home). It is
   * never created here: the store home only changes the `app_type` of the
   * domain the store already has, so the URL stays the same.
   */
  async findStoreHomeDomain(
    storeId: number,
  ): Promise<{ id: number; hostname: string; app_type: string }> {
    const domain = await this.prisma.domain_settings.findFirst({
      where: {
        store_id: storeId,
        is_primary: true,
        ownership: 'vendix_subdomain',
        app_type: { in: STORE_HOME_DOMAIN_APP_TYPES as any },
        status: { not: 'disabled' },
      },
      select: { id: true, hostname: true, app_type: true },
      orderBy: { id: 'asc' },
    });
    if (!domain) {
      throw new VendixHttpException(ErrorCodes.STORE_APPS_010);
    }
    return { ...domain, app_type: String(domain.app_type) };
  }

  /**
   * Changes which app a domain serves, keeping its hostname, status and
   * certificate, and clears the resolver caches like the domains module.
   */
  async setAppType(
    domain: { id: number; hostname: string },
    appType: string,
  ): Promise<void> {
    await this.prisma.domain_settings.update({
      where: { id: domain.id },
      data: { app_type: appType as any, updated_at: new Date() },
    });
    this.events.emit('domain.updated', {
      domainId: domain.id,
      hostname: domain.hostname,
    });
  }

  /** The sitemap and robots of an app's host are cached for an hour. */
  async clearSeoCache(hostname: string): Promise<void> {
    const host = hostname.toLowerCase();
    await Promise.all([
      this.cache.del(`seo:sitemap:${host}`),
      this.cache.del(`seo:robots:${host}`),
    ]);
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
}
