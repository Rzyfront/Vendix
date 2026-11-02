import { PublicSeoService } from '../../../public/seo/public-seo.service';
import { DomainConfigService } from '@common/config/domain.config';

jest.mock('../../../../prisma/services/global-prisma.service', () => ({
  GlobalPrismaService: class {},
}));
jest.mock('../../../public/domains/public-domains.service', () => ({
  PublicDomainsService: class {},
}));

/**
 * Apps · landing page SEO (Fase 6): the landing's own domain gets its sitemap
 * and an indexable robots; the primary `{tienda}-store` domain, which also
 * renders the landing (`STORE_LANDING`), keeps blocking all indexing.
 */
describe('PublicSeoService · landing page', () => {
  let service: PublicSeoService;
  let appRow: any;

  beforeEach(() => {
    jest.spyOn(DomainConfigService, 'getBaseDomain').mockReturnValue('vendix.online');
    appRow = {
      config: { offer_mode: 'product', offer_product_id: 7 },
      domain_settings: { hostname: 'roku-landing.vendix.online', status: 'active' },
    };
    const globalPrisma = {
      store_apps: { findFirst: jest.fn(async () => appRow) },
      crm_landing_pages: {
        findFirst: jest.fn(async () => ({ enabled: true, published_json: {} })),
      },
      products: {
        findFirst: jest.fn(async () => ({ id: 7, slug: 'combo', name: 'Combo' })),
      },
    };
    const publicDomains = {
      resolveDomain: jest.fn(async () => ({ app: 'STORE_LANDING', store_id: 10 })),
    };
    const cache = { get: jest.fn(async () => undefined), set: jest.fn() };
    service = new PublicSeoService(
      globalPrisma as any,
      publicDomains as any,
      cache as any,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('the landing domain lists / and the offer product', async () => {
    const xml = await service.generateSitemap('roku-landing.vendix.online');

    expect(xml).toContain('<loc>https://roku-landing.vendix.online/</loc>');
    expect(xml).toContain('<loc>https://roku-landing.vendix.online/products/combo</loc>');
  });

  it('the landing domain is indexable except cart, checkout and token pages', async () => {
    const robots = await service.generateRobotsTxt('roku-landing.vendix.online');

    expect(robots).toContain('Allow: /\n');
    expect(robots).toContain('Disallow: /checkout');
    expect(robots).toContain('Disallow: /pedido/');
    expect(robots).toContain('Sitemap: https://roku-landing.vendix.online/sitemap.xml');
  });

  it('{tienda}-store keeps its current SEO (all blocked, minimal sitemap)', async () => {
    const robots = await service.generateRobotsTxt('roku-store.vendix.online');
    const xml = await service.generateSitemap('roku-store.vendix.online');

    expect(robots).toBe('User-agent: *\nDisallow: /\n');
    expect(xml).not.toContain('/products/');
  });

  it('an unpublished landing app keeps blocking its domain', async () => {
    appRow = null;

    const robots = await service.generateRobotsTxt('roku-landing.vendix.online');

    expect(robots).toBe('User-agent: *\nDisallow: /\n');
  });
});
