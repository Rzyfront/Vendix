import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { PublicDomainsService } from '../domains/public-domains.service';
import { DomainConfigService } from '@common/config/domain.config';
import { S3Service } from '@common/services/s3.service';
import { S3PathHelper } from '@common/helpers/s3-path.helper';
import { PwaIconVariant } from '@common/config/image-presets';
import {
  pwaIconCacheKey,
  pwaManifestCacheKey,
} from '@common/config/pwa-cache-keys';
import { extractS3KeyFromUrl } from '@common/helpers/s3-url.helper';
import {
  VENDIX_APPLE_TOUCH_180_BASE64,
  VENDIX_ICON_192_BASE64,
  VENDIX_ICON_512_BASE64,
} from './assets/vendix-brand-icons';

/**
 * Vendix brand green. Used as `theme_color` / `background_color` and as the
 * opaque canvas behind a derived tenant icon when the tenant has no branding
 * color configured.
 */
const DEFAULT_THEME_COLOR = '#2F6F4E';

/** Cache TTL, in ms, for both the manifest and the resolved icon binaries. */
const PWA_CACHE_TTL_MS = 300_000;

/**
 * Manifest icon entries. `src` is ALWAYS a same-origin relative path served by
 * `GET /pwa/:asset`, never a signed S3 URL: presigned URLs expire in 24h and
 * the installed app would silently lose its icon (the defect this closes).
 */
const MANIFEST_ICONS: ReadonlyArray<Record<string, string>> = [
  {
    src: '/pwa/icon-192.png',
    sizes: '192x192',
    type: 'image/png',
    purpose: 'any',
  },
  {
    src: '/pwa/icon-512.png',
    sizes: '512x512',
    type: 'image/png',
    purpose: 'any',
  },
  {
    src: '/pwa/icon-maskable-512.png',
    sizes: '512x512',
    type: 'image/png',
    purpose: 'maskable',
  },
  {
    src: '/pwa/apple-touch-icon-180.png',
    sizes: '180x180',
    type: 'image/png',
    purpose: 'any',
  },
];

interface PwaDomainContext {
  app_type: string;
  hostname: string;
  store_id?: number;
  organization_id?: number;
  store_name?: string;
  organization_name?: string;
  primary_color?: string;
}

interface PwaLogoSource {
  /** Raw (unsigned) S3 key of the tenant branding asset. */
  logo_key: string;
  /** Tenant S3 base path where the derived icon is cached. */
  base_path: string;
}

/** Cached icon payload. `b64 === null` means "serve the Vendix brand icon". */
interface CachedPwaIcon {
  b64: string | null;
}

/**
 * 📱 Public PWA Service
 *
 * Serves the per-tenant Web App Manifest and its icon binaries from the
 * backend, resolved by hostname.
 *
 * Two hard rules, both of which are the reason this service exists:
 *  1. NOTHING in the manifest body may be a signed S3 URL. Icons are relative
 *     same-origin paths, so the installed app never depends on a credential
 *     that expires.
 *  2. `resolveIconBuffer()` NEVER fails: a tenant with no usable logo installs
 *     with the Vendix brand icon rather than with a broken image.
 */
@Injectable()
export class PublicPwaService {
  private readonly logger = new Logger(PublicPwaService.name);

