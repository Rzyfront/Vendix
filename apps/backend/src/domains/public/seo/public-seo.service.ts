import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { PublicDomainsService } from '../domains/public-domains.service';
import { DomainConfigService } from '@common/config/domain.config';
import { normalizeHostname } from '@common/utils/tenant-hostname.util';
import { isValidSlug } from '@common/utils/slug.util';
import { MARKETING_SITEMAP_PAGES, marketingSitemapVersion } from './marketing-sitemap.registry';

interface DomainContext {
  app_type: string;
  base_url: string;
  store_id?: number;
  organization_id?: number;
}

@Injectable()
export class PublicSeoService {
  private readonly logger = new Logger(PublicSeoService.name);

  constructor(
    private readonly globalPrisma: GlobalPrismaService,
    private readonly publicDomainsService: PublicDomainsService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  async generateSitemap(hostname: string): Promise<string> {
    // This value becomes a Redis key AND the emitted `base_url`, so its shape is
    // guaranteed at the entry point rather than trusted from the caller:
    // `resolveDomain` matches case-insensitively and does not strip the port, so
    // unnormalized variants resolve to the SAME tenant while each spawns its own
    // cache entry carrying a full sitemap build.
    hostname =
      normalizeHostname(hostname) || DomainConfigService.getBaseDomain();

    const baseDomain = DomainConfigService.getBaseDomain();
    const isMarketingHost = hostname === baseDomain || hostname === `www.${baseDomain}`;
    const cacheKey = isMarketingHost
      ? `seo:sitemap:${hostname}:marketing:${marketingSitemapVersion()}`
      : `seo:sitemap:${hostname}`;
    const cached = await this.cache.get<string>(cacheKey);
    if (cached) return cached;

    const context = await this.resolveDomainContext(hostname);
    let xml: string;

    switch (context.app_type) {
      case 'VENDIX_LANDING':
        xml = this.buildVendixLandingSitemap(context.base_url);
        break;
      case 'ORG_LANDING':
        xml = await this.buildOrgLandingSitemap(context);
        break;
      case 'STORE_ECOMMERCE':
        xml = await this.buildEcommerceSitemap(context);
        break;
      default:
        // Admin panels and other private apps — minimal sitemap
        xml = this.buildMinimalSitemap(context.base_url);
        break;
    }

    await this.cache.set(cacheKey, xml, 3_600_000);
    this.logger.log(`Sitemap generated for ${hostname} (${context.app_type})`);

    return xml;
  }

  async generateRobotsTxt(hostname: string): Promise<string> {
    // Same contract as generateSitemap: normalize before it becomes a cache key.
    hostname =
      normalizeHostname(hostname) || DomainConfigService.getBaseDomain();

    const cacheKey = `seo:robots:${hostname}`;
    const cached = await this.cache.get<string>(cacheKey);
    if (cached) return cached;

    const context = await this.resolveDomainContext(hostname);
    let content: string;

    switch (context.app_type) {
      case 'VENDIX_LANDING':
        content = `User-agent: *
Allow: /

Sitemap: ${context.base_url}/sitemap.xml
`;
        break;

      case 'ORG_LANDING':
        content = `User-agent: *
Allow: /

Sitemap: ${context.base_url}/sitemap.xml
`;
        break;

      case 'STORE_ECOMMERCE':
        // Listados, productos y categorías (`?category_ids=`, `?brand_ids=`) siguen
        // rastreables. Se bloquean la búsqueda libre y los rangos de precio (espacio
        // de URL infinito), los parámetros de orden y las páginas privadas o con
        // token (pedido, factura, reserva, cuenta). `Allow: /cartas` es necesario
        // porque `Disallow: /cart` también casa por prefijo con `/cartas`.
        content = `User-agent: *
Allow: /
Allow: /catalog
Allow: /products
Allow: /novedades
Allow: /ofertas
Allow: /cartas
Disallow: /cart
Disallow: /wishlist
Disallow: /checkout
Disallow: /account
Disallow: /api/
Disallow: /*?*search=
Disallow: /*?*min_price=
Disallow: /*?*max_price=
Disallow: /*?*sort=
Disallow: /*?*sort_by=
Disallow: /*?*order_by=
Disallow: /pedido/
Disallow: /order/
Disallow: /factura/
Disallow: /preconsulta/
Disallow: /book/
Disallow: /hotel/reserva/
Disallow: /fila
Disallow: /reset-password

Sitemap: ${context.base_url}/sitemap.xml
`;
        break;

      default:
        // Admin panels — block all indexing
        content = `User-agent: *
Disallow: /
`;
        break;
    }

    await this.cache.set(cacheKey, content, 3_600_000);
    return content;
  }

  // ---------------------------------------------------------------------------
  // Sitemap builders by app_type
  // ---------------------------------------------------------------------------

  private buildVendixLandingSitemap(base_url: string): string {
    const baseDomain = DomainConfigService.getBaseDomain();
    const canonicalBase =
      base_url === `https://www.${baseDomain}`
        ? `https://${baseDomain}`
        : base_url;

    // /ayuda, /pqr and /legal/* exist in the SPA, but the CDN currently serves
    // them with HTTP 404; restore them to the sitemap when the CDN is fixed.

    // Generation/cache time is not an editorial modification date.
    return this.buildSitemapXml(canonicalBase, MARKETING_SITEMAP_PAGES);
  }

  private async buildOrgLandingSitemap(
    context: DomainContext,
  ): Promise<string> {
    const now = new Date().toISOString();

    // Org landing is a single page, but we can also list its active stores
    const urls = [{ path: '/', priority: '1.0', changefreq: 'weekly' }];

    return this.buildSitemapXml(context.base_url, urls, now);
  }

  private async buildEcommerceSitemap(context: DomainContext): Promise<string> {

    const static_urls = [
      { path: '/', priority: '1.0', changefreq: 'daily' },
      { path: '/catalog', priority: '0.9', changefreq: 'daily' },
      { path: '/novedades', priority: '0.8', changefreq: 'daily' },
      { path: '/ofertas', priority: '0.8', changefreq: 'daily' },
    ];

    // Fetch active ecommerce products
    const store_products = context.store_id
      ? await this.globalPrisma.products.findMany({
          where: {
            store_id: context.store_id,
            state: 'active',
            available_for_ecommerce: true,
          },
          select: { slug: true, updated_at: true },
          orderBy: { updated_at: 'desc' },
        })
      : [];

    // Un slug vacío publicaría `/products/` (el listado) como producto, y uno con
    // caracteres fuera de `isValidSlug` no es una URL limpia: se omiten del sitemap.
    const products = store_products.filter((p) => isValidSlug(p.slug));
    const skipped = store_products.length - products.length;
    if (skipped > 0) {
      this.logger.warn(
        `Ecommerce sitemap: ${skipped} products of store ${context.store_id} skipped for empty/invalid slug`,
      );
    }

    // Los listados cambian cuando cambia un producto: su lastmod es el del producto
    // modificado más reciente. La hora de generación del sitemap no es una fecha de
    // modificación (antes se publicaba «ahora» en cada consulta).
    const listings_lastmod = products[0]?.updated_at?.toISOString() ?? null;

    const static_entries = static_urls
      .map(
        (u) => `  <url>
    <loc>${escapeXml(context.base_url + u.path)}</loc>
${listings_lastmod ? `    <lastmod>${listings_lastmod}</lastmod>
` : ''}    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`,
      )
      .join('\n');

    const product_entries = products
      .map(
        (p) => `  <url>
    <loc>${escapeXml(context.base_url + '/products/' + p.slug)}</loc>
${p.updated_at ? `    <lastmod>${p.updated_at.toISOString()}</lastmod>
` : ''}    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`,
      )
      .join('\n');

    this.logger.log(
      `Ecommerce sitemap: ${static_urls.length} static + ${products.length} products`,
    );

    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${static_entries}
${product_entries}
</urlset>`;
  }

  private buildMinimalSitemap(base_url: string): string {
    const now = new Date().toISOString();
    return this.buildSitemapXml(
      base_url,
      [{ path: '/', priority: '1.0', changefreq: 'monthly' }],
      now,
    );
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private buildSitemapXml(
    base_url: string,
    urls: ReadonlyArray<{ path: string; priority: string; changefreq: string }>,
    lastmod?: string,
  ): string {
    const entries = urls
      .map(
        (u) => `  <url>
    <loc>${escapeXml(base_url + u.path)}</loc>
${lastmod ? `    <lastmod>${lastmod}</lastmod>\n` : ''}    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`,
      )
      .join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>`;
  }

  private async resolveDomainContext(hostname: string): Promise<DomainContext> {
    try {
      const domain = await this.publicDomainsService.resolveDomain(hostname);

      return {
        app_type: domain.app ?? 'VENDIX_LANDING',
        base_url: `https://${hostname}`,
        store_id: domain.store_id,
        organization_id: domain.organization_id,
      };
    } catch {
      this.logger.warn(
        `Domain resolution failed for ${hostname}, falling back to vendix`,
      );
    }

    // Fallback: vendix landing
    return this.resolveVendixCoreFallback();
  }

  private async resolveVendixCoreFallback(): Promise<DomainContext> {
    const base_domain = DomainConfigService.getBaseDomain();

    const org = await this.globalPrisma.organizations.findFirst({
      where: { slug: 'vendix' },
      select: { id: true },
    });

    const store = org
      ? await this.globalPrisma.stores.findFirst({
          where: { organization_id: org.id, is_active: true },
          select: { id: true },
        })
      : null;

    return {
      app_type: 'VENDIX_LANDING',
      base_url: `https://${base_domain}`,
      store_id: store?.id,
      organization_id: org?.id,
    };
  }
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
