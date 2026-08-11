import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import { S3Service } from './s3.service';
import { S3PathHelper } from '../helpers/s3-path.helper';
import { pwaCacheKeysForHost } from '../config/pwa-cache-keys';

/**
 * 📱 PWA cache invalidation.
 *
 * The installable app icon is derived from the tenant branding and then cached
 * TWICE: as a PNG object in S3 (`{basePath}/branding/pwa/{variant}.png`) and as
 * a base64 payload in Redis. `S3Service.getOrCreatePwaIcon()` treats an existing
 * derived object as authoritative and never re-renders it, so without an
 * explicit drop a tenant that changes its logo keeps serving the OLD icon
 * forever — and the manifest keeps the old name and brand color for its TTL.
 *
 * Every method here is best-effort and never throws: dropping a cache must
 * never fail the settings write that triggered it. A tenant whose invalidation
 * silently failed recovers on the next logo change; a tenant whose SAVE failed
 * because of a cache is a support ticket.
 *
 * Note on what callers still cannot fix: an ALREADY INSTALLED PWA caches its
 * icon at install time. Refreshing these caches makes the new icon reach fresh
 * installs and the browser tab; existing installs need a reinstall.
 */
@Injectable()
export class PwaCacheService {
  private readonly logger = new Logger(PwaCacheService.name);

  constructor(
    private readonly globalPrisma: GlobalPrismaService,
    private readonly s3Service: S3Service,
    private readonly s3PathHelper: S3PathHelper,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  /**
   * Drops the manifest and icon caches for every hostname pointing at a store,
   * plus the icons derived under that store's S3 path.
   *
   * Call it after any write that changes what the manifest or the icon would
   * look like: `stores.logo_url`, `branding.logo_url`, `branding.favicon_url`,
   * `branding.primary_color`, `ecommerce.inicio.*` colors, or the store name.
   */
  async invalidateStore(storeId: number): Promise<void> {
    try {
      const store = await this.globalPrisma.stores.findUnique({
        where: { id: storeId },
        select: {
          id: true,
          slug: true,
          organizations: { select: { id: true, slug: true } },
        },
      });

      const basePath = store?.organizations
        ? this.s3PathHelper.buildStorePath(store.organizations, {
            id: store.id,
            slug: store.slug,
          })
        : null;

      await this.invalidate({ where: { store_id: storeId }, basePath });
    } catch (error) {
      this.warn(`store ${storeId}`, error);
    }
  }

  /**
   * Drops the manifest and icon caches for the organization's OWN hostnames
   * (ORG_LANDING / ORG_ADMIN), plus the icons derived under its S3 path.
   *
   * Scoped with `store_id: null` on purpose: a store subdomain resolves its
   * icon from the STORE branding, so it is untouched by an organization-level
   * branding change and must keep its warm cache.
   */
  async invalidateOrganization(organizationId: number): Promise<void> {
    try {
      const org = await this.globalPrisma.organizations.findUnique({
        where: { id: organizationId },
        select: { id: true, slug: true },
      });

      await this.invalidate({
        where: { organization_id: organizationId, store_id: null },
        basePath: org ? this.s3PathHelper.buildOrgPath(org) : null,
      });
    } catch (error) {
      this.warn(`organization ${organizationId}`, error);
    }
  }

  // ---------------------------------------------------------------------------

  private async invalidate(params: {
    where: Record<string, unknown>;
    basePath: string | null;
  }): Promise<void> {
    const { where, basePath } = params;

    const domains = await this.globalPrisma.domain_settings.findMany({
      where,
      select: { hostname: true },
    });

    const keys = domains
      .map((domain) => (domain.hostname ?? '').trim().toLowerCase())
      .filter(Boolean)
      .flatMap((hostname) => pwaCacheKeysForHost(hostname));

    // `Promise.allSettled`: one unreachable Redis key must not skip the rest,
    // and none of them must surface to the caller.
    await Promise.allSettled(keys.map((key) => this.cache.del(key)));

    const dropped = basePath
      ? await this.s3Service.deleteDerivedPwaIcons(basePath)
      : 0;

    this.logger.log(
      `PWA cache invalidated: ${domains.length} hostname(s), ` +
        `${keys.length} cache key(s), ${dropped} derived icon(s)`,
    );
  }

  private warn(scope: string, error: unknown): void {
    this.logger.warn(
      `PWA cache invalidation for ${scope} failed (the settings write itself ` +
        `succeeded): ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