  constructor(
    private readonly globalPrisma: GlobalPrismaService,
    private readonly publicDomainsService: PublicDomainsService,
    private readonly s3Service: S3Service,
    private readonly s3PathHelper: S3PathHelper,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Builds the Web App Manifest for a hostname.
   *
   * The `icons` array is identical whether or not the tenant has a logo — when
   * it does not, it is `resolveIconBuffer()` that answers with the Vendix
   * brand. That keeps the manifest cacheable and the install prompt stable.
   */
  async buildManifest(hostname: string): Promise<Record<string, unknown>> {
    const host = this.normalizeHostname(hostname);
    const cacheKey = pwaManifestCacheKey(host);

    const cached = await this.cache.get<Record<string, unknown>>(cacheKey);
    if (cached) return cached;

    const context = await this.resolveDomainContext(host);
    const themeColor = this.resolveThemeColor(context);

    const manifest: Record<string, unknown> = {
      id: '/',
      name: this.resolveTenantName(context),
      short_name: this.resolveTenantName(context),
      start_url: `https://${host}/`,
      scope: `https://${host}/`,
      display: 'standalone',
      theme_color: themeColor,
      background_color: themeColor,
      icons: MANIFEST_ICONS.map((icon) => ({ ...icon })),
    };

    await this.cache.set(cacheKey, manifest, PWA_CACHE_TTL_MS);
    this.logger.log(`PWA manifest built for ${host} (${context.app_type})`);

    return manifest;
  }

  /**
   * Resolves the PNG binary for a manifest icon variant.
   *
   * Never throws and never returns an empty buffer: any failure degrades to
   * the Vendix brand icon.
   */
  async resolveIconBuffer(
    hostname: string,
    variant: PwaIconVariant,
  ): Promise<{ buffer: Buffer; fromTenant: boolean }> {
    const host = this.normalizeHostname(hostname);
    const cacheKey = pwaIconCacheKey(host, variant);

    try {
      const cached = await this.cache.get<CachedPwaIcon>(cacheKey);
      if (cached) {
        return cached.b64
          ? { buffer: Buffer.from(cached.b64, 'base64'), fromTenant: true }
          : { buffer: this.getBrandIconBuffer(variant), fromTenant: false };
      }

      const context = await this.resolveDomainContext(host);
      const source = await this.resolveTenantLogoSource(context);

      if (source) {
        const buffer = await this.s3Service.getOrCreatePwaIcon(
          source.logo_key,
          source.base_path,
          variant,
          this.resolveThemeColor(context),
        );

        if (buffer?.length) {
          await this.cache.set(
            cacheKey,
            { b64: buffer.toString('base64') } satisfies CachedPwaIcon,
            PWA_CACHE_TTL_MS,
          );
          return { buffer, fromTenant: true };
        }
      }

      // No usable branding asset (or an empty derivation): remember the
      // fallback decision so the next request skips the DB/S3 round-trip.
      await this.cache.set(
        cacheKey,
        { b64: null } satisfies CachedPwaIcon,
        PWA_CACHE_TTL_MS,
      );
    } catch (error) {
      this.logger.warn(
        `PWA icon "${variant}" for ${host} fell back to the Vendix brand: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return { buffer: this.getBrandIconBuffer(variant), fromTenant: false };
  }

  /**
   * The Vendix brand PNG for a variant. Public so the HTTP layer can still
   * answer with a valid icon if anything above it fails.
   */
  getBrandIconBuffer(variant: PwaIconVariant): Buffer {
    // Lazily decoded once per process; the base64 blobs are embedded assets.
    if (!PublicPwaService.brandIcons) {
      PublicPwaService.brandIcons = {
        'icon-192': Buffer.from(VENDIX_ICON_192_BASE64, 'base64'),
        'icon-512': Buffer.from(VENDIX_ICON_512_BASE64, 'base64'),
        'icon-maskable-512': Buffer.from(VENDIX_ICON_512_BASE64, 'base64'),
        'apple-touch-icon-180': Buffer.from(
          VENDIX_APPLE_TOUCH_180_BASE64,
          'base64',
        ),
      };
    }

    return (
      PublicPwaService.brandIcons[variant] ??
      PublicPwaService.brandIcons['icon-512']
    );
  }

  private static brandIcons: Record<PwaIconVariant, Buffer> | null = null;

  // ---------------------------------------------------------------------------
  // Tenant resolution
  // ---------------------------------------------------------------------------

  private async resolveDomainContext(
    hostname: string,
  ): Promise<PwaDomainContext> {
    try {
      const domain = await this.publicDomainsService.resolveDomain(hostname);

      return {
        app_type: domain.app ?? 'VENDIX_LANDING',
        hostname,
        store_id: domain.store_id,
        organization_id: domain.organization_id,
        store_name: domain.store_name,
        organization_name: domain.organization_name,
        // Only the COLOR is taken from this call. The logo it returns is
        // signed (24h expiry) and must never reach the manifest or an icon.
        primary_color: (domain.branding as { primary_color?: string } | null)
          ?.primary_color,
      };
    } catch {
      this.logger.warn(
        `Domain resolution failed for ${hostname}, falling back to vendix`,
      );
    }

    return this.resolveVendixCoreFallback(hostname);
  }

  private async resolveVendixCoreFallback(
    hostname: string,
  ): Promise<PwaDomainContext> {
    const org = await this.globalPrisma.organizations.findFirst({
      where: { slug: 'vendix' },
      select: { id: true, name: true },
    });

    return {
      app_type: 'VENDIX_LANDING',
      hostname: hostname || DomainConfigService.getBaseDomain(),
      organization_id: org?.id,
      organization_name: org?.name,
    };
  }

  /**
   * Picks the tenant branding asset to derive the app icon from, reading RAW
   * (unsigned) S3 keys straight from the database.
   *
   * Precedence — first candidate that is also a branding asset wins:
   *   store domains: stores.logo_url → branding.logo_url →
   *                  ecommerce.inicio.logo_url → branding.favicon_url
   *   org domains:   branding.logo_url → branding.favicon_url
   *
   * The `isBrandingAssetKey` filter is load-bearing: without it the ecommerce
   * cascade happily picks a slider photo (a storefront banner) as the app icon.
   */
  private async resolveTenantLogoSource(
    context: PwaDomainContext,
  ): Promise<PwaLogoSource | null> {
    if (context.store_id) {
      const store = await this.globalPrisma.stores.findUnique({
        where: { id: context.store_id },
        select: {
          id: true,
          slug: true,
          logo_url: true,
          organizations: { select: { id: true, slug: true } },
        },
      });

      if (!store?.organizations) return null;

      const settings = await this.globalPrisma.store_settings.findUnique({
        where: { store_id: context.store_id },
        select: { settings: true },
      });
      const data = (settings?.settings ?? {}) as Record<string, any>;

      const logo_key = this.pickBrandingKey([
        store.logo_url,
        data?.branding?.logo_url,
        data?.ecommerce?.inicio?.logo_url,
        data?.branding?.favicon_url,
      ]);
      if (!logo_key) return null;

      return {
        logo_key: await this.preferLargestFaviconVariant(logo_key),
        base_path: this.s3PathHelper.buildStorePath(store.organizations, {
          id: store.id,
          slug: store.slug,
        }),
      };
    }

    if (context.organization_id) {
      const org = await this.globalPrisma.organizations.findUnique({
        where: { id: context.organization_id },
        select: { id: true, slug: true },
      });
      if (!org) return null;

      const settings =
        await this.globalPrisma.organization_settings.findUnique({
          where: { organization_id: context.organization_id },
          select: { settings: true },
        });
      const data = (settings?.settings ?? {}) as Record<string, any>;

      const logo_key = this.pickBrandingKey([
        data?.branding?.logo_url,
        data?.branding?.favicon_url,
      ]);
      if (!logo_key) return null;

      return {
        logo_key: await this.preferLargestFaviconVariant(logo_key),
        base_path: this.s3PathHelper.buildOrgPath(org),
      };
    }

    return null;
  }

  /**
   * Swaps a small favicon for the largest sibling variant that actually exists.
   *
   * `generateAndUploadFaviconFromLogo` writes `favicon-16/32/192.png` side by
   * side but records only the 16px one in `branding.favicon_url`. For a tenant
   * whose ONLY branding asset is that favicon (no logo), deriving a 512px app
   * icon from 16px is a 32x upscale — an unreadable smear. The 192px sibling is
   * already sitting next to it.
   *
   * Existence is checked rather than assumed: rows predating the multi-size
   * generator have only the 16px file, and a key pointing at a missing object
   * would fail the whole derivation.
   */
  private async preferLargestFaviconVariant(key: string): Promise<string> {
    const match = key.match(/^(.*\/)favicon-(\d+)\.png$/i);
    if (!match) return key;

    const [, directory, sizeText] = match;
    const currentSize = Number(sizeText);
    if (!Number.isFinite(currentSize)) return key;

    for (const candidateSize of PublicPwaService.FAVICON_SIZES_DESC) {
      if (candidateSize <= currentSize) break;

      const candidate = `${directory}favicon-${candidateSize}.png`;
      if (
        this.s3PathHelper.isBrandingAssetKey(candidate) &&
        (await this.s3Service.objectExists(candidate))
      ) {
        return candidate;
      }
    }

    return key;
  }

  /** Sizes emitted by `generateAndUploadFaviconFromLogo`, largest first. */
  private static readonly FAVICON_SIZES_DESC = [192, 32] as const;

  /** First candidate that normalizes to a safe, branding-scoped S3 key. */
  private pickBrandingKey(candidates: unknown[]): string | null {
    for (const candidate of candidates) {
      if (typeof candidate !== 'string' || !candidate.trim()) continue;

      // Tolerates legacy rows that stored a full (possibly signed) S3 URL.
      const key = extractS3KeyFromUrl(candidate);
      if (!key) continue;

      // An external CDN URL survives extraction unchanged: not our bucket.
      if (/^https?:\/\//i.test(key)) continue;

      if (!this.s3PathHelper.isBrandingAssetKey(key)) continue;

      return key;
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** STORE_* → store name, ORG_* → organization name, anything else → Vendix. */
  private resolveTenantName(context: PwaDomainContext): string {
    if (context.app_type?.startsWith('STORE_')) {
      return context.store_name?.trim() || 'Vendix';
    }
    if (context.app_type?.startsWith('ORG_')) {
      return context.organization_name?.trim() || 'Vendix';
    }
    return 'Vendix';
  }

  private resolveThemeColor(context: PwaDomainContext): string {
    const color = context.primary_color?.trim();
    return color && /^#[0-9a-fA-F]{3,8}$/.test(color)
      ? color
      : DEFAULT_THEME_COLOR;
  }

  /**
   * The hostname arrives from a client-controlled `Host` header and is used as
   * a cache key and inside `start_url`/`scope`, so it is normalized to a bare,
   * lowercase, port-less host with no unexpected characters.
   */
  private normalizeHostname(hostname: string): string {
    const normalized = (hostname ?? '')
      .toString()
      .trim()
      .toLowerCase()
      .split(':')[0]
      .replace(/[^a-z0-9.-]/g, '');

    return normalized || DomainConfigService.getBaseDomain();
  }
}
