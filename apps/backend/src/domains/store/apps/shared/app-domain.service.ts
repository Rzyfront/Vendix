import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { DomainConfigService } from '@common/config/domain.config';
import { VendixHttpException } from '@common/errors/vendix-http.exception';
import { ErrorCodes } from '@common/errors/error-codes';
import {
  AppDomainAlias,
  PROTECTED_APP_TYPES,
  parseAppDomainAliases,
  withAlias,
  withoutAlias,
} from './app-domain-aliases';

/** `app_type` values an app publishes on (plan S1/S5). */
export type PublishedAppType =
  | 'STORE_HOME'
  // Landing page (Fase 6): its own `{tienda}-landing` domain serves the same
  // landing the store already renders under `STORE_LANDING`.
  | 'STORE_LANDING'
  | 'STORE_PRODUCT_PAGE'
  | 'STORE_SERVICE_PAGE'
  | 'STORE_BOOKING';

/**
 * `app_type` values the store's primary `{tienda}-store` domain may carry
 * while the store home is off (`STORE_LANDING`) or on (`STORE_HOME`).
 */
const STORE_HOME_DOMAIN_APP_TYPES = ['STORE_LANDING', 'STORE_HOME'];

const CUSTOM_OWNERSHIPS = ['custom_domain', 'custom_subdomain'] as const;

/** Hostnames tried when concurrent publishes keep taking the next name. */
const MAX_CREATE_ATTEMPTS = 5;

/**
 * Builds the app's Vendix hostname from the store slug and base domain;
 * `isTaken` says whether a candidate is used by someone else.
 */
export type HostnameBuilder = (
  storeSlug: string,
  baseDomain: string,
  isTaken: (hostname: string) => boolean,
) => string | null;

/**
 * Whether the app's earlier subdomain may be reactivated as-is. Apps with a
 * fixed suffix always keep it; the product page only while it names the
 * same product.
 */
export type ReusePrevious = (
  hostname: string,
  storeSlug: string,
  baseDomain: string,
) => boolean;

/** Postgres unique violation surfaced by Prisma (`P2002`). */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

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

/** What an app row knows about its domains (Apps F5). */
export interface AppDomainState {
  /** `store_apps.domain_settings`: the primary domain. */
  primary: AppDomainRef | null;
  published: boolean;
  /**
   * Before F5 an app could be published with a custom domain as its only
   * (primary) domain; this is the `app_type` that domain had before.
   */
  legacyPreviousAppType: string | null;
  aliases: AppDomainAlias[];
}

/** Builds the {@link AppDomainState} of an app row and its parsed config. */
export function appDomainState(
  row: { status: string; domain_settings: AppDomainRef | null },
  config: {
    custom_domain_previous_app_type?: string | null;
    custom_domain_aliases?: AppDomainAlias[];
  },
): AppDomainState {
  return {
    primary: row.domain_settings,
    published: row.status === 'published',
    legacyPreviousAppType: config.custom_domain_previous_app_type ?? null,
    aliases: config.custom_domain_aliases ?? [],
  };
}

