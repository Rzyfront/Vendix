import { Injectable, Logger } from '@nestjs/common';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { PublicDomainsService } from '../domains/public-domains.service';
import { DomainConfigService } from '@common/config/domain.config';

interface CacheEntry {
  content: string;
  timestamp: number;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

@Injectable()
export class PublicSeoService {
  private readonly logger = new Logger(PublicSeoService.name);
  private readonly sitemapCache = new Map<string, CacheEntry>();
  private readonly robotsCache = new Map<string, CacheEntry>();

  constructor(
    private readonly globalPrisma: GlobalPrismaService,
    private readonly publicDomainsService: PublicDomainsService,
  ) {}

  async generateSitemap(hostname: string): Promise<string> {
    const cached = this.sitemapCache.get(hostname);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.content;
    }

    const { storeId, baseUrl } = await this.resolveStoreContext(hostname);

    const products = await this.globalPrisma.products.findMany({
      where: {
        store_id: storeId,
        state: 'active',
        available_for_ecommerce: true,
      },
      select: {
        slug: true,
        updated_at: true,
      },
      orderBy: { updated_at: 'desc' },
    });

    const now = new Date().toISOString();

    const staticUrls = [
      { path: '/', priority: '1.0', changefreq: 'daily' },
      { path: '/catalog', priority: '0.9', changefreq: 'daily' },
      { path: '/novedades', priority: '0.8', changefreq: 'daily' },
      { path: '/ofertas', priority: '0.8', changefreq: 'daily' },
    ];

    const staticEntries = staticUrls
      .map(
        (u) => `  <url>
    <loc>${escapeXml(baseUrl + u.path)}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`,
      )
      .join('\n');

    const productEntries = products
      .map(
        (p) => `  <url>
    <loc>${escapeXml(baseUrl + '/products/' + p.slug)}</loc>
    <lastmod>${(p.updated_at ?? new Date()).toISOString()}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`,
      )
      .join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${staticEntries}
${productEntries}
</urlset>`;

    this.sitemapCache.set(hostname, { content: xml, timestamp: Date.now() });
    this.logger.log(
      `Sitemap generated for ${hostname} (store ${storeId}): ${staticUrls.length + products.length} URLs`,
    );

    return xml;
  }

  async generateRobotsTxt(hostname: string): Promise<string> {
    const cached = this.robotsCache.get(hostname);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.content;
    }

    const { baseUrl } = await this.resolveStoreContext(hostname);

    const content = `User-agent: *
Allow: /
Allow: /catalog
Allow: /products
Allow: /novedades
Allow: /ofertas
Disallow: /cart
Disallow: /wishlist
Disallow: /checkout
Disallow: /account
Disallow: /api/

Sitemap: ${baseUrl}/sitemap.xml
`;

    this.robotsCache.set(hostname, { content, timestamp: Date.now() });
    return content;
  }

  private async resolveStoreContext(
    hostname: string,
  ): Promise<{ storeId: number; baseUrl: string }> {
    try {
      const domain = await this.publicDomainsService.resolveDomain(hostname);

      if (domain.store_id) {
        return {
          storeId: domain.store_id,
          baseUrl: `https://${hostname}`,
        };
      }
    } catch (error) {
      this.logger.warn(
        `Domain resolution failed for ${hostname}, falling back to vendix-corp`,
      );
    }

    // Fallback: resolve vendix-corp organization's first active store
    return this.resolveVendixCoreFallback();
  }

  private async resolveVendixCoreFallback(): Promise<{
    storeId: number;
    baseUrl: string;
  }> {
    const org = await this.globalPrisma.organizations.findFirst({
      where: { slug: 'vendix-corp' },
      select: { id: true },
    });

    if (!org) {
      throw new Error('Fallback organization vendix-corp not found');
    }

    const store = await this.globalPrisma.stores.findFirst({
      where: { organization_id: org.id, is_active: true },
      select: { id: true },
    });

    if (!store) {
      throw new Error('No active store found for vendix-corp');
    }

    const baseDomain = DomainConfigService.getBaseDomain();
    return {
      storeId: store.id,
      baseUrl: `https://${baseDomain}`,
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