export interface PublishedAppDomains {
  primary: { id: number; hostname: string };
  aliases: AppDomainAlias[];
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
   * Activates a Vendix subdomain for the app and never fails because a name
   * is taken (Apps F5, Rafael's rule):
   *
   * 1. the app's own earlier subdomain (`previous`, usually the disabled one
   *    an unpublish left) is reactivated when `canReusePrevious` accepts it,
   *    so republishing never creates a second domain or leaves an orphan;
   * 2. otherwise `buildHostname` picks a free hostname. Its `isTaken` check
   *    ignores this store's own earlier subdomains of the same app, so an
   *    old row with that name is reactivated instead of burning `-2`;
   * 3. a hostname another request took meanwhile (unique violation) is
   *    marked as taken and the next free one is tried.
   */
  async activateVendixHostname(
    storeId: number,
    appType: PublishedAppType,
    buildHostname: HostnameBuilder,
    previous: AppDomainRef | null = null,
    canReusePrevious: ReusePrevious = () => true,
  ): Promise<{ id: number; hostname: string }> {
    const store = await this.prisma.stores.findUnique({
      where: { id: storeId },
      select: { slug: true, organization_id: true },
    });
    const storeSlug = store?.slug ?? '';
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

    if (
      previous &&
      previous.ownership === 'vendix_subdomain' &&
      own.get(previous.hostname.toLowerCase()) === previous.id &&
      canReusePrevious(previous.hostname, storeSlug, baseDomain)
    ) {
      const reactivated = await this.reactivate(previous.id);
      if (reactivated) return reactivated;
      own.delete(previous.hostname.toLowerCase());
      taken.add(previous.hostname.toLowerCase());
    }

    for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt++) {
      const hostname = buildHostname(
        storeSlug,
        baseDomain,
        (candidate) => taken.has(candidate) && !own.has(candidate),
      );
      if (!hostname) {
        throw new VendixHttpException(ErrorCodes.STORE_APPS_018);
      }
      const reusable = own.get(hostname);
      if (reusable !== undefined) {
        const reactivated = await this.reactivate(reusable);
        if (reactivated) return reactivated;
        own.delete(hostname);
        taken.add(hostname);
        continue;
      }

      let created: {
        id: number;
        hostname: string;
        organization_id: number | null;
        store_id: number | null;
      };
      try {
        created = await this.prisma.domain_settings.create({
          data: {
            hostname,
            store_id: storeId,
            organization_id: store?.organization_id ?? null,
            app_type: appType,
            // `store`, not `ecommerce`: the ecommerce, tables and product
            // links look up the store's ecommerce domain by
            // `domain_type = 'ecommerce'`, and an app domain must never be
            // picked as the online store.
            domain_type: 'store',
            is_primary: false,
            ownership: 'vendix_subdomain',
            status: 'active',
            ssl_status: 'issued',
            config: {},
          },
          select: { id: true, hostname: true, organization_id: true, store_id: true },
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        taken.add(hostname);
        // A concurrent publish of this same app may have just created this
        // exact hostname: adopt it instead of leaving a second subdomain
        // (the -2) next to it, orphaned from the app.
        const raced = await this.prisma.domain_settings.findFirst({
          where: {
            hostname,
            store_id: storeId,
            app_type: appType,
            ownership: 'vendix_subdomain',
          },
          select: { id: true, hostname: true },
        });
        if (raced) {
          this.events.emit('domain.activated', {
            domainId: raced.id,
            hostname: raced.hostname,
            store_id: storeId,
          });
          return raced;
        }
        continue;
      }
      this.events.emit('domain.activated', {
        domainId: created.id,
        hostname: created.hostname,
        organization_id: created.organization_id,
        store_id: created.store_id,
      });
      return created;
    }
    throw new VendixHttpException(ErrorCodes.STORE_APPS_018);
  }

  /**
   * Activates one of the app's own subdomains; `null` when another active
   * domain took the same hostname while this one was disabled.
   */
  private async reactivate(
    id: number,
  ): Promise<{ id: number; hostname: string } | null> {
    try {
      return await this.setDomainStatus(id, 'active');
    } catch (error) {
      if (isUniqueViolation(error)) return null;
      throw error;
    }
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
   * Apps F5: publishes the app on its Vendix subdomain (always, the primary
   * domain) and, when `customDomainId` is given, adds that custom domain as
   * an alias. Existing aliases are kept. When the subdomain changes (product
   * page with another product) the old one is disabled; a pre-F5 publication
   * whose primary was a custom domain keeps that domain as an alias.
   *
   * The custom domain is validated before anything changes, so a rejected
   * publish leaves the current publication untouched.
   */
  async publishOnDomains(
    storeId: number,
    appType: PublishedAppType,
    state: AppDomainState,
    customDomainId: number | null | undefined,
    buildHostname: HostnameBuilder,
    canReusePrevious: ReusePrevious = () => true,
  ): Promise<PublishedAppDomains> {
    if (customDomainId) {
      await this.findTakeableCustomDomain(storeId, customDomainId);
    }

    const primary = await this.activateVendixHostname(
      storeId,
      appType,
      buildHostname,
      state.primary,
      canReusePrevious,
    );
    let aliases = [...state.aliases];

    const previous = state.published ? state.primary : null;
    if (previous && previous.id !== primary.id) {
      if (previous.ownership === 'vendix_subdomain') {
        await this.setDomainStatus(previous.id, 'disabled');
        await this.clearSeoCache(previous.hostname);
      } else {
        const legacy = await this.prisma.domain_settings.findFirst({
          where: { id: previous.id, store_id: storeId },
          select: { app_type: true, status: true },
        });
        if (
          legacy &&
          legacy.status !== 'disabled' &&
          String(legacy.app_type) === appType
        ) {
          // Legacy (pre-F5) publish: the custom domain already served this
          // app and no previous type was recorded. Record the current type so
          // releasing it leaves the customer's verified domain untouched,
          // exactly as before F5, instead of disabling it.
          aliases = withAlias(aliases, {
            domain_id: previous.id,
            previous_app_type: state.legacyPreviousAppType ?? appType,
          });
        }
      }
    }

    if (customDomainId) {
      const taken = await this.takeOverCustomDomain(
        storeId,
        customDomainId,
        appType,
      );
      // Already serving this app: keep the app_type recorded the first time.
      if (taken.previousAppType !== null) {
        aliases = [
          ...withoutAlias(aliases, customDomainId),
          { domain_id: customDomainId, previous_app_type: taken.previousAppType },
        ];
      } else {
        // It already served this app type before (e.g. a store landing on a
        // custom domain): record that, so releasing it changes nothing.
        aliases = withAlias(aliases, {
          domain_id: customDomainId,
          previous_app_type: appType,
        });
      }
      await this.clearSeoCache(taken.domain.hostname);
    }

    return { primary, aliases };
  }

  /**
   * Apps F5: unpublishing releases the primary domain and every alias. A
   * domain someone pointed to another app in the meantime is left alone.
   */
  async releaseAppDomains(
    storeId: number,
    appType: PublishedAppType,
    state: AppDomainState,
  ): Promise<void> {
    await this.releaseDomain(state.primary, state.legacyPreviousAppType);
    for (const alias of state.aliases) {
      await this.releaseAlias(storeId, appType, alias);
    }
  }

  /**
   * An alias recovers the app it served before; without a known previous
   * app it is disabled (kept, never deleted). An alias that already served
   * this app type before is left as it is.
   */
  async releaseAlias(
    storeId: number,
    appType: string,
    alias: AppDomainAlias,
  ): Promise<void> {
    const domain = await this.prisma.domain_settings.findFirst({
      where: { id: alias.domain_id, store_id: storeId },
      select: { id: true, hostname: true, app_type: true, status: true },
    });
    if (
      !domain ||
      domain.status === 'disabled' ||
      String(domain.app_type) !== appType
    ) {
      return;
    }
    if (!alias.previous_app_type || alias.previous_app_type === appType) {
      // It served this app type before the app took it (or the record is
      // legacy and has no previous type): leave it as it was. A verified
      // customer domain is never disabled by unpublishing an app.
    } else {
      await this.setAppType(domain, alias.previous_app_type);
    }
    await this.clearSeoCache(domain.hostname);
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
   * The store's primary `{tienda}-store` domain (Fase 5, store home), or
   * `null` when the store has none active. The store home only changes the
   * `app_type` of that domain, so the URL stays the same.
   */
  async findStoreHomeDomain(
    storeId: number,
  ): Promise<{ id: number; hostname: string; app_type: string } | null> {
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
    return domain ? { ...domain, app_type: String(domain.app_type) } : null;
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

  /**
   * Apps F5: clears the SEO cache of the app's primary host and of every
   * alias recorded in its config (`rawConfig` = `store_apps.config`).
   */
  async clearAppSeoCache(
    storeId: number,
    primaryHostname: string,
    rawConfig: unknown,
  ): Promise<void> {
    const ids = parseAppDomainAliases(rawConfig).map((a) => a.domain_id);
    const aliases = ids.length
      ? await this.prisma.domain_settings.findMany({
          where: { id: { in: ids }, store_id: storeId },
          select: { hostname: true },
        })
      : [];
    await Promise.all(
      [primaryHostname, ...aliases.map((a) => a.hostname)].map((host) =>
        this.clearSeoCache(host),
      ),
    );
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
